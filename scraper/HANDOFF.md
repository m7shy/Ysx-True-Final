# YT-Scraper — Session Handoff

**Paste this file into a new Claude conversation to continue work on the project.**

---

## Goal

Autonomously find YouTube coaching and educator channels (500–10k subscribers)
that sell courses or programs. Output `leads.csv` with
`url, email, avg_views, social_links, external_links` — ready for an outreach pipeline.

**Active campaign:** Fitness niche — currently at keyword round 19, graph round 33.

---

## Project Location

```
D:\YT-Scraper\
```

---

## Full File Inventory

### Scripts

| File | Role |
|------|------|
| `main.py` | Keyword scraper. Reads `keywords.txt`, runs `search.list` (100 units/kw), filters via Tier-1+2 pipeline, writes `leads.csv`. Fires `SMARTLEAD_WEBHOOK_URL` on every qualified lead. |
| `process_backlog.py` | Push specific channel IDs through the pipeline. Reads `backlog_ids.txt`, bypasses `search.list`, batches 50 at a time into `channels.list`. Supports `--dry-run`. |
| `process_graph.py` | Mine featured channel networks. Reads `targets.txt` (Big Fish IDs), fetches `brandingSettings.channel.featuredChannelsUrls`, pushes discovered IDs through `run_gauntlet()`. |
| `process_lookalike.py` | **DEAD — produces zero leads.** `relatedToVideoId` was removed from the YouTube Data API v3 on 7 Aug 2023. HTTP 400 on every search call. Script handles gracefully. |
| `orchestrator.py` | AI campaign commander. Uses Gemini to generate keywords, runs `main.py` and `process_graph.py` in a pivot loop with a live ASCII dashboard. |
| `seed_blacklist.py` | Stdin utility. Paste channel IDs to bulk-add to `blacklist.csv`. |
| `setup_automation.py` | Creates a Windows Task Scheduler job to run the Fitness campaign nightly. |

### Input Files

| File | Used by | Current state |
|------|---------|---------------|
| `keywords.txt` | `main.py` | Overwritten by orchestrator. Last: Fitness keyword round 19. |
| `backlog_ids.txt` | `process_backlog.py` | 29 channel IDs queued — not yet processed. |
| `targets.txt` | `process_graph.py` | Overwritten by orchestrator. Last: Fitness graph round 33. |
| `lookalike_targets.txt` | `process_lookalike.py` | Loaded but API is dead — see warning above. |
| `used_keywords.txt` | `orchestrator.py` | **Cross-session keyword memory bank.** Contains all keywords from rounds 1–19. Never delete this. |

### Generated Output Files

| File | Purpose |
|------|---------|
| `leads.csv` | Qualified leads: `url, email, avg_views, social_links, external_links` |
| `blacklist.csv` | Permanent disqualifications: `channel_id` |
| `insufficient_content.csv` | Soft-skip: <10 long-form videos. Re-evaluated on every future run. |
| `skipped.log` | Timestamped skip reason for every rejected channel |
| `qualified.csv` | Optional: drop an external pipeline export here; loaded into dedup set at startup |

### Documentation

| File | Contents |
|------|---------|
| `ICP.md` | Canonical Ideal Channel Profile — exact filter criteria with examples |
| `ORCHESTRATOR.md` | Orchestrator playbook — flags, pivot logic, round-angle table |
| `PROVEN_STRINGS.md` | Verified keyword pattern log — patterns to keep, patterns to ban |
| `README.md` | Project overview, quick start, quota reference |

---

## Environment Variables (.env)

```
YOUTUBE_API_KEYS=key1,key2,...       # required — comma-separated, rotate on exhaustion
GEMINI_API_KEY=AIza...               # required for orchestrator.py
GEMINI_MODEL=gemini-2.0-flash        # optional default
SMARTLEAD_WEBHOOK_URL=https://...    # optional — POST fired on every qualified lead
```

---

## Architecture in One Paragraph

All sibling scripts do `import main as m`. Every quota-aware API call, key rotation,
and file I/O helper lives in `main.py` and is shared via `m.`. The canonical filter
pipeline is `m.run_gauntlet(channels, seen_ids)` — defined once, used by every script.
`orchestrator.py` drives everything via subprocess. `used_keywords.txt` is the
persistent memory bank that prevents cross-session Gemini keyword duplication.

---

## Filter Pipeline

### Tier 1 — Zero cost (channels.list data already in memory)

1. Dedup — skip if ID in `leads.csv`, `qualified.csv`, or `blacklist.csv`
2. Hidden subscriber count → blacklist
3. Sub range 500–10k → blacklist if outside
4. Explicit country not in {US, GB, CA, AU} → blacklist
5. Country unset + `₹` or `+91` in title/description → blacklist
6. No qualification signal (`course/enroll/kajabi/...` or `coaching/program/mentorship`) → blacklist

### Tier 2 — 1 quota unit per channel

7. No upload within 15 days → skip (no file written)
8. < 10 long-form videos (>60s) → `insufficient_content.csv`
9. Avg views on long-form < 1,000 → blacklist
10. **Qualified** → `leads.csv` + webhook POST

---

## Quota Budget

| Operation | Units | When |
|-----------|-------|------|
| `search.list` | 100 | Once per keyword |
| `channels.list` | 1 | Per batch of ≤50 channels |
| `playlistItems.list` | 1 | Per Tier-1 survivor |
| `videos.list` | 1 | Per active channel |
| Pre-flight verify | 1 | Once at startup |

**25 keywords × ~110 units = ~2,750 units per keyword round.**
One 8,000-unit API key covers a full keyword round. Keys rotate automatically.

---

## What Was Built in This Chat Session (Full Log)

1. **`process_backlog.py`** — reads `backlog_ids.txt`, bypasses search, batches to `channels.list`, runs `run_gauntlet()`.
2. **`process_graph.py`** — reads `targets.txt`, mines `brandingSettings.featuredChannelsUrls`, runs `run_gauntlet()`.
3. **`process_lookalike.py`** — built but dead (API endpoint removed 7 Aug 2023).
4. **`run_gauntlet()` in `main.py`** — extracted shared Tier-1+2 filter loop. Single source of truth.
5. **`orchestrator.py`** — Gemini keyword generation + pivot loop + ASCII dashboard. 15s RPM guard. 25 kw/round.
6. **Hardcoded Gemini prompt** — `_ICP_BLOCK`, `_HARD_BANS`, `_ROUND_ANGLES[1–5]`, `_DEEP_ANGLE` as module constants. Prompt cannot drift from scraper criteria.
7. **Keyword memory bank** — `used_keywords.txt` persists across sessions. Full list injected into every Gemini prompt. Dashboard shows count.
8. **Webhook** — `send_webhook()` in `main.py` POSTs `{name, url, email, subscribers, avg_views, external_links}` to `SMARTLEAD_WEBHOOK_URL`. stdlib `urllib`, wrapped in `try/except`.
9. **External links column** — `channel_batch()` now requests `brandingSettings` (zero extra quota). `extract_external_links()` parses `customLinks[].linkUrl`. New `external_links` column in `leads.csv`.
10. **Five `.md` docs** — `README.md`, `ICP.md`, `ORCHESTRATOR.md`, `PROVEN_STRINGS.md`, `HANDOFF.md` — written/rewritten. Removed legacy Playboard/play30/link references.
11. **`keywords.txt` reset** — replaced celebrity-name queries with 60 clean ICP-aligned patterns.

---

## Known Issues

- **`process_lookalike.py` produces zero leads** — `relatedToVideoId` is dead. Watch for YouTube re-enabling.
- **`main.py` has a duplicate filter loop** — `main()` has its own inline Tier-1/2 loop *and* calls `run_gauntlet()` via sibling scripts. Both were updated in this session. Future refactor: collapse `main()` to call `run_gauntlet()` directly.
- **`leads.csv` schema migration** — `external_links` column was added this session. Old rows have 4 columns, new rows have 5. Safe in Excel; `DictWriter(extrasaction='ignore')` handles it.
- **India filter gap** — only `₹` and `+91` heuristics. English-language Indian creators with no price signals pass. By design.
- **`orchestrator.py` overwrites `keywords.txt` and `targets.txt`** — back them up before running if they have manual content you need.

---

## Immediate Next Steps

### 1. Process the backlog queue (29 IDs waiting)
```
python process_backlog.py
```

### 2. Resume the Fitness campaign
```
python orchestrator.py --niche "Fitness" --target 300
```

### 3. Wire up the webhook
Add to `.env`:
```
SMARTLEAD_WEBHOOK_URL=https://your-smartlead-endpoint/webhook
```

### 4. Schedule nightly runs
```
python setup_automation.py
```

### 5. Future improvements (not yet built)
- Refactor `main()` to call `m.run_gauntlet()` directly (removes duplicated loop)
- Add `score` column (1 or 2) to `leads.csv` for outreach prioritization
- Expand geo heuristic: add `.in` TLD URL detection to `has_india_signals()`
- Re-check `insufficient_content.csv` — add a dedicated script that re-runs only the long-form check on those channels
