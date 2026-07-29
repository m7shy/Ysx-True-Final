# Kickstart prompt for the next session

Copy everything below the line. Add one line at the top saying whether this session is
**deploying** or **hardening** — the prompt deliberately does not choose for you, and it aims much
better once it knows.

If you commit or push anything before starting the next session, update the baseline commit in the
Repository section. A wrong baseline is exactly the kind of premise error that has cost reviewers
in this project real effort.

---

You are working on a CRM + client-portal app that sends cold outreach email.
Deploy to real paying use is 2026-08-05.

## Repository

- Work in: `C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring`.
  It has a `THIS-IS-NOT-PROD.md` marker. HEAD should be `c3228f8`, tree clean.
- NEVER touch `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS` — that is production.
  Reading it to compare is fine; writing, building or restarting anything there is not.
- Six copies of this project have existed on this machine. Confirm your path before every command.

## Read first, in this order

1. `HANDOFF.md` — the top entry only (2026-07-29 "latest"). Its "Still open" and
   "Before you deploy" sections are the current state of play.
2. `.plans/known-failures.md` — all of it. Traps measured on this repo, including the
   memory flags below.
3. `.plans/REVIEW-FRONTEND-fable.md` — findings F1–F15 with the reasoning. Skim unless
   you are touching one of them.

## Hard constraints

- The production database is offline (Neon free-tier compute exhausted; resets 2026-08-05).
  You cannot test against real data. Do not try, and do not provision a database.
- Verify with: `npx tsc --noEmit` + `npx vitest run` at the root, and `npx tsc -p . --noEmit`
  + `npx vitest run` in `server/`. Run them SEQUENTIALLY — running both at once has OOM'd
  this machine.
- This machine is memory-starved (~1GB free of 8GB). If tsc dies with a NewSpace /
  "young object promotion failed" error, do NOT raise `--max-old-space-size`, which makes
  it worse. Use:
  `NODE_OPTIONS="--max-semi-space-size=2 --max-old-space-size=1024"`
- Baseline: **353 server tests, 43 frontend tests, both typechecks clean, clean git status
  at `c3228f8`.** If your baseline differs, stop and report that first.
- Do not commit unless asked.

## Deploy-critical, in order

1. **Settings → Sender identity MUST have a business name and postal address before deploy.**
   As of the 07-29 compliance work this gates ALL FOUR send paths, not just campaigns —
   without it, Unibox replies and Dashboard follow-ups return 409 `MISSING_SENDER_IDENTITY`
   and send nothing.
2. Campaign throughput now honours the wizard's pacing (~27 sends/day/campaign on defaults,
   vs previously 10-per-tick 24/7 uncapped). If that is too slow, change the 20-minute
   default in `src/features/campaigns/defaults.ts` — not the code that enforces it.
3. Once the DB is back: `SELECT id, name FROM "Campaign" WHERE "sendDays" = 0;`
   Those campaigns are silently frozen and are no longer creatable.

## How to find bugs in this codebase

Reading has repeatedly missed the defect class that actually bites here. What works is
mechanically diffing the keys a caller passes against the keys the receiver reads — that
found the biggest bug of the last session (13 wizard fields silently dropped, so every
campaign ever created sent unthrottled) after three careful reviews had read the same file.
It is 4-for-4 on that class. Prefer it over another read-through.

Surfaces it has NOT been run over yet: `App.tsx` beyond routing, `context/SettingsContext.tsx`,
`context/AuthContext.tsx`, `components/TemplatesView.tsx`, `DocumentationView.tsx`,
`EmailCard.tsx`, and most of `services/gemini.ts`'s prompt construction.

## Rules that have cost real time here

- **A test that passes the moment you write it deserves suspicion.** Mutation-check every new
  test: perform the mutation, confirm the failure, restore. Record the mutation in the test
  file's header.
- **Test the WIRING, not the rule.** A unit test on a pure function proves nothing about whether
  anything calls it correctly — that is exactly how the 13-dropped-fields bug survived.
- **A repair can commit the offence it repairs.** Read your own diff before declaring done; that
  has caught the regression-in-the-fix three sessions running, when the test suite did not.
- **Nothing in this codebase has ever run against Postgres.** Every fix is verified by reasoning,
  typechecking and mocks. Say so rather than implying runtime verification.
