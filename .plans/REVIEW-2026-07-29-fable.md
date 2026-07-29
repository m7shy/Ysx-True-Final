# REVIEW — 2026-07-29 (Fable 5, planner)

Reviewer: Claude Fable 5. Scope: the 20 fixes of 2026-07-28 (`fc0c273..HEAD`), the unfinished
backend review's open claims, and the never-reviewed portal backend. Checkout:
`C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring` (THIS-IS-NOT-PROD
marker confirmed). Production was not touched.

## 1. Summary

Baseline reproduced exactly before any analysis: server `tsc` clean, **316/316** server tests,
root `tsc` clean, **14/14** frontend tests.

The 2026-07-28 work is substantially better than its base rate suggests. The load-bearing fixes —
the pulse gate, the scraper claim/cancel rework, the revision-round migration, the invoice
double-send claim, the portal auth/refresh path — all verify as correct, several by independent
simulation or hand-execution rather than by reading. The portal backend, reviewed here for the
first time, is well-scoped: I could not construct a cross-tenant read or write through any of
`portal/routes.ts`, `clients/routes.ts`, `projects/routes.ts`, or `invoices/routes.ts`.

What I did find: one real (low-moderate) correctness defect in the rewritten analytics endpoint's
time-windowing, one silently-dangerous configuration foot-gun in the pulse gate (directly relevant
because HANDOFF tells the operator to tune exactly that env var), one stale-response race in the
invoice send route (currently latent), one unhandled failure path in the Windows process-tree
kill that can wedge a tenant's scraper slot until restart (suspected — needs a live Windows
failure to prove), and a handful of dead code, wrong comments, and test gaps.

**Deploy verdict for 2026-08-05: GO on code quality, with items 1–2 of the execution plan landed
first.** The honest caveat stands and cannot be reviewed away: nothing here has ever executed
against Postgres, and the three pending migrations plus five behaviour changes get their first
real run on deploy day. The non-code NO-GO items (DKIM, postal address, etc.) are outside this
review's scope and per HANDOFF remain undone.

## 2. Confirmed defects

### 2.1 Analytics: funnel counts and rates mix incompatible time windows — MEDIUM-LOW
`server/src/analytics/routes.ts:51,59` — `dmsSent` (and `callsBooked`/`trials`/`clients`) window
on `Lead.createdAt`, while `replies`/`opened`/`clicked`/`bounced` window on
`TrackingEvent.createdAt`, and `sent` windows on `CampaignRecipient.lastSentAt`.

Failure scenario: a lead imported 60 days ago and first emailed 3 days ago is **excluded** from
"Leads Contacted" in the 7-day view, while its reply event is **included**. With 3 old leads
contacted this week and 11 replies from them, the screen shows "Reply Rate — 11 of 3 contacted"
(366%). The card label says "Leads Contacted", which `createdAt` does not measure at all.

Proved by reading the route against the schema (`Lead.lastContacted` exists and is set by the
send path) — no DB needed; the arithmetic is visible in `components/AnalyticsView.tsx:81`. This
is the screen that was rewritten specifically so that "a metric that looks precise and is not"
never renders again; the denominators are real but measure the wrong thing.

### 2.2 Pulse: `PULSE_BURST_MS >= PULSE_IDLE_POLL_MS` silently disables idling — MEDIUM
`server/src/scheduler/pulse.ts:52-54,105-118` — no validation relates the three env knobs.
If the burst is as long as (or longer than) the idle interval, a new burst opens the moment the
old one closes: `now >= burstUntil` implies `now >= nextIdleWakeAt`, so `mayPoll` never returns
false and the compute never sleeps.

**Verified by simulation** (driving a verbatim copy of `pulse.ts` with a virtual clock, scratchpad
`pulse-sim/`): with `BURST_MS=120000, IDLE_POLL_MS=60000`, all five pollers ran at full cadence
for 14 simulated idle days — 10,135 follow-up ticks instead of ~672. That is a silent, total
reversal of the outage fix, produced by exactly the tuning HANDOFF invites ("raise
`PULSE_IDLE_POLL_MS` — it is an env var, free, no code change" — an operator who instead *lowers*
it below 90s, or raises `PULSE_BURST_MS`, re-creates the outage while believing themselves safe).
Secondary (soft) hazard: `BURST_MS` under ~3s pushes the burst below the 1s-floored `GATE_TICK_MS`
and degrades fairness under timer jitter — degradation only, not starvation, because a still-due
poller opens the next burst itself.

### 2.3 Invoice send: the double-click loser responds with a stale DRAFT row — LOW (latent)
`server/src/invoices/routes.ts:220-221` — on a *concurrent* double-send, the loser's earlier
`findUnique` saw `DRAFT`, its `updateMany` claim matches 0 rows, `isFirstSend` is false, and the
route responds `{ invoice }` with `status: 'DRAFT', sentAt: null` — asserting un-sent for an
invoice that was just sent. Latent today only because the sole caller
(`components/ClientPortalView.tsx:857`) discards the body and refetches; any future consumer of
the response resurrects the "Send button reappears after send" bug this commit fixed. The comment
at line 216 claims the response "keeps the shape the previous `update()` returned" — for the
loser path it does not (stale `status`/`sentAt`/`updatedAt`).

### 2.4 Portal-user revoke is not immediate for access tokens — LOW (doc/design)
`server/src/clients/routes.ts:156-159` claims revoke makes "every outstanding portal session
(access + refresh) ... stop verifying immediately". `requireClientAuth`
(`server/src/auth/clientMiddleware.ts:45-82`) checks `Client.status` but never `tokenVersion`,
and client access tokens carry no `ver` claim (`clientJwt.ts:17-24`). A revoked portal user keeps
full portal access until their access token expires — `JWT_ACCESS_TTL`, default 15m
(`config.ts:35`). Acceptable design; false comment. (Related false comment: `clientMiddleware.ts:41-43`
says an archived client "gets a clean 403 from login" — login *succeeds* for archived clients,
since the auth routes never check `Client.status`; only the data routes 403. No data exposure.)

### 2.5 Dead code — the exact "value nothing reads" class — LOW
- `server/src/portal/auth.ts:52` — `refreshSchema` is unread since refresh went cookie-only.
- `server/src/portal/routes.ts:311` — `const updated = await prisma.invoice.updateMany(...)`;
  `updated` is never inspected (benign: the CAS makes the race a no-op, but the pattern is the
  one this repo has been burned by four times).

## 3. Suspected but unproven

### 3.1 taskkill failure wedges a tenant in 'cancelling' forever — would settle on Windows
`server/src/scraper/service.ts:708-723` — `killProcessTree` handles the killer's `error` event
(spawn failure, e.g. taskkill not on PATH) but **not a non-zero exit** (`close` with code 1 =
access denied / partial failure). If taskkill runs and fails while the child stays alive, nothing
retries, nothing escalates, and there is no deadline: the job stays `cancelling`, `activeJobFor`
holds the tenant's slot, `activeChildCount` holds a global slot, and repeated Stop clicks return
`true` without re-signalling (`cancelJob:741`). Recovery requires a backend restart.
To settle: on Windows, run a job, make taskkill fail (ACL or race), observe the wedge. The
*benign* race the brief asked about — child exits between the status flip and the kill — is
handled: taskkill on a dead pid exits non-zero, but the child's own `close` handler has already
finalized the job; verified by reading both handlers.

### 3.2 Reply-poller pagination lacks a stable tiebreaker
`server/src/unibox/replyPoller.ts:233` — `orderBy: { lastContacted: 'asc' }` with `skip`/`take`.
Postgres does not guarantee a stable order for equal keys, so leads sharing a `lastContacted`
timestamp (bulk sends) can shuffle between pages across ticks and a lead can be repeatedly
skipped. Cheap fix (add `id` tiebreak); proving the skip requires a live DB with tied timestamps.

### 3.3 `followupReplyGate.test.ts` order-dependence is latent
`server/src/__tests__/followupReplyGate.test.ts:124-128` — `beforeEach` restores
`sendSmtpMail`'s implementation but not `checkRecipientReply`'s; `vi.clearAllMocks()` does not.
Today every test sets it explicitly, so nothing leaks *yet* — the same shape that bit three times
on 2026-07-28.

## 4. Test-quality findings

- **The 50eb019 white-screen fix has no test.** Mutations that should fail a test and today fail
  none: (a) revert `statusMeta()` to direct `STATUS_META[status]` indexing
  (`components/ScraperView.tsx:63`); (b) remove `'cancelling'` from the poll-continuation
  condition (`ScraperView.tsx:299`) or from `isRunning` (`:393`); (c) remove `'cancelling'` from
  the client `JobStatus` union (`services/scraperApi.ts:16`) — `tsc` stays green (the `Record`
  merely loses a key) and both suites pass. This is the *third* client/server shape bug in two
  days and the only one of the three with no regression net.
- **`killProcessTree` failure path untested** — mock the killer child emitting `close` with code 1
  and today no assertion notices (see 3.1).
- The pulse suites (`pulse.test.ts`, `autoScraperPulse.test.ts`) are **genuine**: the 10s anchor
  poller and boot-phase sweep reproduce the mechanism (my independent simulation agrees with
  their expectations), and the earlier vacuity lessons (lone probe, relative phase) are addressed
  in code, not just comments.
- Frontend suites use `mockReset` (implementation-resetting) — clean. `analyticsView.test.tsx`
  asserts the *absence* of the previously invented numbers, which is the right shape.

## 5. Verified as correct (how, briefly)

- **Pulse gate / `startGatedPoller`** — simulated 14 idle days against a verbatim copy of
  `pulse.ts` at 7 boot phases and 4 configs: every poller (10s → 15min) served in every ~30min
  window (max gap 0.5–0.67h vs 336h pre-fix). Due-check-before-`mayPoll` ordering, one-turn-per-
  burst, `runImmediately`, and overlap suppression all behave as documented. A poller cannot be
  served twice in one burst (`servedThisBurst` only clears when a burst opens; while a burst is
  open the open-branch is unreachable).
- **Migration `20260728080000_revision_round_unique`** — hand-executed the CTE chain on
  duplicate-bearing, multi-group, and clean datasets: renumbers land collision-free above the
  per-project max (shift is per-project ROW_NUMBER over dup_rank>1 rows), earliest duplicate
  keeps its number, no-op on clean data, idempotent, CTE snapshot semantics sound.
- **Invoice money paths** — send: atomic DRAFT→SENT claim gates both the email and the activity
  entry; mark-paid: CAS inside `$transaction` with `withUniqueRetry` correctly *outside* the
  transaction; `Receipt`/`Invoice` `@@unique([userId, number])` present in schema.
- **Portal backend authz** (first complete review): `tenantDb` extension AND-merges `userId` into
  every where (incl. extended-where-unique sibling merge, create stamping, re-homing guard);
  every `portal/routes.ts` query filters `clientId + userId`; child rows (Revision/Message/
  FileLink) are only reachable through an owned parent; invite cannot re-home across clients or
  tenants (`userId_email` per-agency unique); revoke resolves through the owning client; magic-link
  tokens are hashed-at-rest, single-use via CAS, per-account TTLs; refresh is cookie-only with
  rotation + reuse-detection + family revocation; ambiguous cross-agency password logins refuse
  rather than guess; portal SPA is mounted before the CRM catch-all; `/api/portal` is gated by
  `requireClientAuth` with aud separation, `/api/portal/auth` rate-limited. No client-A→agency-B
  read or mutation found. Money display: outstanding nets off payments; the mark-paid
  partial-payment limitation is known and documented in-code.
- **`interleaveByTenant`** terminates and conserves campaigns: each campaign occupies exactly one
  (tenant, round) slot; by round = max bucket size all are emitted; no duplicates.
- **`selectLeadsForTick` cursor arithmetic** (the dead review's headline doubt): the wrap-around
  advance `(cursor + leads.length) % total` is exactly right — traced total=5/cursor=4/take=3
  (lands on 2, one past the front rows consumed) and the degenerate total<take case. Stale
  `total` from concurrent status changes self-corrects next tick via the `% total`.
- **`normalizeSubject`** — over-stripping is applied symmetrically to both compare sides, so the
  bare-`r` prefix cannot create a realistic false thread match; the fallback additionally only
  runs when In-Reply-To/References both failed and declines when no thread subject exists.
- **AnalyticsView ↔ server shape** — field-for-field match (9 fields), verified against
  `analytics/routes.ts:72`. **ScraperView ↔ server** — client `JobStatus` union now matches
  `service.ts:42` including `cancelling`; `statusMeta()` degrades unknown statuses.
  **CampaignsListView `pausedReason`** exists server-side and in `types.ts`. **Unibox/Dashboard
  fixes** are real: `sendReplyToThread` goes through `apiPost` (throws on non-2xx; the server
  route returns real HTTP errors and deliberately does not fail a sent reply on a post-send
  bookkeeping error), and DashboardView now inspects the `sendFollowUp` result.
- **Scraper claim/eviction** — `claimJobSlot` is fully synchronous (no interleaving window);
  `abandonClaim` restores both the map and the slot on prep failure; `sweepFinishedJobs` never
  evicts in-flight (incl. `cancelling`) jobs and sweeps after registration so the cap is honest;
  `startAutoJob`/`autoScheduler` stale-run recovery checks `activeJobFor` before reclaiming.
- **`threadSubject`** is actually passed at `server/src/index.ts:494` (the previously-unread
  value is now read); `verify.yml` reasoning is sound (Prisma client sync into `server/`, the
  `MAILBOX_ENCRYPTION_KEY` stub) though the workflow has still never been observed running.

## 6. Could not determine

- Anything requiring live Postgres: the migration against real (possibly duplicate-bearing) data,
  Prisma extended-where-unique runtime behaviour, pagination stability (3.2), the three pending
  migrations' interaction, real Neon compute consumption of the new duty cycle.
- Whether `taskkill` behaves as assumed on the production VM (3.1), and whether the two untracked
  prod files (`install-deps.bat`, `uninstall-deps.bat`) matter.
- IMAP realities: provider `SINCE` semantics, ImapFlow `bodyStructure` shapes in the wild.
- `verify.yml` has never been observed running (`gh` not installed here).
- The unbounded reply-check defer (known, needs a schema field — carried, not re-reported).

## 7. EXECUTION PLAN (for Opus 5)

Rules for every task: work ONLY in `C:\Users\banjigum1\Documents\YSXXS\YSXXS`. Never touch
`C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS`. After each task run `npx tsc -p . --noEmit` and
`npx vitest run` in `server/`, and `npx tsc --noEmit` + `npm test` at the root. Do not commit.

### Must land before the 2026-08-05 deploy

**T1. Fix the analytics time-window mismatch.** `server/src/analytics/routes.ts`.
Change the `dmsSent` count to window on when the lead was *contacted*, not created:
`where: { status: { in: ACTIVE_STATUSES }, ...(since ? { lastContacted: { gte: since } } : {}) }`.
Leave `callsBooked`/`trials`/`clients` on `createdAt` (they measure cohort outcomes, and no
per-transition timestamp exists — note this in a comment) or, if you judge consistency worth it,
window them on `updatedAt`; state your choice in the code comment. Update
`server/src/__tests__/analyticsSummary.test.ts`: add a test seeding a lead with `createdAt` 60
days back and `lastContacted` 2 days back, asserting it IS counted in a 7-day window (assert on
the `where` clause the mock receives, or on the summed result if the mock supports filtering).
Mutation that must break the new test: reverting the field to `createdAt`.

**T2. Validate the pulse env knobs.** `server/src/scheduler/pulse.ts`.
At module load, after computing the three constants: if `BURST_MS >= IDLE_POLL_MS`, log
`logger.error` naming both values and fall back to the DEFAULTS for both (do not try to be
clever); if `BURST_MS < 3 * 1_000` (i.e. below 3×GATE_TICK floor), warn and raise BURST_MS to
90_000. Implement by validating raw values before assigning the exported constants. Add tests in
`pulse.test.ts` using `vi.resetModules()` + `vi.stubEnv` to import the module under a bad config
and assert (a) the fallback values are in effect via behaviour (a poll after `IDLE_POLL_MS` of
idle is refused between bursts — i.e. the system still sleeps) and (b) the error was logged.
Mutation that must break it: deleting the validation (the bad-config test then observes
`mayPoll` always-true).

**T3. Handle taskkill failure and add a cancel escalation.** `server/src/scraper/service.ts`,
`killProcessTree` / `cancelJob`.
(a) In the win32 branch, listen for the killer's `close` event: on a non-zero exit code, log at
error level with the code, and fall back to `child.kill('SIGKILL')` (same as the existing
`error`-event fallback — factor it into a small helper).
(b) In `cancelJob`, after `killProcessTree`, start an unref'd timer (`CANCEL_ESCALATION_MS`,
default 60s, env-overridable): if the job is still `cancelling` when it fires and `procs` still
holds the child, call `killProcessTree` again and log a warning. Do NOT free the slot or force
the status — the slot must stay held while the child may be alive; the close handler remains the
only finalizer. Clear the timer inside the `close` handler.
Tests in `scraperConcurrency.test.ts` (the spawn mock already exists): (1) killer closes with
code 1 → the direct `kill` fallback fires; (2) with fake timers, a job still `cancelling` after
60s gets a second `killProcessTree` and remains `cancelling` (slot still held — assert a new
`startJob` for the tenant still 409s). Mutation that must break them: removing the `close`
listener / removing the escalation timer.

**T4. Regression tests for the ScraperView 'cancelling' contract.** New file
`test/scraperView.test.tsx` (jsdom, same harness as `analyticsView.test.tsx`; mock the
`services/apiClient` fetches ScraperView uses).
Assert: (a) rendering a job list containing `status: 'cancelling'` renders "Stopping…" and does
not crash; (b) a job with a status string the client has never heard of (e.g. `'zombified'`)
renders the degraded label rather than a blank page; (c) while status is `'cancelling'`, the
Start control stays disabled/spinner active (`isRunning` semantics). Keep the tests at the
render level — they exist to catch the server adding a status the client does not know.
Mutation that must break them: reverting `statusMeta()` to direct `STATUS_META[status]` indexing,
or dropping `'cancelling'` from the poll/isRunning conditions.

### Should follow (post-deploy is acceptable)

**T5. Fix the invoice-send loser response.** `server/src/invoices/routes.ts:221`.
When `!isFirstSend` and `invoiceRow.status === 'DRAFT'` (i.e. we lost a concurrent claim), respond
with `{ ...invoiceRow, status: 'SENT' as const, sentAt }` — the claim loser knows the winner just
sent it. Extend the existing send tests: two concurrent sends → both responses carry
`status: 'SENT'`, exactly one email. Mutation: removing the patch → loser test sees DRAFT.

**T6. Add the pagination tiebreaker.** `server/src/unibox/replyPoller.ts:233` and the wrap-around
query at `:242`: `orderBy: [{ lastContacted: 'asc' }, { id: 'asc' }]`. Update
`replyPollerFairness.test.ts` only if its mock asserts on `orderBy`. (Mutation coverage is not
achievable against a mock that sorts deterministically anyway — say so in the test comment
rather than writing a vacuous assertion.)

**T7. Hygiene sweep.**
- Delete `refreshSchema` (`server/src/portal/auth.ts:52`).
- `server/src/portal/routes.ts:311`: drop the unused `const updated =` binding (keep the call).
- Correct the revoke comment (`server/src/clients/routes.ts:156-159`): sessions stop refreshing
  immediately; access tokens survive up to `JWT_ACCESS_TTL` (15m).
- Correct `clientMiddleware.ts:41-43`: archived clients can still log in; they are denied at the
  data routes.
- `followupReplyGate.test.ts` `beforeEach`: add
  `mocks.checkRecipientReply.mockReset()` plus an explicit safe default
  (`mockResolvedValue('unknown')`) so a leaked implementation can never satisfy a later test.

### Explicitly NOT to do
- Do not "fix" `clearAuth()` wiping stored settings (intentional, prevents a cross-tenant
  credential leak — see known-failures.md).
- Do not add a `tokenVersion` DB check to `requireClientAuth` without being asked: it doubles the
  middleware's DB cost per request on a compute-billed database for a 15-minute exposure window.
- Do not touch the migration SQL — it verifies correct as written.
- Do not commit or push anything.

## 8. Closing state (planner's own runs, pre-implementation)

- `git status`: clean before implementation began (only this report added).
- server `npx tsc -p . --noEmit`: clean. server `npx vitest run`: **316/316**.
- root `npx tsc --noEmit`: clean. root `npm test`: **14/14**.
