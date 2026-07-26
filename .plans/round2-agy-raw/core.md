### Standalone Follow-up Jobs Infinite Retry Loop on Recipient Reply
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/index.ts:343
WHAT: Standalone follow-up jobs (jobs where `job.campaignId` is null/undefined) are never cancelled when a recipient reply is detected because `cancelFollowup` is guarded inside an `if (campaignId && normalizedRecipient)` block.
SCENARIO:
1. A standalone follow-up job (with `skipIfReplied: true` and `campaignId: null`) is scheduled for recipient `prospect@example.com`.
2. The recipient replies to the email.
3. `sendFollowupJob` executes on the scheduler tick (line 297) and detects the reply (`hasRecipientReplied` returns `true` on line 337).
4. Because `campaignId` is `undefined`, the check `if (campaignId && normalizedRecipient)` on line 343 evaluates to `false`, bypassing `await cancelFollowup(String(job.id), 'replied')`.
5. The job status in Postgres remains `SCHEDULED`.
6. On every subsequent scheduler tick (every 10s by default via `FOLLOWUP_TICK_MS`), the scheduler re-fetches the job, re-verifies reply status, logs "Skipping followup send", and leaves the job in `SCHEDULED` status forever, causing infinite database load and log spam.
FIX: Move `await cancelFollowup(String(job.id), 'replied');` outside the `if (campaignId && normalizedRecipient)` block so that `job.id` is always marked as cancelled upon detecting a reply, regardless of whether `campaignId` is set.

### Scraper Async Race Condition Spawns Overlapping Child Processes
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/scraper/service.ts:393
WHAT: `startJob` (line 385) and `startAutoJob` (line 489) check `activeJobFor(userId)` before performing asynchronous setup tasks (`fs.mkdir`, `materializeCookiePool`, `writeProfileSettings`), but only register the running job into the global `jobs` map at lines 433/525.
SCENARIO:
1. An automated script or user submits two concurrent `POST /api/scraper/jobs` requests for tenant `usr_123` at virtually the same millisecond.
2. Both requests execute `activeJobFor('usr_123')` simultaneously. Since neither request has inserted a `ScrapeJob` into the `jobs` Map yet, both requests pass the check.
3. Both requests execute `await materializeCookiePool(...)` and `await writeProfileSettings(...)`, yielding to the Node.js event loop.
4. Both requests reach lines 433/525 and spawn parallel Python `main.py` processes targeting the exact same niche workspace (`profiles/crm-usr_123`).
5. The two Python child processes run simultaneously in the same directory, corrupting `leads.csv` and `keywords.txt`, locking the shared SQLite `tracking.db`, and making duplicate YouTube scraper requests.
FIX: Synchronously create and insert an initial `ScrapeJob` (or in-flight tenant lock) into `jobs` before executing any async operations, ensuring subsequent calls immediately detect `activeJobFor(userId)`.

### Unpaid/Inactive Tenants Can Modify Mailboxes via Un-gated OAuth Flow
SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/index.ts:150
WHAT: `oauthRouter` is mounted at `/api/auth/oauth` without the `requireActiveTenant` middleware, allowing tenants with `UNPAID` or `INACTIVE` account status to connect, update, and persist mailboxes in Postgres.
SCENARIO:
1. A tenant's subscription expires, setting `User.status = AccountStatus.UNPAID`.
2. `requireActiveTenant` successfully blocks the tenant from mutating campaigns, leads, or mail routes (`/api/mail`, `/api/campaigns`, etc.).
3. However, the user navigates to `/api/auth/oauth/gmail/start` and completes the browser OAuth flow back to `/api/auth/oauth/gmail/callback`.
4. Because `/api/auth/oauth` lacks `requireActiveTenant`, `oauthRoutes.ts` exchanges the authorization code and calls `upsertMailbox()`, writing new OAuth access/refresh tokens to the database despite the account being blocked from mutations.
FIX: Mount `requireActiveTenant` on `/api/auth/oauth` in `index.ts` (e.g. `app.use('/api/auth/oauth', requireAuth, requireActiveTenant, oauthRouter);` or apply `requireActiveTenant` inside `oauthRoutes.ts`).

### Database Host and Connection Details Leaked in Deep Health Payload
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: server/src/health/monitor.ts:83
WHAT: `runDeepChecks()` catches errors during the mailbox count lookup and formats `checks.mailboxes.detail` with `err.message` verbatim, exposing raw Prisma/Postgres connection error strings (which contain database hostname, port, database name, and username) in the HTTP response of `GET /api/health/deep`.
SCENARIO:
1. The Postgres connection drops or encounters an error during `prisma.mailbox.count()`.
2. `prisma.mailbox.count()` throws a `PrismaClientInitializationError` containing the database connection target (e.g., `Can't reach database server at ep-xyz.neon.tech:5432`).
3. Line 83 catches the error and sets `checks.mailboxes = { status: 'degraded', detail: 'lookup failed: ' + err.message }`.
4. An external requester polling `GET /api/health/deep` receives the unredacted infrastructure hostname, port, and username in cleartext in the JSON response payload.
FIX: Redact the error detail in `checks.mailboxes` to a generic message such as `'mailbox lookup failed'` (matching `checks.db`), and log the raw error object with `logger.error({ err })`.

### `HEALTH_TOKEN` Configuration Locks Out Authenticated Admin UI Sessions from Deep Health Diagnostics
SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: server/src/index.ts:126
WHAT: When `HEALTH_TOKEN` is configured, `healthTokenGuard` immediately rejects requests missing `x-health-token` or query `token` with a 401 error, failing to fall back to `requireAuth` as described in its design contract.
SCENARIO:
1. An administrator sets `HEALTH_TOKEN` in `.env` so an external uptime monitoring service can poll `/api/health/deep`.
2. A logged-in CRM admin opens the web application dashboard, which issues a request to `GET /api/health/deep` using their normal admin session JWT in `Authorization: Bearer <token>`.
3. `healthTokenGuard` sees that `HEALTH_TOKEN` is set, checks `req.get('x-health-token')` (which is empty), and immediately executes `res.status(401).json(...)`.
4. Legitimate admin sessions in the web application are rejected with 401 and cannot view deep health diagnostics whenever `HEALTH_TOKEN` is active.
FIX: In `healthTokenGuard`, if the token header/query is missing or invalid when `HEALTH_TOKEN` is set, call `requireAuth(req, res, next)` instead of returning 401 directly.

## CHECKED AND SOUND

The following components and paths were thoroughly reviewed and verified to be correct and secure:

1. **Prisma Tenant-Scoping Extension (`server/src/db/tenantDb.ts`)**:
   - Verified `scopeWhere` uses `AND` merging to prevent caller-supplied `userId` or `OR` conditions from widening query scope.
   - Verified `scopeUniqueWhere` uses top-level sibling merging so compound unique inputs match no rows if `userId` mismatches.
   - Verified `stampData` forcibly overrides `userId` on creations/upserts, preventing cross-tenant row injection.
   - Verified `update` and `updateMany` explicitly delete `userId` and `user` from mutation data payloads to prevent re-homing rows across tenants.

2. **Scraper Cookie & File Sanitation (`server/src/scraper/cookieService.ts`)**:
   - `sanitizeCookieName` strictly enforces `.txt` extension, strips path traversals via `path.basename`, and sanitizes non-alphanumeric stem characters.
   - `saveCookieFile` verifies `MAILBOX_ENCRYPTION_KEY` presence and encrypts cookie contents via AES-256-GCM before writing to Postgres.
   - `materializeCookiePool` isolates disk scratch materialization to the tenant's individual profile directory (`profiles/crm-<userId>/cookies`).

3. **Config Environment Parsing & Fingerprinting (`server/src/config.ts`)**:
   - `configSchema` uses Zod coercion and strict type validations.
   - `JWT_SECRET` fail-fast check enforces minimum length and blocks startup in production if missing.
   - `configReport()` uses SHA-256 truncation (`slice(0, 6)`) to generate safe fingerprints without leaking secret values in logs.

4. **Rate Limiting & Authentication Gates (`server/src/index.ts`)**:
   - Authentication rate limiters (`authLimiter`, `portalAuthLimiter`, `magicLinkLimiter`) enforce tight window bounds on sensitive login and magic-link endpoints.
   - Unauthenticated endpoints (`/t` tracking router and `/api/billing/webhook`) are appropriately isolated before global rate limiters and express.json parsers.
MODEL_USED=gemini-3.1-pro-high VIA=file
