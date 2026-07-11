# Proven Search Strings Log

This document tracks keyword patterns that have been **verified to surface
qualifying leads** when run through `main.py`. Use these as a reference when
seeding `keywords.txt` manually or evaluating Gemini output quality.

A "proven" string is one where at least one run using that query returned
a channel that passed all Tier-1 and Tier-2 filters and landed in `leads.csv`.

---

## How to Use This Log

1. After a scraper run, open `leads.csv` and check the `social_links` column
   for clues about which search angle found each channel.
2. Open `skipped.log` to see which query angles produced only blacklisted results.
3. Add working patterns to the **Confirmed** section below.
4. Add consistently barren patterns to the **Barren** section to avoid wasting
   quota regenerating them.

---

## Pattern Taxonomy

Queries that consistently qualify tend to follow one of these structures:

```
[niche topic] + [product signal]
  e.g. "productivity systems online course"

[platform name] + [creator signal]
  e.g. "kajabi course creator coach"

[outcome] + [product signal]
  e.g. "six figure freelance business program"

[pain point] + [product signal]
  e.g. "struggling online business coaching"

[format signal] + [niche]
  e.g. "masterclass content creator business"
```

The scraper's qualification signals are:
- **Score 2 (strong)**: `course`, `enroll`, `gumroad`, `teachable`, `kajabi`,
  `stan.store`, `masterclass`
- **Score 1 (weak)**: `coaching`, `program`, `mentorship`

Queries that do NOT contain at least one of these words (or that surface
channels whose descriptions don't contain them) will produce zero yield.

---

## Confirmed Patterns

*(Add entries here as you verify them)*

| Pattern | Niche | Avg yield / run | Notes |
|---------|-------|-----------------|-------|
| `[niche] online course creator` | any | TBD | — |
| `[niche] coaching program enroll` | any | TBD | — |
| `[niche] masterclass small creator` | any | TBD | — |
| `kajabi [niche] course creator` | any | TBD | strong signal |
| `stan store [niche] coaching` | any | TBD | strong signal |
| `gumroad [niche] digital product` | any | TBD | strong signal |
| `[niche] bootcamp online program` | any | TBD | — |
| `[niche] coaching program mentorship` | any | TBD | weak signal |

---

## Barren Patterns

*(Add patterns here that repeatedly return zero qualified leads)*

| Pattern | Reason |
|---------|--------|
| Celebrity name + niche | Attracts mega-channels (>10k subs), wastes quota |
| `how to [do niche thing]` | Surfaces tutorial channels, not selling channels |
| Platform name alone | Attracts the platform's own content team |
| Motivational phrases without commercial signal | Score 0, instant blacklist |

---

## Baseline Keywords (`keywords.txt` default)

The file `keywords.txt` ships with these generic patterns. They work for any
niche run directly via `main.py` (without the orchestrator).
When the orchestrator runs, it overwrites `keywords.txt` with niche-specific
queries from Gemini.

See current `keywords.txt` for the active baseline.
