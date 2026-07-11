"""
process_backlog.py — Run specific channel IDs through the full filter pipeline.

Reads channel IDs from backlog_ids.txt (one per line), batches them into
groups of 50 for progress reporting, enriches each via main.py's yt-dlp
wrappers (zero API quota, no key), and pushes every channel through the same
Tier-1 (subs, geo, signals) and Tier-2 (recent upload, long-form count,
avg views) filters used by main.py.

Results land in the same output files:
  leads.csv                — qualified leads
  blacklist.csv            — permanent disqualifications
  insufficient_content.csv — soft-skip (Shorts-dominated channels)
  skipped.log              — timestamped skip reasons

Usage:
  python process_backlog.py
  python process_backlog.py --dry-run   # show what would be processed, no network calls
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from dotenv import load_dotenv

import main as m  # re-use all shared globals, wrappers, helpers, and I/O functions

load_dotenv()

# Route all output through main's console-safe printer — box-drawing chars and
# emoji in channel titles crash a cp1252 Windows console under bare print().
print = m.safe_print  # noqa: A001

BACKLOG_FILE = Path("backlog_ids.txt")
_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_\-]{22}$")


def load_backlog() -> list[str]:
    if not BACKLOG_FILE.exists():
        raise SystemExit(
            f"{BACKLOG_FILE} not found — create it with one channel ID per line.\n"
            "Channel IDs look like: UCxxxxxxxxxxxxxxxxxxxxxxxxx (24 chars starting with UC)"
        )
    ids: list[str] = []
    seen_in_file: set[str] = set()
    with open(BACKLOG_FILE, encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            cid = raw.strip()
            if not cid or cid.startswith("#"):
                continue
            if not _CHANNEL_ID_RE.match(cid):
                print(f"[WARN] line {lineno}: skipping invalid channel ID {cid!r}")
                continue
            if cid in seen_in_file:
                continue
            seen_in_file.add(cid)
            ids.append(cid)
    return ids


def main(dry_run: bool = False) -> None:
    backlog = load_backlog()
    if not backlog:
        raise SystemExit(f"{BACKLOG_FILE} is empty or contains no valid channel IDs.")
    print(f"Loaded {len(backlog)} channel ID(s) from {BACKLOG_FILE}")

    if dry_run:
        print("[DRY RUN] Would process the following IDs (no network calls made):")
        for cid in backlog:
            print(f"  {cid}")
        return

    print("API-free mode — enrichment via yt-dlp (no quota, no key)")

    seen_ids = m.load_seen_ids()

    # Pre-filter backlog against already-seen IDs — saves per-channel fetches
    pending = [cid for cid in backlog if cid not in seen_ids]
    skipped_upfront = len(backlog) - len(pending)
    if skipped_upfront:
        print(f"Skipping {skipped_upfront} already-seen ID(s) (in leads/qualified/blacklist)")
    print(f"Processing {len(pending)} new ID(s)\n")

    if not pending:
        print("Nothing to do.")
        return

    new_rows: list[dict] = []
    flushed = 0
    total_batches = (len(pending) + 49) // 50

    try:
        for batch_num, batch_start in enumerate(range(0, len(pending), 50), 1):
            batch = pending[batch_start : batch_start + 50]
            print(f"[batch {batch_num}/{total_batches}] fetching {len(batch)} channel(s)")

            channels = m.channel_batch(batch)
            m.run_gauntlet(channels, seen_ids, new_rows)

            # Flush after every batch so an interrupted run loses at most one batch.
            if new_rows:
                m.append_rows(new_rows)
                flushed += len(new_rows)
                new_rows = []

    finally:
        if new_rows:
            m.append_rows(new_rows)
            flushed += len(new_rows)
            new_rows = []

        print(f"\n{'─' * 50}")
        print(f"New leads  : {flushed}")
        print(f"Output     : {m.OUTPUT_FILE.resolve()}")
        print(f"Tracking DB: {m.TRACKING_DB_FILE.resolve()} (processed_channels, blacklist)")
        print(f"Skip log   : {m.SKIP_LOG_FILE.resolve()}")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    main(dry_run=dry_run)
