# YT-Scraper

Finds YouTube coaching and educator channels (500–10k subscribers) that actively
sell a course, program, or digital product. Outputs `leads.csv` with
`url, email, avg_views, social_links` — ready to drop into an outreach pipeline.

---

## Quick Start

```bash
pip install -r requirements.txt
copy .env.example .env        # then edit: add YOUTUBE_API_KEYS and GEMINI_API_KEY
python orchestrator.py --niche "B2B Coaching" --target 300
```

Or run the scraper directly without the orchestrator:

```bash
# edit keywords.txt with your search queries, then:
python main.py
```

---

## Scripts

| Script | Purpose | Input file |
|--------|---------|------------|
| `main.py` | Keyword scraper — searches YouTube and filters channels | `keywords.txt` |
| `process_backlog.py` | Push specific channel IDs through the filter pipeline | `backlog_ids.txt` |
| `process_graph.py` | Mine featured channel networks of known leads | `targets.txt` |
| `process_lookalike.py` | Lookalike engine via `relatedToVideoId` (deprecated API) | `lookalike_targets.txt` |
| `orchestrator.py` | AI commander — runs the above scripts in a Gemini-driven loop | — |
| `seed_blacklist.py` | Paste channel IDs into stdin to bulk-add to `blacklist.csv` | stdin |

---

## Generated Files

| File | Content | Permanent? |
|------|---------|------------|
| `leads.csv` | Qualified leads: `url, email, avg_views, social_links` | Yes — append-only |
| `blacklist.csv` | Permanent disqualifications: `channel_id` | Yes |
| `insufficient_content.csv` | Channels with <10 long-form videos — re-checked on future runs | Soft — not permanent |
| `skipped.log` | Timestamped skip reason for every rejected channel | Yes — append-only |

---

## Filter Pipeline (applied to every channel)

### Tier 1 — Zero API cost

1. Dedup against `leads.csv`, `qualified.csv`, `blacklist.csv`
2. Hidden subscriber count → blacklist
3. Subscriber range 500–10,000 → blacklist if outside
4. Explicit country not in {US, GB, CA, AU} → blacklist
5. Country unset + `₹` or `+91` in description → blacklist
6. No qualification signal (see ICP.md) → blacklist

### Tier 2 — 1 API unit per channel

7. No upload within 15 days → skip
8. Fewer than 10 long-form videos (>60s) → `insufficient_content.csv`
9. Average views on long-form videos < 1,000 → blacklist
10. **Qualified** → appended to `leads.csv`

---

## Setup Details

### YouTube API Keys

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project
2. Enable **YouTube Data API v3**
3. Create an API key
4. Add to `.env`: `YOUTUBE_API_KEYS=key1,key2,...`

Multiple keys rotate automatically when one hits its daily quota (8,000 units/key/run cap).

### Gemini API Key (orchestrator only)

1. [Google AI Studio](https://aistudio.google.com/apikey) → create a free key
2. Add to `.env`: `GEMINI_API_KEY=your_key`

---

## Quota Reference

| Operation | Units | Frequency |
|-----------|-------|-----------|
| `search.list` | 100 | Once per keyword |
| `channels.list` | 1 | Once per batch of ≤50 channels |
| `playlistItems.list` | 1 | Per Tier-1 survivor |
| `videos.list` | 1 | Per active channel |

Typical cost: ~110 units per keyword (100 search + a few Tier-2 calls).
One 8,000-unit key covers ~72 keywords before the cap.

---

## Documentation

| File | Contents |
|------|---------|
| `ICP.md` | Ideal Channel Profile — exact qualification criteria |
| `ORCHESTRATOR.md` | Orchestrator playbook — flags, loop logic, prompt architecture |
| `PROVEN_STRINGS.md` | Log of keyword patterns verified to surface qualifying leads |
| `HANDOFF.md` | Technical reference for AI agents and contributors |
