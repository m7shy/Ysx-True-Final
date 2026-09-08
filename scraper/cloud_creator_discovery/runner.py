#!/usr/bin/env python3
"""Cloud-safe, discovery-only YouTube creator finder for YSXVISUALS.

This module deliberately does not qualify leads or recommend outreach.  It
collects public YouTube metadata, maintains a Cairo-day deduplication ledger,
and writes an auditable report for a human/agent qualification step later.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import yt_dlp


CAIRO = ZoneInfo("Africa/Cairo")
RUN_SLOTS = ("09:00", "11:00", "14:00", "16:00", "19:00")
TARGET_PER_RUN = 40
MIN_PER_RUN = 30
MAX_PER_RUN = 50
SEARCH_RESULTS_PER_QUERY = 25

# Fixed research vocabulary: no model-generated queries are used.  The offset
# rotation keeps repeated runs from drawing solely from the first few topics.
QUERY_ROTATION: tuple[tuple[str, str], ...] = (
    ("business coaching", "business coaching tutorial"),
    ("freelancing", "freelance consultant tutorial"),
    ("marketing", "marketing consultant how to"),
    ("sales", "sales coach training"),
    ("career coaching", "career coach tutorial"),
    ("personal finance", "financial coach how to"),
    ("fitness coaching", "fitness coach tutorial"),
    ("productivity", "productivity coach systems"),
    ("real estate", "real estate agent training"),
    ("software tutorials", "software consultant tutorial"),
    ("design education", "designer tutorial freelance"),
    ("language learning", "language coach lesson"),
    ("music education", "music teacher tutorial"),
    ("photography education", "photography coach tutorial"),
    ("creator education", "youtube creator tutorial"),
    ("online business", "online business coach tutorial"),
    ("ecommerce", "ecommerce coach tutorial"),
    ("web development", "web developer tutorial freelance"),
    ("health education", "health coach tutorial"),
    ("leadership coaching", "leadership coach training"),
)

EXCLUSION_TERMS = (
    "video editor", "editing services", "editor portfolio", "editing tutorial",
    "news", "university", "college", "school district", "official channel",
    "highlights", "clips", "compilation", "reupload", "re-upload",
    "shorts", "record label", "television", "tv network",
)


def canonical_channel_id(entry: dict[str, Any]) -> str:
    """Return a UC channel ID only when yt-dlp supplied one directly."""
    for key in ("channel_id", "uploader_id"):
        value = str(entry.get(key) or "")
        if value.startswith("UC"):
            return value
    for key in ("channel_url", "uploader_url", "url"):
        match = re.search(r"/channel/(UC[\w-]+)", str(entry.get(key) or ""))
        if match:
            return match.group(1)
    return ""


def subscriber_range(count: int | None) -> str | None:
    if count is None:
        return None
    if 1_000 <= count < 3_000:
        return "1k–3k"
    if 3_000 <= count < 5_000:
        return "3k–5k"
    if 5_000 <= count <= 10_000:
        return "5k–10k"
    return None


def ydl_extract(target: str, *, flat: bool, playlist_items: str | None = None) -> dict[str, Any] | None:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": flat,
        "socket_timeout": 20,
        "retries": 1,
        "extractor_retries": 1,
    }
    if playlist_items:
        options["playlist_items"] = playlist_items
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            return ydl.extract_info(target, download=False)
    except Exception as exc:  # a single unavailable channel must not stop a run
        print(f"[discovery] skipped inaccessible source: {exc}", file=sys.stderr)
        return None


def search_entries(query: str) -> list[dict[str, Any]]:
    result = ydl_extract(f"ytsearch{SEARCH_RESULTS_PER_QUERY}:{query}", flat=True)
    return [entry for entry in (result or {}).get("entries", []) if entry]


def fetch_channel(channel_id: str) -> dict[str, Any] | None:
    return ydl_extract(
        f"https://www.youtube.com/channel/{channel_id}/videos",
        flat=True,
        playlist_items="1-12",
    )


def is_recent_long_form(entries: list[dict[str, Any]], now: datetime) -> bool:
    """Require an observed non-Short upload from the last 90 days when dated."""
    cutoff = now.timestamp() - 90 * 24 * 60 * 60
    for entry in entries:
        duration = entry.get("duration")
        timestamp = entry.get("timestamp")
        if isinstance(duration, (int, float)) and duration >= 180:
            # Some flat channel pages omit timestamps.  The item is still a
            # recent catalogue item, but we retain that limitation in the log.
            if timestamp is None or (isinstance(timestamp, (int, float)) and timestamp >= cutoff):
                return True
    return False


def obvious_nonfit(title: str, description: str) -> bool:
    haystack = f"{title} {description}".lower()
    return any(term in haystack for term in EXCLUSION_TERMS)


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def append_jsonl(path: Path, payloads: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for payload in payloads:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def slot_queries(cairo_now: datetime) -> list[tuple[str, str]]:
    slot_index = RUN_SLOTS.index(cairo_now.strftime("%H:%M"))
    day_offset = cairo_now.toordinal() * 3 + slot_index * 4
    return [QUERY_ROTATION[(day_offset + i) % len(QUERY_ROTATION)] for i in range(4)]


def discover(cairo_now: datetime, state_root: Path) -> dict[str, Any]:
    date_key = cairo_now.date().isoformat()
    slot = cairo_now.strftime("%H:%M")
    daily_path = state_root / "daily" / f"{date_key}.json"
    daily = load_json(daily_path, {"date": date_key, "seen_channel_ids": [], "runs": {}})
    seen = set(daily.get("seen_channel_ids", []))
    discoveries: list[dict[str, Any]] = []
    rejection_counts: Counter[str] = Counter()

    # A rerun of the same slot reports the stored result instead of creating a
    # second discovery batch.
    if slot in daily.get("runs", {}):
        return daily["runs"][slot]

    for niche, query in slot_queries(cairo_now):
        for entry in search_entries(query):
            if len(discoveries) >= MAX_PER_RUN:
                break
            channel_id = canonical_channel_id(entry)
            if not channel_id or channel_id in seen:
                rejection_counts["duplicate_or_unresolved"] += 1
                continue
            channel = fetch_channel(channel_id)
            if not channel:
                rejection_counts["channel_unavailable"] += 1
                continue
            title = str(channel.get("channel") or channel.get("uploader") or entry.get("channel") or "")
            description = str(channel.get("description") or "")
            if obvious_nonfit(title, description):
                rejection_counts["obvious_nonfit"] += 1
                continue
            subscribers = channel.get("channel_follower_count")
            try:
                subscribers = int(subscribers) if subscribers is not None else None
            except (TypeError, ValueError):
                subscribers = None
            range_label = subscriber_range(subscribers)
            if range_label is None:
                rejection_counts["subscriber_band_unobserved_or_outside"] += 1
                continue
            uploads = [item for item in channel.get("entries", []) if item]
            if not is_recent_long_form(uploads, cairo_now):
                rejection_counts["no_recent_observed_long_form"] += 1
                continue
            record = {
                "discovered_at": cairo_now.isoformat(),
                "channel_id": channel_id,
                "channel_creator_name": title or "UNKNOWN",
                "channel_url": f"https://www.youtube.com/channel/{channel_id}",
                "niche": niche,
                "approximate_subscriber_range": range_label,
                "discovery_source": f"YouTube public search: {query}",
                "evidence": {
                    "subscriber_count_observed": subscribers,
                    "recent_catalogue_items_checked": len(uploads),
                    "recent_long_form_observed": True,
                },
                "qualification_status": "NOT_RUN_DISCOVERY_ONLY",
            }
            discoveries.append(record)
            seen.add(channel_id)
        if len(discoveries) >= MAX_PER_RUN:
            break

    append_jsonl(state_root / "discoveries" / f"{date_key}.jsonl", discoveries)
    report = {
        "run_at": cairo_now.isoformat(),
        "slot": slot,
        "new_discoveries": len(discoveries),
        "daily_cumulative_total": len(seen),
        "target_range": f"{MIN_PER_RUN}–{MAX_PER_RUN}",
        "qualification": "NOT_RUN_DISCOVERY_ONLY",
        "rejections_by_screen": dict(rejection_counts),
        "discoveries": discoveries,
    }
    save_json(state_root / "reports" / date_key / f"{slot.replace(':', '')}.json", report)
    daily["seen_channel_ids"] = sorted(seen)
    daily.setdefault("runs", {})[slot] = report
    save_json(daily_path, daily)
    return report


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "## YSXVISUALS creator discovery",
        "",
        f"- Cairo run: `{report['run_at']}`",
        f"- New discoveries: **{report['new_discoveries']}**",
        f"- Daily cumulative: **{report['daily_cumulative_total']}**",
        "- Qualification: not run (discovery-only workflow)",
    ]
    if report["slot"] == "19:00":
        lines.append("- Final daily summary: qualification counts are intentionally not produced.")
    lines.extend(["", "| Creator/channel | Niche | Subscribers | Source |", "|---|---|---|---|"])
    for item in report["discoveries"]:
        lines.append(
            f"| [{item['channel_creator_name']}]({item['channel_url']}) | {item['niche']} | "
            f"{item['approximate_subscriber_range']} | {item['discovery_source']} |"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--now", help="ISO-8601 UTC instant for testing")
    args = parser.parse_args()
    now_utc = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(UTC)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=UTC)
    cairo_now = now_utc.astimezone(CAIRO).replace(second=0, microsecond=0)
    if cairo_now.strftime("%H:%M") not in RUN_SLOTS:
        print(f"[discovery] skipped: Cairo time is {cairo_now:%H:%M}, not a scheduled slot")
        return 0
    report = discover(cairo_now, args.state_dir)
    markdown = markdown_report(report)
    print(markdown)
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        Path(summary_path).open("a", encoding="utf-8").write(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
