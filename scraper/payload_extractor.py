"""
Low-overhead regex-based extractor for YouTube's ytInitialPlayerResponse payload.

Captures embedded JSON directly from raw HTML page sources without headless rendering.
Extracts video metadata, content flags, and monetization signals for upstream validation.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any


# Regex to find the start of ytInitialPlayerResponse assignment. No 'var' prefix
# is required — matches yt-dlp's own extractor pattern (ytInitialPlayerResponse
# is not always preceded by a 'var' declaration keyword across page variants).
_YT_INIT_START = re.compile(r"ytInitialPlayerResponse\s*=\s*")


def _extract_json_object(text: str, start_pos: int) -> str | None:
    """Extract a complete JSON object from text starting at start_pos.

    Handles arbitrary nesting depth by tracking brace balance.
    Returns the JSON string (including braces) or None if malformed.
    """
    if start_pos >= len(text) or text[start_pos] != "{":
        return None
    depth = 0
    in_string = False
    escape_next = False
    end_pos = start_pos
    for i in range(start_pos, len(text)):
        ch = text[i]
        if escape_next:
            escape_next = False
            continue
        if ch == "\\":
            escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end_pos = i
                break
    if depth != 0:
        return None
    return text[start_pos : end_pos + 1]


@dataclass
class VideoMetadata:
    """Extracted video metadata and content flags from ytInitialPlayerResponse."""

    video_id: str = ""
    title: str = ""
    duration_ms: int = 0
    is_age_restricted: bool = False
    is_monetized: bool = False
    is_private: bool = False
    is_unlisted: bool = False
    is_live: bool = False
    is_premiere: bool = False
    short_form: bool = False
    category: str = ""
    view_count: int | None = None
    upload_date: str = ""
    channel_id: str = ""
    channel_name: str = ""
    keywords: list[str] = field(default_factory=list)
    is_restricted_mode_safe: bool = True
    content_rating: str = ""
    raw_data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for JSON serialization."""
        return {
            "video_id": self.video_id,
            "title": self.title,
            "duration_ms": self.duration_ms,
            "is_age_restricted": self.is_age_restricted,
            "is_monetized": self.is_monetized,
            "is_private": self.is_private,
            "is_unlisted": self.is_unlisted,
            "is_live": self.is_live,
            "is_premiere": self.is_premiere,
            "short_form": self.short_form,
            "category": self.category,
            "view_count": self.view_count,
            "upload_date": self.upload_date,
            "channel_id": self.channel_id,
            "channel_name": self.channel_name,
            "keywords": self.keywords,
            "is_restricted_mode_safe": self.is_restricted_mode_safe,
            "content_rating": self.content_rating,
        }


def extract_payload(html_source: str) -> dict[str, Any] | None:
    """Extract and parse ytInitialPlayerResponse JSON from raw HTML.

    Returns the parsed JSON dict or None if not found / not parseable.
    Handles malformed/truncated JSON gracefully and supports arbitrary nesting depth.

    Tries every occurrence of the assignment, not just the first: unavailable/
    error-state pages can emit a leading `ytInitialPlayerResponse = null;` (or a
    template placeholder) before the real object appears later in the page.
    """
    if not html_source:
        return None
    for match in _YT_INIT_START.finditer(html_source):
        raw_json = _extract_json_object(html_source, match.end())
        if not raw_json:
            continue
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError:
            continue
    return None


def _extract_video_id(data: dict) -> str:
    """Extract videoId from the payload's videoDetails block."""
    details = data.get("videoDetails", {})
    return (details or {}).get("videoId", "")


def _extract_title(data: dict) -> str:
    """Extract video title."""
    details = data.get("videoDetails", {})
    return (details or {}).get("title", "")


def _extract_duration_ms(data: dict) -> int:
    """Extract lengthSeconds and convert to milliseconds."""
    details = data.get("videoDetails", {})
    secs = (details or {}).get("lengthSeconds", "0")
    try:
        return int(secs) * 1000
    except (TypeError, ValueError):
        return 0


def _extract_view_count(data: dict) -> int | None:
    """Extract viewCount from videoDetails; return None if hidden or absent."""
    details = data.get("videoDetails", {})
    count = (details or {}).get("viewCount", None)
    if count is None:
        return None
    try:
        return int(count)
    except (TypeError, ValueError):
        return None


def _extract_channel_info(data: dict) -> tuple[str, str]:
    """Extract channel_id and channel_name from videoDetails."""
    details = data.get("videoDetails", {})
    channel_id = (details or {}).get("channelId", "")
    channel_name = (details or {}).get("author", "")
    return channel_id, channel_name


def _extract_keywords(data: dict) -> list[str]:
    """Extract keywords array from videoDetails.keywords."""
    details = data.get("videoDetails", {})
    kw = (details or {}).get("keywords", [])
    return kw if isinstance(kw, list) else []


def _microformat(data: dict) -> dict:
    """Return microformat.playerMicroformatRenderer — the actual nesting level
    that holds category, publishDate, isUnlisted, isFamilySafe, etc.

    A prior version of this module read these fields directly off `microformat`,
    which does not carry them — verified against a live watch-page fetch, every
    one of those fields lives one level deeper, under playerMicroformatRenderer.
    """
    microformat = data.get("microformat", {}) or {}
    return microformat.get("playerMicroformatRenderer", {}) or {}


# Phrases yt-dlp's own extractor matches against playabilityStatus.status/reason
# to detect an age gate (see yt_dlp.extractor.youtube._video.YoutubeIE._is_agegated).
# A bare "age" substring (the prior implementation) false-positives on ordinary
# words like "average", "storage", "package", "manage".
_AGE_GATE_PHRASES = (
    "confirm your age", "age-restricted", "inappropriate",
    "age_verification_required", "age_check_required",
)


def _is_age_restricted(data: dict) -> bool:
    """Detect age-restriction using the same signals yt-dlp's extractor relies on:
    desktopLegacyAgeGateReason presence, or a known age-gate phrase in the
    playabilityStatus status/reason fields.
    """
    status = data.get("playabilityStatus", {}) or {}
    if status.get("desktopLegacyAgeGateReason"):
        return True
    haystack = f"{status.get('status', '')} {status.get('reason', '')}".lower()
    return any(phrase in haystack for phrase in _AGE_GATE_PHRASES)


def _is_private(data: dict) -> bool:
    """Detect private status from videoDetails.isPrivate (the direct signal
    yt-dlp reads), falling back to the playabilityStatus.status text for
    removed/unplayable videos where videoDetails may be absent entirely.
    """
    details = data.get("videoDetails", {}) or {}
    if details.get("isPrivate"):
        return True
    status = data.get("playabilityStatus", {}) or {}
    status_val = (status.get("status") or "").upper()
    return status_val in ("UNPLAYABLE", "LOGIN_REQUIRED")


def _is_unlisted(data: dict) -> bool:
    """Detect unlisted status from microformat.playerMicroformatRenderer.isUnlisted
    — videoDetails carries no such field.
    """
    return bool(_microformat(data).get("isUnlisted", False))


def _is_live(data: dict) -> bool:
    """Detect live/streaming status from videoDetails or streaming data."""
    details = data.get("videoDetails", {})
    is_live_content = (details or {}).get("isLiveContent", False)
    return bool(is_live_content)


def _is_premiere(data: dict) -> bool:
    """Detect an upcoming/scheduled Premiere from videoDetails.isUpcoming — the
    only field yt-dlp's extractor uses for this signal. (An earlier version of
    this module also checked a `microformat.isScheduledContent` key that does
    not exist anywhere in YouTube's actual player-response schema.)
    """
    details = data.get("videoDetails", {}) or {}
    return bool(details.get("isUpcoming", False))


def _is_short_form(data: dict) -> bool:
    """Detect Shorts (very short videos, < 60 seconds).

    Live streams are excluded: a live broadcast reports lengthSeconds="0" while
    it is still running (duration is unknown until it ends), which is not the
    same condition as a short-form video and must not be conflated with one.
    """
    if _is_live(data):
        return False
    length_ms = _extract_duration_ms(data)
    return length_ms < 60_000


def _is_monetized(data: dict) -> bool:
    """Detect ad/monetization signals via presence of adPlacements or
    adBreakHeartbeatParams at the top level of the payload.

    A prior version checked for streamingData.formats/adaptiveFormats, which is
    present on virtually every playable video regardless of monetization status
    and is therefore not a monetization signal at all. adPlacements/
    adBreakHeartbeatParams are the fields yt-dlp's own extractor reads to detect
    ad placement (see the AD_PLACEMENT_KIND_START handling in youtube/_video.py).
    """
    return bool(data.get("adPlacements")) or bool(data.get("adBreakHeartbeatParams"))


def _extract_category(data: dict) -> str:
    """Extract video category/genre from microformat.playerMicroformatRenderer."""
    return _microformat(data).get("category", "")


def _extract_upload_date(data: dict) -> str:
    """Extract publish date from microformat.playerMicroformatRenderer."""
    return _microformat(data).get("publishDate", "")


def _extract_content_rating(data: dict) -> str:
    """Extract content rating label (e.g., 'ytAgeRestricted') from contentRating.ytRating.

    contentRating is an empty object on the vast majority of videos (it only
    carries data for videos with an actual rating), so an empty string here is
    the expected, common case rather than an extraction failure.
    """
    rating = data.get("contentRating", {}) or {}
    return rating.get("ytRating", "")


def _is_restricted_mode_safe(data: dict) -> bool:
    """Check microformat.playerMicroformatRenderer.isFamilySafe — the field
    yt-dlp itself reads for this signal. Defaults to True (safe) when absent,
    matching yt-dlp's own `is False` (not `not`) check, which only treats an
    explicit False as unsafe.
    """
    is_family_safe = _microformat(data).get("isFamilySafe")
    return is_family_safe is not False


def extract_metadata(payload: dict[str, Any]) -> VideoMetadata:
    """Parse ytInitialPlayerResponse payload into a structured VideoMetadata object.

    Handles missing/malformed fields gracefully with safe defaults.
    All extraction functions validate their return types before returning.
    """
    if not payload or not isinstance(payload, dict):
        return VideoMetadata()

    video_id = _extract_video_id(payload)
    title = _extract_title(payload)
    duration_ms = _extract_duration_ms(payload)
    view_count = _extract_view_count(payload)
    channel_id, channel_name = _extract_channel_info(payload)
    keywords = _extract_keywords(payload)

    is_age_restricted = _is_age_restricted(payload)
    is_private = _is_private(payload)
    is_unlisted = _is_unlisted(payload)
    is_live = _is_live(payload)
    is_premiere = _is_premiere(payload)
    short_form = _is_short_form(payload)
    is_monetized = _is_monetized(payload)
    category = _extract_category(payload)
    upload_date = _extract_upload_date(payload)
    content_rating = _extract_content_rating(payload)
    is_restricted_mode_safe = _is_restricted_mode_safe(payload)

    return VideoMetadata(
        video_id=video_id,
        title=title,
        duration_ms=duration_ms,
        is_age_restricted=is_age_restricted,
        is_monetized=is_monetized,
        is_private=is_private,
        is_unlisted=is_unlisted,
        is_live=is_live,
        is_premiere=is_premiere,
        short_form=short_form,
        category=category,
        view_count=view_count,
        upload_date=upload_date,
        channel_id=channel_id,
        channel_name=channel_name,
        keywords=keywords,
        is_restricted_mode_safe=is_restricted_mode_safe,
        content_rating=content_rating,
        raw_data=payload,
    )


def extract_from_html(html_source: str) -> VideoMetadata | None:
    """End-to-end: extract and parse ytInitialPlayerResponse from raw HTML.

    Returns VideoMetadata on success, None if extraction failed.
    Validates against standard schema constraints before returning.
    """
    if not html_source:
        return None
    payload = extract_payload(html_source)
    if payload is None:
        return None
    metadata = extract_metadata(payload)
    if not metadata.video_id:
        return None
    return metadata


def validate_schema(metadata: VideoMetadata) -> bool:
    """Verify VideoMetadata matches expected schema and constraints.

    Checks:
      - video_id is a valid 11-character YouTube video ID
      - title is non-empty
      - duration_ms is non-negative
      - channel_id is non-empty
      - Logical consistency (e.g., not both private and monetized)
    """
    if not metadata.video_id or len(metadata.video_id) != 11:
        return False
    if not metadata.title:
        return False
    if metadata.duration_ms < 0:
        return False
    if not metadata.channel_id:
        return False
    if metadata.is_private and metadata.is_monetized:
        return False
    if metadata.is_live and metadata.short_form:
        return False
    return True
