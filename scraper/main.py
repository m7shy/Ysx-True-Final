"""
YouTube Channel Lead Scraper
Finds YouTube channels of coaches/educators selling courses or programs.
Outputs leads.csv with url, email, avg_views, social_links, external_links columns.

Fully API-free: search, channel enrichment, upload-recency checks, and video
statistics all run through yt-dlp's flat JSON extraction — zero Google API
quota, no API key required. All yt-dlp traffic is dispatched through a shared
proxy-rotation manager with exponential backoff, so HTTP 429 (Too Many
Requests) throttles are absorbed natively: the offending proxy is benched, the
next one takes over, and the request is retried after a growing, jittered wait.

Proxies are optional. Provide them via the PROXY_LIST env var (comma-separated
"http://user:pass@host:port" entries) or a proxies.txt file (one per line,
'#' comments allowed). With no proxies configured, everything runs over the
direct connection and backoff alone handles throttling.
"""

from __future__ import annotations

import argparse
import csv
import datetime
import json
import logging
import os
import random
import re
import signal
import sqlite3
import sys
import time
from pathlib import Path

from curl_cffi import requests
import yt_dlp
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from yt_dlp.networking.impersonate import ImpersonateTarget
from yt_dlp.utils import DownloadError, ExtractorError

import resilient_extractor as rex
from cookie_manager import COOKIE_MANAGER
from request_pacing import poisson_sleep
from session_profile import SessionProfile
from transcript_extractor import fetch_transcript

TRANSCRIPT_WORD_LIMIT = 300  # ~first 1-2 minutes of narration

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
HTTP_TIMEOUT = 30       # hard socket timeout (seconds) on every yt-dlp request
# Browser profile curl_cffi replays at the TLS/HTTP2 layer (JA3, cipher order,
# ALPN, HTTP/2 SETTINGS, header casing/order) so socket-level fingerprinting
# sees a real Chrome handshake, not a Python client.
_IMPERSONATE = "chrome120"

MAX_RETRIES      = 5       # attempts per extraction before giving up on the item
BACKOFF_BASE     = 2.0     # exponential backoff base (seconds)
BACKOFF_CAP      = 120.0   # ceiling on a single backoff sleep
POISSON_LAMBDA   = 1.2     # average inter-request sleep time (seconds) using Poisson distribution

RECENT_DAYS = 15
MIN_SUBS    = 500
MAX_SUBS    = 10_000

# yt-dlp search depth — top N results pulled per keyword.
SEARCH_RESULTS = 50

# How many of a channel's newest uploads feed the long-form / avg-views checks.
UPLOADS_SAMPLE = 15

# Visual gate: how many of the newest uploads' thumbnails get checked for a
# human-face principal element before a channel is treated as faceless/automated.
FACE_CHECK_SAMPLE = 3
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

ALLOWED_COUNTRIES = frozenset({"US", "GB", "CA", "AU"})
ALLOWED_LANGUAGES = frozenset({"en", "ar"})

OUTPUT_FILE       = Path("leads.csv")
QUALIFIED_FILE    = Path("qualified.csv")       # external pipeline export — migrated into the tracking DB
BLACKLIST_FILE    = Path("blacklist.csv")       # legacy — one-time migration source only
INSUFFICIENT_FILE = Path("insufficient_content.csv")  # legacy — one-time migration source only
SKIP_LOG_FILE     = Path("skipped.log")
PROXY_FILE        = Path("proxies.txt")
# Cookie rotation now lives in cookie_manager.COOKIE_MANAGER: a pool of
# Netscape-format cookies.txt files (one per logged-in Google/YouTube account)
# rotated per request, so no single account gets rate-limited or bot-flagged
# under sustained scraping. The legacy single-file YTDLP_COOKIES_FILE env var
# is auto-adopted into the pool on first run (see cookie_manager for details).
# An authenticated session is yt-dlp's own fix for "Sign in to confirm you're
# not a bot" — the strongest trust signal YouTube checks. Falls back to the
# unauthenticated (bot-check-prone) path when the pool is empty.
WEBHOOK_DB_FILE   = Path("webhook_queue.db")
TRACKING_DB_FILE  = Path("tracking.db")         # processed-channel + blacklist state (indexed)
DAEMON_STATE_FILE = Path("daemon_state.json")
PENDING_VERIFICATION_FILE = Path("pending_email_verification.csv")

SMARTLEAD_WEBHOOK_URL = os.getenv("SMARTLEAD_WEBHOOK_URL", "").strip()
WEBHOOK_TIMEOUT       = 10   # seconds per delivery attempt

# ZeroBounce email validation — gates every extracted email before it reaches
# leads.csv, so bounces/spam-traps never touch the cold-sending domain.
ZEROBOUNCE_API_KEY = os.getenv("ZEROBOUNCE_API_KEY", "").strip()
ZEROBOUNCE_URL     = "https://api.zerobounce.net/v2/validate"
ZEROBOUNCE_TIMEOUT = 5   # seconds — on expiry the row is cached for re-check, not dropped
# ZeroBounce statuses that mean "this address will bounce or trip a trap"
ZEROBOUNCE_REJECT_STATUSES = frozenset({"invalid", "abuse", "spamtrap", "do_not_mail"})

LONGFORM_MIN_SECS   = 60    # videos longer than this are counted as long-form
# Proportional Shorts gate: a channel must be majority long-form. At least this
# fraction of its recent uploads must exceed LONGFORM_MIN_SECS, else it is a
# Shorts-dominated channel and routed to insufficient_content.
MIN_LONGFORM_RATIO  = 0.40

# CSV output columns — order matters; external_links is the new column
CSV_FIELDS = ["url", "email", "avg_views", "social_links", "external_links", "priority_lane"]

# ── Signals ───────────────────────────────────────────────────────────────────
STRONG_SIGNALS = frozenset({
    "course", "enroll", "gumroad", "teachable",
    "kajabi", "stan.store", "masterclass",
})
WEAK_SIGNALS = frozenset({
    "coaching", "program", "mentorship",
})

# Existing monetization/sponsorship footprints in video descriptions — used to
# route already-monetized creators into the high-ticket outreach lane.
MONETIZATION_SIGNALS = frozenset({
    "sponsored by", "sponsored", "#ad", "#sponsored", "paid partnership",
    "in partnership with", "brand deal", "affiliate link", "discount code",
    "promo code", "use code",
})

# ── Logging ───────────────────────────────────────────────────────────────────
skip_log = logging.getLogger("skip")
skip_log.setLevel(logging.INFO)
_SKIP_LOG_FMT = logging.Formatter("%(asctime)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")


def _bind_skip_log(path: Path) -> None:
    """Point the skip logger at `path`, replacing any prior file handler.

    Called once at import against the default SKIP_LOG_FILE, and again by
    use_profile() when the active niche changes so each profile's skips land in
    its own skipped.log instead of a shared one.
    """
    for handler in list(skip_log.handlers):
        skip_log.removeHandler(handler)
        handler.close()
    fh = logging.FileHandler(path, encoding="utf-8")
    fh.setFormatter(_SKIP_LOG_FMT)
    skip_log.addHandler(fh)


_bind_skip_log(SKIP_LOG_FILE)


# ── Console-safe output ───────────────────────────────────────────────────────
# Channel titles routinely carry emoji. Rather than globally mutating the stdout
# encoding (sys.stdout.reconfigure), every print goes through safe_print, which
# degrades gracefully on a console that can't encode a glyph (e.g. Windows
# cp1252) instead of crashing the scrape mid-run with a UnicodeEncodeError.

def safe_print(*args, **kwargs) -> None:
    text = " ".join(str(a) for a in args)
    try:
        print(text, **kwargs)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        print(text.encode(enc, "ignore").decode(enc, "ignore"), **kwargs)


# ── List chunking ─────────────────────────────────────────────────────────────

def chunked(seq: list, size: int):
    """Yield successive `size`-length slices of `seq`.

    Enrichment is per-channel under yt-dlp (there is no batch endpoint), but the
    pool is still walked in chunks so progress breadcrumbs and periodic CSV
    flushes happen at a sane cadence.
    """
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


# ── Compatibility shims (legacy Google-API-era names) ─────────────────────────
# run_gauntlet() and the sibling process_*.py scripts were written against the
# Google API wrappers. The names below keep those call sites working unchanged:
#   HttpError            — now the terminal per-item extraction failure raised
#                          by the yt-dlp wrappers after retries are exhausted.
#   QuotaExhaustedError  — kept for interface compatibility; yt-dlp has no
#                          quota, so nothing raises it during a normal run.
#   fits()               — always True: there is no quota budget to check.

class HttpError(Exception):
    """A yt-dlp extraction failed for one item after all retries/proxies.

    Named HttpError so the existing per-channel `except HttpError` handlers in
    run_gauntlet() keep skipping the single bad channel instead of crashing."""


class QuotaExhaustedError(Exception):
    """Legacy terminal-halt signal. With yt-dlp there is no daily quota, so this
    is never raised by the enrichment path; main() still catches it so any
    sibling script that raises it keeps its clean-halt semantics (exit 199)."""


def fits(operation: str) -> bool:  # noqa: ARG001 - kept for call-site compat
    """yt-dlp has no quota — every operation always fits."""
    return True


# ── Proxy rotation manager ────────────────────────────────────────────────────

class ProxyManager:
    """Round-robin proxy rotation with per-proxy 429 cooldowns.

    Sources (first hit wins):
      • PROXY_LIST env var — comma-separated proxy URLs
      • proxies.txt        — one proxy URL per line, '#' comments allowed

    `None` (direct connection) is always the fallback when every proxy is
    cooling down, and is the only route when no proxies are configured. A proxy
    that trips a 429 is benched for a cooldown that doubles on each consecutive
    offence and resets after a clean request.
    """

    _BASE_COOLDOWN = 60.0     # seconds a proxy sits out after its first 429
    _MAX_COOLDOWN  = 900.0

    def __init__(self) -> None:
        self.proxies: list[str] = self._load()
        self._idx = 0
        self._benched_until: dict[str, float] = {}
        self._strikes: dict[str, int] = {}
        if self.proxies:
            safe_print(f"Proxy manager: {len(self.proxies)} prox(ies) loaded, rotating on 429")
        else:
            safe_print("Proxy manager: no proxies configured — direct connection with backoff only")

    @staticmethod
    def _load() -> list[str]:
        raw = os.getenv("PROXY_LIST", "").strip()
        if raw:
            return [p.strip() for p in raw.split(",") if p.strip()]
        if PROXY_FILE.exists():
            lines = PROXY_FILE.read_text(encoding="utf-8").splitlines()
            return [ln.strip() for ln in lines if ln.strip() and not ln.lstrip().startswith("#")]
        return []

    def current(self) -> str | None:
        """Return the proxy to use for the next request (None = direct)."""
        if not self.proxies:
            return None
        now = time.monotonic()
        for _ in range(len(self.proxies)):
            proxy = self.proxies[self._idx % len(self.proxies)]
            if self._benched_until.get(proxy, 0.0) <= now:
                return proxy
            self._idx += 1
        return None  # every proxy is cooling down — go direct

    def report_success(self, proxy: str | None) -> None:
        if proxy:
            self._strikes[proxy] = 0

    def report_throttle(self, proxy: str | None) -> None:
        """Bench the throttled proxy (escalating cooldown) and advance rotation."""
        if proxy:
            strikes = self._strikes.get(proxy, 0) + 1
            self._strikes[proxy] = strikes
            cooldown = min(self._BASE_COOLDOWN * (2 ** (strikes - 1)), self._MAX_COOLDOWN)
            self._benched_until[proxy] = time.monotonic() + cooldown
            safe_print(f"    [proxy] 429 on {proxy} — benched {cooldown:.0f}s, rotating")
        self._idx += 1


PROXY_MANAGER = ProxyManager()


# ── yt-dlp dispatch with rate-limit handling ──────────────────────────────────

_BASE_YDL_OPTS = {
    "quiet": True,            # no progress / banner noise
    "no_warnings": True,
    "skip_download": True,
    "noprogress": True,
    "socket_timeout": HTTP_TIMEOUT,
    "retries": 0,             # retry policy is ours, not yt-dlp's internal one
    "extractor_retries": 0,
    # Route yt-dlp's own extraction traffic through curl_cffi with the same
    # Chrome profile the requests layer uses, so every socket the scraper opens
    # (search, playlist, watch pages) presents an identical browser fingerprint.
    "impersonate": ImpersonateTarget("chrome", _IMPERSONATE.removeprefix("chrome")),
    # `cookiefile` is NOT baked in here any more — COOKIE_MANAGER.current()
    # injects a rotating cookie file per attempt inside ytdlp_extract(), the
    # same way PROXY_MANAGER injects the proxy. yt-dlp treats an empty
    # cookiefile as an error, so it's only set when the pool yields one.
}

# Flat extraction — playlists/tabs/search enumerate entry metadata without
# resolving each video. ignoreerrors so one dead entry can't abort a listing.
_FLAT_OPTS = {**_BASE_YDL_OPTS, "extract_flat": "in_playlist", "ignoreerrors": True}
# Full single-video extraction (used to read a video's exact upload timestamp,
# view count, description, captions). "_no_format_resolve" is our own marker
# (popped in ytdlp_extract, not a real yt-dlp option): every field this scraper
# reads (title/duration/view_count/description/timestamp/upload_date/
# automatic_captions/language) comes from raw extractor metadata, populated
# before yt-dlp resolves/selects a downloadable format — a step we never need
# since skip_download is already set. Skipping it (extract_info(process=False))
# avoids "Requested format is not available", which fires whenever this
# sandbox's missing JS runtime (no node/deno/bun/quickjs) can't solve YouTube's
# signature challenge and every format gets filtered out.
_VIDEO_OPTS = {**_BASE_YDL_OPTS, "_no_format_resolve": True}

_429_MARKERS = ("429", "too many requests")
_TRANSIENT_MARKERS = (
    "timed out", "timeout", "connection reset", "connection refused",
    "temporary failure", "network", "unable to download", "503", "500",
    "internal server error", "service unavailable", "handshake",
)
# YouTube's bot-check / session-invalid signature — distinct from a 429. Means
# the *current cookie's account* is burned or logged out, not that the IP is
# rate-limited, so the cookie gets a long bench (COOKIE_MANAGER.report_bot_check)
# and rotation immediately hands the next attempt a different account.
_BOT_CHECK_MARKERS = (
    "sign in to confirm", "not a bot", "confirm you're not a bot",
    "confirm your age", "login required", "account cookies are no longer valid",
)


def _is_throttle(msg: str) -> bool:
    return any(m in msg for m in _429_MARKERS)


def _is_transient(msg: str) -> bool:
    return any(m in msg for m in _TRANSIENT_MARKERS)


def _is_bot_check(msg: str) -> bool:
    return any(m in msg for m in _BOT_CHECK_MARKERS)


def _throttle_pause() -> None:
    """Polite jittered inter-request delay — keeps the direct/proxy IPs cool."""
    time.sleep(poisson_sleep(POISSON_LAMBDA))


def _backoff(attempt: int, label: str) -> None:
    """Sleep with exponential backoff + jitter, printing a retry breadcrumb."""
    wait = min(BACKOFF_BASE * (2 ** attempt), BACKOFF_CAP) + random.uniform(0, 1.0)
    safe_print(f"    [retry {attempt + 1}/{MAX_RETRIES}] {label} — waiting {wait:.1f}s")
    time.sleep(wait)


def ytdlp_extract(target: str, opts: dict, extra: dict | None = None) -> dict:
    """Run one yt-dlp extraction through the proxy manager with backoff.

    HTTP 429 → bench the current proxy, rotate to the next, exponential
    backoff, retry. Transient network/server faults → backoff and retry on the
    same route. Anything else (private/terminated channel, parse failure,
    exhausted retries) raises HttpError so per-item handlers can skip the item.
    """
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        proxy = PROXY_MANAGER.current()
        cookie = COOKIE_MANAGER.current()
        run_opts = dict(opts)
        if extra:
            run_opts.update(extra)
        if proxy:
            run_opts["proxy"] = proxy
        if cookie:
            run_opts["cookiefile"] = cookie
        # See _VIDEO_OPTS: skip yt-dlp's format resolution/selection step for
        # calls that only ever read metadata fields, not format/download URLs.
        skip_format_resolve = run_opts.pop("_no_format_resolve", False)
        _throttle_pause()
        try:
            with yt_dlp.YoutubeDL(run_opts) as ydl:
                info = ydl.extract_info(
                    target, download=False, process=not skip_format_resolve
                )
            PROXY_MANAGER.report_success(proxy)
            COOKIE_MANAGER.report_success(cookie)
            return info or {}
        except (DownloadError, ExtractorError) as exc:
            last_err = exc
            msg = str(exc).lower()
            if _is_bot_check(msg):
                # Account-level, not IP-level: bench this cookie hard and let the
                # next attempt rotate to a different account. No long backoff —
                # a fresh authenticated session may well succeed immediately.
                COOKIE_MANAGER.report_bot_check(cookie)
                if attempt < MAX_RETRIES:
                    _backoff(attempt, "bot-check — rotating cookie")
                    continue
            elif _is_throttle(msg):
                PROXY_MANAGER.report_throttle(proxy)
                COOKIE_MANAGER.report_throttle(cookie)
                if attempt < MAX_RETRIES:
                    _backoff(attempt, "HTTP 429 rate limit")
                    continue
            elif _is_transient(msg):
                if attempt < MAX_RETRIES:
                    _backoff(attempt, "transient network fault")
                    continue
            break  # permanent fault (removed/private/parse error) — no retry
        except OSError as exc:  # raw socket faults that escape yt-dlp's wrapper
            last_err = exc
            if attempt < MAX_RETRIES:
                _backoff(attempt, type(exc).__name__)
                continue
    raise HttpError(f"yt-dlp extraction failed for {target!r}: {last_err}")


# ── yt-dlp search ─────────────────────────────────────────────────────────────
# Scrapes YouTube's search results for free — no API involved anywhere.

_UC_URL_RE     = re.compile(r"/channel/(UC[A-Za-z0-9_\-]+)")
_HANDLE_URL_RE = re.compile(r"/(@[A-Za-z0-9_.\-]+)")
# Pull an 11-char video id out of a watch / short / youtu.be / embed URL.
_VIDEO_ID_RE   = re.compile(r"(?:v=|/shorts/|youtu\.be/|/embed/|/live/)([A-Za-z0-9_\-]{11})")


def _resolve_handle_ytdlp(handle_url: str) -> str:
    """Resolve an @handle / custom channel URL to its canonical UC… ID via yt-dlp.

    Bounded to a single playlist item so it reads the channel's metadata
    without enumerating every upload. Returns '' on any failure so the caller
    can simply skip the entry.
    """
    try:
        info = ytdlp_extract(handle_url, _FLAT_OPTS, {"playlist_items": "1"})
    except HttpError:
        return ""
    cid = info.get("channel_id") or info.get("uploader_id") or info.get("id") or ""
    if cid.startswith("UC"):
        return cid
    for entry in info.get("entries", []) or []:
        if entry:
            c = entry.get("channel_id") or ""
            if c.startswith("UC"):
                return c
    return ""


def _channel_id_from_entry(entry: dict) -> str:
    """Resolve a flat yt-dlp entry to a canonical UC… channel id.

    Tries the direct channel_id/uploader_id, then a UC id parsed from any
    channel/uploader URL, then — the @handle blindspot — resolves a custom
    handle URL through yt-dlp. Shared by the search and lookalike engines so the
    extraction rules stay identical. Returns '' when nothing resolves.
    """
    cid = entry.get("channel_id") or entry.get("uploader_id") or ""
    if cid and cid.startswith("UC"):
        return cid
    url = (
        entry.get("channel_url")
        or entry.get("uploader_url")
        or entry.get("url")
        or ""
    )
    m = _UC_URL_RE.search(url)
    if m:
        return m.group(1)
    hm = _HANDLE_URL_RE.search(url)
    if hm:
        return _resolve_handle_ytdlp(f"https://www.youtube.com/{hm.group(1)}")
    return ""


def _unique_channel_ids(entries) -> list[str]:
    """Map flat yt-dlp entries → ordered, de-duplicated list of UC… channel ids."""
    ids: list[str] = []
    seen: set[str] = set()
    for entry in entries or []:
        if not entry:
            continue
        cid = _channel_id_from_entry(entry)
        if cid and cid.startswith("UC") and cid not in seen:
            seen.add(cid)
            ids.append(cid)
    return ids


def search_page_ytdlp(keyword: str) -> list[str]:
    """Search YouTube via yt-dlp and return unique channel IDs (UC…) for the
    top SEARCH_RESULTS videos matching `keyword`."""
    query = f"ytsearch{SEARCH_RESULTS}:{keyword}"
    try:
        info = ytdlp_extract(query, _FLAT_OPTS)
    except HttpError as exc:  # network blip, parser change, etc. — skip keyword
        safe_print(f"  [ERROR] yt-dlp search failed: {exc}")
        return []
    return _unique_channel_ids(info.get("entries", []))


def search_lookalikes_ytdlp(seed_url: str) -> list[str]:
    """Algorithmic lookalike traversal: harvest the channel IDs YouTube's own
    recommendation engine pairs with a seed video.

    YouTube's auto-generated "mix" radio playlist (list=RD<videoId>) IS the
    algorithmic recommendation feed for a video — it is the only algorithm
    surface yt-dlp can enumerate deterministically (the bare watch-page "related"
    rail is not exposed via the extractor).
    """
    vid = ""
    m = _VIDEO_ID_RE.search(seed_url or "")
    if m:
        vid = m.group(1)
    if not vid:
        safe_print(f"  [ERROR] lookalike: no video id parsed from {seed_url!r}")
        return []

    mix_url = f"https://www.youtube.com/watch?v={vid}&list=RD{vid}"
    try:
        info = ytdlp_extract(mix_url, _FLAT_OPTS)
    except HttpError as exc:  # dead seed, no mix, parser change — skip seed
        safe_print(f"  [ERROR] lookalike extraction failed for {vid}: {exc}")
        return []
    return _unique_channel_ids(info.get("entries", []))


# ── yt-dlp enrichment (replaces channels.list / playlistItems.list / videos.list)

# One flat extraction of a channel's /videos tab yields BOTH the channel header
# metadata (subs, description, handle) and its newest uploads (id, duration,
# view_count). The upload entries are cached per uploads-playlist id so
# recent_upload() and get_video_details() reuse them instead of re-fetching.
_UPLOADS_CACHE: dict[str, list[dict]] = {}


def _uploads_playlist_id(cid: str) -> str:
    """A channel's uploads playlist id is its UC… id with a UU prefix."""
    return "UU" + cid[2:] if cid.startswith("UC") else cid


_ORIG_CAPTION_RE = re.compile(r"^([a-zA-Z]{2,3})-orig$")


def _detect_channel_language(entries: list[dict]) -> str:
    first_id = next((e.get("id") for e in entries if e.get("id")), "")
    if not first_id:
        return ""
    try:
        info = ytdlp_extract(
            f"https://www.youtube.com/watch?v={first_id}",
            _VIDEO_OPTS,
            {"writeautomaticsub": True, "subtitleslangs": ["all"]},
        )
    except HttpError:
        return ""
    for key in (info.get("automatic_captions") or {}):
        m = _ORIG_CAPTION_RE.match(key)
        if m:
            return m.group(1).lower()
    lang = info.get("language") or ""
    return lang.split("-")[0].lower() if lang else ""


def _channel_resource(cid: str) -> dict | None:
    """Fetch one channel via yt-dlp and shape it like a YouTube API channel
    resource, so run_gauntlet() consumes it unchanged.

    Field mapping (yt-dlp → API shape):
      channel / uploader            → snippet.title
      description                   → snippet.description
      uploader_id (@handle)         → snippet.customUrl
      channel_follower_count        → statistics.subscriberCount
        (None → statistics.hiddenSubscriberCount = True)
      UU… uploads playlist          → contentDetails.relatedPlaylists.uploads
    snippet.country is not exposed by YouTube's web layer, so it is left empty —
    the gauntlet's country gate then relies on its India-signal heuristics,
    exactly as it already did for API channels that hid the field.
    brandingSettings customLinks are likewise unavailable → empty list.
    """
    url = f"https://www.youtube.com/channel/{cid}/videos"
    try:
        info = ytdlp_extract(url, _FLAT_OPTS, {"playlist_items": f"1-{UPLOADS_SAMPLE}"})
    except HttpError as exc:
        skip_log.info(f"SKIP {cid}: channel fetch failed — {exc}")
        return None
    if not info:
        return None

    entries = [e for e in (info.get("entries") or []) if e][:UPLOADS_SAMPLE]
    uploads_id = _uploads_playlist_id(cid)
    _UPLOADS_CACHE[uploads_id] = entries

    subs = info.get("channel_follower_count")
    if subs is None:
        # Self-healing cascade: yt-dlp's field map may have drifted after a
        # page-structure update. Pull the raw channel page and try alternative
        # patterns before concluding the count is genuinely hidden.
        try:
            subs = rex.guarded(
                f"subscriber_count[{cid}]",
                primary=lambda: None,  # primary (yt-dlp) already failed above
                recover=lambda h: rex.recover_subscriber_count(
                    h, upstream_primary="yt-dlp channel_follower_count"),
                html_getter=lambda: _fetch_html(f"https://www.youtube.com/channel/{cid}"),
            )
        except rex.ExtractionRecoveryError:
            # All fallbacks exhausted — keep the existing hidden-subscriber
            # gate semantics untouched.
            subs = None
    return {
        "id": cid,
        "snippet": {
            "title":            info.get("channel") or info.get("uploader") or "",
            "description":      info.get("description") or "",
            "customUrl":        info.get("uploader_id") or "",
            "country":          "",
            "defaultLanguage":  _detect_channel_language(entries),
        },
        "statistics": {
            "subscriberCount":       str(int(subs)) if subs is not None else "0",
            "hiddenSubscriberCount": subs is None,
        },
        "contentDetails": {"relatedPlaylists": {"uploads": uploads_id}},
        "brandingSettings": {"channel": {"customLinks": []}},
    }


def channel_batch(ids: list[str]) -> list[dict]:
    """Fetch channel metadata for the given UC… ids via yt-dlp.

    Returns dicts shaped exactly like YouTube API channel resources (snippet,
    statistics, contentDetails, brandingSettings) so run_gauntlet() and the
    sibling process_*.py scripts keep working unchanged. yt-dlp has no batch
    endpoint, so channels are fetched one at a time through the rate-limited
    dispatcher; an unfetchable channel is logged and skipped, never fatal.
    """
    channels: list[dict] = []
    for cid in ids:
        ch = _channel_resource(cid)
        if ch:
            channels.append(ch)
    return channels


def _parse_iso(raw: str) -> datetime.datetime | None:
    """Parse an RFC-3339 timestamp defensively; return None on anomalous input."""
    if not raw:
        return None
    try:
        return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _fetch_html(url: str) -> str | None:
    """Fetch a raw page source for the self-healing fallback cascade.

    Same proxy rotation, impersonation, and 429 backoff as every other HTTP
    path in this module. Returns None (never raises) if the page is
    unreachable, so recovery cleanly degrades to the caller's existing gates.
    """
    for attempt in range(MAX_RETRIES + 1):
        proxy = PROXY_MANAGER.current()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        _throttle_pause()
        try:
            resp = requests.get(
                url,
                timeout=HTTP_TIMEOUT,
                proxies=proxies,
                impersonate=_IMPERSONATE,
            )
        except requests.exceptions.RequestException:
            if attempt < MAX_RETRIES:
                _backoff(attempt, "fallback-fetch network fault")
                continue
            return None
        if resp.status_code == 429:
            PROXY_MANAGER.report_throttle(proxy)
            if attempt < MAX_RETRIES:
                _backoff(attempt, "HTTP 429 rate limit (fallback fetch)")
                continue
            return None
        if resp.status_code >= 500 and attempt < MAX_RETRIES:
            _backoff(attempt, f"HTTP {resp.status_code} (fallback fetch)")
            continue
        if resp.status_code != 200:
            return None
        PROXY_MANAGER.report_success(proxy)
        return resp.text
    return None


_RSS_PUBLISHED_RE = re.compile(r"<published>([^<]+)</published>")


def _rss_recent(channel_id: str) -> bool | None:
    """Check upload recency via the channel's RSS feed (exact publish dates,
    ~15 KB, no bot-check surface). Runs through the same proxy rotation and
    429 backoff as the yt-dlp calls. Returns None if the feed is unreachable
    so the caller can fall back to a watch-page extraction.
    """
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    for attempt in range(MAX_RETRIES + 1):
        proxy = PROXY_MANAGER.current()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        _throttle_pause()
        try:
            resp = requests.get(
                url,
                timeout=HTTP_TIMEOUT,
                proxies=proxies,
                impersonate=_IMPERSONATE,
            )
        except requests.exceptions.RequestException:
            if attempt < MAX_RETRIES:
                _backoff(attempt, "RSS network fault")
                continue
            return None
        if resp.status_code == 429:
            PROXY_MANAGER.report_throttle(proxy)
            if attempt < MAX_RETRIES:
                _backoff(attempt, "HTTP 429 rate limit (RSS)")
                continue
            return None
        if resp.status_code >= 500 and attempt < MAX_RETRIES:
            _backoff(attempt, f"HTTP {resp.status_code} (RSS)")
            continue
        if resp.status_code != 200:
            return None
        PROXY_MANAGER.report_success(proxy)
        dates = [_parse_iso(d) for d in _RSS_PUBLISHED_RE.findall(resp.text)]
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=RECENT_DAYS)
        return any(d and d >= cutoff for d in dates)
    return None


def recent_upload(playlist_id: str) -> tuple[bool, list[str]]:
    """Return (is_active, all_video_ids).

    is_active     – True if any video was published within RECENT_DAYS.
    all_video_ids – ALL fetched IDs (up to UPLOADS_SAMPLE) passed to
                    get_video_details for long-form and average-views checks.

    Video ids come from the flat entries cached by channel_batch() (or a flat
    playlist extraction for direct callers). Recency comes from the channel's
    RSS feed — exact publish dates with no bot-check; if the feed is
    unreachable, ONE full-metadata fetch of the newest video supplies the
    timestamp instead.
    """
    entries = _UPLOADS_CACHE.get(playlist_id)
    if entries is None:
        info = ytdlp_extract(
            f"https://www.youtube.com/playlist?list={playlist_id}",
            _FLAT_OPTS,
            {"playlist_items": f"1-{UPLOADS_SAMPLE}"},
        )
        entries = [e for e in (info.get("entries") or []) if e][:UPLOADS_SAMPLE]
        _UPLOADS_CACHE[playlist_id] = entries

    all_ids = [e.get("id", "") for e in entries if e.get("id")]
    if not all_ids:
        return False, []

    channel_id = "UC" + playlist_id[2:] if playlist_id.startswith("UU") else playlist_id
    rss = _rss_recent(channel_id)
    if rss is not None:
        return rss, all_ids

    # RSS unreachable — fall back to fully resolving the newest upload.
    newest = ytdlp_extract(f"https://www.youtube.com/watch?v={all_ids[0]}", _VIDEO_OPTS)
    ts = newest.get("timestamp") or newest.get("release_timestamp")
    if ts is None:
        raw = newest.get("upload_date", "")  # YYYYMMDD
        try:
            ts = datetime.datetime.strptime(raw, "%Y%m%d").replace(
                tzinfo=datetime.timezone.utc
            ).timestamp()
        except (ValueError, TypeError):
            return False, all_ids
    published = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=RECENT_DAYS)
    return published >= cutoff, all_ids


def _video_meta(video_id: str, flat: dict | None) -> tuple[int | None, int | None, str]:
    """Return (duration_secs, view_count, description) for one video.

    Reads the cached flat entry first (channel-tab entries carry both fields);
    falls back to one full extraction when either is missing. Returns None for
    a duration/view field that genuinely cannot be resolved. The description is
    only populated when a full extraction already happened for duration/views —
    it is never fetched with an extra request of its own.
    """
    duration = flat.get("duration") if flat else None
    views    = flat.get("view_count") if flat else None
    description = flat.get("description") if flat else None
    if duration is None or views is None:
        try:
            full = ytdlp_extract(f"https://www.youtube.com/watch?v={video_id}", _VIDEO_OPTS)
        except HttpError:
            full = {}
        duration = full.get("duration") if duration is None else duration
        views    = full.get("view_count") if views is None else views
        if description is None:
            description = full.get("description")
    if duration is None or views is None:
        # Structured extraction (flat entry + full yt-dlp fetch) came up empty
        # — likely a page-structure drift. Run the raw-HTML fallback cascade.
        html = _fetch_html(f"https://www.youtube.com/watch?v={video_id}")
        if html:
            if duration is None:
                try:
                    duration = rex.recover_duration_secs(
                        html, upstream_primary="yt-dlp duration")
                except rex.ExtractionRecoveryError as exc:
                    rex.fallback_log.warning("%s — leaving duration unresolved", exc)
            if views is None:
                try:
                    views = rex.recover_view_count(
                        html, upstream_primary="yt-dlp view_count")
                except rex.ExtractionRecoveryError as exc:
                    rex.fallback_log.warning("%s — leaving view count unresolved", exc)
    return (
        int(duration) if duration is not None else None,
        int(views) if views is not None else None,
        description or "",
    )


# ── Visual content gate (Gemini) ────────────────────────────────────────────
# Faceless/automated channels (compilation reposts, TTS narration over stock
# footage, meme streams) pass every metadata filter above but don't fit a
# talking-head/tutorial ICP. This gate samples the newest uploads' thumbnails
# and asks Gemini vision whether a human face is a principal element of the
# frame; a channel with no face across the sample is routed to the blacklist.

_FACE_CHECK_PROMPT = (
    "You are screening a YouTube video thumbnail for a talking-head/tutorial "
    "content filter. Examine the attached thumbnail image and decide whether a "
    "real human face is a principal visual element of the frame — clearly "
    "visible and occupying a prominent portion of the thumbnail, not a small "
    "or incidental figure, and not a cartoon/avatar, meme template, "
    "screen-recording, slideshow, stock-footage collage, or text-only "
    "graphic.\n\n"
    "Respond with ONLY a single-line JSON object, no markdown fencing, no "
    "extra commentary:\n"
    '{"human_face_principal_element": true or false}'
)

_gemini_client: "genai.Client | None" = None
_gemini_client_init_failed = False


def _get_gemini_client() -> "genai.Client | None":
    """Return the shared Vertex AI Gemini client, initialising it once.

    Mirrors orchestrator.py's init_gemini(): same Vertex AI project/location
    env vars, same credentials — no separate API configuration. Returns None
    (fail-open) if the project isn't configured or the client can't be built,
    so a missing/broken Gemini setup degrades to "skip the visual gate"
    instead of taking down the whole scrape.
    """
    global _gemini_client, _gemini_client_init_failed
    if _gemini_client is not None:
        return _gemini_client
    if _gemini_client_init_failed:
        return None

    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        safe_print("  [face-check] GOOGLE_CLOUD_PROJECT not set — skipping visual gate")
        _gemini_client_init_failed = True
        return None

    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
    try:
        _gemini_client = genai.Client(
            vertexai=True,
            project=project,
            location=location,
            http_options={"timeout": HTTP_TIMEOUT * 1000},
        )
    except Exception as exc:
        safe_print(f"  [face-check] Gemini client init failed: {exc} — skipping visual gate")
        _gemini_client_init_failed = True
        return None
    return _gemini_client


def _fetch_thumbnail_bytes(video_id: str) -> bytes | None:
    """Fetch a video's hqdefault thumbnail as raw JPEG bytes, or None on failure."""
    url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    try:
        resp = requests.get(url, timeout=HTTP_TIMEOUT, impersonate=_IMPERSONATE)
        if resp.status_code != 200 or not resp.content:
            return None
        return resp.content
    except Exception:
        return None


def _thumbnail_has_face(client: "genai.Client", image_bytes: bytes) -> bool | None:
    """Ask Gemini whether the thumbnail's principal element is a human face.

    Returns True/False on a clean classification, None if the call failed or
    the response couldn't be parsed as the expected structured JSON.
    """
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                _FACE_CHECK_PROMPT,
            ],
            config={"response_mime_type": "application/json"},
        )
        payload = json.loads((response.text or "").strip())
        flag = payload.get("human_face_principal_element")
        return bool(flag) if isinstance(flag, bool) else None
    except Exception:
        return None


def check_face_present(video_ids: list[str]) -> bool:
    """Return False only if every sampled thumbnail was checked and none of
    them showed a human face as the principal element.

    Fails open (returns True) when Gemini isn't configured, or when no
    thumbnail could be fetched/classified at all — a filter this destructive
    should never fire on missing data, only on a confirmed negative result
    across the sample.
    """
    client = _get_gemini_client()
    if client is None:
        return True

    sample = [vid for vid in video_ids[:FACE_CHECK_SAMPLE] if vid]
    if not sample:
        return True

    checked = 0
    for vid in sample:
        image_bytes = _fetch_thumbnail_bytes(vid)
        if image_bytes is None:
            continue
        result = _thumbnail_has_face(client, image_bytes)
        if result is None:
            continue
        checked += 1
        if result:
            return True

    return checked == 0


def get_video_details(video_ids: list[str]) -> tuple[int, int, bool, str]:
    """Return (longform_count, avg_views, monetized, recent_video_transcript)
    for the given video IDs.

    longform_count – number of videos whose duration exceeds LONGFORM_MIN_SECS.
    avg_views      – mean viewCount across long-form videos only; 0 if none.
    monetized      – True if the aggregate text of the long-form videos'
                      descriptions carries an existing monetization/sponsorship
                      footprint (see MONETIZATION_SIGNALS).
    recent_video_transcript – auto-generated transcript of the channel's
                      newest upload (video_ids[0]), truncated to roughly the
                      first TRANSCRIPT_WORD_LIMIT words. '' if that video has
                      no automatic captions. Raw text only — no scoring or
                      filtering is applied here; a downstream module consumes
                      it directly.
    Served from the flat entries cached during channel enrichment; only videos
    missing duration/view data trigger an individual yt-dlp fetch.
    """
    flat_by_id: dict[str, dict] = {}
    for entries in _UPLOADS_CACHE.values():
        for e in entries:
            if e.get("id"):
                flat_by_id[e["id"]] = e

    longform_views: list[int] = []
    descriptions: list[str] = []
    for vid in video_ids:
        duration, views, description = _video_meta(vid, flat_by_id.get(vid))
        if duration is None or duration <= LONGFORM_MIN_SECS:
            continue
        # A hidden/absent viewCount is NOT zero views — counting it as 0 would
        # poison the average and wrongly blacklist strong leads. Skip the video
        # entirely: it contributes to neither the long-form count nor the mean.
        if views is None:
            continue
        longform_views.append(views)
        if description:
            descriptions.append(description)
    longform_count = len(longform_views)
    avg_views = int(sum(longform_views) / longform_count) if longform_count else 0
    monetized = has_monetization_signals(" ".join(descriptions))

    recent_video_transcript = ""
    if video_ids:
        transcript = fetch_transcript(video_ids[0])
        if transcript:
            recent_video_transcript = " ".join(transcript.split()[:TRANSCRIPT_WORD_LIMIT])

    return longform_count, avg_views, monetized, recent_video_transcript


# ── Scoring & extraction ──────────────────────────────────────────────────────

# High-confidence India-origin signals for channels that hide the country field.
_INDIA_GEO_RE = re.compile(r'[₹]|\+91\s*\d', re.UNICODE)


def has_india_signals(text: str) -> bool:
    return bool(_INDIA_GEO_RE.search(text or ""))


def has_monetization_signals(text: str) -> bool:
    """Case/unicode-safe scan of aggregated video descriptions for existing
    monetization or sponsorship footprints (e.g. "sponsored by", "discount code").
    casefold() (not lower()) is used so accented/uncommon unicode casing still
    normalizes correctly; a non-string input never raises.
    """
    lower = (text or "").casefold()
    return any(s in lower for s in MONETIZATION_SIGNALS)


def score(description: str) -> int:
    lower = (description or "").lower()
    if any(s in lower for s in STRONG_SIGNALS):
        return 2
    if any(s in lower for s in WEAK_SIGNALS):
        return 1
    return 0


# Email matching, hardened against trailing-text capture. The domain is matched
# as labelled segments followed by a known TLD, with a trailing negative
# lookahead so "john@gmail.comFollow" or "...@host.com.Subscribe" can no longer
# glue prose onto a valid-looking address (a hard-bounce risk for outreach).
_TLDS = (
    "com|net|org|io|co|edu|gov|mil|info|biz|me|tv|us|uk|ca|au|de|fr|es|it|nl|"
    "in|eu|ie|nz|se|no|fi|dk|ch|at|be|pt|pl|cz|gr|ru|jp|cn|br|mx|za|"
    "app|dev|ai|xyz|online|site|store|shop|tech|live|pro|club|blog|page|link|"
    "email|agency|media|studio|design|academy|coach|courses|guru|life|world|"
    "today|news|tips|fit|fitness|company|solutions|consulting"
)
_EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+\-]+@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+"
    r"(?:" + _TLDS + r")"
    r"(?![A-Za-z0-9])",
    re.IGNORECASE,
)

# Only bracketed obfuscation is honoured — "[at]", "(at)", "[dot]", "(dot)".
# The bare-word "\s+at\s+" / "\s+dot\s+" rules were removed: they corrupted
# ordinary prose ("based at home") and fabricated garbage addresses.
_OBFUS_AT  = re.compile(r"\s*[\[(]\s*at\s*[\])]\s*", re.IGNORECASE)
_OBFUS_DOT = re.compile(r"\s*[\[(]\s*dot\s*[\])]\s*", re.IGNORECASE)


def extract_email(text: str) -> str:
    text = text or ""
    m = _EMAIL_RE.search(text)
    if m:
        return m.group(0)
    normalized = _OBFUS_DOT.sub(".", _OBFUS_AT.sub("@", text))
    m = _EMAIL_RE.search(normalized)
    return m.group(0) if m else ""


_URL_RE = re.compile(r'https?://[^\s\'"<>]+|www\.[^\s\'"<>]+')
_URL_TRAILING = ".,;:!?)]}'\""


def extract_social_links(desc: str) -> str:
    """Return all URLs found in the description joined by ' | ', or empty string.

    Trailing punctuation is stripped so "visit https://site.com." does not yield
    a broken "https://site.com." link.
    """
    links = [u.rstrip(_URL_TRAILING) for u in _URL_RE.findall(desc or "")]
    links = [u for u in links if u]
    return " | ".join(links)


def extract_external_links(channel: dict) -> str:
    """Return custom/external links from brandingSettings.channel.customLinks.

    YouTube's web layer (yt-dlp) does not expose the About-tab custom links, so
    channel dicts built by channel_batch() carry an empty customLinks list and
    this returns ''. The field is kept so run_gauntlet() and the CSV schema are
    unchanged, and so API-shaped dicts from other pipelines still work.
    """
    links: list[str] = []
    branding = (channel or {}).get("brandingSettings", {}) or {}
    for item in branding.get("channel", {}).get("customLinks", []) or []:
        url = (item.get("linkUrl", "") or "").strip()
        if url:
            links.append(url)
    return " | ".join(links)


def make_url(channel: dict) -> str:
    return f"https://www.youtube.com/channel/{(channel or {}).get('id', '')}"


# ── Deep-link website crawler ─────────────────────────────────────────────────
# When a qualified channel hides its email from the YouTube description, the
# email frequently lives on the personal website linked from the About tab.
# We fetch that one custom site and re-run _EMAIL_RE (via extract_email) on the
# raw HTML — recovering leads that would otherwise be discarded.

_CRAWL_TIMEOUT = 5   # strict per-request ceiling (seconds)
# Aggregators / social platforms are not the lead's own site — skip them and
# crawl the first genuinely custom domain instead.
_SOCIAL_DOMAINS = frozenset({
    "instagram.com", "twitter.com", "x.com", "facebook.com", "fb.com",
    "fb.me", "tiktok.com", "youtube.com", "youtu.be", "linkedin.com",
    "t.me", "telegram.me", "telegram.org", "snapchat.com", "pinterest.com",
    "threads.net", "reddit.com", "discord.gg", "discord.com", "twitch.tv",
    "whatsapp.com", "wa.me", "linktr.ee", "beacons.ai", "patreon.com",
    "spotify.com", "apple.com", "amazon.com", "medium.com", "substack.com",
})


def _host_of(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url, re.IGNORECASE)
    host = (m.group(1) if m else url).lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def _is_social(host: str) -> bool:
    return any(host == d or host.endswith("." + d) for d in _SOCIAL_DOMAINS)


def crawl_for_email(external_links: list[str]) -> str:
    """Fetch the FIRST non-social custom website among external_links and scan
    its HTML for an email address.

    Mocks a standard browser User-Agent and enforces a strict 5-second timeout.
    Every network failure (timeout, connection reset, DNS, TLS, bad status, …)
    is swallowed and returns '' so the crawler can never crash the main thread.
    """
    for raw in external_links:
        url = (raw or "").strip()
        if not url:
            continue
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        if _is_social(_host_of(url)):
            continue
        # First custom domain found — this is the one we crawl (per spec).
        try:
            resp = requests.get(
                url,
                timeout=_CRAWL_TIMEOUT,
                allow_redirects=True,
                impersonate=_IMPERSONATE,
            )
            return extract_email(resp.text or "")
        except Exception:
            # requests.RequestException + any defensive edge — never propagate.
            return ""
    return ""


# ── I/O ───────────────────────────────────────────────────────────────────────

# Leading characters a spreadsheet may interpret as a formula. Channel-supplied
# text (titles, descriptions, links) is untrusted, so any field starting with
# one of these is prefixed with a single quote to neutralise CSV injection.
_CSV_RISKY = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value) -> str:
    s = "" if value is None else str(value)
    if s and s[0] in _CSV_RISKY:
        return "'" + s
    return s


def load_keywords(path: str = "keywords.txt") -> list[str]:
    with open(path, encoding="utf-8") as fh:
        return [ln.strip() for ln in fh if ln.strip() and not ln.startswith("#")]


def load_seed_urls(path: str = "lookalike_targets.txt") -> list[str]:
    """Load seed video URLs for the lookalike engine. Returns [] if the file is
    absent so Phase 2 is simply skipped on installs that don't use it."""
    if not Path(path).exists():
        return []
    return load_keywords(path)


# ── State tracking (SQLite, indexed) ──────────────────────────────────────────
# Processed-channel and blacklist state used to live in volatile in-memory sets
# rebuilt from CSVs on every run (memory inflation over long autonomous runs,
# and total state loss on a mid-write crash). It now lives natively in
# tracking.db: two indexed tables queried with fast existence checks and written
# with INSERT OR IGNORE so duplicate-tracking constraints are enforced at the
# database layer rather than by pre-scanning a set.
#
#   processed_channels — every channel id (or @handle) already handled, so it is
#                        never enriched twice. status records the disposition
#                        (lead / qualified / blacklist / insufficient / seen).
#   blacklist          — permanently disqualified targets.
#
# load_seen_ids() returns a SeenIds facade that quacks like the old set[str]
# (`cid in seen_ids`, `seen_ids.add(cid)`) so run_gauntlet() and every sibling
# process_*.py script keep working unchanged against the DB.

_TRACKING_CONN: sqlite3.Connection | None = None


def _connect_tracking_db() -> sqlite3.Connection:
    """Return the shared tracking-DB connection (WAL + busy timeout), opening it
    on first use. Single-threaded pipeline, so one connection is reused."""
    global _TRACKING_CONN
    if _TRACKING_CONN is None:
        conn = sqlite3.connect(TRACKING_DB_FILE)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        _TRACKING_CONN = conn
    return _TRACKING_CONN


def init_tracking_db() -> None:
    """Create the tracking tables + indices (idempotent) and run the one-time
    legacy-CSV migration. Safe to call at the top of every entry point."""
    conn = _connect_tracking_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS processed_channels (
            channel_id   TEXT PRIMARY KEY,
            status       TEXT NOT NULL DEFAULT 'seen',
            processed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS blacklist (
            channel_id     TEXT PRIMARY KEY,
            reason         TEXT,
            blacklisted_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tracking_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_processed_status ON processed_channels(status);
        """
    )
    conn.commit()
    _migrate_legacy_state()


def _extract_ids_from_url_csv(path: Path, seen: set[str]) -> None:
    with open(path, encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            url = row.get("url", "")
            m = re.search(r"/channel/([A-Za-z0-9_\-]+)", url)
            if m:
                seen.add(m.group(1))
                continue
            m = re.search(r"/@([A-Za-z0-9_.\-]+)", url)
            if m:
                seen.add(f"@{m.group(1)}")


def _migrate_legacy_state() -> None:
    """One-time import of pre-existing CSV state into the tracking DB.

    Guarded by a flag row in tracking_meta so the CSVs are read exactly once —
    the steady-state pipeline never touches them again (no more static file
    lookups for tracking). Every insert is INSERT OR IGNORE, so re-running is a
    no-op even if the guard is bypassed.
    """
    conn = _connect_tracking_db()
    done = conn.execute(
        "SELECT 1 FROM tracking_meta WHERE key = 'legacy_csv_migrated'"
    ).fetchone()
    if done:
        return

    # leads.csv / qualified.csv carry channel URLs → extract UC ids and @handles.
    for url_file, status in ((OUTPUT_FILE, "lead"), (QUALIFIED_FILE, "qualified")):
        if url_file.exists():
            ids: set[str] = set()
            _extract_ids_from_url_csv(url_file, ids)
            conn.executemany(
                "INSERT OR IGNORE INTO processed_channels (channel_id, status) VALUES (?, ?)",
                [(cid, status) for cid in ids],
            )

    # blacklist.csv / insufficient_content.csv carry bare channel_id rows.
    if BLACKLIST_FILE.exists():
        with open(BLACKLIST_FILE, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                cid = row.get("channel_id", "").strip()
                if cid:
                    conn.execute(
                        "INSERT OR IGNORE INTO blacklist (channel_id, reason) VALUES (?, ?)",
                        (cid, "legacy-import"),
                    )
                    conn.execute(
                        "INSERT OR IGNORE INTO processed_channels (channel_id, status) "
                        "VALUES (?, 'blacklist')",
                        (cid,),
                    )
    if INSUFFICIENT_FILE.exists():
        with open(INSUFFICIENT_FILE, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                cid = row.get("channel_id", "").strip()
                if cid:
                    conn.execute(
                        "INSERT OR IGNORE INTO processed_channels (channel_id, status) "
                        "VALUES (?, 'insufficient')",
                        (cid,),
                    )

    conn.execute(
        "INSERT OR IGNORE INTO tracking_meta (key, value) VALUES "
        "('legacy_csv_migrated', datetime('now'))"
    )
    conn.commit()


def is_seen(cid: str) -> bool:
    """Fast native existence check: True if `cid` is already processed or
    blacklisted. Uses the primary-key indices on both tables."""
    if not cid:
        return False
    conn = _connect_tracking_db()
    row = conn.execute(
        "SELECT 1 WHERE EXISTS (SELECT 1 FROM processed_channels WHERE channel_id = ?) "
        "OR EXISTS (SELECT 1 FROM blacklist WHERE channel_id = ?)",
        (cid, cid),
    ).fetchone()
    return row is not None


def mark_processed(cid: str, status: str = "seen") -> None:
    """Record a channel as processed. INSERT OR IGNORE handles the duplicate
    constraint natively — no pre-check needed."""
    if not cid:
        return
    conn = _connect_tracking_db()
    conn.execute(
        "INSERT OR IGNORE INTO processed_channels (channel_id, status) VALUES (?, ?)",
        (cid, status),
    )
    conn.commit()


class SeenIds:
    """Set-like facade over the tracking DB.

    Preserves the exact interface the pipeline used against the old in-memory
    `set[str]` — membership tests and `.add()` — but every operation is a native
    SQL query/write, so state is durable and memory-flat regardless of run
    length. Kept intentionally minimal: the pipeline only ever needs `in` and
    `.add()`.
    """

    def __contains__(self, cid: object) -> bool:
        return is_seen(cid) if isinstance(cid, str) else False

    def add(self, cid: str) -> None:
        mark_processed(cid, "seen")


def load_seen_ids() -> "SeenIds":
    """Return the DB-backed seen-id tracker.

    Signature preserved for main() and every process_*.py caller; the returned
    object is used identically to the former set (`cid in seen_ids`,
    `seen_ids.add(cid)`) but is backed by tracking.db, not a volatile set."""
    init_tracking_db()
    return SeenIds()


def append_to_blacklist(cid: str, reason: str = "") -> None:
    """Blacklist a channel natively: INSERT OR IGNORE into both the blacklist
    table and processed_channels, so duplicate targets are absorbed at the DB
    layer."""
    if not cid:
        return
    conn = _connect_tracking_db()
    conn.execute(
        "INSERT OR IGNORE INTO blacklist (channel_id, reason) VALUES (?, ?)",
        (cid, reason or None),
    )
    conn.execute(
        "INSERT OR IGNORE INTO processed_channels (channel_id, status) VALUES (?, 'blacklist')",
        (cid,),
    )
    conn.commit()


def append_to_insufficient(cid: str) -> None:
    """Record a Shorts-dominated channel as processed with 'insufficient' status
    (native INSERT OR IGNORE)."""
    mark_processed(cid, "insufficient")


def normalize_leads_csv() -> None:
    """Bring leads.csv up to the current CSV_FIELDS schema, in place.

    Older runs wrote a 4-column row (url, email, avg_views, social_links) before
    external_links existed. On startup we read every row through csv.DictReader
    (which tolerates a short header), backfill any field missing from CSV_FIELDS
    with an empty default, drop obsolete extras, and rewrite the file in the
    canonical column order. Values pass through _csv_safe() so a legacy row can't
    smuggle a spreadsheet formula through the rewrite.

    The rewrite is atomic: rows are written to a temp file in the same directory
    and os.replace()'d over the original only after a clean write. If anything
    raises mid-way, the temp file is discarded and the original leads.csv is left
    untouched — no partial file, no data loss.
    """
    if not OUTPUT_FILE.exists() or OUTPUT_FILE.stat().st_size == 0:
        return

    with open(OUTPUT_FILE, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        existing = reader.fieldnames or []
        # Already canonical → nothing to do; avoid a needless rewrite.
        if existing == CSV_FIELDS:
            return
        rows = [
            {field: _csv_safe(row.get(field, "")) for field in CSV_FIELDS}
            for row in reader
        ]

    tmp = OUTPUT_FILE.with_suffix(OUTPUT_FILE.suffix + ".tmp")
    try:
        with open(tmp, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, OUTPUT_FILE)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    safe_print(
        f"[migrate] leads.csv normalized to {len(CSV_FIELDS)}-column schema "
        f"({len(rows)} row(s), added: {', '.join(f for f in CSV_FIELDS if f not in existing) or 'none'})"
    )


def append_rows(rows: list[dict]) -> None:
    """Append qualified lead rows to leads.csv.

    Uses extrasaction='ignore' so rows missing optional keys (e.g. external_links
    on older code paths) are written safely without raising. Every field is run
    through _csv_safe() to neutralise spreadsheet formula injection.
    """
    write_header = not OUTPUT_FILE.exists() or OUTPUT_FILE.stat().st_size == 0
    safe_rows = [{k: _csv_safe(v) for k, v in row.items()} for row in rows]
    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        writer.writerows(safe_rows)


# ── Email validation gate (ZeroBounce) ────────────────────────────────────────
# Runs immediately after extract_email()/crawl_for_email() mine an address and
# before that row is ever written to leads.csv or POSTed to the webhook. This
# is the single checkpoint protecting the cold-sending domain's reputation:
# hard-bounce/invalid/spam-trap addresses never reach long-term storage.

def verify_email(email: str) -> str:
    """Check one address against ZeroBounce. Returns "valid", "invalid", or
    "timeout" (no verdict within ZEROBOUNCE_TIMEOUT — caller should cache the
    row for a later re-check rather than drop it).

    If ZEROBOUNCE_API_KEY isn't configured the gate is a no-op ("valid"), so
    the pipeline keeps working in environments without a validation budget.
    """
    if not ZEROBOUNCE_API_KEY:
        return "valid"
    try:
        resp = requests.get(
            ZEROBOUNCE_URL,
            params={"api_key": ZEROBOUNCE_API_KEY, "email": email},
            timeout=ZEROBOUNCE_TIMEOUT,
            impersonate=_IMPERSONATE,
        )
    except requests.exceptions.Timeout:
        return "timeout"
    except requests.exceptions.RequestException:
        # Connection-level faults are treated like a timeout: fail open to the
        # cache, never silently drop a lead over a transient network error.
        return "timeout"
    if resp.status_code != 200:
        return "timeout"
    status = (resp.json() or {}).get("status", "").strip().lower()
    return "invalid" if status in ZEROBOUNCE_REJECT_STATUSES else "valid"


def cache_pending_verification(row: dict, reason: str) -> None:
    """Park a row whose ZeroBounce check timed out, for secondary verification
    later — never dropped, never promoted straight to leads.csv."""
    file_exists = PENDING_VERIFICATION_FILE.exists()
    safe_row = {k: _csv_safe(v) for k, v in row.items()}
    safe_row["cached_reason"] = reason
    safe_row["cached_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fieldnames = CSV_FIELDS + ["recent_video_transcript", "cached_reason", "cached_at"]
    with open(PENDING_VERIFICATION_FILE, "a", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        if not file_exists:
            writer.writeheader()
        writer.writerow(safe_row)


# ── Webhook delivery with SQLite Dead-Letter Queue ────────────────────────────
# Qualified leads are POSTed to SMARTLEAD_WEBHOOK_URL the moment they pass the
# gauntlet. A failed delivery (timeout, connection fault, 5xx, 429) is never
# lost: the JSON payload lands in webhook_queue.db and flush_webhook_queue()
# retries everything still queued at the end of the run. 4xx responses (other
# than 429) are treated as permanent rejections and are NOT queued — retrying
# a payload the endpoint has refused would loop forever.

def _connect_webhook_db() -> sqlite3.Connection:
    """Open a connection to webhook_queue.db configured for safe concurrent
    access: WAL journaling lets readers and writers overlap, and the busy
    timeout makes SQLite retry instead of raising 'database is locked'."""
    conn = sqlite3.connect(WEBHOOK_DB_FILE)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def init_webhook_db() -> None:
    """Create webhook_queue.db (idempotent). Called once at startup."""
    with _connect_webhook_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS webhook_queue (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                payload     TEXT    NOT NULL,
                created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
                attempts    INTEGER NOT NULL DEFAULT 0,
                last_error  TEXT
            )
            """
        )


def _enqueue_webhook(payload: dict, error: str) -> None:
    """Persist a failed payload to the dead-letter queue."""
    with _connect_webhook_db() as conn:
        conn.execute(
            "INSERT INTO webhook_queue (payload, attempts, last_error) VALUES (?, 1, ?)",
            (json.dumps(payload, ensure_ascii=False), error[:500]),
        )
    safe_print(f"    [webhook] delivery failed ({error[:120]}) — queued to DLQ")


def _post_webhook(payload: dict) -> tuple[bool, bool, str]:
    """POST one payload. Returns (delivered, retryable, error).

    retryable is True for timeouts, connection faults, 429 and 5xx responses;
    False for 2xx (delivered) and other 4xx (permanent rejection).
    """
    try:
        resp = requests.post(
            SMARTLEAD_WEBHOOK_URL,
            json=payload,
            timeout=WEBHOOK_TIMEOUT,
            impersonate=_IMPERSONATE,
        )
    except requests.exceptions.RequestException as exc:
        return False, True, f"{type(exc).__name__}: {exc}"
    if 200 <= resp.status_code < 300:
        return True, False, ""
    retryable = resp.status_code == 429 or resp.status_code >= 500
    return False, retryable, f"HTTP {resp.status_code}"


def send_webhook(payload: dict) -> None:
    """Deliver a qualified-lead payload; on a retryable failure, park it in the
    SQLite DLQ for flush_webhook_queue() to pick up."""
    if not SMARTLEAD_WEBHOOK_URL:
        return
    delivered, retryable, error = _post_webhook(payload)
    if delivered:
        return
    if retryable:
        _enqueue_webhook(payload, error)
    else:
        skip_log.info(f"WEBHOOK rejected permanently ({error}): {json.dumps(payload)[:200]}")
        safe_print(f"    [webhook] permanent rejection ({error}) — not queued")


def flush_webhook_queue() -> None:
    """Retry every payload sitting in the dead-letter queue.

    Runs at the end of the script. Delivered rows are deleted; rows that fail
    again stay queued (with attempts/last_error updated) for the next run.
    """
    if not SMARTLEAD_WEBHOOK_URL or not WEBHOOK_DB_FILE.exists():
        return
    with _connect_webhook_db() as conn:
        rows = conn.execute(
            "SELECT id, payload FROM webhook_queue ORDER BY id"
        ).fetchall()
        if not rows:
            return
        safe_print(f"\n[webhook] flushing DLQ — {len(rows)} payload(s) queued")
        delivered = 0
        requeued  = 0
        for row_id, raw in rows:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                conn.execute("DELETE FROM webhook_queue WHERE id = ?", (row_id,))
                continue
            ok, retryable, error = _post_webhook(payload)
            if ok:
                conn.execute("DELETE FROM webhook_queue WHERE id = ?", (row_id,))
                delivered += 1
            elif not retryable:
                conn.execute("DELETE FROM webhook_queue WHERE id = ?", (row_id,))
                skip_log.info(f"WEBHOOK dropped from DLQ ({error}): {raw[:200]}")
            else:
                conn.execute(
                    "UPDATE webhook_queue SET attempts = attempts + 1, last_error = ? "
                    "WHERE id = ?",
                    (error[:500], row_id),
                )
                requeued += 1
        safe_print(f"[webhook] DLQ flush done — {delivered} delivered, {requeued} still queued")


# ── Crash / restart recovery (daemon_state.json) ──────────────────────────────
# On SIGINT/SIGTERM the current run position (keyword/seed indices, candidate
# pool, pending leads) is snapshotted to disk so a restart can resume instead
# of starting the whole pass over.

def save_daemon_state(state: dict) -> None:
    """Atomically write the checkpoint so a crash mid-write can't corrupt it."""
    tmp = DAEMON_STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, DAEMON_STATE_FILE)


def load_daemon_state() -> dict | None:
    """Return the last checkpoint, if one exists and is readable."""
    if not DAEMON_STATE_FILE.exists():
        return None
    try:
        return json.loads(DAEMON_STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def clear_daemon_state() -> None:
    DAEMON_STATE_FILE.unlink(missing_ok=True)


def install_signal_checkpoint(state_getter) -> None:
    """Install SIGINT/SIGTERM handlers that snapshot state_getter() to
    daemon_state.json before letting the interpreter exit."""

    def _handler(signum, frame):
        safe_print(f"\n[signal] caught {signal.Signals(signum).name} — saving checkpoint")
        try:
            save_daemon_state(state_getter())
        except Exception as exc:
            safe_print(f"[signal] checkpoint save failed: {exc}")
        raise SystemExit(130)

    signal.signal(signal.SIGINT, _handler)
    signal.signal(signal.SIGTERM, _handler)


# ── Shared filter pipeline ────────────────────────────────────────────────────

def run_gauntlet(channels: list[dict], seen_ids: set[str], new_rows_out: list[dict]) -> None:
    """Run channel dicts through Tier-1 + Tier-2 filters. Appends qualified rows to new_rows_out.

    Single source of truth for the filter logic — used by main(), process_backlog.py,
    process_graph.py, and process_lookalike.py.
    """
    for ch in channels:
        if not isinstance(ch, dict):
            continue
        cid = ch.get("id")
        if not cid:
            continue
        snippet = ch.get("snippet", {}) or {}
        custom  = snippet.get("customUrl", "")
        if cid in seen_ids or (custom and custom in seen_ids):
            continue

        name = snippet.get("title", cid)
        desc = snippet.get("description", "")

        # ── Tier 1: zero-cost filters ─────────────────────────────────────────
        stats = ch.get("statistics", {}) or {}
        if stats.get("hiddenSubscriberCount", False):
            skip_log.info(f"SKIP {cid} ({name}): subscriber count hidden")
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        try:
            subs = int(stats.get("subscriberCount", 0) or 0)
        except (TypeError, ValueError):
            subs = 0
        if not (MIN_SUBS <= subs <= MAX_SUBS):
            skip_log.info(
                f"SKIP {cid} ({name}): {subs:,} subs — outside {MIN_SUBS:,}–{MAX_SUBS:,}"
            )
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        country = snippet.get("country", "")
        if country and country not in ALLOWED_COUNTRIES:
            skip_log.info(f"SKIP {cid} ({name}): country={country!r} blocked")
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue
        if not country and has_india_signals(f"{name} {desc}"):
            skip_log.info(f"SKIP {cid} ({name}): country unset — India signals detected")
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        lang = snippet.get("defaultLanguage", "")
        if lang and lang not in ALLOWED_LANGUAGES:
            skip_log.info(f"SKIP {cid} ({name}): language={lang!r} unsupported")
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        sig = score(desc)
        if sig == 0:
            skip_log.info(f"SKIP {cid} ({name}): no qualification signals")
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        # ── Tier 2: API-cost filters ──────────────────────────────────────────
        uploads_id = (
            ch.get("contentDetails", {})
            .get("relatedPlaylists", {})
            .get("uploads", "")
        )
        if not uploads_id:
            skip_log.info(f"SKIP {cid} ({name}): no uploads playlist")
            continue

        if not fits("playlistItems.list"):
            skip_log.info(f"SKIP {cid} ({name}): quota limit before upload check")
            raise QuotaExhaustedError("Quota exhausted during gauntlet.")

        try:
            active, video_ids = recent_upload(uploads_id)
        except HttpError as exc:
            skip_log.info(f"SKIP {cid} ({name}): upload check error — {exc}")
            continue

        if not active:
            skip_log.info(f"SKIP {cid} ({name}): no upload in last {RECENT_DAYS} days")
            continue

        if not fits("videos.list"):
            skip_log.info(f"SKIP {cid} ({name}): quota limit before video details check")
            raise QuotaExhaustedError("Quota exhausted during gauntlet.")

        try:
            longform_count, avg_views, monetized, recent_video_transcript = get_video_details(video_ids)
        except HttpError as exc:
            skip_log.info(f"SKIP {cid} ({name}): video details error — {exc}")
            continue

        total_videos   = len(video_ids)
        longform_ratio = (longform_count / total_videos) if total_videos else 0.0
        if longform_ratio < MIN_LONGFORM_RATIO:
            skip_log.info(
                f"SKIP {cid} ({name}): {longform_count}/{total_videos} long-form "
                f"({longform_ratio:.0%}) — below {MIN_LONGFORM_RATIO:.0%} ratio — insufficient_content"
            )
            append_to_insufficient(cid)
            seen_ids.add(cid)
            continue

        if avg_views < 1_000:
            skip_log.info(
                f"SKIP {cid} ({name}): {avg_views:,} avg views — below 1k threshold"
            )
            append_to_blacklist(cid)
            seen_ids.add(cid)
            continue

        # ── Tier 2b: visual gate ────────────────────────────────────────────
        # Faceless/automated channels (compilations, TTS narration, meme
        # streams) can pass every check above; this rejects them on thumbnail
        # content instead of metadata.
        if not check_face_present(video_ids):
            skip_log.info(
                f"SKIP {cid} ({name}): no human face detected across "
                f"{min(len(video_ids), FACE_CHECK_SAMPLE)} sampled thumbnails — faceless/automated content"
            )
            append_to_blacklist(cid, "faceless_content")
            seen_ids.add(cid)
            continue

        # ── Qualified lead ────────────────────────────────────────────────────
        email          = extract_email(desc)
        social_links   = extract_social_links(desc)
        external_links = extract_external_links(ch)
        url            = make_url(ch)

        # Deep-link recovery: no email in the description → crawl the channel's
        # own website (first custom, non-social external link) for one.
        deep_linked = False
        if not email and external_links:
            crawled = crawl_for_email(external_links.split(" | "))
            if crawled:
                email = crawled
                deep_linked = True
                safe_print(f"  [+] found via deep-link: {email}")

        row = {
            "url":                      url,
            "email":                    email,
            "avg_views":                avg_views,
            "social_links":             social_links,
            "external_links":           external_links,
            "priority_lane":            "high-ticket" if monetized else "",
            "recent_video_transcript":  recent_video_transcript,
        }

        # ── Email validation gate ───────────────────────────────────────────
        # Runs right after mining, before the row can reach leads.csv or the
        # webhook. Protects the cold-sending domain's reputation from bounces
        # and spam traps.
        if email:
            verdict = verify_email(email)
            if verdict == "invalid":
                skip_log.info(f"SKIP {cid} ({name}): email '{email}' failed ZeroBounce validation")
                append_to_blacklist(cid, "invalid_email")
                seen_ids.add(cid)
                continue
            if verdict == "timeout":
                skip_log.info(f"CACHE {cid} ({name}): ZeroBounce timed out — parked for re-check")
                cache_pending_verification(row, "zerobounce_timeout")
                seen_ids.add(cid)
                continue

        new_rows_out.append(row)
        seen_ids.add(cid)
        send_webhook(row)

        strength   = "strong" if sig == 2 else "weak"
        email_note = f" | {email}{' (deep-link)' if deep_linked else ''}" if email else ""
        ext_note   = f" | {len(external_links.split(' | '))} ext link(s)" if external_links else ""
        mon_note   = " | high-ticket lane" if monetized else ""
        safe_print(f"  [+] {name} | {subs:,} subs | {avg_views:,} avg views | {strength} signals{email_note}{ext_note}{mon_note}")


# ── Profile switching ─────────────────────────────────────────────────────────
# Hot-swap the active niche's workspace. Rebinds every path global to the
# profile's directory, flushes the in-memory extraction cache, and drops the
# tracking-DB connection so the next DB call reopens against the profile's own
# tracking.db. This is the "serialize active profile → flush memory → hot-load
# next profile" switch; SessionProfile just owns the paths.

def use_profile(profile: SessionProfile) -> None:
    """Route all output/state I/O through `profile`'s per-niche directory.

    Must be called before init_tracking_db()/init_webhook_db() so those open
    inside the profile dir. Safe to call again mid-process to switch niches: the
    previous profile's tracking connection is closed and the upload cache is
    cleared, so no channel state leaks across the boundary. Network globals
    (PROXY_MANAGER, impersonation, pacing) are deliberately left shared.
    """
    global OUTPUT_FILE, QUALIFIED_FILE, BLACKLIST_FILE, INSUFFICIENT_FILE
    global SKIP_LOG_FILE, WEBHOOK_DB_FILE, TRACKING_DB_FILE, DAEMON_STATE_FILE
    global _TRACKING_CONN

    # Serialize/close the outgoing profile's DB handle before repointing.
    if _TRACKING_CONN is not None:
        _TRACKING_CONN.commit()
        _TRACKING_CONN.close()
        _TRACKING_CONN = None
    # Flush the in-memory upload cache so the next niche starts cold.
    _UPLOADS_CACHE.clear()

    OUTPUT_FILE       = profile.leads
    QUALIFIED_FILE    = profile.qualified
    BLACKLIST_FILE    = profile.blacklist
    INSUFFICIENT_FILE = profile.insufficient
    SKIP_LOG_FILE     = profile.skip_log
    WEBHOOK_DB_FILE   = profile.webhook_db
    TRACKING_DB_FILE  = profile.tracking_db
    DAEMON_STATE_FILE = profile.daemon_state

    _bind_skip_log(SKIP_LOG_FILE)
    safe_print(f"[profile] active niche '{profile.niche}' → {profile.dir}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="YouTube channel lead scraper (yt-dlp).")
    parser.add_argument(
        "--niche",
        default=os.getenv("ORCHESTRATOR_NICHE", "").strip(),
        help="Isolate this run under profiles/<niche>/ (own leads, blacklist, "
             "tracking DB, keyword memory). Omit for the legacy shared workspace.",
    )
    args = parser.parse_args()

    profile: SessionProfile | None = None
    if args.niche:
        profile = SessionProfile(args.niche)
        use_profile(profile)

    safe_print("API-free mode — all extraction via yt-dlp (no quota, no key)")

    init_webhook_db()
    init_tracking_db()
    normalize_leads_csv()
    if SMARTLEAD_WEBHOOK_URL:
        safe_print(f"Webhook: delivering leads to {SMARTLEAD_WEBHOOK_URL} (DLQ: {WEBHOOK_DB_FILE})")
    else:
        safe_print("Webhook: SMARTLEAD_WEBHOOK_URL not set — delivery disabled")

    keywords_path = str(profile.keywords) if profile else "keywords.txt"
    seed_path     = str(profile.lookalike) if profile else "lookalike_targets.txt"
    if profile and not Path(keywords_path).exists():
        safe_print(
            f"[profile] no keywords file for niche '{profile.niche}' yet — "
            f"create {keywords_path} (or let orchestrator.py generate it). Nothing to do."
        )
        return
    keywords  = load_keywords(keywords_path)
    seed_urls = load_seed_urls(seed_path)
    safe_print(f"Loaded {len(keywords)} keyword(s) and {len(seed_urls)} lookalike seed(s)")

    seen_ids  = load_seen_ids()
    new_rows: list[dict] = []

    # Shared candidate pool across both discovery phases. pool_seen de-dupes a
    # channel surfaced by multiple keywords/seeds so it is enriched only once;
    # seen_ids excludes channels already processed in prior runs.
    candidate_pool: list[str] = []
    pool_seen: set[str] = set()
    kw_index   = 0
    seed_index = 0

    checkpoint = load_daemon_state()
    if checkpoint:
        kw_index       = checkpoint.get("kw_index", 0)
        seed_index     = checkpoint.get("seed_index", 0)
        candidate_pool = checkpoint.get("candidate_pool", [])
        pool_seen      = set(checkpoint.get("pool_seen", candidate_pool))
        new_rows       = checkpoint.get("pending_leads", [])
        clear_daemon_state()
        safe_print(
            f"[resume] loaded checkpoint — kw_index={kw_index}, seed_index={seed_index}, "
            f"pool={len(candidate_pool)}, pending_leads={len(new_rows)}"
        )

    def pool_extend(found: list[str]) -> int:
        added = 0
        for cid in found:
            if cid and cid not in seen_ids and cid not in pool_seen:
                pool_seen.add(cid)
                candidate_pool.append(cid)
                added += 1
        return added

    def current_state() -> dict:
        return {
            "kw_index": kw_index,
            "seed_index": seed_index,
            "candidate_pool": candidate_pool,
            "pool_seen": list(pool_seen),
            "pending_leads": new_rows,
        }

    install_signal_checkpoint(current_state)

    try:
        # ── Phase 1: keyword SEO search (yt-dlp) ──────────────────────────────
        while kw_index < len(keywords):
            keyword = keywords[kw_index]
            safe_print(f"\n[keyword] '{keyword}'")
            added = pool_extend(search_page_ytdlp(keyword))
            safe_print(f"  [search] +{added} new candidate channel(s) via yt-dlp")
            kw_index += 1

        # ── Phase 2: algorithmic lookalike engine (yt-dlp) ────────────────────
        while seed_index < len(seed_urls):
            seed = seed_urls[seed_index]
            safe_print(f"\n[lookalike] {seed}")
            added = pool_extend(search_lookalikes_ytdlp(seed))
            safe_print(f"  [lookalike] +{added} new candidate channel(s) via algorithm")
            seed_index += 1

        # ── Enrichment: pool → 50-ID chunks → channel_batch (yt-dlp) ──────────
        safe_print(
            f"\nPooled {len(candidate_pool)} unique candidate channel(s) "
            f"— enriching in chunks of 50"
        )
        for chunk in chunked(candidate_pool, 50):
            channels = channel_batch(chunk)

            # Single source of truth — all Tier-1/Tier-2 filtering lives in run_gauntlet().
            run_gauntlet(channels, seen_ids, new_rows)

            # Flush qualified rows after every chunk so an interrupted run
            # (crash, reboot, Ctrl-C) never loses more than one chunk of leads.
            if new_rows:
                append_rows(new_rows)
                new_rows = []

    except QuotaExhaustedError as exc:
        safe_print(f"\n[HALTED] {exc}")
        skip_log.info(f"HALTED — saving CSV. {exc}")
        sys.exit(199)

    finally:
        if new_rows:
            append_rows(new_rows)
            new_rows = []

        flush_webhook_queue()

        safe_print(f"\n{'─' * 50}")
        safe_print(f"Output     : {OUTPUT_FILE.resolve()}")
        safe_print(f"Tracking DB: {TRACKING_DB_FILE.resolve()} (processed_channels, blacklist)")
        safe_print(f"Skip log   : {SKIP_LOG_FILE.resolve()}")


if __name__ == "__main__":
    main()
