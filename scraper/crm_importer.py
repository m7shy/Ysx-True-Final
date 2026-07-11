"""
crm_importer.py — push scraped leads into the YSX Flow CRM.

Reads the scraper's leads.csv (url, email, avg_views, social_links,
external_links, priority_lane, ...) and POSTs the rows to the CRM's
server-to-server import endpoint:

    POST {CRM_IMPORT_URL}/api/leads/import
    header: X-Import-Key: {CRM_IMPORT_KEY}
    body:   { "niche": "<profile>", "leads": [ {row}, ... ] }

The endpoint upserts by (tenant, email): new emails are created, existing ones
have their tracking stats refreshed. Rows without an email are skipped locally
(the CRM keys leads on email).

Env (via .env, same as the scraper):
    CRM_IMPORT_URL   base URL of the CRM backend (default http://localhost:3001)
    CRM_IMPORT_KEY   shared secret, must equal the server's IMPORT_API_KEY

Usage:
    python crm_importer.py                          # imports ./leads.csv
    python crm_importer.py --csv profiles/ai/leads.csv --niche ai
    python crm_importer.py --batch 100
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

from curl_cffi import requests
from dotenv import load_dotenv

# Reuse the scraper's proven, Vertex-backed Gemini client instead of the CRM's
# /api/gemini proxy: that proxy is a 501 stub and, more importantly, is gated by
# requireAuth (a browser JWT) — this importer only holds the X-Import-Key shared
# secret, so it can never reach it. orchestrator.py already talks to Gemini the
# right way; we lean on the exact same setup here.
from orchestrator import GEMINI_MODEL, init_gemini, _call_gemini

load_dotenv()

CRM_IMPORT_URL = os.getenv("CRM_IMPORT_URL", "http://localhost:3001").strip().rstrip("/")
CRM_IMPORT_KEY = os.getenv("CRM_IMPORT_KEY", "").strip()
REQUEST_TIMEOUT = 30  # seconds per batch

# Strict R.E.T.A.I.N. framework instruction. The transcript block is appended.
RETAIN_HOOK_PROMPT = (
    "Analyze the first 2 minutes of this creator's video transcript. Identify a "
    "specific engagement or pacing flaw based on the R.E.T.A.I.N. framework "
    "guidelines. Generate a single-sentence cold email opening hook highlighting "
    "this retention gap. Keep it completely natural, concise, and under 25 words. "
    "Do not use generic filler."
)


def read_rows(csv_path: Path) -> list[dict]:
    """Load CSV rows, keeping only those with a non-empty email."""
    with csv_path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        rows = [row for row in reader if (row.get("email") or "").strip()]
    return rows


def generate_first_line(client, transcript: str) -> str | None:
    """Turn a raw transcript into a single R.E.T.A.I.N. cold-email hook.

    Best-effort: returns None on any Gemini error so a failed generation never
    blocks the import — the row is still upserted, just without a first line.
    """
    prompt = f"{RETAIN_HOOK_PROMPT}\n\nTRANSCRIPT:\n\"\"\"\n{transcript}\n\"\"\""
    try:
        resp = _call_gemini(client, prompt)
    except Exception as exc:  # noqa: BLE001 — degrade gracefully, keep importing
        print(f"  ~ hook generation failed: {exc}", file=sys.stderr)
        return None
    text = (getattr(resp, "text", None) or "").strip().strip('"').strip()
    return text or None


def enrich_first_lines(rows: list[dict]) -> None:
    """Attach a `custom_first_line` to every row that carries a transcript.

    The Gemini client is initialised lazily and only once — if no row has a
    transcript, or the client can't be created (Gemini not configured), the
    import proceeds untouched.
    """
    if not any((row.get("recent_video_transcript") or "").strip() for row in rows):
        return

    try:
        client = init_gemini()
    except SystemExit as exc:  # init_gemini raises SystemExit on misconfig
        print(f"WARNING: Gemini unavailable, importing without hooks — {exc}", file=sys.stderr)
        return

    for row in rows:
        transcript = (row.get("recent_video_transcript") or "").strip()
        if not transcript:
            continue
        hook = generate_first_line(client, transcript)
        if hook:
            row["custom_first_line"] = hook


def post_batch(leads: list[dict], niche: str | None) -> dict:
    """POST one batch and return the parsed JSON summary (raises on HTTP error)."""
    body: dict = {"leads": leads}
    if niche:
        body["niche"] = niche

    resp = requests.post(
        f"{CRM_IMPORT_URL}/api/leads/import",
        headers={"Content-Type": "application/json", "X-Import-Key": CRM_IMPORT_KEY},
        data=json.dumps(body),
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"import failed [{resp.status_code}]: {resp.text}")
    return resp.json()


def main() -> int:
    parser = argparse.ArgumentParser(description="Import scraped leads into the YSX Flow CRM.")
    parser.add_argument("--csv", default="leads.csv", help="path to the leads CSV (default: leads.csv)")
    parser.add_argument("--niche", default=None, help="run-level niche/profile applied to every row")
    parser.add_argument("--batch", type=int, default=200, help="rows per request (default: 200)")
    args = parser.parse_args()

    if not CRM_IMPORT_KEY:
        print("ERROR: CRM_IMPORT_KEY is not set (must match the server's IMPORT_API_KEY).", file=sys.stderr)
        return 2

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"ERROR: {csv_path} not found.", file=sys.stderr)
        return 2

    rows = read_rows(csv_path)
    if not rows:
        print(f"No emailed leads found in {csv_path} — nothing to import.")
        return 0

    # Generate personalized R.E.T.A.I.N. hooks from transcripts before batching.
    enrich_first_lines(rows)

    total_created = total_updated = total_skipped = 0
    for start in range(0, len(rows), args.batch):
        batch = rows[start : start + args.batch]
        try:
            summary = post_batch(batch, args.niche)
        except Exception as exc:  # noqa: BLE001 — report and stop
            print(f"ERROR importing rows {start}-{start + len(batch)}: {exc}", file=sys.stderr)
            return 1

        total_created += summary.get("created", 0)
        total_updated += summary.get("updated", 0)
        total_skipped += summary.get("skipped", 0)
        for err in summary.get("errors", []):
            print(f"  ! {err.get('email')}: {err.get('message')}", file=sys.stderr)

    print(
        f"Imported {len(rows)} lead(s) from {csv_path}: "
        f"{total_created} created, {total_updated} updated, {total_skipped} skipped."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
