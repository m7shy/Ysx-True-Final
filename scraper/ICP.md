# Ideal Channel Profile (ICP)

This is the canonical definition of a qualifying lead. Every filter in `main.py`
and every Gemini prompt in `orchestrator.py` is derived from this document.
If you change a threshold here, update `main.py` to match.

---

## Hard Criteria (all must pass — any failure = disqualification)

| Signal | Requirement | File action on failure |
|--------|-------------|------------------------|
| Subscriber count | 500 – 10,000 | `blacklist.csv` |
| Subscriber count hidden | Must be visible | `blacklist.csv` |
| Country code (explicit) | US, GB, CA, AU only | `blacklist.csv` |
| Country heuristic (unset) | No `₹` or `+91` in title/description | `blacklist.csv` |
| Qualification signal | Score >= 1 (see below) | `blacklist.csv` |
| Recent upload | At least one video within last 15 days | skipped, no file |
| Long-form video count | >= 10 videos longer than 60 seconds | `insufficient_content.csv` |
| Average views (long-form) | >= 1,000 | `blacklist.csv` |

---

## Qualification Signal Scoring

The channel's YouTube description is scanned for these keywords (case-insensitive):

| Score | Label | Trigger words |
|-------|-------|---------------|
| 2 | Strong | `course`, `enroll`, `gumroad`, `teachable`, `kajabi`, `stan.store`, `masterclass` |
| 1 | Weak | `coaching`, `program`, `mentorship` |
| 0 | Disqualified | None of the above found |

Score 0 → permanent `blacklist.csv`. Score 1 or 2 → continues to Tier-2 checks.

---

## Ideal Channel (positive example)

- US-based fitness coach, 3,200 subscribers
- Description mentions "enroll in my 12-week coaching program"
- Uploads weekly; last video 4 days ago
- 14 long-form videos in latest 15 uploads, avg 2,400 views
- Email visible in description
- **Result**: qualifies → `leads.csv`

---

## Known Filter Gaps (by design)

- **English-only heuristic**: The geo heuristic only catches `₹` and `+91`. An Indian creator
  writing in English with no price signals will pass. False-positive rate kept low intentionally.
- **Score 1 ("weak") channels**: `coaching`, `program`, `mentorship` can appear on channels
  that do not actively sell. A manual review pass on weak-signal leads is recommended.
- **Avg views on latest 15 videos only**: A channel that recently pivoted to Shorts may score
  low here despite an older long-form catalogue.

---

## What Is NOT a Qualifying Lead

- Mega-influencers (>10k subs) — outside sub range, filtered automatically
- Corporate brands and SaaS companies — no coaching signal in description
- Indian/Brazilian/Pakistani creators (explicit country or heuristic signals)
- Channels with hidden subscriber counts
- Channels inactive for >15 days
- Channels with fewer than 10 long-form videos (soft-skip → `insufficient_content.csv`)
- Channels averaging <1,000 views on long-form content
