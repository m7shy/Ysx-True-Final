# Frontend review brief for Fable 5 — paste everything below the line into a fresh session

Budget note for the human: this is written for a **limited credit budget**. It is ordered so that
stopping early still yields a usable result, and it tells the reviewer to write findings to disk
incrementally rather than holding them to the end — the previous backend review died at an API
session limit and lost its analysis. Do not remove those instructions to save tokens; they are the
insurance.

---

You are reviewing the **frontend** of a CRM + client-portal app. You are the planner: another agent
(Opus 5) implements whatever you specify. **Do not write or edit application code.** Read, verify,
reason, and hand back a findings report and an ordered execution plan precise enough to execute
without you.

The code was written largely by an AI assistant over a few days. It is competent and heavily
commented, and that is the risk: it reads as more verified than it is. Your job is to find what it
got wrong, not to admire it.

## Repository

- Review: `C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring`. It has a
  `THIS-IS-NOT-PROD.md` marker.
- **NEVER touch** `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS` — that is production. Reading it to
  compare is fine; writing, building or restarting anything there is not.
- Six copies of this project have existed on this machine. Confirm your path before every command.

## Read these first, in order (budget ~15 minutes of context)

1. `.plans/known-failures.md` — all of it. Traps measured on this repo.
2. `.plans/REVIEW-2026-07-29-fable.md` — the most recent review. Its section 5 lists what is already
   verified correct; **do not re-derive any of it.**
3. `.plans/REVIEW-2026-07-28-frontend.md` — the last frontend review. Everything it found that
   verified as real is already fixed; check before re-reporting.
4. `HANDOFF.md`, top two entries only.

## Hard constraints

- **The production database is offline** (Neon free-tier compute exhausted; resets 2026-08-05). You
  cannot test against real data. Do not try, and do not provision a database.
- `npx tsc --noEmit` and `npm test` at the repo root work offline. In `server/`, `npx tsc -p .
  --noEmit` and `npx vitest run` also work. Use them freely.
- **Baseline: 19 frontend tests (3 files), 328 server tests, 0 type errors, clean `git status` at
  `df9a0e0`.** If your baseline differs, stop and report that first.
- Running server `tsc` and `vitest` simultaneously has OOM'd this machine. Run commands sequentially;
  use `NODE_OPTIONS=--max-old-space-size=4096` for `tsc` if needed.
- You may run commands and read anything. Do not modify application source. To prove a defect by
  breaking something, describe the mutation and its expected result instead of committing it.

## The shape of the problem

~13,500 lines of TSX/TS with **19 tests**. The compiler is the only thing checking most of it, and
the compiler has now missed the same class of bug **three times in three days** — see failure mode 1
below. Assume the untested majority contains defects of the same kind as the tested minority did.

Rough inventory, largest first:

| Area | Lines | Tests |
|---|---|---|
| `components/` (19 screens) | 7,213 | 8 (AnalyticsView) + 5 (ScraperView) |
| `src/features/campaigns/` (wizard + 4 steps) | 2,886 | 0 |
| `services/` (12 API clients) | 1,989 | 0 |
| `portal/` (client-facing SPA) | 1,662 | 6 (auth state) |
| `App.tsx`, `types.ts`, `context/`, `hooks/` | 1,794 | 0 |

## Scope, in priority order — stop wherever the budget runs out

### 1. Client types that assert a shape the server does not send — HIGHEST VALUE

This has caused **three white screens in three days**, every one invisible to `tsc`:

- the portal's `/auth/refresh` returned only `accessToken` while `PortalAuthState` declared
  `clientUser` non-optional → blank page on every reload;
- `ScrapeJob['status']` gained `'cancelling'` server-side and not client-side, so a `Record` over
  the client union stayed "exhaustive", `STATUS_META['cancelling']` was `undefined`, and the next
  line dereferenced `.Icon` → blank page the moment Stop was pressed;
- (the same class, third instance, in the portal shell).

`tsc` cannot catch these: the client type is an independent assertion about the server, not a
derivation from it. **Systematically cross-check every client-side response type against the server
route that actually populates it.** The client types live in `types.ts`, `services/*.ts` and
`portal/services/portalApi.ts`; the server responses are the `res.json(...)` calls in
`server/src/**/routes.ts`. Look specifically for: fields declared non-optional that the server omits
on some path, union members the server can send that the client does not list, and `Record<Union,
T>` lookups that go unguarded.

Deliverable for this section: a table of every mismatch, the route that produces it, and whether it
white-screens or merely renders wrong.

### 2. Screens that still show invented data

The Analytics screen was rendering fixture data — a padded "Sent Emails" figure, a hardcoded 42.8%
open rate, invented deltas, five fictional template names — and was rewritten on 2026-07-28 so that
every number comes from the API and anything unanswerable is not displayed. **Two more screens were
never given that treatment, and I confirmed both are still live:**

- `components/PerformanceView.tsx:4` imports `getEfficiencyStats`/`getRecentProjects` from
  `services/mockPerformance`, and it **is routed** — `App.tsx:393`, case `'PERFORMANCE'`. Every
  figure on that screen is invented. HANDOFF calls it "a separate legacy mock with no corresponding
  data model", which is an explanation, not a defence: the user cannot tell.
- `components/ComposeFollowUp.tsx:103` calls `fetchSentEmails()` from `services/mockZoho` — a
  748-line screen partly backed by a fixture.

Decide for each: delete the screen, hide it behind a flag, or build the endpoint. Recommend one, with
the reasoning. Also grep for any other live `mockZoho`/`mockPerformance` import I may have missed and
say what you found. **Do not report the two above as discoveries — they are given.** Report what they
imply and what else is like them.

### 3. `src/features/campaigns/` — 2,886 lines, zero tests

The campaign wizard **wedged** on 2026-07-28 and was fixed. It is the most complex uncovered
subsystem and it is the path that sends real email to real prospects. Priorities: can the wizard
reach a state it cannot leave; is a partially-filled campaign recoverable; does step validation match
what the server will accept (compare against `server/src/campaigns/routes.ts`'s zod schemas); what
happens on a failed submit at step 4.

### 4. `services/` error handling — 1,989 lines, zero tests

Specifically the "value the code produces that nothing reads" class, which has been found **six**
times in this repo. Grep deliberately for: a result object that is awaited but never inspected (this
caused "Follow-up sent successfully" on a failed send), an error code checked in the UI and thrown by
nothing, an argument accepted and never passed on. All of them typecheck. All fail silently.

### 5. Anything left

`App.tsx` (592 lines, routing + state), `context/`, `hooks/useEmailProvider.ts`.

## The specific failure modes this codebase produces

Measured on this repository, not generic advice. Each cost real time:

1. **Tests that pass against broken code.** Two suites written on 2026-07-28 were vacuous and passed
   against the very bug they targeted. **Do not trust a green suite as evidence.** For any fix you
   assess, ask what mutation would break the code and whether an existing test would catch it. Say so
   when the answer is no.
2. **A value the code produces that nothing reads.** Six instances so far. Grep for it deliberately.
3. **Client types asserting a shape the server does not send.** Three white screens. Section 1.
4. **`vi.clearAllMocks()` does not reset implementations, only call history.** Four tests have leaked
   state this way. Frontend suites currently use `mockReset` — keep it that way in anything you
   specify.
5. **The author's own claims have been wrong**, including a simulation that "verified" a component
   by omitting a rule and pinning a variable to a lucky value. Where a comment or HANDOFF asserts
   something is verified, **check the verification, not the claim.**
6. **A repair can commit the offence it repairs.** The most recent one did: a validator's second
   branch undid the invariant its own first branch enforced. It typechecked and 326 tests passed.

## Rules for reporting

- Every finding needs `file:line` and a concrete failure scenario — specific inputs or state leading
  to a specific wrong outcome. "This could be a problem" is not a finding.
- **Verify before reporting.** Prior delegated reviews of this codebase produced confident HIGH
  findings that were flatly wrong — four in one session. Assume you are capable of the same.
- Separate **CONFIRMED** from **SUSPECTED**, and say which is which.
- **Check the premise, not just the conclusion.** Premises handed to previous reviewers have been
  wrong and cost them real effort. If something in this brief looks wrong, say so.
- A finding can be accurate and still not be a defect. One reviewer correctly described `clearAuth()`
  wiping stored settings; that behaviour is intentional and security-motivated, and "fixing" it would
  have reintroduced a cross-tenant credential leak. **Check intent before calling something broken.**
- If an area is sound, say so and say how you checked. "I verified X, Y, Z and they hold" is a
  valuable result. Do not manufacture findings to look thorough.
- State what you could not determine, especially anything needing the live database.

## Deliverable — write incrementally, do not hold it to the end

Write to `.plans/REVIEW-FRONTEND-fable.md`. **Create the file after finishing section 1 and append to
it after each subsequent section.** The previous backend review hit an API session limit mid-analysis
and its work was lost; this is the mitigation and it is not optional.

Structure:

1. **Summary** — what you checked, what you found, your confidence, and whether you would ship this
   frontend to a paying client on 2026-08-05.
2. **Confirmed defects** — file:line, failure scenario, how you proved it, severity.
3. **Suspected but unproven** — and exactly what would settle each one.
4. **Test-quality findings** — any test that would pass against broken behaviour, is vacuous, or
   leaks state. Name the mutation that should break it.
5. **Verified as correct** — briefly, so nobody redoes the work.
6. **Could not determine** — explicitly.
7. **EXECUTION PLAN** — the part that matters most. An ordered list of tasks for the implementing
   agent. For each: the file(s), what to change and why, how to verify it, and what mutation should
   break the new test. Rank by real user impact, and mark what must land before the 2026-08-05 deploy
   versus what can follow.

Finish by confirming `git status` is clean and reporting `npx tsc --noEmit` and `npm test` at the
root. **Do not commit anything.**
