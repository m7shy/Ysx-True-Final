"""
criteria.py -- single source of truth for "what qualifies as a lead".

Every threshold and signal-word list that main.py's run_gauntlet() gates on,
and that orchestrator.py's Gemini prompt describes, lives here as one
Criteria dataclass. Both modules load the same values instead of keeping
independent copies -- the drift that motivated this file: orchestrator.py's
_ICP_BLOCK described a 10-word signal vocabulary that main.py had already
outgrown, so Gemini kept being told to avoid channels the scraper would
actually accept.

Deliberately stdlib-only (no curl_cffi / yt_dlp / google-genai imports) so
orchestrator.py can import this without pulling in main.py's entire runtime
dependency chain.

Precedence, lowest to highest: dataclass defaults -> <profile_dir>/settings.json
-> YSX_SCRAPER_* environment variables. Every field is clamped afterwards, so
even a hand-edited settings.json or a misconfigured env var can't push a
threshold somewhere the crawl budget can't afford (see _clamp()).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path

SETTINGS_FILENAME = "settings.json"

# Default signal vocabulary. Mirrors the STRONG_SIGNALS / WEAK_SIGNALS widened
# 2026-07-25: orchestrator.py's own prompts (rounds 2 and 5) anchor on
# platform names and group formats that the old 10-word gate didn't accept,
# so the generator was finding channels the gate then permanently
# blacklisted (31% of one run's skips). score() does SUBSTRING matching --
# that's why "whop"/"circle"/"maven" appear only as domains ("whopping",
# "circles", Apache Maven would otherwise false-positive), and why bare
# "skool" is absent (matches "old skool" on music/gaming channels) in favour
# of the phrases below. Bare "community"/"challenge" are deliberately
# excluded -- they appear on nearly every channel and would neuter the gate.
DEFAULT_STRONG_SIGNALS = frozenset({
    "course", "enroll", "masterclass", "workshop", "bootcamp", "mastermind",
    "accelerator", "cohort", "academy", "certification", "curriculum",
    "webinar", "membership", "digital product", "group coaching",
    "1:1 coaching", "waitlist",
    "work with me", "book a call", "free training", "apply now",
    "gumroad", "teachable", "kajabi", "stan.store", "thinkific", "podia",
    "udemy", "patreon", "kartra", "clickfunnels", "samcart", "thrivecart",
    "memberful", "mighty networks",
    "skool.com", "circle.so", "maven.com", "whop.com", "systeme.io",
})
DEFAULT_WEAK_SIGNALS = frozenset({
    "coaching", "program", "mentorship", "consulting", "training",
    "ebook", "e-book", "downloadable", "my students", "my clients",
    "skool community", "skool group", "my skool", "join my skool",
    "paid community", "private community", "membership community",
})


@dataclass
class Criteria:
    """One tenant's qualification thresholds. Field names match the JSON keys
    written by server/src/scraper/service.ts (camelCase) via _FIELD_ALIASES
    below, and the ScraperSettings Prisma column names on the Node side."""

    min_subs: int = 1_000
    max_subs: int = 50_000
    recent_days: int = 15
    min_avg_views: int = 1_000
    min_longform_ratio: float = 0.40
    longform_min_secs: int = 60
    search_results: int = 50
    uploads_sample: int = 15
    face_check_sample: int = 3
    # How many days before a temporarily-rejected channel (subs out of band,
    # avg views too low, long-form ratio too low, no recent upload) is
    # eligible to be re-crawled instead of staying permanently blacklisted.
    recheck_days: int = 30
    strong_signals: frozenset = field(default_factory=lambda: DEFAULT_STRONG_SIGNALS)
    weak_signals: frozenset = field(default_factory=lambda: DEFAULT_WEAK_SIGNALS)


# JSON/env key (camelCase or SCREAMING_SNAKE) -> dataclass field name.
_FIELD_ALIASES = {
    "minSubs": "min_subs",
    "maxSubs": "max_subs",
    "recentDays": "recent_days",
    "minAvgViews": "min_avg_views",
    "minLongformRatio": "min_longform_ratio",
    "longformMinSecs": "longform_min_secs",
    "searchResults": "search_results",
    "uploadsSample": "uploads_sample",
    "faceCheckSample": "face_check_sample",
    "recheckDays": "recheck_days",
    "strongSignals": "strong_signals",
    "weakSignals": "weak_signals",
}

_INT_FIELDS = frozenset({
    "min_subs", "max_subs", "recent_days", "min_avg_views",
    "longform_min_secs", "search_results", "uploads_sample",
    "face_check_sample", "recheck_days",
})
_FLOAT_FIELDS = frozenset({"min_longform_ratio"})
_LIST_FIELDS = frozenset({"strong_signals", "weak_signals"})

# Clamp bounds: field -> (min, max). Guards against a setting that would burn
# the crawl budget (e.g. MAX_SUBS=10_000_000) or, for signal terms, reopen the
# false-positive trap score()'s substring matching creates (see MIN_TERM_LEN).
_CLAMP_BOUNDS = {
    "min_subs": (0, 2_000_000),
    "max_subs": (0, 2_000_000),
    "recent_days": (1, 365),
    "min_avg_views": (0, 1_000_000),
    "min_longform_ratio": (0.0, 1.0),
    "longform_min_secs": (1, 3_600),
    "search_results": (5, 200),
    "uploads_sample": (3, 50),
    "face_check_sample": (0, 10),
    "recheck_days": (1, 365),
}

MAX_SIGNAL_TERMS = 60
MAX_TERM_LEN = 40
# score() matches by substring -- a term shorter than this false-positives
# constantly (e.g. "app" inside "happy", "wrap up"). Terms containing a "."
# (domains like "stan.store") are exempt: they're deliberately short and
# specific enough not to collide.
MIN_TERM_LEN = 4


def _sanitize_signal_list(raw) -> frozenset:
    if not isinstance(raw, (list, tuple, set, frozenset)):
        return frozenset()
    out: list[str] = []
    seen: set[str] = set()
    for term in raw:
        if not isinstance(term, str):
            continue
        t = term.strip().lower()
        if not t or t in seen:
            continue
        if len(t) > MAX_TERM_LEN:
            continue
        if len(t) < MIN_TERM_LEN and "." not in t:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= MAX_SIGNAL_TERMS:
            break
    return frozenset(out)


def _clamp(c: Criteria) -> None:
    for name, (lo, hi) in _CLAMP_BOUNDS.items():
        val = getattr(c, name)
        try:
            val = type(lo)(val)
        except (TypeError, ValueError):
            val = lo
        val = max(lo, min(hi, val))
        setattr(c, name, val)

    if c.max_subs < c.min_subs:
        c.max_subs = c.min_subs

    c.strong_signals = _sanitize_signal_list(c.strong_signals) or DEFAULT_STRONG_SIGNALS
    c.weak_signals = _sanitize_signal_list(c.weak_signals) or DEFAULT_WEAK_SIGNALS


def _coerce(field_name: str, value):
    if field_name in _INT_FIELDS:
        return int(value)
    if field_name in _FLOAT_FIELDS:
        return float(value)
    if field_name in _LIST_FIELDS:
        return _sanitize_signal_list(value)
    return value


def _apply_overrides(c: Criteria, data: dict, source: str) -> None:
    for key, raw_value in data.items():
        field_name = _FIELD_ALIASES.get(key, key if key in _FIELD_ALIASES.values() else None)
        if field_name is None:
            continue
        try:
            setattr(c, field_name, _coerce(field_name, raw_value))
        except (TypeError, ValueError) as exc:
            print(
                f"[criteria] WARNING: ignoring bad value for {key!r} from {source}: {exc}",
                file=sys.stderr,
            )


def _apply_env_overrides(c: Criteria) -> None:
    """YSX_SCRAPER_<FIELD_NAME> env vars, e.g. YSX_SCRAPER_MIN_SUBS=2000.
    Signal lists take a comma-separated list."""
    valid_fields = {f.name for f in fields(Criteria)}
    for env_key, raw_value in os.environ.items():
        if not env_key.startswith("YSX_SCRAPER_"):
            continue
        field_name = env_key[len("YSX_SCRAPER_"):].lower()
        if field_name not in valid_fields:
            continue
        try:
            if field_name in _LIST_FIELDS:
                value = [t.strip() for t in raw_value.split(",") if t.strip()]
            else:
                value = raw_value
            setattr(c, field_name, _coerce(field_name, value))
        except (TypeError, ValueError) as exc:
            print(
                f"[criteria] WARNING: ignoring bad value for {env_key!r}: {exc}",
                file=sys.stderr,
            )


def load(profile_dir: "Path | str | None") -> Criteria:
    """Build the effective Criteria for a run: defaults -> settings.json (if
    profile_dir is given and the file exists) -> YSX_SCRAPER_* env -> clamp.

    Never raises: a missing or malformed settings.json falls back to defaults
    with a warning printed to stderr, so a bad file can't take down a scrape.
    """
    c = Criteria()

    if profile_dir is not None:
        settings_path = Path(profile_dir) / SETTINGS_FILENAME
        if settings_path.exists():
            try:
                with open(settings_path, encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, dict):
                    _apply_overrides(c, data, str(settings_path))
                else:
                    print(
                        f"[criteria] WARNING: {settings_path} is not a JSON object -- using defaults",
                        file=sys.stderr,
                    )
            except (OSError, json.JSONDecodeError) as exc:
                print(
                    f"[criteria] WARNING: failed to read {settings_path}: {exc} -- using defaults",
                    file=sys.stderr,
                )

    _apply_env_overrides(c)
    _clamp(c)
    return c


def _fmt_subs(n: int) -> str:
    if n >= 1_000 and n % 1_000 == 0:
        return f"{n // 1_000}k"
    return f"{n:,}"


def describe_for_prompt(c: Criteria) -> str:
    """Render the TARGET CHANNEL PROFILE block orchestrator.py sends to
    Gemini. Generated from `c` rather than hand-maintained, so it can no
    longer drift from what main.py's run_gauntlet() actually accepts."""
    min_longform_count = max(1, round(c.uploads_sample * c.min_longform_ratio))
    strong = ", ".join(sorted(c.strong_signals))
    weak = ", ".join(sorted(c.weak_signals))
    return f"""\
TARGET CHANNEL PROFILE (mirrors the scraper's filter criteria exactly):
  Subscribers    : {c.min_subs:,} to {c.max_subs:,}  (small/mid creators; larger channels waste quota)
  Language       : English
  Geography      : US, UK, Canada, Australia  (other geos are auto-filtered at scrape time)
  Activity       : Has uploaded at least one video within the last {c.recent_days} days
  Content format : Long-form videos (>{c.longform_min_secs} seconds); at least {min_longform_count} of the last {c.uploads_sample} uploads must qualify
  Business model : Actively sells at least one of:
                   course / program / coaching package / masterclass / digital product
  Description signal requirement -- channel description MUST contain at least one of:
    STRONG signals (score 2): {strong}
    WEAK   signals (score 1): {weak}
    Score 0 = instant disqualification. Your queries MUST surface channels that score >= 1.\
"""


def hard_ban_rule_1(c: Criteria) -> str:
    """The subscriber-band clause of _HARD_BANS rule 1, indented to drop
    straight into orchestrator.py's numbered list. Rendered from `c` so it
    can't drift from the actual MAX_SUBS the way it did after the 2026-07-25
    band widening (was left saying ">10k subs" against a 50k cap)."""
    return (
        "  1. No proper names of famous creators or celebrities.\n"
        f"     These attract mega-channels (>{_fmt_subs(c.max_subs)} subs) that burn quota and never qualify.\n"
        '     BANNED: "Ali Abdaal", "Alex Hormozi", "Tony Robbins", any influencer surname.'
    )
