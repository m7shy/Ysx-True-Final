# Round 2 (agy) + cross-round synthesis — 2026-07-26

Round 2 was delegated to `agy`, reviewing the same code as round 1 independently. Raw,
unedited worker output is preserved in `.plans/round2-agy-raw/` — **that directory is a
worker artifact, not a verified finding list.** This file is the verified view.

## Coverage — 6 of 10 units delivered

| Unit | Result |
|---|---|
| campaigns, core, schema, frontend_core, portal_spa, scraper_py | delivered (`gemini-3.1-pro-high`) |
| **auth**, **portal**, **mail**, **frontend_views** | **no deliverable** |

`auth`, `portal`, `frontend_views` hit the silent rc=0 no-op (narration, exit 0, empty
stderr, no output via file *or* the delimited-stdout fallback). `mail` hit a genuine
transient (`high traffic`). Retried separately.

**The gap matters and is stated plainly: `auth` is exactly where round 1 found its
highest-severity issue (R1-01/R1-02), so those findings have NO independent second
opinion.** Same for the portal backend and the 13k-line component tree.

## Verification status

29 findings were returned, 12 self-rated HIGH/HIGH-confidence. Per skill §5.18 a sample was
checked against source before relaying — a prior delegated review in this repo produced ~100
findings of which two were confidently wrong. That rate held again here.

### CONFIRMED — verified against source, real

**S-01 · `ClientUser.email` is globally `@unique` across all tenants** — `prisma/schema.prisma:668`
Verified: the field carries a bare `@unique`, not `@@unique([userId, email])`. Two different
agencies cannot both have a client contact with the same email address; the second tenant's
invite fails permanently with an opaque constraint error. **This is the identical bug class
to the `Receipt.number` issue fixed earlier today** — a per-tenant identifier constrained
globally. Round 1 missed it; this is round 2 earning its cost.

**S-02 · `CookieFile.name` is globally `@unique` across all tenants** — `prisma/schema.prisma:885`
Verified. One tenant uploading `cookies.txt` permanently blocks every other tenant from using
that filename — a cross-tenant conflict and a trivial griefing vector. Note the model's own
comment documents `userId` as nullable and additive for legacy rows, so the tenant scoping was
clearly intended but the constraint was never updated to match.

**S-03 · Pausing a campaign permanently destroys its scheduled follow-ups** — `server/src/campaigns/routes.ts:305`
Verified: pause calls `cancelScheduledFollowupsForCampaign(existing.id, 'campaign_paused')`,
which **cancels** rather than suspends, and resume has no restore path. A user pausing a
campaign for an hour silently loses every queued follow-up in the sequence.

This is a direct, unintended consequence of the 2026-07-25 fix that made pause actually stop
follow-ups (they previously kept sending for days). That fix was correct about the leak and
wrong about the mechanism. **Neither the session that wrote it nor round 1 caught this** —
the strongest single argument for having run a second round.

**S-04 · Setting `HEALTH_TOKEN` removes admin-session access to `/api/health/deep`** — `server/src/index.ts:126`
Verified: `if (!expected) return requireAuth(req, res, next);` — the `requireAuth` fallback
applies **only when the token is unset**. Once set, a logged-in admin can no longer reach the
endpoint from the UI; only the token works. **This is live right now** — I set `HEALTH_TOKEN`
in prod earlier today, so this behaviour changed in production this session. Not a
vulnerability, but a real operational regression worth knowing about.

**S-05 · The OAuth router is mounted without `requireActiveTenant`** — `server/src/index.ts:150`
Verified. `app.use('/api/auth/oauth', oauthRouter)` carries no tenant gate, so an `UNPAID` or
`INACTIVE` tenant can still connect and replace mailboxes while every other mutating router
blocks them. Matches round 1's R1-08 (same class, different route) — **an independent
agreement across both rounds, which raises confidence in both.**

### REFUTED — checked and wrong

**Cross-tenant credential leak via `localStorage`** — claimed HIGH/HIGH at `context/SettingsContext.tsx:66`
**Wrong.** The `onSessionCleared` subscription that clears `ysxflow_settings` on logout is
present at lines 74–75 **of the same file** — it is the 2026-07-25 fix for exactly this bug.
The worker read line 66 and did not read 8 lines further down. Relaying this would have sent
someone to re-fix a bug that was already fixed.

**Stored XSS via unsanitized file-link URLs** — claimed HIGH/HIGH at `portal/pages/ProjectPage.tsx:191`
**Materially overstated.** The render is unsanitized, which is true and is round 1's R1-10.
But the worker did not check the write path: `server/src/projects/routes.ts:47-66` restricts
the stored scheme to `http:`/`https:` via a Zod `.refine()`, and prod has **0 `fileLink`
rows**. Real as defence-in-depth, **LOW** not HIGH, and not currently exploitable.

### PLAUSIBLE — real mechanism, severity not confirmed

**Duplicate send when a DB write fails after SMTP success** — `server/src/campaigns/worker.ts:386`
The mechanism is real: `dispatchRecipient()` sends first and writes recipient status last, and
the catch path releases the claim back to `PENDING` (`worker.ts:473`) for a retry. So an
exception *between* a successful SMTP handoff and the status write means the same email sends
again next tick. I did not trace every branch of the catch to confirm which statuses it
resets, so I am not asserting the HIGH rating. Worth a careful read — duplicate cold email to
a prospect is a real reputational cost.

**Campaign flips to `COMPLETED` while recipients are `IN_SEQUENCE`** — `worker.ts:483`
Verified that `openCount` counts only `PENDING`/`SENDING`, while `IN_SEQUENCE` is counted as
*terminal*. Whether that is wrong depends on whether `COMPLETED` is meant to mean "initial
sends done" (defensible) or "sequence finished". It becomes a genuine bug only if any code
path cancels follow-ups on `COMPLETED` the way pause does (**S-03**) — not traced. Flagging
the interaction rather than the finding.

### NOT VERIFIED
The remaining ~20 findings (scraper Python multi-tenant file handling, SQLite connection
handling, portal SPA sign-out and StrictMode double-consumption, `apiClient` refresh race,
missing indexes on `ClientUser.userId` / `FollowupJob.nextRetryAt`, `Revision` round-number
uniqueness, send-window partial config) were **not individually checked against source**.
Several look plausible and cheap to confirm. They are recorded in `.plans/round2-agy-raw/`
and must be verified before anyone acts on them.

## What the two-round design actually bought

- **Round 2 found what round 1 missed:** the two global-unique multi-tenancy bugs (S-01, S-02)
  and the destructive-pause regression (S-03). Round 1 read `schema.prisma` for *missing*
  tenant keys and never asked the inverse question — which constraints are scoped too widely.
- **Round 1 found what round 2 missed:** the OAuth session-binding hole (R1-01/R1-02), the
  single highest-severity finding of either round. Though note round 2's `auth` unit never
  ran, so this is a coverage gap, not a genuine miss.
- **Both independently flagged the same class** of ungated-router issue (R1-08 / S-05).
- **Round 1 pre-empted two of round 2's false positives.** Having already established that
  `fileLink` has 0 rows and that the `localStorage` fix is present, both overstatements were
  disproved in minutes instead of becoming work items.

The cross-check is the deliverable. A single-pass review would have shipped the two wrong
HIGHs alongside the real ones with nothing to distinguish them.
