"""
Auto-generated transcript extraction.

Pulls a video's auto-generated (ASR) caption track via yt-dlp's
metadata-only path (writeautomaticsub + skip_download — no video bytes are
ever fetched), strips VTT/SRT cue markup and timestamp lines, and returns the
plain spoken-text string. Used by the description/monetization-signal gates
in main.py to run text checks against a video's actual narration instead of
only its description, without the cost of downloading media.

Results are cached in-process only (module-level dict) — nothing here is
persisted to disk; the cache is discarded when the process exits.
"""

from __future__ import annotations

import re

from curl_cffi import requests

from cookie_manager import COOKIE_MANAGER

_IMPERSONATE = "chrome120"
_HTTP_TIMEOUT = 15
# Same rotating cookie pool as main.py — this module shares the single
# COOKIE_MANAGER instance instead of reading the cookie config independently.
# fetch_transcript() has no retry loop, so a burned cookie here only rotates
# which account the *next* transcript call uses (not a retry of this one).
_BOT_CHECK_MARKERS = (
    "sign in to confirm", "not a bot", "confirm you're not a bot",
    "confirm your age", "login required", "account cookies are no longer valid",
)

# Caption tracks come back as WebVTT or SRT depending on format negotiation.
_VTT_HEADER_RE   = re.compile(r"^WEBVTT.*$", re.MULTILINE)
_CUE_TIMING_RE   = re.compile(
    r"^\s*(?:\d+\s*\n)?"
    r"\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*$",
    re.MULTILINE,
)
_SRT_INDEX_RE    = re.compile(r"^\d+\s*$", re.MULTILINE)
_TAG_RE          = re.compile(r"</?[a-zA-Z][^>]*>")           # <c>, <b>, <00:00:01.000>
_POSITION_CUE_RE = re.compile(r"align:\S+|position:\S+|line:\S+")

# In-process only — never written to disk, cleared on process exit.
_TRANSCRIPT_CACHE: dict[str, str] = {}


def _clean_caption_text(raw: str) -> str:
    """Strip VTT/SRT structural noise, leaving just the spoken-text lines."""
    text = _VTT_HEADER_RE.sub("", raw)
    text = _CUE_TIMING_RE.sub("", text)
    text = _SRT_INDEX_RE.sub("", text)
    text = _TAG_RE.sub("", text)
    text = _POSITION_CUE_RE.sub("", text)

    lines = []
    seen_line = None
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line == seen_line:  # ASR tracks routinely repeat the rolling caption line
            continue
        lines.append(line)
        seen_line = line
    return " ".join(lines)


def _pick_auto_caption_url(info: dict, lang_prefs: tuple[str, ...]) -> str | None:
    auto_captions = info.get("automatic_captions") or {}
    if not auto_captions:
        return None

    for lang in lang_prefs:
        tracks = auto_captions.get(lang)
        if tracks:
            return _best_track_url(tracks)

    for tracks in auto_captions.values():
        if tracks:
            return _best_track_url(tracks)
    return None


def _best_track_url(tracks: list[dict]) -> str | None:
    for ext in ("vtt", "srv1", "srt"):
        for track in tracks:
            if track.get("ext") == ext and track.get("url"):
                return track["url"]
    for track in tracks:
        if track.get("url"):
            return track["url"]
    return None


def fetch_transcript(video_id: str, lang_prefs: tuple[str, ...] = ("en", "en-orig")) -> str:
    """Return the cleaned auto-generated transcript text for `video_id`, or ''
    if the video has no automatic captions (narration disabled / no ASR track).

    Metadata-only: yt-dlp runs with skip_download + writeautomaticsub, so no
    video/audio bytes are ever pulled — only the caption-track manifest.
    """
    if video_id in _TRANSCRIPT_CACHE:
        return _TRANSCRIPT_CACHE[video_id]

    import yt_dlp  # local import: keeps this module importable standalone

    cookie = COOKIE_MANAGER.current()
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writeautomaticsub": True,
        "subtitleslangs": list(lang_prefs) + ["all"],
        "socket_timeout": _HTTP_TIMEOUT,
        "retries": 0,
        "extractor_retries": 0,
        **({"cookiefile": cookie} if cookie else {}),
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=False
            )
        COOKIE_MANAGER.report_success(cookie)
    except Exception as exc:
        # No retry loop here — but if this cookie's account is bot-flagged, bench
        # it so the next video's transcript call rotates to a different account.
        if any(m in str(exc).lower() for m in _BOT_CHECK_MARKERS):
            COOKIE_MANAGER.report_bot_check(cookie)
        _TRANSCRIPT_CACHE[video_id] = ""
        return ""

    if not info:
        _TRANSCRIPT_CACHE[video_id] = ""
        return ""

    track_url = _pick_auto_caption_url(info, lang_prefs)
    if not track_url:
        _TRANSCRIPT_CACHE[video_id] = ""
        return ""

    try:
        resp = requests.get(track_url, timeout=_HTTP_TIMEOUT, impersonate=_IMPERSONATE)
        if resp.status_code != 200 or not resp.text:
            _TRANSCRIPT_CACHE[video_id] = ""
            return ""
    except Exception:
        _TRANSCRIPT_CACHE[video_id] = ""
        return ""

    cleaned = _clean_caption_text(resp.text)
    _TRANSCRIPT_CACHE[video_id] = cleaned
    return cleaned
