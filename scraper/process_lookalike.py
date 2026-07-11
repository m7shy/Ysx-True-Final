"""
process_lookalike.py — Algorithmic Lookalike Engine (yt-dlp edition).

For every target channel ID in lookalike_targets.txt:
  Step 1 — m.channel_batch()          → channel metadata + newest uploads (yt-dlp)
  Step 2 — take the N most recent video IDs as seeds
  Step 3 — m.search_lookalikes_ytdlp() per seed → the channels YouTube's own
           recommendation engine pairs with that video (mix/radio playlist)
  Step 4 — flatten, dedup against load_seen_ids()
  Step 5 — m.channel_batch() + m.run_gauntlet() → leads.csv / blacklist.csv /
           insufficient_content.csv

This replaces the dead relatedToVideoId API search (removed from the YouTube
Data API on 7 Aug 2023) with yt-dlp's mix-playlist traversal — the same engine
main.py uses for its Phase-2 lookalikes. Zero API quota, no key.

Usage:
  python process_lookalike.py
  python process_lookalike.py --dry-run   # show seed video IDs, skip lookalike searches
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

LOOKALIKE_FILE = Path("lookalike_targets.txt")
_CHANNEL_ID_RE = re.compile(r"^UC[A-Za-z0-9_\-]{22}$")
SEED_VIDEOS_PER_TARGET = 3   # most recent uploads used as lookalike seeds


# ── Input ─────────────────────────────────────────────────────────────────────

def load_lookalike_targets() -> list[str]:
    if not LOOKALIKE_FILE.exists():
        raise SystemExit(
            f"{LOOKALIKE_FILE} not found — create it with one channel ID per line.\n"
            "Channel IDs look like: UCxxxxxxxxxxxxxxxxxxxxxxxxx (24 chars starting with UC)"
        )
    ids: list[str] = []
    seen_in_file: set[str] = set()
    with open(LOOKALIKE_FILE, encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            cid = raw.strip()
            if not cid or cid.startswith("#"):
                continue
            if not _CHANNEL_ID_RE.match(cid):
                print(f"[WARN] line {lineno}: skipping invalid ID {cid!r}")
                continue
            if cid in seen_in_file:
                continue
            seen_in_file.add(cid)
            ids.append(cid)
    return ids


# ── Seed extraction (yt-dlp) ──────────────────────────────────────────────────

def fetch_seed_video_ids(playlist_id: str, max_videos: int = SEED_VIDEOS_PER_TARGET) -> list[str]:
    """Return the N most recent video IDs from an uploads playlist.

    Reads the entries channel_batch() already cached for this playlist when
    available; otherwise runs one flat yt-dlp extraction of the playlist.
    """
    entries = m._UPLOADS_CACHE.get(playlist_id)
    if entries is None:
        info = m.ytdlp_extract(
            f"https://www.youtube.com/playlist?list={playlist_id}",
            m._FLAT_OPTS,
            {"playlist_items": f"1-{max_videos}"},
        )
        entries = [e for e in (info.get("entries") or []) if e]
    return [e.get("id", "") for e in entries if e.get("id")][:max_videos]


# ── Main ──────────────────────────────────────────────────────────────────────

def main(dry_run: bool = False) -> None:  # noqa: C901
    targets = load_lookalike_targets()
    if not targets:
        raise SystemExit(f"{LOOKALIKE_FILE} is empty or contains no valid channel IDs.")

    print(f"Loaded {len(targets)} target(s) from {LOOKALIKE_FILE}")
    print("API-free mode — lookalike traversal via yt-dlp mix playlists (no quota, no key)")

    seen_ids = m.load_seen_ids()

    all_lookalike_ids: list[str] = []
    seen_lookalike: set[str] = set()
    search_ok = 0
    search_failed = 0
    new_rows: list[dict] = []
    flushed = 0

    try:
        # ── Phase 1: extract seed videos + discover lookalike channel IDs ────
        print(f"\n── Phase 1: seed extraction across {len(targets)} target(s) ──\n")

        # Step 1 — enrich targets (fills the uploads cache with their newest videos)
        uploads_by_target: dict[str, str] = {}  # {channel_id: uploads_playlist_id}
        if not dry_run:
            for batch_start in range(0, len(targets), 50):
                batch = targets[batch_start : batch_start + 50]
                for ch in m.channel_batch(batch):
                    uploads_id = (
                        ch.get("contentDetails", {})
                        .get("relatedPlaylists", {})
                        .get("uploads", "")
                    )
                    if uploads_id:
                        uploads_by_target[ch["id"]] = uploads_id

        # Step 2 + 3 — per-target: seed videos → mix-playlist lookalike traversal
        for target_id in targets:
            if dry_run:
                print(f"  [dry-run] would process target {target_id}")
                continue

            uploads_id = uploads_by_target.get(target_id)
            if not uploads_id:
                print(f"  [target] {target_id}: channel unavailable — skipping")
                continue

            try:
                seed_ids = fetch_seed_video_ids(uploads_id, SEED_VIDEOS_PER_TARGET)
            except m.HttpError as exc:
                print(f"  [target] {target_id}: seed fetch error — {exc}")
                continue

            if not seed_ids:
                print(f"  [target] {target_id}: no seed videos in uploads playlist — skipping")
                continue

            print(f"\n  [target] {target_id} → {len(seed_ids)} seed video(s) extracted")

            found_this_target: list[str] = []
            for vid_id in seed_ids:
                result = m.search_lookalikes_ytdlp(f"https://www.youtube.com/watch?v={vid_id}")
                if not result:
                    # dead seed / no mix playlist — already logged by main
                    search_failed += 1
                    continue
                search_ok += 1
                new_ids = [cid for cid in result if cid not in seen_lookalike]
                for cid in new_ids:
                    seen_lookalike.add(cid)
                    all_lookalike_ids.append(cid)
                found_this_target.extend(new_ids)
                print(
                    f"    [video {vid_id}]: {len(result)} channel(s) returned, "
                    f"{len(new_ids)} new"
                )

            print(
                f"  [target] {target_id} → "
                f"{len(found_this_target)} unique lookalike channel(s) found"
            )

        # ── Phase 1 summary ──────────────────────────────────────────────────
        pending = [fid for fid in all_lookalike_ids if fid not in seen_ids]
        already_seen = len(all_lookalike_ids) - len(pending)

        print(f"\n  Total unique lookalike channel IDs discovered : {len(all_lookalike_ids)}")
        if already_seen:
            print(f"  Already seen (skipped)                       : {already_seen}")
        print(f"  Pending for gauntlet                         : {len(pending)}")

        if dry_run or not pending:
            return  # nothing to run through the gauntlet

        # ── Phase 2: run lookalike channels through the gauntlet ─────────────
        print(f"\n── Phase 2: running {len(pending)} channel(s) through the gauntlet ──")

        total_gauntlet_batches = (len(pending) + 49) // 50

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
            new_rows = []

        print(f"\n{'─' * 50}")
        print(f"Seed searches : {search_ok} OK  |  {search_failed} empty/failed")
        print(f"New leads     : {flushed}")
        print(f"Output        : {m.OUTPUT_FILE.resolve()}")
        print(f"Tracking DB   : {m.TRACKING_DB_FILE.resolve()} (processed_channels, blacklist)")
        print(f"Skip log      : {m.SKIP_LOG_FILE.resolve()}")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    main(dry_run=dry_run)
