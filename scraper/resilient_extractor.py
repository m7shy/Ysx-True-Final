"""
Self-healing fallback extraction layer.

YouTube's web layer restructures without notice, which silently breaks
structured extractors (yt-dlp field maps, ytInitialPlayerResponse paths) and
starves the pipeline of primitives like subscriber counts and view counts.
This module wraps each primitive behind a FallbackChain: the primary extractor
runs first, and on an empty result or an exception a cascade of pre-configured
recovery patterns (alternative JSON regexes, meta-tag reads, raw string index
scans) attempts to pull the value straight out of the page source.

Every recovery is logged as a WARNING naming the exact step that fired, so the
primary extractor can be updated manually. If every step fails, a plain
ExtractionRecoveryError is raised — callers keep their existing None/skip
gates untouched.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any, Callable

# ── Logging ───────────────────────────────────────────────────────────────────
fallback_log = logging.getLogger("fallback")
fallback_log.setLevel(logging.WARNING)
if not fallback_log.handlers:
    _h = logging.StreamHandler(sys.stderr)
    _h.setFormatter(logging.Formatter(
        "%(asctime)s  SELF-HEAL %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    ))
    fallback_log.addHandler(_h)


class ExtractionRecoveryError(RuntimeError):
    """Raised when the primary extractor and every fallback step fail."""


def _is_empty(value: Any) -> bool:
    """Treat None, empty strings/collections as extraction misses. 0 is a
    legitimate value for counts (a channel can genuinely have 0 views on a
    video), so numeric zero is NOT a miss."""
    if value is None:
        return True
    if isinstance(value, (str, list, tuple, dict, set)) and len(value) == 0:
        return True
    return False


class FallbackChain:
    """Ordered cascade of named extraction steps for one primitive field.

    steps – list of (step_name, callable) pairs. Each callable takes the raw
    source (HTML string or parsed payload) and returns the value or None.
    The first step is treated as the primary extractor: succeeding there is
    silent. Any later step that recovers the value fires a targeted warning
    naming the step, so the drifted primary can be fixed manually.
    """

    def __init__(self, field: str, steps: list[tuple[str, Callable[[Any], Any]]]):
        if not steps:
            raise ValueError("FallbackChain requires at least one step")
        self.field = field
        self.steps = steps

    def run(self, source: Any, upstream_primary: str | None = None) -> Any:
        """Execute the cascade. `upstream_primary` names an extractor that
        already failed before this chain was invoked (e.g. a yt-dlp field
        map); when set, even a first-step hit is reported as a recovery so
        that extractor gets fixed."""
        failures: list[str] = []
        for i, (name, fn) in enumerate(self.steps):
            try:
                value = fn(source)
            except Exception as exc:  # trap faults; never crash the loop
                failures.append(f"{name}: {type(exc).__name__}: {exc}")
                continue
            if _is_empty(value):
                failures.append(f"{name}: empty result")
                continue
            if i > 0 or upstream_primary is not None:
                drifted = upstream_primary or self.steps[0][0]
                fallback_log.warning(
                    "field '%s' recovered via fallback step '%s' "
                    "(primary extractor '%s' failed — update it): %r",
                    self.field, name, drifted, value,
                )
            return value
        raise ExtractionRecoveryError(
            f"all {len(self.steps)} extraction steps failed for field "
            f"'{self.field}': " + "; ".join(failures)
        )


# ── Number parsing ────────────────────────────────────────────────────────────
_COMPACT_RE = re.compile(r"([\d][\d,.]*)\s*([KMB])?", re.IGNORECASE)
_MULTIPLIERS = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}


def parse_compact_number(text: str) -> int | None:
    """Parse '1,234', '1.23K', '4.5M subscribers' → int. None if no number."""
    if not text:
        return None
    m = _COMPACT_RE.search(text)
    if not m:
        return None
    digits, suffix = m.group(1), m.group(2)
    try:
        base = float(digits.replace(",", ""))
    except ValueError:
        return None
    return int(base * _MULTIPLIERS.get((suffix or "").upper(), 1))


# ── Subscriber count (channel page HTML) ──────────────────────────────────────
# Classic renderer: "subscriberCountText":{"simpleText":"1.23K subscribers"}
_SUBS_SIMPLETEXT_RE = re.compile(
    r'"subscriberCountText"\s*:\s*\{[^{}]*?"simpleText"\s*:\s*"([^"]+)"'
)
# Accessibility label variant: "label":"1.23K subscribers"
_SUBS_LABEL_RE = re.compile(r'"label"\s*:\s*"([\d.,]+\s*[KMB]?\s*subscribers?)"', re.I)
# 2024+ ViewModel variant: "content":"1.2K subscribers"
_SUBS_CONTENT_RE = re.compile(r'"content"\s*:\s*"([\d.,]+\s*[KMB]?\s*subscribers?)"', re.I)


def _subs_from_simpletext(html: str) -> int | None:
    m = _SUBS_SIMPLETEXT_RE.search(html)
    return parse_compact_number(m.group(1)) if m else None


def _subs_from_label(html: str) -> int | None:
    m = _SUBS_LABEL_RE.search(html)
    return parse_compact_number(m.group(1)) if m else None


def _subs_from_content_viewmodel(html: str) -> int | None:
    m = _SUBS_CONTENT_RE.search(html)
    return parse_compact_number(m.group(1)) if m else None


def _subs_from_raw_index(html: str) -> int | None:
    """Last resort: locate the literal word 'subscribers' and scan the
    preceding characters for a compact number token."""
    idx = html.find("subscribers")
    while idx != -1:
        window = html[max(0, idx - 24):idx]
        m = None
        for m in _COMPACT_RE.finditer(window):
            pass  # keep the number closest to the keyword
        if m:
            return parse_compact_number(m.group(0))
        idx = html.find("subscribers", idx + 1)
    return None


def recover_subscriber_count(html: str, upstream_primary: str | None = None) -> int:
    """Cascade subscriber-count recovery over raw channel-page HTML."""
    chain = FallbackChain("subscriber_count", [
        ("json-subscriberCountText-simpleText", _subs_from_simpletext),
        ("json-accessibility-label", _subs_from_label),
        ("json-viewmodel-content", _subs_from_content_viewmodel),
        ("raw-string-index-scan", _subs_from_raw_index),
    ])
    return chain.run(html, upstream_primary=upstream_primary)


# ── View count (watch page HTML) ──────────────────────────────────────────────
_VIEWS_VIDEODETAILS_RE = re.compile(r'"viewCount"\s*:\s*"(\d+)"')
_VIEWS_META_RE = re.compile(
    r'<meta\s+itemprop="interactionCount"\s+content="(\d+)"', re.I
)
_VIEWS_SIMPLETEXT_RE = re.compile(
    r'"viewCount"\s*:\s*\{[^{}]*?"simpleText"\s*:\s*"([\d.,]+\s*views?)"', re.I
)


def _views_from_videodetails(html: str) -> int | None:
    m = _VIEWS_VIDEODETAILS_RE.search(html)
    return int(m.group(1)) if m else None


def _views_from_meta_tag(html: str) -> int | None:
    m = _VIEWS_META_RE.search(html)
    return int(m.group(1)) if m else None


def _views_from_simpletext(html: str) -> int | None:
    m = _VIEWS_SIMPLETEXT_RE.search(html)
    return parse_compact_number(m.group(1)) if m else None


def recover_view_count(html: str, upstream_primary: str | None = None) -> int:
    """Cascade view-count recovery over raw watch-page HTML."""
    chain = FallbackChain("view_count", [
        ("json-videoDetails-viewCount", _views_from_videodetails),
        ("meta-itemprop-interactionCount", _views_from_meta_tag),
        ("json-viewCount-simpleText", _views_from_simpletext),
    ])
    return chain.run(html, upstream_primary=upstream_primary)


# ── Duration seconds (watch page HTML) ────────────────────────────────────────
_LEN_SECS_RE = re.compile(r'"lengthSeconds"\s*:\s*"(\d+)"')
_DURATION_META_RE = re.compile(
    r'<meta\s+itemprop="duration"\s+content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"', re.I
)
_APPROX_MS_RE = re.compile(r'"approxDurationMs"\s*:\s*"(\d+)"')


def _duration_from_lengthseconds(html: str) -> int | None:
    m = _LEN_SECS_RE.search(html)
    return int(m.group(1)) if m else None


def _duration_from_meta_tag(html: str) -> int | None:
    m = _DURATION_META_RE.search(html)
    if not m:
        return None
    h, mins, s = (int(g) if g else 0 for g in m.groups())
    total = h * 3600 + mins * 60 + s
    return total or None


def _duration_from_approx_ms(html: str) -> int | None:
    m = _APPROX_MS_RE.search(html)
    return int(m.group(1)) // 1000 if m else None


def recover_duration_secs(html: str, upstream_primary: str | None = None) -> int:
    """Cascade duration recovery over raw watch-page HTML."""
    chain = FallbackChain("duration_secs", [
        ("json-videoDetails-lengthSeconds", _duration_from_lengthseconds),
        ("meta-itemprop-duration", _duration_from_meta_tag),
        ("json-approxDurationMs", _duration_from_approx_ms),
    ])
    return chain.run(html, upstream_primary=upstream_primary)


# ── Upload date (watch page HTML) ─────────────────────────────────────────────
_UPLOAD_DATE_RE = re.compile(r'"uploadDate"\s*:\s*"([^"]+)"')
_PUBLISH_DATE_RE = re.compile(r'"publishDate"\s*:\s*"([^"]+)"')
_DATE_META_RE = re.compile(
    r'<meta\s+itemprop="(?:uploadDate|datePublished)"\s+content="([^"]+)"', re.I
)


def _date_from_uploaddate(html: str) -> str | None:
    m = _UPLOAD_DATE_RE.search(html)
    return m.group(1) if m else None


def _date_from_meta_tag(html: str) -> str | None:
    m = _DATE_META_RE.search(html)
    return m.group(1) if m else None


def _date_from_publishdate(html: str) -> str | None:
    m = _PUBLISH_DATE_RE.search(html)
    return m.group(1) if m else None


def recover_upload_date(html: str, upstream_primary: str | None = None) -> str:
    """Cascade upload-date recovery over raw watch-page HTML. Returns the
    raw date string (ISO 8601 or YYYY-MM-DD as found)."""
    chain = FallbackChain("upload_date", [
        ("json-microformat-uploadDate", _date_from_uploaddate),
        ("meta-itemprop-date", _date_from_meta_tag),
        ("json-microformat-publishDate", _date_from_publishdate),
    ])
    return chain.run(html, upstream_primary=upstream_primary)


# ── Generic guard for primary extractors ──────────────────────────────────────
def guarded(field: str, primary: Callable[[], Any],
            recover: Callable[[str], Any],
            html_getter: Callable[[], str | None]) -> Any:
    """Run `primary()`; on an empty result or a fault, fetch page source via
    `html_getter()` and run the recovery cascade over it.

    Raises ExtractionRecoveryError if the primary fails AND recovery fails
    (or no HTML could be fetched) — callers decide how their existing gates
    handle that, exactly as they handled a missing value before.
    """
    try:
        value = primary()
    except Exception as exc:
        fallback_log.warning(
            "field '%s' primary extractor raised %s: %s — entering fallback cascade",
            field, type(exc).__name__, exc,
        )
        value = None
    if not _is_empty(value):
        return value
    html = html_getter()
    if _is_empty(html):
        raise ExtractionRecoveryError(
            f"field '{field}': primary extraction failed and no page source "
            "was available for fallback recovery"
        )
    return recover(html)
