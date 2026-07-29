# Fable 5 review brief — paste everything below the line into a fresh session

---

You are auditing a codebase and producing a **findings report and an execution plan**. You are the
planner; another agent (Opus 5) will implement whatever you specify. **Do not write or edit
application code.** Read, verify, reason, and hand back a plan precise enough to execute without
you.

The work under review was written by an AI assistant in a single day. It is competent and heavily
commented, and that is exactly the risk: it reads as more verified than it is. Your job is to find
what it got wrong, not to admire it.

## Repository

- **Review:** `C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring`.
  It has a `THIS-IS-NOT-PROD.md` marker.
- **NEVER touch** `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS` — that is production. Reading it to
  compare is fine; writing, building or restarting anything there is not.
- Six copies of this project have existed on this machine. Confirm your path before every command.

## Read these first, in order

1. `HANDOFF.md` — the entry titled **"2026-07-28 (final)"** at the top. That is the work under review.
2. `.plans/known-failures.md` — **all of it**, especially the last four entries. They describe
   traps that produced tests passing for the wrong reason, and a bug class ("a value the code
   produces that nothing reads") found four separate times.
3. `.plans/REVIEW-2026-07-28-mail.md`, `-scraper.md`, `-frontend.md` — the three reviews that drove
   these fixes.

## Hard constraints

- **The production database is offline** (Neon free-tier compute exhausted; resets 2026-08-05). You
  cannot test anything against real data. Do not try, and do not provision a database.
- **Nothing here has ever run against Postgres.** All 316 server tests mock Prisma. That is the
  single largest gap in the verification story and you should weigh findings accordingly.
- `npx tsc -p . --noEmit` and `npx vitest run` in `server/`, and `npx tsc --noEmit` and `npm test`
  at the root, all work offline. Use them freely. Baseline: **316 server tests, 14 frontend, 0 type
  errors.** If your baseline differs, stop and report that first.
- You may run commands and read anything. Do not modify application source. If you need to prove a
  defect by breaking something, describe the mutation and its expected result instead.

## Scope, in priority order

### 1. The 20 fixes from 2026-07-28 — `git log --oneline fc0c273..HEAD`

All by one author, in one day, none exercised against a live database, and the author's own
self-checks demonstrably failed twice (see below). This is the highest-value target.

Start with the areas the author flagged as least confident:

- **`server/src/scheduler/pulse.ts` — `startGatedPoller`.** Core scheduling; three subsystems
  (reply detection, auto-scraper, watchdog) now depend on it. It ticks faster than the burst window
  and self-throttles. Check the interaction between `runImmediately`, the due-check, and
  `servedThisBurst`. Can a poller be served twice in one burst? Starve under an unusual
  `PULSE_*` env combination? What if `BURST_MS` is configured below `GATE_TICK_MS`?
- **`server/src/scraper/service.ts` — the claim/cancel/eviction rework.** `claimJobSlot`,
  `abandonClaim`, `killProcessTree`, the new `cancelling` status, `sweepFinishedJobs`. Adding that
  status already caused one white screen (fixed in `50eb019`) because a consumer did not know about
  it. **Find the other consumers.** Also: is `taskkill` reachable and correct? What happens if the
  child exits between the status flip and the kill?
- **`prisma/migrations/20260728080000_revision_round_unique/migration.sql`** — still **never
  executed anywhere**. Verify the window functions and `UPDATE ... FROM ... JOIN` by hand.
- **`server/src/invoices/routes.ts`** — the send response is now built from a row already in hand
  rather than re-read. Confirm the shape matches what `update()` previously returned and that no
  consumer relied on a field that changed.
- **`components/AnalyticsView.tsx`** — a full rewrite with only 8 tests behind it.

### 2. The backend review that never finished

It hit an API session limit mid-analysis and **invalidated its own final result** (module state
leaked between its simulation runs). Its worktree is preserved with its probe files:
`C:\Users\BANJIG~1\AppData\Local\Temp\claude\C--Users-banjigum1-Documents-YSXXS\c3555dda-3181-4f9d-b5ef-d68792bb4bdc\scratchpad\backend-review`
Its brief is `.plans/REVIEW-PROMPT-2026-07-28.md`. Resume rather than restart. Note that several of
its findings were already fixed; check before re-reporting.

### 3. The portal backend — never reviewed, not once

`server/src/portal/**` plus `server/src/clients/`, `server/src/projects/`, `server/src/invoices/`.
Client-facing, handles authentication, invoices and money display. Two prior attempts failed
(one model refused on content-policy grounds, another never delivered a file). Priorities:
cross-client data exposure, whether a client of agency A can read or mutate anything of agency B,
and anything money-shaped.

## The specific failure modes this codebase produces

Not generic advice — these are measured on this repository, and each cost real time:

1. **Tests that pass against broken code.** Two suites written yesterday were vacuous and passed
   against the very bug they targeted. **Do not trust a green suite as evidence.** For any fix you
   are assessing, ask what mutation would break the code and whether an existing test would catch
   it. Say so when the answer is no.
2. **"A value the code produces that nothing reads."** Found four times: an argument never passed,
   twice; a result object never inspected; an error code checked but never thrown. All type-check.
   All fail silently. Grep for it deliberately.
3. **Client types that assert a shape the server does not send.** Twice in two days, both causing a
   white screen, both invisible to `tsc`. Cross-check every client-side type against the server
   response that actually populates it.
4. **`vi.clearAllMocks()` does not reset implementations**, only call history. Three tests leaked
   state this way yesterday.
5. **The author's own claims have been wrong.** A simulation "verifying" one component was wrong
   because the model omitted a rule and pinned a variable to a lucky value. **Where the code
   comments or HANDOFF assert something is verified, check the verification, not just the claim.**

## Rules for reporting

- **Every finding needs `file:line` and a concrete failure scenario** — specific inputs or state
  leading to a specific wrong outcome. "This could be a problem" is not a finding.
- **Verify before reporting.** Prior delegated reviews of this codebase produced confident HIGH
  findings that were flatly wrong — four in one session. Assume you are capable of the same.
- **Separate CONFIRMED from SUSPECTED**, and say which is which.
- **Check the premise, not just the conclusion.** Two premises given to a previous reviewer were
  wrong and cost it real effort. If something in this brief looks wrong, say so.
- **A finding can be accurate and still not be a defect.** One reviewer correctly described
  `clearAuth()` wiping stored settings; that behaviour is intentional and security-motivated, and
  "fixing" it would have reintroduced a cross-tenant credential leak. Check intent before calling
  something broken.
- **If an area is sound, say so and say how you checked.** "I verified X, Y, Z and they hold" is a
  valuable result. Do not manufacture findings to look thorough.
- **State what you could not determine.** Especially anything that needs the live database.

## Deliverable

Write to `.plans/REVIEW-2026-07-29-fable.md`:

1. **Summary** — what you checked, what you found, your confidence, and whether you would deploy
   this on 2026-08-05.
2. **Confirmed defects** — file:line, failure scenario, how you proved it, severity.
3. **Suspected but unproven** — and exactly what would settle each one.
4. **Test-quality findings** — any test that would pass against broken behaviour, is vacuous, or
   leaks state. Name the mutation that should break it.
5. **Verified as correct** — briefly, so nobody redoes the work.
6. **Could not determine** — explicitly.
7. **EXECUTION PLAN** — the part that matters most. An ordered list of tasks for the implementing
   agent. For each: the file(s), what to change and why, how to verify it, and what mutation should
   break the new test. Rank by real user impact, and mark anything that must land before the
   2026-08-05 deploy versus what can follow.

Finish by confirming `git status` is clean and reporting the results of both typechecks and both
test suites. Do not commit anything.
