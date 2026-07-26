"""
release_blacklist.py -- release channels blacklisted under qualification
criteria that have since loosened.

Widening a threshold in criteria.py (or via the CRM's Qualification Criteria
settings) only affects channels not yet seen -- anything already written to
`blacklist` stays excluded forever unless it's explicitly released. This is
the scripted version of the hand-written SQLite migration that two prior
sessions had to run manually (2,401 rows for a subscriber-band widening,
3,259 more for a signal-vocabulary widening).

What it does NOT do: re-crawl YouTube. Eligibility is decided entirely from
what's already on disk --

  - Numeric gates (subs_out_of_band:N, avg_views_low:N,
    longform_ratio_low:N/M) embed the actual measured value in the reason
    string, so they're re-checked precisely against the CURRENT Criteria.
  - The signal gate (no_signals) has no such number -- the channel's
    description was never stored, only the fact that score() returned 0 --
    so it can't be re-verified per channel. Releasing it (--include-signal-gate)
    is a blanket bucket release: correct in aggregate right after a
    deliberate vocabulary widening, not a per-row guarantee.
  - Everything else (hidden_subs, country_blocked, lang_unsupported,
    india_signals, faceless_content, invalid_email) isn't threshold-tunable
    in this system and is never released.

Every `blacklist` row is supposed to carry a structured `reason` going
forward (see main.py's run_gauntlet()), but most of the rows already on disk
predate that -- they fall back to the last matching line in skipped.log for
that channel (last skip wins, so a channel later rejected for a still-valid
reason correctly stays blacklisted).

Usage:
  python release_blacklist.py --niche crm-<userId> [--apply] [--json] [--include-signal-gate]
  python release_blacklist.py --all-profiles [--apply] [--json] [--include-signal-gate]

Default is a dry run. --apply backs up tracking.db (tracking.db.bak-release-<ts>)
before deleting anything.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import criteria as criteria_mod
from session_profile import PROFILES_ROOT, SessionProfile

# Structured reason formats written by main.py's run_gauntlet() (see
# append_to_blacklist() calls there).
_SUBS_RE = re.compile(r"^subs_out_of_band:(\d+)$")
_AVGVIEWS_RE = re.compile(r"^avg_views_low:(\d+)$")
_LONGFORM_RE = re.compile(r"^longform_ratio_low:(\d+)/(\d+)$")

# skipped.log line shape: "<timestamp>  SKIP <cid> (<name>): <message>"
_LOG_LINE_RE = re.compile(r"SKIP (\S+) \(.*?\): (.+)$")
_LOG_SUBS_RE = re.compile(r"^([\d,]+) subs")
_LOG_AVGVIEWS_RE = re.compile(r"^([\d,]+) avg views")
_LOG_LONGFORM_RE = re.compile(r"^(\d+)/(\d+) long-form")
_LOG_NO_SIGNALS = "no qualification signals"

# Channel ids per DELETE statement — see the comment in apply_release().
_DELETE_CHUNK = 500


def _reason_from_log_message(msg: str) -> "str | None":
    """Translate a skipped.log message into the same structured-reason
    vocabulary the blacklist.reason / processed_channels.reason columns use,
    so one eligibility check (_is_releasable) works for both structured rows
    and rows only recoverable from the log."""
    m = _LOG_SUBS_RE.match(msg)
    if m:
        return f"subs_out_of_band:{m.group(1).replace(',', '')}"
    m = _LOG_AVGVIEWS_RE.match(msg)
    if m:
        return f"avg_views_low:{m.group(1).replace(',', '')}"
    m = _LOG_LONGFORM_RE.match(msg)
    if m:
        return f"longform_ratio_low:{m.group(1)}/{m.group(2)}"
    if msg.strip() == _LOG_NO_SIGNALS:
        return "no_signals"
    return None


def _last_skip_messages(skip_log_path: Path) -> dict:
    """Parse skipped.log, keeping the raw message of the LAST skip line
    recorded per channel id -- the file is append-only chronological, so this
    is literal "last skip wins", independent of whether that message maps to
    a recognized/releasable reason. Translating to a structured reason
    happens afterward (see _reason_from_log_message): a channel later
    rejected for an unrecognized or permanent reason (e.g. hidden subs, after
    once being rejected for a since-loosened subs band) must not be released
    just because an EARLIER line happened to be for a releasable reason."""
    last: dict[str, str] = {}
    if not skip_log_path.exists():
        return last
    with open(skip_log_path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            m = _LOG_LINE_RE.search(line)
            if not m:
                continue
            cid, msg = m.group(1), m.group(2)
            last[cid] = msg
    return last


def _is_releasable(reason: "str | None", c: criteria_mod.Criteria, include_signal_gate: bool) -> bool:
    """True iff `reason` (structured or log-derived) would no longer trigger
    its gate under the current Criteria `c`."""
    if not reason:
        return False
    m = _SUBS_RE.match(reason)
    if m:
        subs = int(m.group(1))
        return c.min_subs <= subs <= c.max_subs
    m = _AVGVIEWS_RE.match(reason)
    if m:
        views = int(m.group(1))
        return views >= c.min_avg_views
    m = _LONGFORM_RE.match(reason)
    if m:
        count, total = int(m.group(1)), int(m.group(2))
        ratio = (count / total) if total else 0.0
        return ratio >= c.min_longform_ratio
    if reason == "no_signals":
        return include_signal_gate
    return False


def _backup(db_path: Path) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = db_path.with_name(f"{db_path.name}.bak-release-{ts}")
    shutil.copy2(db_path, backup_path)
    return backup_path


def scan_profile(profile_dir: Path, include_signal_gate: bool = False) -> dict:
    """Dry-run scan of one profile's tracking.db: returns eligibility counts
    and the list of releasable channel ids, without writing anything."""
    profile_dir = Path(profile_dir)
    db_path = profile_dir / "tracking.db"
    result = {
        "profile": profile_dir.name,
        "scanned": 0,
        "releasable": 0,
        "no_reason_found": 0,
        "by_reason": {},
        "releasable_ids": [],
    }
    if not db_path.exists():
        return result

    c = criteria_mod.load(profile_dir)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute("SELECT channel_id, reason FROM blacklist").fetchall()
    finally:
        conn.close()
    result["scanned"] = len(rows)

    log_fallback: "dict | None" = None  # parsed lazily -- most profiles won't need it
    for cid, reason in rows:
        effective_reason = reason
        if not effective_reason:
            if log_fallback is None:
                log_fallback = _last_skip_messages(profile_dir / "skipped.log")
            last_msg = log_fallback.get(cid)
            effective_reason = _reason_from_log_message(last_msg) if last_msg else None

        if not effective_reason:
            result["no_reason_found"] += 1
            continue

        if _is_releasable(effective_reason, c, include_signal_gate):
            kind = effective_reason.split(":", 1)[0]
            result["releasable"] += 1
            result["releasable_ids"].append(cid)
            result["by_reason"][kind] = result["by_reason"].get(kind, 0) + 1

    return result


def apply_release(profile_dir: Path, include_signal_gate: bool = False) -> dict:
    """Back up tracking.db, then delete the releasable rows from both
    `blacklist` and `processed_channels` (status='blacklist' only -- leads,
    qualified, seen, insufficient, and recheck rows are never touched)."""
    profile_dir = Path(profile_dir)
    db_path = profile_dir / "tracking.db"
    result = scan_profile(profile_dir, include_signal_gate)
    result["released"] = 0
    result["backup"] = None
    if not db_path.exists() or not result["releasable_ids"]:
        return result

    result["backup"] = str(_backup(db_path))

    ids = result["releasable_ids"]
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA busy_timeout=5000;")
        # Chunked, not one big IN (...): SQLite caps host parameters per
        # statement (SQLITE_MAX_VARIABLE_NUMBER — 32766 on modern builds, but
        # only 999 on older ones). Bulk releases of several thousand channels
        # are this script's whole reason for existing, and the repo's own
        # new-VM runbook means the SQLite build is not fixed, so the limit is
        # not something to rely on. Both deletes share one transaction, so a
        # failure part-way leaves the DB untouched rather than half-released.
        for chunk in (ids[i:i + _DELETE_CHUNK] for i in range(0, len(ids), _DELETE_CHUNK)):
            placeholders = ",".join("?" for _ in chunk)
            conn.execute(f"DELETE FROM blacklist WHERE channel_id IN ({placeholders})", chunk)
            conn.execute(
                f"DELETE FROM processed_channels WHERE status = 'blacklist' "
                f"AND channel_id IN ({placeholders})",
                chunk,
            )
        conn.commit()
    finally:
        conn.close()
    result["released"] = len(ids)
    return result


def _iter_profile_dirs(root: Path = PROFILES_ROOT):
    if not root.exists():
        return
    for entry in sorted(root.iterdir()):
        if entry.is_dir() and (entry / "tracking.db").exists():
            yield entry


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Release channels blacklisted under qualification criteria "
                    "that have since loosened. Defaults to a dry run.",
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--niche", help="Release for one niche/tenant's profiles/<slug>/ directory.")
    target.add_argument("--all-profiles", action="store_true", help="Scan every profiles/*/ directory.")
    parser.add_argument("--apply", action="store_true", help="Actually delete the releasable rows (default: dry run).")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON only, nothing else.")
    parser.add_argument(
        "--include-signal-gate",
        action="store_true",
        help="Also release channels blacklisted for 'no_signals'. Unlike the "
            "numeric gates, a signal-vocabulary change can't be re-verified "
            "per channel (the description text isn't stored) -- this is a "
            "blanket release of the whole bucket. Pass only right after a "
            "deliberate STRONG_SIGNALS/WEAK_SIGNALS widening.",
    )
    args = parser.parse_args()

    if args.all_profiles:
        profile_dirs = list(_iter_profile_dirs())
    else:
        profile_dirs = [SessionProfile(args.niche).dir]

    action = apply_release if args.apply else scan_profile
    results = [action(d, args.include_signal_gate) for d in profile_dirs]

    if args.json:
        json.dump({"mode": "apply" if args.apply else "dry_run", "profiles": results}, sys.stdout, indent=2)
        print()
        return

    for r in results:
        print(f"\n== {r['profile']} ==")
        print(f"  scanned:          {r['scanned']}")
        print(f"  releasable:       {r['releasable']}")
        print(
            f"  no_reason_found:  {r['no_reason_found']}  "
            "(neither a structured reason nor a matching skipped.log line -- can't verify)"
        )
        if "released" in r:
            print(f"  released:         {r['released']}")
            print(f"  backup:           {r['backup']}")
        if r["by_reason"]:
            print("  by reason:")
            for k, v in sorted(r["by_reason"].items(), key=lambda kv: -kv[1]):
                print(f"    {k:<24} {v}")
        if "released" not in r and r["releasable"]:
            print("  (dry run -- pass --apply to actually release these)")


if __name__ == "__main__":
    main()
