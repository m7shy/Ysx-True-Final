"""
orchestrator.py -- zero-touch daily daemon for the YT Lead Scraper.

Runs continuously in the background. Once every 24 hours it wakes up,
generates EXACTLY 10 fresh keywords with Gemini, runs the scraper pipeline
(main.py), then goes back to sleep. Completion is tracked per calendar date
in daemon_state.json, so a kill/restart never double-runs (or skips) a day.

Usage:
  python orchestrator.py
  python orchestrator.py --niche "crm-<userId>" --keywords 4 --once

Environment (.env):
  YOUTUBE_API_KEYS       -- existing, required
  GOOGLE_CLOUD_PROJECT   -- required for Vertex AI (your GCP project ID)
  GOOGLE_CLOUD_LOCATION  -- optional, default: us-central1
  GEMINI_MODEL           -- optional, default: gemini-2.0-flash
  ORCHESTRATOR_NICHE     -- optional, default: "B2B Coaching" (overridden by --niche)

CLI flags (only meaningful together, for a single scheduled burst):
  --niche NICHE     isolate this run under profiles/<niche>/ (overrides
                     ORCHESTRATOR_NICHE without needing an env var per call)
  --keywords N       fresh keywords to generate this run (overrides the
                     10/day daemon default -- a scheduler doing several
                     short runs per day wants fewer keywords per burst)
  --once             run exactly ONE cycle (Gemini keywords -> main.py) and
                     exit, instead of the infinite daily-sleep loop. Skips the
                     calendar-day gate entirely: the caller (e.g. the CRM's
                     autoScheduler.ts) owns "when's the next run", not this
                     script's own daily state file.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import date, datetime, timedelta
from pathlib import Path

from google import genai
from dotenv import load_dotenv

from session_profile import SessionProfile

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
NICHE        = os.getenv("ORCHESTRATOR_NICHE", "B2B Coaching")

# ── Per-niche workspace ───────────────────────────────────────────────────────
# Every file this daemon writes lives under profiles/<niche>/ so distinct niches
# keep separate keyword memory, leads, and run state. The same profile directory
# is handed to main.py via `--niche`, so the scraper writes its leads/tracking DB
# into the same place the daemon reads them back from.
PROFILE            = SessionProfile(NICHE)
KEYWORDS_FILE      = PROFILE.keywords         # main.py reads this for the niche
USED_KEYWORDS_FILE = PROFILE.used_keywords    # persistent cross-session keyword memory bank
LEADS_FILE         = PROFILE.leads
STATE_FILE         = PROFILE.daemon_state     # persistent daily-run completion tracker

# ── Daemon schedule ───────────────────────────────────────────────────────────
KEYWORDS_PER_DAY   = 10      # EXACTLY this many fresh keywords per daily run
POLL_SECONDS       = 60      # granularity of the sleep loop (survives clock jumps)
RETRY_ON_FAIL_SECS = 3600    # if a daily run fails, retry after an hour (same day)


def use_niche(niche: str) -> None:
    """Repoint every per-niche global at `niche`'s profile directory.

    Mirrors main.py's use_profile() rebind idiom exactly (see main.py ~line
    1852): called once, early, before any of PROFILE/KEYWORDS_FILE/etc. are
    read, so a single process can target an arbitrary niche instead of only
    whatever ORCHESTRATOR_NICHE happened to be at import time.
    """
    global NICHE, PROFILE, KEYWORDS_FILE, USED_KEYWORDS_FILE, LEADS_FILE, STATE_FILE
    NICHE              = niche
    PROFILE            = SessionProfile(NICHE)
    KEYWORDS_FILE      = PROFILE.keywords
    USED_KEYWORDS_FILE = PROFILE.used_keywords
    LEADS_FILE         = PROFILE.leads
    STATE_FILE         = PROFILE.daemon_state

# ── Gemini API guardrails ─────────────────────────────────────────────────────
# These exist because used_keywords.txt grew past 200 entries, which bloated the
# prompt, slowed the Vertex AI call, and let it hang the orchestrator's main
# thread indefinitely. The three values below cap context size, wall-clock wait,
# and retry effort respectively.
API_TIMEOUT_SECONDS    = 30                       # hard wall-clock cap on a single Gemini call
API_TIMEOUT_MS         = API_TIMEOUT_SECONDS * 1000  # google-genai HttpOptions wants milliseconds
MAX_API_RETRIES        = 3                        # total attempts before giving up on a round
RETRY_BACKOFF_SECONDS  = 15                       # base sleep between retries (grows exponentially)
MAX_EXCLUSION_KEYWORDS = 50                       # only the most-recent N exclusions go in the prompt


# ── CSV helpers ───────────────────────────────────────────────────────────────

def count_csv_rows(path: Path) -> int:
    """Return the number of data rows in a CSV (header excluded). 0 if missing."""
    if not path.exists():
        return 0
    try:
        with open(path, encoding="utf-8", newline="") as fh:
            return sum(1 for _ in csv.DictReader(fh))
    except Exception:
        return 0


# ── Persistent daemon state ───────────────────────────────────────────────────

def load_state() -> dict:
    """Load daemon_state.json. Returns a fresh default state if missing/corrupt."""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, encoding="utf-8") as fh:
                state = json.load(fh)
            if isinstance(state, dict):
                state.setdefault("last_completed_date", "")
                state.setdefault("total_runs", 0)
                return state
        except Exception:
            pass
    return {"last_completed_date": "", "total_runs": 0}


def save_state(state: dict) -> None:
    """Atomically persist daemon state so a kill mid-write cannot corrupt it."""
    tmp = STATE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)
    os.replace(tmp, STATE_FILE)


def already_ran_today(state: dict) -> bool:
    return state.get("last_completed_date") == date.today().isoformat()


# ── Keyword memory bank ───────────────────────────────────────────────────────

def load_used_keywords() -> list[str]:
    """Load all keywords previously generated across every session from used_keywords.txt.

    This is the cross-session memory bank. Every keyword Gemini has ever generated
    for this project is stored here so it is never repeated in future sessions.
    Returns an empty list if the file does not exist yet.
    """
    if not USED_KEYWORDS_FILE.exists():
        return []
    with open(USED_KEYWORDS_FILE, encoding="utf-8") as fh:
        return [ln.strip() for ln in fh if ln.strip() and not ln.startswith("#")]


def append_to_used_keywords(keywords: list[str]) -> None:
    """Append a freshly generated batch of keywords to used_keywords.txt.

    Called immediately after Gemini returns a batch, before main.py runs,
    so the memory bank is updated even if the scraper is interrupted mid-run.
    """
    with open(USED_KEYWORDS_FILE, "a", encoding="utf-8") as fh:
        for kw in keywords:
            fh.write(f"{kw}\n")


# ── Subprocess runner ─────────────────────────────────────────────────────────

def run_script(script: str, *script_args: str) -> int:
    """Run a sibling Python script, streaming its stdout/stderr in real-time.

    Returns the process exit code.
    """
    # -u / PYTHONUNBUFFERED: the child writes to a pipe, not a TTY, so without
    # this its stdout is block-buffered and only flushes in ~8KB chunks — making
    # the live log arrive in bursts instead of line-by-line. Unbuffering streams
    # each line straight through to the CRM's live log panel (matters for the
    # long auto-runs this drives). utf-8 matches the Node spawn so emoji/em-dash
    # breadcrumbs don't get mangled on a cp1252 console.
    cmd = [sys.executable, "-u", script, *script_args]
    print(f"\n  $ python {script} {' '.join(script_args)}".rstrip())
    print(f"  {'=' * 58}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=Path(__file__).parent,
        env={**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"},
    )

    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        print(f"  | {line}", end="", flush=True)

    proc.stdout.close()
    rc = proc.wait()

    status = "OK" if rc == 0 else f"exit {rc}"
    print(f"  {'=' * 58}")
    print(f"  Script finished ({status})\n")
    return rc


# ── Hardcoded ICP + prompt constants ─────────────────────────────────────────
# These constants mirror the exact filter criteria enforced by main.py.
# They are intentionally baked here — not read from a file or env var — so
# the Gemini prompt can never drift from the scraper's actual acceptance logic.

_ICP_BLOCK = """\
TARGET CHANNEL PROFILE (mirrors the scraper's filter criteria exactly):
  Subscribers    : 500 to 10,000  (micro-creators only; larger channels waste quota)
  Language       : English
  Geography      : US, UK, Canada, Australia  (other geos are auto-filtered at scrape time)
  Activity       : Has uploaded at least one video within the last 15 days
  Content format : Long-form videos (>60 seconds); channel must have >= 10 such videos
  Business model : Actively sells at least one of:
                   course / program / coaching package / masterclass / digital product
  Description signal requirement -- channel description MUST contain at least one of:
    STRONG signals (score 2): course, enroll, gumroad, teachable, kajabi, stan.store, masterclass
    WEAK   signals (score 1): coaching, program, mentorship
    Score 0 = instant disqualification. Your queries MUST surface channels that score >= 1.\
"""

_HARD_BANS = """\
HARD BANS -- queries that violate any of these rules will be rejected:
  1. No proper names of famous creators or celebrities.
     These attract mega-channels (>10k subs) that burn quota and never qualify.
     BANNED: "Ali Abdaal", "Alex Hormozi", "Tony Robbins", any influencer surname.
  2. No YouTube-growth meta-queries.
     BANNED: "how to grow YouTube channel", "faceless YouTube channel", "YouTube tips 2024"
  3. No corporate brands, SaaS companies, or media publishers.
  4. No pure entertainment, gaming, reaction, vlog, or news channels.
  5. No platform names as the SUBJECT of the query (attracts the platform's own content).
     BANNED: "kajabi tutorial", "how to use gumroad", "teachable review"
     ALLOWED: "kajabi course creator", "gumroad digital product coach"
  6. No queries likely to surface India, Brazil, Pakistan, or Philippines creators.
     These geo-filter at scrape time but waste the 100-unit search quota.
     AVOID: rupee, hindi, urdu, tagalog, strong regional phrases.
  7. No standalone motivational phrases with no commercial signal.
     BANNED: "mindset transformation", "positive thinking daily"
     ALLOWED: "mindset coaching online program", "mindset course enroll"\
"""

# Per-round angle strategies. Rounds 1-5 are explicit. Round 6+ uses _DEEP_ANGLE.
_ROUND_ANGLES: dict[int, str] = {
    1: (
        "ROUND 1 -- DIRECT SIGNAL SWEEP\n"
        "Generate queries built from the exact words that appear in qualifying channel descriptions.\n"
        "Think: what would a coach WRITE in their YouTube About section?\n"
        "Lead with: course, program, coaching, enroll, masterclass, or mentorship.\n"
        "Mix 2-word punchy terms with 4-5-word descriptive phrases.\n"
        "RIGHT: 'online course creator coaching', 'enroll coaching program', "
        "'business masterclass small creator'\n"
        "WRONG: 'YouTube business channel', 'entrepreneur videos'"
    ),
    2: (
        "ROUND 2 -- PLATFORM ANCHOR\n"
        "Use course/coaching platform names as QUALIFIERS for the CREATOR, not for the platform.\n"
        "The platform name signals the creator has built and is selling a product.\n"
        "Platforms to anchor on: Kajabi, Gumroad, Teachable, Stan Store, Skool, "
        "Thinkific, Podia, Circle, Maven, Whop, Patreon (for paid courses), Udemy.\n"
        "RIGHT: 'gumroad course creator', 'teachable program coach', "
        "'stan store coaching business', 'skool community coach'\n"
        "WRONG: 'how to use kajabi', 'gumroad tutorial', 'best teachable courses'"
    ),
    3: (
        "ROUND 3 -- OUTCOME AND TRANSFORMATION\n"
        "Coaches name their offers by the result they deliver. Queries must lead with the "
        "TRANSFORMATION the student achieves after buying.\n"
        "Think: what does the buyer BECOME or ACHIEVE? Then attach a commercial signal.\n"
        "RIGHT: 'six figure freelancer coaching program', 'weight loss online coach enroll', "
        "'public speaking confidence masterclass'\n"
        "WRONG: 'weight loss tips', 'freelance advice YouTube'\n"
        "Every query in this round must pair a specific outcome with: program, course, "
        "coaching, coach, or masterclass."
    ),
    4: (
        "ROUND 4 -- PAIN POINT ANCHORING\n"
        "Coaches speak directly to problems. Surface channels by the pain they solve.\n"
        "Think: what does someone type into YouTube when they HAVE the problem the coach addresses?\n"
        "Then add a commercial signal so the result is a SELLING channel, not just a content channel.\n"
        "RIGHT: 'stuck freelancer business coach', 'anxiety management online program', "
        "'struggling entrepreneur coaching'\n"
        "WRONG: 'anxiety YouTube channel', 'freelancer struggles'\n"
        "Every query must pair a specific pain-point phrase with: program, course, "
        "coaching, coach, or enroll."
    ),
    5: (
        "ROUND 5 -- COHORT AND COMMUNITY FORMAT\n"
        "Target channels that sell group-based products: cohorts, bootcamps, accelerators, "
        "challenges, communities, and memberships. These formats signal high-ticket offers "
        "and serious commercial intent.\n"
        "Keywords to anchor on: bootcamp, cohort, accelerator, challenge, community, "
        "mastermind, group coaching, live course.\n"
        "RIGHT: 'online bootcamp business coach', 'cohort program creator', "
        "'30-day challenge program enroll', 'mastermind group coaching'\n"
        "Every query must pair a group-format word with a commercial signal word."
    ),
}

_DEEP_ANGLE = (
    "ROUND {n} -- MICRO-NICHE LONG-TAIL\n"
    "All broad and mid-tier angles have been used. Go ultra-specific.\n"
    "Think in sub-niches: a specialist's vocabulary that a generalist would never use.\n"
    "Use 4-6 word queries. Structure: [specific role or sub-topic] + [specific method or "
    "tool] + [commercial signal].\n"
    "RIGHT: 'solopreneur systems automation course', 'dog agility trainer certification program', "
    "'watercolour florals artist passive income course'\n"
    "Every query must open a NEW pocket of YouTube that has not been searched yet. "
    "Do not paraphrase any prior query."
)


# ── Gemini helpers ────────────────────────────────────────────────────────────

def init_gemini() -> genai.Client:
    """Initialise the Gemini client via Vertex AI to bypass free-tier rate limits.

    Requires Application Default Credentials (`gcloud auth application-default login`)
    and GOOGLE_CLOUD_PROJECT set in .env / environment.
    GOOGLE_CLOUD_LOCATION defaults to us-central1.
    """
    project  = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
    if not project:
        raise SystemExit(
            "\n[ERROR] GOOGLE_CLOUD_PROJECT is not set.\n"
            "  1. Add GOOGLE_CLOUD_PROJECT=your-gcp-project-id to your .env file\n"
            "  2. Authenticate: gcloud auth application-default login\n"
            "  3. Ensure the Vertex AI API is enabled in your GCP project\n"
        )
    # A client-level HTTP timeout makes the underlying transport abort the request
    # at API_TIMEOUT_SECONDS, so the worker thread used in generate_keywords cannot
    # outlive the wall-clock timeout enforced there. http_options accepts a dict.
    client = genai.Client(
        vertexai=True,
        project=project,
        location=location,
        http_options={"timeout": API_TIMEOUT_MS},
    )
    # Quick connectivity test -- generates nothing but confirms credentials work
    try:
        client.models.generate_content(
            model=GEMINI_MODEL,
            contents="ping",
            config={"max_output_tokens": 1},
        )
    except Exception as exc:
        raise SystemExit(f"\n[ERROR] Vertex AI / Gemini API test failed: {exc}\n")
    return client


def _is_retryable_error(exc: Exception) -> bool:
    """Return True for transient failures worth retrying: timeouts, 429, 503.

    The new google-genai SDK raises errors that carry the HTTP status on a
    ``code`` (or ``status_code``) attribute, but transport-level timeouts often
    arrive with no clean status, so we also sniff the string representation for
    the relevant signals. Anything else (auth errors, bad requests, quota
    project misconfig) is treated as fatal and not retried.
    """
    # Our own wall-clock guard tripped — definitely worth another try.
    if isinstance(exc, FutureTimeoutError):
        return True
    # Structured API error from google-genai (.code / .status_code = HTTP status).
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code in (429, 503):
        return True
    # Fall back to string inspection for timeouts/throttling the SDK surfaces
    # without a usable status code (httpx timeouts, gRPC deadlines, etc.).
    text = f"{type(exc).__name__}: {exc}".lower()
    needles = (
        "timeout", "timed out", "deadline",
        "429", "rate limit", "resource_exhausted",
        "503", "unavailable", "service unavailable",
    )
    return any(n in text for n in needles)


def _call_gemini(client: genai.Client, prompt: str):
    """Single Gemini generate_content call. Run inside a worker thread so the
    caller can enforce a hard wall-clock timeout via Future.result(timeout=...).
    """
    return client.models.generate_content(model=GEMINI_MODEL, contents=prompt)


def generate_keywords(
    client: genai.Client,
    niche: str,
    count: int,
    used_keywords: list[str],
    round_num: int,
) -> list[str]:
    """Ask Gemini for `count` fresh, ICP-aligned search queries for the given niche.

    The ICP definition, hard bans, and per-round angle strategy are all baked
    directly into this function as module-level constants (_ICP_BLOCK, _HARD_BANS,
    _ROUND_ANGLES, _DEEP_ANGLE) so the prompt is fully self-contained and cannot
    drift from the scraper's actual acceptance criteria.

    `used_keywords` contains every keyword generated across ALL sessions (the full
    permanent record still lives in used_keywords.txt). To keep the prompt small
    and the API call fast, ONLY the most recent MAX_EXCLUSION_KEYWORDS (50) are
    sent to Gemini as the exclusion list — feeding it 200+ exclusions was what
    bloated the request and caused the indefinite hangs.

    Three guardrails protect the daemon's main thread:
      1. Exclusion list truncated to the most recent 50 keywords.
      2. Each API call is hard-capped at API_TIMEOUT_SECONDS (30s) wall-clock.
      3. Timeouts / 429 / 503 trigger exponential backoff, up to MAX_API_RETRIES.

    On total failure this returns an empty list (it never raises), so the caller
    logs the empty round and the daemon safely goes back to sleep.
    """
    angle = _ROUND_ANGLES.get(round_num, _DEEP_ANGLE.format(n=round_num))

    # GUARDRAIL 1 — context management. The full memory bank may hold 200+ entries
    # but we only feed Gemini the most recent slice. The complete record is still
    # persisted to used_keywords.txt by the caller; this only trims the PROMPT.
    recent_exclusions = used_keywords[-MAX_EXCLUSION_KEYWORDS:]
    if recent_exclusions:
        used_block = (
            f"MOST RECENT {len(recent_exclusions)} PREVIOUSLY GENERATED QUERIES "
            f"({len(used_keywords)} total in the memory bank) "
            f"-- do NOT repeat or paraphrase any of these:\n"
            + "\n".join(recent_exclusions)
        )
    else:
        used_block = "ALL PREVIOUSLY GENERATED QUERIES: none yet -- this is the first round."

    prompt = f"""\
You are a YouTube channel researcher building a qualified lead list.

NICHE: "{niche}"

{_ICP_BLOCK}

{_HARD_BANS}

CURRENT ANGLE:
{angle}

{used_block}

OUTPUT FORMAT -- follow exactly or your output will be discarded:
- Output EXACTLY {count} queries
- One query per line, nothing else
- 2-7 words per query
- No numbering, no bullets, no dashes, no commentary, no headers, no blank lines
- No query may be a paraphrase or synonym rearrangement of any previously generated query
- Every query must directly serve the ICP and niche above

Output {count} queries for the "{niche}" niche now:\
"""

    # GUARDRAILS 2 & 3 — hard timeout + exponential backoff/retry.
    # Each attempt runs the blocking SDK call in a worker thread and waits at most
    # API_TIMEOUT_SECONDS for it. If that wall-clock window elapses, or the call
    # raises a transient error (Timeout / 429 / 503), we back off and retry, up to
    # MAX_API_RETRIES. The main thread can never block longer than the timeout.
    response = None
    for attempt in range(1, MAX_API_RETRIES + 1):
        # A fresh single-worker executor per attempt; shutdown(wait=False) means we
        # never join a thread that may still be unwinding, so the main thread is
        # released the instant the timeout fires (the client-level HTTP timeout
        # then tears the orphaned request down on its own).
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gemini-api")
        try:
            future = executor.submit(_call_gemini, client, prompt)
            response = future.result(timeout=API_TIMEOUT_SECONDS)
            break  # success — leave the retry loop
        except Exception as exc:
            response = None
            retryable = _is_retryable_error(exc)
            kind = "TIMEOUT" if isinstance(exc, FutureTimeoutError) else type(exc).__name__
            print(f"  [GEMINI] WARNING: attempt {attempt}/{MAX_API_RETRIES} failed "
                  f"({kind}): {exc}")

            if not retryable:
                print(f"  [GEMINI] Error is not transient -- aborting keyword round.")
                break
            if attempt >= MAX_API_RETRIES:
                break  # exhausted; handled below

            # Exponential backoff seeded at RETRY_BACKOFF_SECONDS: 15s, 30s, 60s...
            wait = RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))
            print(f"  [GEMINI] Transient error -- sleeping {wait}s before retry "
                  f"{attempt + 1}/{MAX_API_RETRIES}.")
            time.sleep(wait)
        finally:
            executor.shutdown(wait=False)

    if response is None:
        print(f"  [GEMINI] ERROR: keyword generation failed after {MAX_API_RETRIES} "
              f"attempt(s). Skipping this run so the daemon can safely "
              f"go back to sleep.")
        return []

    raw = [ln.strip() for ln in response.text.strip().splitlines() if ln.strip()]
    # Strip any accidental formatting Gemini sneaks in
    cleaned = [re.sub(r"^[\d]+[\.\)]\s*|^[-*+]\s*", "", ln) for ln in raw]
    # Drop meta-commentary lines
    filtered = [
        ln for ln in cleaned
        if not re.match(r"(?i)^(here are|note:|output|sure,|okay|alright|these are)", ln)
        and not re.match(r"^[A-Z][A-Z\s]{4,}:$", ln)  # all-caps section headers
    ]
    return filtered[:count]


# ── File writers ──────────────────────────────────────────────────────────────

def write_keywords(keywords: list[str], niche: str, round_num: int) -> None:
    with open(KEYWORDS_FILE, "w", encoding="utf-8") as fh:
        fh.write(f"# Auto-generated by orchestrator.py\n")
        fh.write(f"# Niche: {niche}  |  Keyword round: {round_num}\n")
        for kw in keywords:
            fh.write(f"{kw}\n")
    print(f"  [{KEYWORDS_FILE}] wrote {len(keywords)} keywords")


# ── Daily run ─────────────────────────────────────────────────────────────────

def run_daily_cycle(client: genai.Client, state: dict) -> bool:
    """Execute one full daily cycle: 10 fresh keywords -> scraper pipeline.

    Returns True on success (state is marked completed for today), False if the
    run failed and should be retried later the same day. The round number fed to
    Gemini is total_runs + 1 so the angle strategy keeps rotating day to day.
    """
    today = date.today().isoformat()
    round_num = state.get("total_runs", 0) + 1
    print(f"\n  [{datetime.now():%Y-%m-%d %H:%M:%S}] Starting daily run "
          f"#{round_num} (niche: {NICHE})")

    all_used_keywords = load_used_keywords()
    print(f"  Keyword memory bank: {len(all_used_keywords)} queries loaded "
          f"from {USED_KEYWORDS_FILE}")

    keywords = generate_keywords(
        client=client,
        niche=NICHE,
        count=KEYWORDS_PER_DAY,
        used_keywords=all_used_keywords,
        round_num=round_num,
    )

    if len(keywords) < KEYWORDS_PER_DAY:
        print(f"  [ERROR] Gemini returned {len(keywords)}/{KEYWORDS_PER_DAY} "
              f"keywords -- daily run aborted, will retry.")
        return False

    print(f"  Gemini returned {len(keywords)} keyword(s).")

    # Persist to memory bank BEFORE running the scraper so the file
    # is updated even if the scraper run is interrupted.
    write_keywords(keywords, NICHE, round_num)
    append_to_used_keywords(keywords)

    leads_before = count_csv_rows(LEADS_FILE)
    exit_code = run_script("main.py", "--niche", NICHE)
    leads_after = count_csv_rows(LEADS_FILE)

    if exit_code == 199:
        # Quota exhausted: nothing more can be scraped today anyway, so the day
        # counts as completed and the daemon waits for tomorrow's quota reset.
        print("  [HALTED] Scraper reported API quota exhausted -- treating "
              "today's run as complete.")
    elif exit_code != 0:
        print(f"  [ERROR] Scraper exited with code {exit_code} -- daily run "
              f"failed, will retry.")
        return False

    state["last_completed_date"] = today
    state["total_runs"] = round_num
    save_state(state)

    print(f"  [DONE] Daily run #{round_num} complete: +{leads_after - leads_before} "
          f"lead(s), {leads_after:,} total in {LEADS_FILE}.")
    return True


def sleep_until_next_day() -> None:
    """Sleep in short increments until the next calendar date begins."""
    tomorrow = datetime.combine(date.today() + timedelta(days=1), datetime.min.time())
    print(f"  Sleeping until {tomorrow:%Y-%m-%d %H:%M} "
          f"({(tomorrow - datetime.now()).seconds // 3600}h away)...")
    while datetime.now() < tomorrow:
        time.sleep(min(POLL_SECONDS, max(1, (tomorrow - datetime.now()).total_seconds())))


# ── Main daemon loop ──────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YT Lead Scraper -- Gemini keyword daemon.")
    parser.add_argument("--niche", default=None, help="Override ORCHESTRATOR_NICHE for this process.")
    parser.add_argument("--keywords", type=int, default=None,
                         help="Fresh keywords to generate this run (overrides the 10/day default).")
    parser.add_argument("--once", action="store_true",
                         help="Run exactly one cycle and exit, skipping the daily-sleep loop "
                              "and the calendar-day gate -- for an external scheduler.")
    return parser.parse_args()


def main() -> None:
    global KEYWORDS_PER_DAY

    args = parse_args()
    if args.niche:
        use_niche(args.niche)
    if args.keywords:
        KEYWORDS_PER_DAY = args.keywords

    if args.once:
        print(f"  [once] niche={NICHE!r} keywords={KEYWORDS_PER_DAY}")
        client = init_gemini()
        state = load_state()
        ok = run_daily_cycle(client, state)
        sys.exit(0 if ok else 1)

    print(f"\n  +{'=' * 60}+")
    print(f"  |  YT-SCRAPER DAILY DAEMON  --  INITIALISING{' ' * 18}|")
    print(f"  +{'=' * 60}+")
    print(f"  |  Niche    : {NICHE:<47}|")
    print(f"  |  Cadence  : {KEYWORDS_PER_DAY} keywords, once per calendar day{' ' * 13}|")
    print(f"  |  Model    : {GEMINI_MODEL:<47}|")
    print(f"  |  State    : {str(STATE_FILE):<47}|")
    print(f"  +{'=' * 60}+\n")

    print("  Initialising Gemini... ", end="", flush=True)
    client = init_gemini()
    print(f"OK ({GEMINI_MODEL} via Vertex AI)\n")

    state = load_state()
    if already_ran_today(state):
        print(f"  Today's run ({state['last_completed_date']}) already completed "
              f"before restart -- resuming sleep.")

    try:
        while True:
            if already_ran_today(state):
                sleep_until_next_day()
                continue

            if run_daily_cycle(client, state):
                sleep_until_next_day()
            else:
                print(f"  Retrying failed daily run in "
                      f"{RETRY_ON_FAIL_SECS // 60} minutes...")
                time.sleep(RETRY_ON_FAIL_SECS)

    except KeyboardInterrupt:
        print(f"\n\n  [SHUTDOWN] Daemon stopped. State persisted in {STATE_FILE}; "
              f"restart resumes safely.\n")


if __name__ == "__main__":
    main()
