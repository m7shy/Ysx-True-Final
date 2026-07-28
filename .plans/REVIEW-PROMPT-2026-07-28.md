# Adversarial review prompt — paste everything below the line into a fresh session

---

You are doing an adversarial code review of work I completed on 2026-07-28. Your job is to **try to
prove it wrong**, not to confirm it. Assume the author was confident and wrong somewhere — your task
is to find where.

## Repository

- **Review this checkout ONLY:** `C:\Users\banjigum1\Documents\YSXXS\YSXXS` (branch
  `phase5-frontend-wiring`). It has a `THIS-IS-NOT-PROD.md` marker.
- **DO NOT touch, build, or modify** `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS`. That is
  production. Reading it to compare is fine; writing to it is not.
- Six copies of this project have existed on this machine. Confirm your path before every edit.

## Read these first, in this order

1. `HANDOFF.md` — the entry titled **"2026-07-28 (later)"** at the top. This is the work under review.
2. `.plans/known-failures.md` — **read all of it.** It documents traps in this repo and, at the end,
   two failure patterns from the very session you are reviewing.
3. `.plans/REVIEW-2026-07-28-mail.md` — the findings that drove half these changes.

## Hard constraints

- **The production database is offline** (Neon free-tier compute exhausted; it resets 2026-08-05).
  You cannot test anything against a live database. Do not try. Do not attempt to provision one.
- **Do not restart services or change any production config.**
- `npx tsc -p .` and `npx vitest run` in `server/` both work offline — the suite mocks Prisma
  throughout. Use them freely.
- Everything is committed and pushed. `git stash`/`git checkout` to experiment is safe, but restore
  the tree before you finish and confirm with `git status`.

## Scope

The commit range is `fc0c273..HEAD` (about 8 functional commits). Start with:

```bash
git log --oneline fc0c273..HEAD
git diff fc0c273..HEAD --stat
```

The functional changes are in:
- `server/src/unibox/replyPoller.ts` — per-tenant fair-share selection with rotating cursors
- `server/src/campaigns/worker.ts` — `interleaveByTenant`
- `server/src/portal/routes.ts` — `createNextRevision` retry
- `prisma/schema.prisma` + `prisma/migrations/20260728080000_revision_round_unique/`
- `server/src/mail/replyCheck.ts` — three separate changes
- `server/src/index.ts` — the reply gate in `sendFollowupJob`
- `server/src/scraper/autoScheduler.ts` — pulse gate
- `.github/workflows/verify.yml`

## Part 1 — Verify the tests before you trust them

**This is the most important part of the job.** A passing suite proves nothing on its own. In this
project, a green test has twice passed against broken behaviour, and one guard had a passing unit
test while being dead code for its entire life.

For **every** test added in this range (`server/src/__tests__/replyPollerFairness.test.ts`,
`workerFairness.test.ts`, `revisionRound.test.ts`, `followupReplyGate.test.ts`,
`autoScraperPulse.test.ts`, and the additions to `server/src/mail/__tests__/replyCheck.test.ts`):

1. **Mutation-check it yourself.** Break the fix it covers — invert a condition, delete a guard,
   return a constant — re-run, and confirm the test **fails**. Restore afterwards. A test that
   passes both ways is worse than no test. The commit messages claim specific mutation results;
   verify those claims independently rather than believing them.
2. **Check the test isn't vacuous.** Look hard at the mocks. Does the assertion exercise real
   product code, or has the mock been shaped until it produces the expected answer by itself?
   `followupReplyGate.test.ts` mocks heavily — scrutinise it especially.
3. **Check the fakes match reality.** Where a mock stands in for a library or for Prisma, verify the
   real thing behaves that way — read the library source in `node_modules` if needed. A fake that is
   more generous than reality hides bugs. One already found: the fetch mock in `replyCheck.test.ts`
   was made to return `bodyStructure` *only when requested*, because a mock that volunteered it
   unconditionally would let code that forgot to ask keep passing.
4. **Check for order dependence.** Several of these use module-level or shared mutable state
   (`vi.hoisted`, module-scope cursors, prototype mocks). `vi.clearAllMocks()` resets call history
   but **not** implementations — one such leak was already found and fixed here. Try running files
   individually and in different orders.

## Part 2 — Specific claims to falsify

These are load-bearing and stated with confidence. Attack each one:

1. **`selectLeadsForTick` (`replyPoller.ts`) genuinely reaches every lead.** Check the cursor
   arithmetic hard. The cursor is `% total`, and `total` changes between ticks as leads change
   status. On the wrap-around path the cursor advances by `leads.length`, which includes rows taken
   from the *front* — I am not convinced that advance is correct. Can a lead be skipped indefinitely?
   Can the rotation stall or oscillate? Write a test with a shrinking/growing tenant.
2. **`interleaveByTenant` always terminates.** The loop is
   `for (let round = 0; out.length < campaigns.length; round++)`. The argument is that every
   campaign lands in exactly one tenant bucket so the total is conserved. Try to construct an input
   where it spins forever or drops a campaign.
3. **The migration SQL is correct.** `prisma/migrations/20260728080000_revision_round_unique/migration.sql`
   has **never been executed anywhere.** Check the window functions and the `UPDATE ... FROM ... JOIN`
   by hand. Does the renumber actually avoid collisions? Is it truly idempotent? Would it deadlock
   or rewrite rows it shouldn't? (Context: the live `Revision` table is empty per the 2026-07-27
   backup, so the risk is low in practice — but the SQL should still be right.)
4. **`normalizeSubject` doesn't over-strip.** The prefix alternation includes a bare `r`. Consider
   subjects like `RE:MAX property update` or `R:D findings` — does it mangle legitimate subjects
   into false matches? Is the resulting thread-scoping still sound?
5. **`collectContentTypes` matches ImapFlow's real output.** I verified the shape against
   `node_modules/imapflow/lib/tools.js` (`parseBodystructure` sets `type` lowercased and
   `childNodes`). Re-verify. Also check the depth cap of 10 can't be exploited to hide a
   `message/delivery-status` part below it.
6. **Failing closed can't wedge a sequence permanently.** `checkRecipientReply` returning `'unknown'`
   makes `sendFollowupJob` defer with **no bound**. Confirm a job can't ping-pong forever consuming
   resources, and confirm the deferral genuinely can't be reached with a *permanent* condition (a
   deleted mailbox, a malformed address) that will never clear.
7. **The auto-scraper gate doesn't break scheduling.** Scrapes run 3–5×/day. With `mayPoll` gating,
   ticks only happen in the idle burst window. Verify a due scrape is still picked up and that
   `computeNextRunTime` can't drift or starve under the gated cadence.
8. **`isUniqueViolation` can't match the wrong constraint.** It substring-matches `'roundNumber'`
   against `err.meta.target`. Check Prisma's actual P2002 payload shape for this schema.

## Part 3 — Verify the prose, not just the code

`HANDOFF.md`'s 2026-07-28 (later) entry makes factual claims. Several *earlier* handoff claims were
found wrong during that session, so treat this one the same way. In particular:

- It asserts the campaign worker never had a fairness problem because every ACTIVE campaign is
  visited each tick and all contended resources are per-tenant. **Verify that independently.**
- It gives Neon figures read from the console (100 CU-hour allowance, 110.24 used, period starting
  the 5th). You cannot re-read the console; just flag anything the code contradicts.
- It claims five timers now poll the database and all five are gated. **Derive that list from the
  code yourself** — `grep -rn "setInterval" server/src` — rather than trusting the count. The fifth
  was found exactly this way after a previous entry confidently said there were four.

## Part 4 — Known unverified items (do not report these as discoveries)

Already known and documented; only report them if you find they are *worse* than described:
- The reply-check defer is unbounded (needs a schema field to cap).
- `.github/workflows/verify.yml` has **never been observed running.** `gh` is not installed on this
  machine. `prisma generate` was confirmed to work without `DATABASE_URL`/`DIRECT_URL` set, so that
  step should be fine, but the workflow as a whole is unproven. Reasoning about it is welcome;
  running it is not possible here.
- Most of the mail layer is unreviewed: `imapClient.ts`, `mail/routes.ts`, `smtpClient.ts`,
  `smtpGateway.ts`, `unibox/routes.ts`, `unibox/intent.ts`. The portal backend has never had a
  completed independent review. Both are fair game for *new* findings.

## Rules for reporting

- **Every finding needs `file:line` and a concrete failure scenario** — specific inputs or state
  leading to a specific wrong outcome. "This could be a problem" is not a finding.
- **Verify before reporting.** A prior delegated review of this codebase produced ~100 findings of
  which two confident HIGHs were flatly wrong; a later one produced four wrong HIGHs in a single
  session. Assume you are capable of the same and check each claim against the source before it
  goes in the report.
- **Prefer a demonstration to an argument.** If you think something is broken, write a failing test
  that proves it and leave the test in place.
- **Separate confirmed from suspected.** Say plainly which is which, and say what you could not
  determine rather than guessing.
- **If you find nothing wrong in a section, say so.** Do not manufacture findings to look thorough.
  "I checked X, Y, Z and they hold, here is how I checked" is a valuable result.

## Deliverable

Write your report to `.plans/REVIEW-2026-07-28-adversarial.md` in the working checkout, structured as:

1. **Summary** — what you checked, what you found, your confidence.
2. **Confirmed defects** — each with file:line, failure scenario, and how you proved it.
3. **Suspected but unproven** — with what would be needed to settle it.
4. **Test-quality findings** — any test that passes against broken behaviour, is vacuous, or is
   order-dependent. Include your mutation results per test file.
5. **Claims verified as correct** — briefly, so the next person doesn't redo the work.
6. **Could not determine** — explicitly.

Then run `npx tsc -p .` and `npx vitest run` in `server/`, confirm the tree is back to a clean
`git status`, and report both results. Do not commit anything unless I ask.
