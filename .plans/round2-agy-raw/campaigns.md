### Duplicate Email Double-Send on Post-Delivery Exception in Worker
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/campaigns/worker.ts:386
WHAT: Post-delivery database or scheduling exceptions cause sent emails to be re-queued and sent again.
SCENARIO: `dispatchRecipient` sends an initial campaign email via `sendFromMailbox`. Immediately after the SMTP send succeeds, a subsequent step in `dispatchRecipient` (e.g. `scheduleFollowup`, `lead.update`, or `campaignRecipient.update`) throws an unhandled exception or DB error. `processCampaign` catches the error, treats it as a failed send attempt, and resets `recipient.status` back to `PENDING` with a 5-minute retry delay (`nextSendAt`). On the next tick 5 minutes later, `dispatchRecipient` is called again and `sendFromMailbox` transmits a duplicate email to the recipient.
FIX: Catch post-send errors inside `dispatchRecipient` and update `recipient.status` to `COMPLETED` / `IN_SEQUENCE` immediately after `sendFromMailbox` succeeds so post-delivery failures log an error without reverting the recipient to `PENDING`.

### Premature Campaign Completion Flips Campaign to COMPLETED While Recipients Are Still IN_SEQUENCE
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/campaigns/worker.ts:483
WHAT: `processCampaign` counts active `IN_SEQUENCE` recipients as terminal progress, setting `Campaign.status` to `COMPLETED` prematurely.
SCENARIO: A campaign is created with 1 initial email and 3 follow-up steps. The worker dispatches the initial email to all recipients and updates their statuses to `IN_SEQUENCE`. At the end of the tick, `processCampaign` calculates `openCount` (`PENDING` + `SENDING`) as `0` and `terminalCount` (`IN_SEQUENCE` + `COMPLETED` + `REPLIED` + `FAILED` + `SKIPPED`) as 100%. It updates the campaign to `status: COMPLETED` and `progress: 100`. Because the campaign is marked `COMPLETED`, `processCampaign` will no longer process it on subsequent ticks.
FIX: Exclude `RecipientStatus.IN_SEQUENCE` from `terminalCount` and include it in `openCount` (or check for active `IN_SEQUENCE` recipients / pending `FollowupJob` rows before setting campaign status to `COMPLETED`).

### HTML Link Tracking Rewriting Corrupts Escaped Query Parameters in Target URLs
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: server/src/campaigns/trackedHtml.ts:73
WHAT: HTML escaping is performed before link tracking URL rewriting, encoding `&` as `&amp;` inside target URLs and corrupting redirect destinations.
SCENARIO: An email body contains a URL with multiple query parameters: `https://example.com/landing?utm_source=cold&utm_medium=email`. In `buildTrackedEmail`, `escapeHtml(input.body)` runs first, changing the URL to `https://example.com/landing?utm_source=cold&amp;utm_medium=email`. Next, `linkTracking` matches the string and passes the `&amp;`-containing URL to `clickUrl`, which signs and encodes it into the tracking token. When the recipient clicks the link, `trackingRoutes.ts` redirects the browser to `https://example.com/landing?utm_source=cold&amp;utm_medium=email`. The target Web server receives parameter name `amp;utm_medium` instead of `utm_medium`, breaking analytics and parameter parsing.
FIX: Match and rewrite raw URLs in `input.body` before applying `escapeHtml`, or unescape HTML entities in URLs before signing and constructing the tracking link.

### Partial Send Window Configuration Causes isWithinSendWindow to Ignore Configured Start/End Hours
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: server/src/campaigns/engine.ts:79
WHAT: `isWithinSendWindow` returns `true` (unrestricted) if only one of `sendWindowStart` or `sendWindowEnd` is configured.
SCENARIO: A tenant configures a campaign with `sendWindowStart = 540` (9:00 AM) and leaves `sendWindowEnd` null. `routes.ts` accepts this payload because both schema fields are independently optional. When `isWithinSendWindow` evaluates the campaign at 2:00 AM, `campaign.sendWindowStart != null && campaign.sendWindowEnd != null` evaluates to `false`. The function skips the window check entirely and returns `true`. The worker sends campaign emails at 2:00 AM, violating the tenant's configured start window.
FIX: Support single-sided window bounds in `isWithinSendWindow` (e.g. check `minutesOfDay >= start` when `end` is null), and/or enforce in `createSchema`/`updateSchema` that `sendWindowStart` and `sendWindowEnd` must be set together.

### Pausing a Campaign Permanently Cancels and Destroys All Scheduled Follow-ups
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/campaigns/routes.ts:305
WHAT: Pausing a campaign permanently cancels all pending follow-up jobs with no recovery mechanism when unpaused.
SCENARIO: A campaign with initial sends and 2 follow-up steps is running. Initial sends complete, and 100 follow-up jobs are queued in `FollowupJob` as `SCHEDULED`. The tenant pauses the campaign (`PATCH /api/campaigns/:id` with `status: "PAUSED"`). `routes.ts` calls `cancelScheduledFollowupsForCampaign`, updating all 100 jobs in `FollowupJob` to `status: CANCELLED`. Later, the tenant unpauses the campaign (`status: "ACTIVE"`). `routes.ts` updates `Campaign.status` to `ACTIVE`, but the cancelled `FollowupJob` rows are never un-cancelled or re-created, and `worker.ts` only handles initial sends. All pending follow-up emails for recipients in sequence are permanently lost.
FIX: Do not set follow-up jobs to `CANCELLED` when a campaign is paused; instead, check `Campaign.status` in `followupScheduler.ts` before dispatching, or un-cancel / reschedule follow-up jobs when campaign status transitions from `PAUSED` to `ACTIVE`.

## CHECKED AND SOUND
- HMAC Token Verification & Constant-Time Comparison (server/src/campaigns/trackingToken.ts:84,110): Constant-time byte comparisons (`timingSafeEqual`) prevent timing attacks on token signature validation. Domain separation (`CLICK_DOMAIN`) prevents cross-type token reuse between click links and unsubscribe/pixel tokens.
- Open Tracking Pixel Route (server/src/campaigns/trackingRoutes.ts:34-70): Unauthenticated pixel endpoint (`/t/o/:token`) correctly returns a transparent 1x1 GIF regardless of error state to prevent pixel breakage, deduplicates open events within a 5-minute window (`OPEN_DEDUPE_WINDOW_MS`), and respects campaign `stopOnOpen` options.
- GET Unsubscribe Safety (server/src/campaigns/trackingRoutes.ts:202-217): `GET /t/u/:token` renders a confirmation form without mutating database state, preventing automated email scanner prefetches (such as Defender Safe Links or Proofpoint) from unsubscribing leads. Mutation only occurs on `POST /t/u/:token`.
- Campaign Recipient Claim Lock (server/src/campaigns/worker.ts:337-341): Atomic compare-and-set (`updateMany` from `PENDING` -> `SENDING`) ensures concurrent worker ticks or multiple worker instances cannot claim the same recipient simultaneously.
- Follow-up Job Recovery (server/src/scheduler/followupScheduler.ts:292-313 & server/src/campaigns/worker.ts:521-544): Stale job/recipient detection automatically recovers stranded `SENDING` rows back to `SCHEDULED`/`PENDING` if a process crashes mid-dispatch.
- Multi-tenant Scoping on Campaign Routes (server/src/campaigns/routes.ts:199,208,220,266,322,347,399,446): All campaign CRUD endpoints use `tenantDb(requireUserId(req))` or explicitly query by `userId` to enforce tenant isolation.
MODEL_USED=gemini-3.1-pro-high VIA=file
