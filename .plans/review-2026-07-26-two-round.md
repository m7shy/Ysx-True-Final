# Two-round deep review — 2026-07-26

User's design: **two independent passes over identical code.** Round 1 by hand (me),
round 2 delegated to `agy`. Neither round sees the other's findings while producing them.
The comparison is the deliverable — agreements are high-confidence, disagreements are
where the interesting bugs and the confident-but-wrong findings both live.

**Scope: genuinely everything (~33.7k lines of real code).** `scraper/venv` excluded
(vendored deps, ~83k lines, not our code).

| Area | Lines | Round-1 unit |
|---|---|---|
| `server/src` (excl. tests) | 11,556 | 1–6 |
| CRM frontend | 12,961 | 8 |
| Scraper Python (excl. venv) | 6,710 | 10 |
| Portal SPA | 1,585 | 9 |
| `prisma/schema.prisma` | 898 | 7 |

## Round-1 units (manual)

1. `auth/` + `creds/` (1,762) — JWT, refresh, OAuth, mailbox encryption
2. `portal/` backend (762) + `billing/` (404) — client-facing surface, webhooks
3. `campaigns/` (1,864) + `scheduler/` (514) — worker, engine, tracking, follow-ups
4. `mail/` (1,478) + `unibox/` (521) — SMTP/IMAP, providers, reply detection
5. `leads/` (553) + `invoices/` (285) + `projects/` (310) — money + DNC + tenant data
6. `scraper/` backend (1,454) + `db/` + `health/` + `index.ts`/`config.ts`
7. `prisma/schema.prisma` (898) — constraints, indexes, cascade behaviour, tenant keys
8. CRM frontend (12,961)
9. Portal SPA (1,585)
10. Python scraper (6,710)

## Method (round 1)

Not a line-by-line read of 33.7k lines — that is not what a careful reviewer does and it
would exhaust context before finishing. Instead, per unit:
- read the high-risk files in full (anything touching auth, money, tenancy, crypto, or an
  unauthenticated route)
- pattern-sweep the whole unit for known defect classes (missing tenant scope, unawaited
  promises, unguarded `any`, secrets in logs, raw SQL, missing `await` on transactions)
- trace each finding to a concrete failure scenario before recording it

Findings are appended to `REVIEW-2026-07-26-round1-manual.md` **as each unit completes**,
not held in context to the end — the conversation may be summarized mid-review and
unwritten findings would be lost.

## Prior context that shapes this review

`.plans/REVIEW-2026-07-25*.md` found 7 HIGHs, all fixed and deployed. Those fixes are
themselves now subject to review — a fix that introduced a regression is exactly what a
second pass should catch, and this repo has already had one (the token-revocation batch
minting a session from a stale pre-update row). Areas the previous review explicitly
recorded as "checked and found sound" are re-examined rather than trusted.

## Round 2 (agy) — planned, not yet run

Split into per-directory units (`known-failures.md`: a ~13k-line unit times out). Use the
Step 7.2 review runner: deliverable is a **file** with a required marker, success is that
file's existence and content, never exit code or stdout. Tier: start `gemini-3.1-pro-high`
for independent-model diversity (different blind spots from a Claude round 1), fall back
per §5.22 error signatures.

Then: spot-check a meaningful sample of agy's findings against source before relaying any
of them (§5.18 — a prior delegated review here produced ~100 findings, two confidently
wrong). Never paste an agy findings list through unverified.
