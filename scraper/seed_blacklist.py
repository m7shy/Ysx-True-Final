"""
seed_blacklist.py — add manual-reject channel IDs to the tracking DB blacklist.

Usage
-----
    python seed_blacklist.py

Paste channel IDs (UCxxxxxxxxxxxxxxxxxxxxxxxxx) one per line, or comma /
space separated, then signal EOF:
    Windows : Ctrl+Z  then Enter
    Mac/Linux: Ctrl+D

IDs that don't look like a YouTube channel ID are printed as warnings and
skipped — nothing invalid is written. Blacklist state lives natively in
tracking.db (INSERT OR IGNORE), not in a CSV, so duplicates are absorbed at the
database layer.
"""

from __future__ import annotations

import re
import sys

import main as m  # reuse the shared tracking-DB layer (init + blacklist writes)

# YouTube channel IDs are "UC" followed by exactly 22 base64-URL characters.
_CHANNEL_ID_RE = re.compile(r'^UC[A-Za-z0-9_\-]{22}$')


def parse_ids(raw: str) -> tuple[list[str], list[str]]:
    """Split raw input on any whitespace or commas, then partition valid/invalid."""
    tokens = [t.strip() for t in re.split(r'[\s,]+', raw) if t.strip()]
    valid = [t for t in tokens if _CHANNEL_ID_RE.match(t)]
    invalid = [t for t in tokens if not _CHANNEL_ID_RE.match(t)]
    return valid, invalid


def append_to_blacklist(ids: list[str]) -> None:
    """Blacklist each id natively via main's DB layer (INSERT OR IGNORE)."""
    m.init_tracking_db()
    for cid in ids:
        m.append_to_blacklist(cid, reason="manual-seed")


def main() -> None:
    print("Paste channel IDs (one per line or comma/space-separated).")
    print("Signal EOF when done — Windows: Ctrl+Z then Enter | Mac/Linux: Ctrl+D\n")

    try:
        raw = sys.stdin.read()
    except KeyboardInterrupt:
        print("\nAborted — nothing written.")
        return

    valid, invalid = parse_ids(raw)

    if invalid:
        print(f"\n[WARNING] {len(invalid)} token(s) skipped (not valid channel IDs):")
        for x in invalid:
            print(f"  ✗  {x}")

    if not valid:
        print("\nNo valid channel IDs found. Nothing written.")
        return

    # Deduplicate against already-tracked channels before writing (native check).
    m.init_tracking_db()
    new_ids = [cid for cid in valid if not m.is_seen(cid)]
    dupes = len(valid) - len(new_ids)

    if dupes:
        print(f"\n[INFO] {dupes} ID(s) already tracked — skipped.")

    if not new_ids:
        print("Nothing new to write.")
        return

    append_to_blacklist(new_ids)
    print(f"\n[OK] {len(new_ids)} channel ID(s) blacklisted in {m.TRACKING_DB_FILE.resolve()}")


if __name__ == "__main__":
    main()
