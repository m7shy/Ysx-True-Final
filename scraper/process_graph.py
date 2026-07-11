"""
process_graph.py — Extract leads from 'Big Fish' channel networks.

For every target channel ID in targets.txt, harvests the channels featured on
its home page (the API's brandingSettings.featuredChannelsUrls field and the
dedicated "Channels" tab are both gone, so the featured shelves embedded in
the page's ytInitialData are the only remaining surface), then runs those
channel IDs through the exact same Tier-1 + Tier-2 gauntlet used by the
backlog and keyword scrapers. No Google API anywhere — zero quota, no key.

Data flow:
  targets.txt
      ↓ featured_channels()  channel home page → foreign UC… ids
      ↓ dedup against load_seen_ids()
      ↓ m.channel_batch()    yt-dlp channel enrichment
      ↓ m.run_gauntlet()     Tier-1 + Tier-2
      ↓ leads.csv / blacklist.csv / insufficient_content.csv

Usage:
  python process_graph.py
  python process_graph.py --dry-run   # show discovered featured IDs, no gauntlet
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from curl_cffi import requests
from dotenv import load_dotenv

import main as m  # re-use all shared globals, wrappers, helpers, and I/O functions

load_dotenv()

# Route all output through main's console-safe printer — box-drawing chars and
# emoji in channel titles crash a cp1252 Windows console under bare print().
print = m.safe_print  # noqa: A001

TARGETS_FILE = Path("targets.txt")
_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_\-]{22}$")


# ── Input loading ─────────────────────────────────────────────────────────────

def load_targets() -> list[str]:
    if not TARGETS_FILE.exists():
        raise SystemExit(
            f"{TARGETS_FILE} not found — create it with one channel ID per line.\n"
            "Channel IDs look like: UCxxxxxxxxxxxxxxxxxxxxxxxxx (24 chars starting with UC)"
        )
    ids: list[str] = []
    seen_in_file: set[str] = set()
    with open(TARGETS_FILE, encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            cid = raw.strip()
            if not cid or cid.startswith("#"):
                continue
            if not _CHANNEL_ID_RE.match(cid):
                print(f"[WARN] line {lineno}: skipping invalid target ID {cid!r}")
                continue
            if cid in seen_in_file:
                continue
            seen_in_file.add(cid)
            ids.append(cid)
    return ids


# ── Featured-channel harvest ──────────────────────────────────────────────────
# YouTube removed the dedicated "Channels" tab (and the API's
# featuredChannelsUrls field is dead), so the featured/recommended channels now
# only exist as shelves embedded in the channel home page's ytInitialData. We
# fetch that one HTML page and pull every foreign UC… id out of it — verified
# to return exactly the featured-shelf channels. Requests run through main's
# proxy rotation with the same 429 benching + exponential backoff.

_FEATURED_ID_RES = (
    re.compile(r'"channelId":"(UC[A-Za-z0-9_\-]{22})"'),
    re.compile(r"/channel/(UC[A-Za-z0-9_\-]{22})"),
)


def featured_channels(target_id: str) -> list[str]:
    """Return the channel IDs featured on a target channel's home page."""
    url = f"https://www.youtube.com/channel/{target_id}"
    html = ""
    for attempt in range(m.MAX_RETRIES + 1):
        proxy = m.PROXY_MANAGER.current()
        proxies = {"http": proxy, "https": proxy} if proxy else None
        m._throttle_pause()
        try:
            resp = requests.get(
                url,
                timeout=m.HTTP_TIMEOUT,
                proxies=proxies,
                impersonate=m._IMPERSONATE,
            )
        except requests.exceptions.RequestException:
            if attempt < m.MAX_RETRIES:
                m._backoff(attempt, "channel page network fault")
                continue
            print(f"    [WARN] {target_id}: channel page unreachable — skipping")
            return []
        if resp.status_code == 429:
            m.PROXY_MANAGER.report_throttle(proxy)
            if attempt < m.MAX_RETRIES:
                m._backoff(attempt, "HTTP 429 rate limit (channel page)")
                continue
            return []
        if resp.status_code >= 500 and attempt < m.MAX_RETRIES:
            m._backoff(attempt, f"HTTP {resp.status_code} (channel page)")
            continue
        if resp.status_code != 200:
            print(f"    [WARN] {target_id}: HTTP {resp.status_code} — skipping")
            return []
        m.PROXY_MANAGER.report_success(proxy)
        html = resp.text
        break

    found: set[str] = set()
    for pattern in _FEATURED_ID_RES:
        found.update(pattern.findall(html))
    found.discard(target_id)
    return sorted(found)


# ── Main ──────────────────────────────────────────────────────────────────────

def main(dry_run: bool = False) -> None:
    targets = load_targets()
    if not targets:
        raise SystemExit(f"{TARGETS_FILE} is empty or contains no valid channel IDs.")
    print(f"Loaded {len(targets)} target(s) from {TARGETS_FILE}")
    print("API-free mode — extraction via yt-dlp (no quota, no key)")

    seen_ids = m.load_seen_ids()

    # ── Phase 1: fetch featured channel IDs from every target ─────────────────
    print(f"\n── Phase 1: extracting featured channels from {len(targets)} target(s) ──")

    all_featured: list[str] = []
    seen_featured: set[str] = set()
    for target_id in targets:
        feat_ids = featured_channels(target_id)
        print(f"  [target] {target_id} → {len(feat_ids)} featured channel(s) found")
        for fid in feat_ids:
            if fid not in seen_featured and fid != target_id:
                seen_featured.add(fid)
                all_featured.append(fid)

    print(f"\n  Total unique featured channel IDs: {len(all_featured)}")

    # Remove IDs already processed in prior runs
    pending = [fid for fid in all_featured if fid not in seen_ids]
    already_seen = len(all_featured) - len(pending)
    if already_seen:
        print(f"  Skipping {already_seen} already-seen ID(s)")
    print(f"  Pending for gauntlet: {len(pending)}")

    if dry_run:
        print("\n[DRY RUN] Featured IDs that would enter the gauntlet:")
        for fid in pending:
            print(f"  {fid}")
        return

    if not pending:
        print("\nNothing to process.")
        _print_summary(0)
        return

    # ── Phase 2: fetch full channel data + run gauntlet ───────────────────────
    print(f"\n── Phase 2: running {len(pending)} channel(s) through the gauntlet ──")

    new_rows: list[dict] = []
    flushed = 0
    total_gauntlet_batches = (len(pending) + 49) // 50

    try:
        for batch_num, batch_start in enumerate(range(0, len(pending), 50), 1):
            batch = pending[batch_start : batch_start + 50]
            print(f"\n  [gauntlet batch {batch_num}/{total_gauntlet_batches}] {len(batch)} channel(s)")

            channels = m.channel_batch(batch)
            m.run_gauntlet(channels, seen_ids, new_rows)

            if new_rows:
                m.append_rows(new_rows)
                flushed += len(new_rows)
                new_rows = []

    finally:
        if new_rows:
            m.append_rows(new_rows)
            flushed += len(new_rows)
        _print_summary(flushed)


def _print_summary(lead_count: int) -> None:
    print(f"\n{'─' * 50}")
    print(f"New leads  : {lead_count}")
    print(f"Output     : {m.OUTPUT_FILE.resolve()}")
    print(f"Tracking DB: {m.TRACKING_DB_FILE.resolve()} (processed_channels, blacklist)")
    print(f"Skip log   : {m.SKIP_LOG_FILE.resolve()}")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    main(dry_run=dry_run)
