# Orchestrator Playbook

`orchestrator.py` is the AI campaign commander. It accepts a niche and a lead
target, uses Gemini to generate search keywords, runs the scraper sub-scripts
in a pivot loop, and stops when the target is reached or resources run out.

---

## Quick Start

```
pip install -r requirements.txt
# add GEMINI_API_KEY to .env (https://aistudio.google.com/apikey)

python orchestrator.py --niche "B2B Coaching" --target 300
```

---

## All Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--niche` | required | Target niche in quotes |
| `--target` | required | New leads to find before stopping |
| `--max-rounds` | 10 | Hard cap on orchestration rounds |
| `--keywords` | 80 | Keywords generated per keyword round |
| `--no-graph` | off | Disable graph-mining rounds; keyword-only mode |

---

## The Pivot Loop

Each round the orchestrator picks one of two strategies:

### Strategy A — Keywords
1. Calls Gemini with the hardcoded ICP prompt (see below)
2. Writes the result to `keywords.txt` (overwrites)
3. Runs `main.py` via subprocess, streaming output live
4. Counts new rows in `leads.csv` to measure yield

### Strategy B — Graph
1. Extracts channel IDs from leads found since the last graph round
2. Writes up to 50 of them to `targets.txt` (overwrites)
3. Runs `process_graph.py` — mines their featured channel networks
4. Counts new rows in `leads.csv` to measure yield

**Switching rule**: Graph fires when 2+ keyword rounds have run AND there are
fewer than half as many graph rounds. Also fires immediately if the last keyword
round returned zero new leads (dry-run recovery).

---

## Gemini Prompt Architecture

The prompt inside `generate_keywords()` is fully self-contained — it does not
read from any external file. It consists of three hardcoded blocks:

1. **`_ICP_BLOCK`** — the exact ICP from `ICP.md` translated into prompt language
2. **`_HARD_BANS`** — patterns that waste quota (celebrity names, geo-risky terms, etc.)
3. **`_ROUND_ANGLES`** — per-round strategy that escalates specificity:

| Round | Angle |
|-------|-------|
| 1 | Direct signal sweep — words that appear in qualifying descriptions |
| 2 | Platform anchor — Kajabi/Gumroad/Teachable as creator qualifiers |
| 3 | Outcome and transformation — what the buyer becomes |
| 4 | Pain point anchoring — the problem the coach solves |
| 5 | Cohort and community format — bootcamp, accelerator, mastermind |
| 6+ | Micro-niche long-tail — hyper-specific sub-niche vocabulary |

---

## Files the Orchestrator Touches

| File | Action |
|------|--------|
| `keywords.txt` | Overwritten before every keyword round |
| `targets.txt` | Overwritten before every graph round |
| `leads.csv` | Read (count rows) after every round — never written directly |
| `blacklist.csv` | Read (count rows) for dashboard — never written directly |
| `insufficient_content.csv` | Read (count rows) for dashboard — never written directly |

The orchestrator never writes to `leads.csv`, `blacklist.csv`, or
`insufficient_content.csv` directly — those are owned by `main.py` and
`process_graph.py`.

---

## Dashboard

Printed before each round and at session end:

```
  +============================================================+
  |  YT-SCRAPER ORCHESTRATOR                                   |
  +============================================================+
  |  Niche    : B2B Coaching                                   |
  |  Progress : [####################------------------] 52.3% |
  |  Leads    : 157 / 300   (+23 via keywords)                 |
  |  Pipeline : 4,821 blacklisted  |  312 insufficient         |
  |  Rounds   : 4 done  (kw=3, graph=1)  ->  next: graph       |
  |  Runtime  : 00h 47m 12s                                    |
  +============================================================+
```

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `YOUTUBE_API_KEYS` | Yes | — | Comma-separated list; rotation handled by `main.py` |
| `GEMINI_API_KEY` | Yes | — | Free key at aistudio.google.com |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Any Gemini model name |

---

## Stopping and Resuming

The orchestrator stops when:
- `--target` leads have been found in this session
- `--max-rounds` rounds have completed
- Ctrl+C is pressed (prints final dashboard before exiting)
- All YouTube API quota is exhausted (handled by `main.py` — the subprocess exits cleanly)

To resume: just re-run with the same `--niche` and `--target`. The orchestrator
reads the current `leads.csv` count as its new baseline, so it will not
double-count leads from prior sessions.
