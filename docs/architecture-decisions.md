# Architecture Decisions

> **Summary:** Phase 1 migrates YSX Flow from a stateless single-user proxy to a multi-tenant backend on PostgreSQL (Neon) via Prisma, with four models — User, Mailbox, Lead, Campaign — all tenant-scoped by `userId`.

---

## ADR-0001 — Phase 1 data layer: Prisma + Neon Postgres, four tenant-scoped models

**One-line:** Adopt Prisma ORM over a Neon-hosted Postgres database; every tenant-owned row is scoped to a `User` via a cascading `userId` relation.

**Status:** Accepted · 2026-07-06

### Context
The server (`server/`, `secure-mail-gateway`) was a stateless single-user Express proxy: credentials lived in an in-memory `Map` (`server/src/creds/store.ts`) and Microsoft OAuth tokens in a flat file (`server/data/tokens.json`). To support multiple tenants and unlimited rotating mailboxes, state must move into a real database.

### Decision
- **ORM/DB:** Prisma ORM + PostgreSQL on Neon.
- **Schema location:** `server/prisma/schema.prisma` — **not** the repo root. The backend lives in `server/`, and that is where the Prisma deps (`@prisma/client`, `prisma`), the client singleton, and the npm scripts live, so the `prisma` CLI resolves the schema by default when run from `server/`. The root `package.json` is the Vite/React frontend and must stay free of DB concerns.
- **Four models only:** `User`, `Mailbox`, `Lead`, `Campaign`. No extra tables — sequence steps stay a JSON array on `Campaign` rather than a fifth model.

### Database connection configuration (Neon)
Neon exposes two connection strings for the same database:

| Env var        | Neon connection            | Used by                        |
|----------------|----------------------------|--------------------------------|
| `DATABASE_URL` | **pooled** (PgBouncer; host contains `-pooler`), append `?sslmode=require&pgbouncer=true` | app runtime (`url`)      |
| `DIRECT_URL`   | **direct/unpooled**, `?sslmode=require` | `prisma migrate` / introspection (`directUrl`) |

Migrations cannot run through PgBouncer, hence the separate `directUrl`. Both are documented in `server/.env.example` and declared (optional) in the validated env config `server/src/config.ts`. Prisma reads them from the `datasource db` block in the schema.

### Key modeling decisions
- **Tenant isolation:** `Mailbox`, `Lead`, `Campaign` each carry a non-null `userId` with an explicit `@relation(..., onDelete: Cascade)`. Deleting a `User` atomically removes all owned rows; nothing dangles cross-tenant.
- **Per-tenant uniqueness, not global:** `@@unique([userId, email])` on `Mailbox` and `Lead`. The same inbox/prospect address may legitimately belong to two different tenants; a global `@unique` would both block valid inserts and leak row existence across tenants. `User.email` is the **only** intentional global `@unique` — it is the login identity (the tenant itself), not tenant-owned data.
- **OAuth token record (`Mailbox`)** mirrors the real persisted shape 1:1 (`accessToken`, `refreshToken`, `scope`, `tokenType @default("Bearer")`, `tenant`, `obtainedAt`, `expiresAt`). The legacy ms-epoch `obtainedAt`/`expiresAt` are modeled as `DateTime` (timestamptz) so the rotation/refresh engine can compare and order in SQL; the app converts on read/write and keeps the 5-minute refresh buffer in code. `tenant` is nullable (MS GUID/`common`; null for Gmail).
- **Provider enum:** `MailboxProvider { GMAIL, MICROSOFT }` only (Zoho dropped per requirement); both are OAuth2 going forward.
- **Daily send counters are scalar columns:** `dailyLimit`, `sentToday`, `counterDate @db.Date`, `lastSentAt` — so the rotation engine filters/orders/aggregates healthy under-limit mailboxes directly in SQL. `dailyLimit` defaults to `0` (a new mailbox sends nothing until explicitly warmed). **Counter reset is app logic** (stale `counterDate` < current UTC day ⇒ treat `sentToday` as 0); it is not enforced by the schema.
- **Campaign stats are flat scalar columns** (`sentCount`, `clickedCount`, `repliedCount`, `opportunitiesCount`) so dashboards can `SUM`/`ORDER` in SQL.
- **JSON reserved for genuinely nested/variable blobs** never field-filtered in SQL: `User.signatures`, `User.settings`, `Lead.intelligence`, `Campaign.sequence`, `Campaign.autoFollowUps`. `Lead.score` stays scalar (`Int?`) because leads are prioritized/sorted by it.
- **JWT session tracking** kept minimal on `User` via `tokenVersion` (bump to invalidate all issued JWTs — logout-everywhere / password reset) + `lastLoginAt`. No sessions table (stays within the 4-model cap).
- **Health gate for rotation:** a single `Mailbox.isActive` boolean pulls a mailbox from rotation without deleting it. Speculative `disabledAt`/`disabledReason` columns were dropped as premature.
- **Indexes** cover real query paths, tenant-scoped: `Mailbox @@index([userId, isActive])` (rotation pick) and `@@index([userId, expiresAt])` (lazy refresh-on-read, matching `microsoftOauth.ts`); `Lead @@index([userId, status])`, `@@index([userId, score])`; `Campaign @@index([userId, status])`, `@@index([userId, scheduledAt])`. The FK `userId` is covered by the leading column of each composite index.
- **cuid() ids** and `createdAt`/`updatedAt` on all four models.

### Toolchain pin — IMPORTANT
The schema uses the **classic `url` + `directUrl` datasource block**, which is Neon's documented Prisma setup and **valid on Prisma 6.x**. Prisma **7** removed `url`/`directUrl` from the datasource block in favor of `prisma.config.ts`, so this schema would fail `prisma validate` on 7.x. `server/package.json` therefore pins `prisma`/`@prisma/client` to `^6.2.0`. Run migrations with the local (pinned) binary via the npm scripts — not a global/`npx` latest Prisma.

### Validation evidence
`npx prisma@6 validate` (resolved 6.19.3) against `server/prisma/schema.prisma` with placeholder URLs: **"The schema … is valid 🚀"**. `prisma generate`/`migrate` were not run here (no live Neon `DATABASE_URL`; migrations need the real database).

### How to go live (next steps)
1. Create a Neon project; copy the pooled + direct URLs into `server/.env` as `DATABASE_URL` / `DIRECT_URL` (see `server/.env.example`).
2. `cd server && npm install` (installs Prisma; postinstall runs `prisma generate`).
3. `npm run prisma:migrate` to create the initial migration and tables.
4. Import `{ prisma }` from `src/db/prisma.ts` in route handlers.

### Connection-architecture files added
- `server/prisma/schema.prisma` — the schema above.
- `server/src/db/prisma.ts` — `PrismaClient` singleton (cached on `globalThis` in dev/test to avoid pool exhaustion under `tsx watch`).
- `server/src/config.ts` — `DATABASE_URL` / `DIRECT_URL` added (optional, so mail-only runs and tests don't require a DB).
- `server/package.json` — `@prisma/client` + `prisma` deps; `prisma:generate` / `prisma:migrate` / `prisma:deploy` / `prisma:studio` scripts.
- `server/.env.example` + root `.gitignore` (`!server/.env.example`) — committable Neon URL guidance.

### Open questions for follow-up (surfaced by adversarial review)
1. **Legacy ZOHO cutover** — provider enum is `GMAIL`/`MICROSOFT` only, but `types.ts`/config still reference ZOHO. The migration must drop/convert any ZOHO mailboxes/settings (no enum slot exists).
2. **Email normalization** — `@@unique([userId, email])` is case-sensitive. Enforce lowercase-before-write (the codebase already does `userEmail.toLowerCase().trim()`) so two rows can't differ only by case.
3. **Daily-limit day boundary** — `counterDate` is UTC with no per-mailbox timezone. Confirm whether limits should follow the account's local day.
4. **Secrets in `User.settings`** — the historical `SecureState` co-located client secrets/refresh tokens in the settings blob. Strip secret fields before serializing `User` to the client and redact tokens from logs; encryption-at-rest of `Mailbox` tokens is an app concern, not enforced by the schema.
5. **`Campaign.recipients`** — the frontend `Campaign` has `recipients: Recipient[]`; Phase 1 has no lead-linking join model (4-model cap), so recipients are intentionally out of scope for now.

---

## ADR-0002 — Phase 2: JWT auth + per-tenant DB-backed mail credentials

**One-line:** Every API request now authenticates with a JWT and resolves mailbox credentials from the `Mailbox` table scoped to `req.auth.userId`; the global `process.env` single-user mailbox config (GMAIL_USER / ZOHO_USER / MICROSOFT_USER …) is gone.

**Status:** Accepted · 2026-07-06

### Context
The server authenticated no one and sent mail as a single hardcoded mailbox read from `process.env` (`GMAIL_USER`/`GMAIL_APP_PASSWORD`, `ZOHO_USER`, `MICROSOFT_USER`, …). Microsoft OAuth tokens lived in a flat `server/data/tokens.json`. Neither is viable for a multi-tenant gateway.

### Decision — authentication (`server/src/auth/`)
- **Endpoints:** `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, plus `GET /api/auth/me` for session hydration. Mounted publicly at `/api/auth`; every other API router is mounted behind `requireAuth`.
- **Passwords:** `bcryptjs` at cost factor 12 (`auth/password.ts`). `bcrypt.compare` is constant-time; login errors are deliberately generic (`INVALID_CREDENTIALS`) to avoid account enumeration.
- **Tokens (`auth/jwt.ts`):** two JWT types on one secret, distinguished by a `typ` claim — `access` (15m, carries `sub`+`email`) and `refresh` (30d, also carries `ver` = `User.tokenVersion`). `refresh` verifies `ver === User.tokenVersion`, so bumping `tokenVersion` (password reset / logout-everywhere) revokes every outstanding refresh token. This is exactly the field Phase 1 added for this purpose.
- **Gate (`auth/middleware.ts`):** `requireAuth` reads the Bearer access token and attaches `{ userId, email }` to `req.auth`. **Handlers read the tenant only from `req.auth` — never from the request body/query** — so one tenant can never act on another's data or mailboxes.
- **No mock/demo login exists in the server layer.** A grep for `mock|demo|simulat|bypass` over `server/src` returns only Vitest fixtures; there were never demo login buttons/flags to remove — the previous server simply had no auth at all.

### Decision — per-tenant credentials (`server/src/creds/`)
- **`mailboxStore.ts`** resolves credentials from the `Mailbox` model by `(userId, provider, isActive)`. It returns hosts/ports + a fresh XOAUTH2 access token. IMAP/SMTP authenticate via XOAUTH2 (`{ user, accessToken }`) — the Phase-1 schema only stores OAuth tokens, so app-password basic auth is dropped.
- **`oauth.ts`** performs the provider refresh-token exchange (Google / Microsoft, incl. the AADSTS700025 public-client retry) using **app-level** client id/secret from env. These app-registration creds are NOT per-user and correctly stay in env; only the per-user tokens moved to the DB.
- **`ensureFreshAccessToken`** refreshes when the token is within a 5-minute buffer and persists the rotated (re-encrypted) tokens back to `Mailbox`.
- **Zoho is unsupported** at the resolver: `MailboxProvider` has only `GMAIL`/`MICROSOFT`, so there is nothing to look up — a zoho request returns `DENIED` rather than silently reading env.
- **Removed:** `creds/store.ts` (dead in-memory `Map`) and `mail/microsoftOauth.ts` (the `tokens.json` file store); the single-user mailbox vars in `config.ts` and `.env.example`.

### Security configuration
- **Mailbox token encryption-at-rest (`creds/crypto.ts`):** OAuth `accessToken`/`refreshToken` are AES-256-GCM encrypted (per-value random IV, auth tag, versioned `v1:iv:tag:ct` wire format) before they touch Postgres and decrypted on read, honoring the schema's ciphertext contract. Key = `MAILBOX_ENCRYPTION_KEY` (32 bytes, 64 hex chars); loader throws if missing/wrong-length.
- **`JWT_SECRET`** is required in production (`config.ts` throws at boot if unset; a clearly-labelled insecure fallback is used only in dev/test). New env is documented in `server/.env.example`.
- **Secret hygiene:** tokens/passwords are never logged (`util/redact.ts`, `maskEmail`); `User` is serialized to clients via a `publicUser()` projection that omits `passwordHash`.

### Consequences & follow-ups
1. **Mailboxes must be populated** before mail send/fetch works: the DB-backed resolver returns `AUTH: "No active <provider> mailbox connected"` until a mailbox row exists. The OAuth **connect/callback flow** that writes those rows (via `mailboxStore.upsertMailbox`, which encrypts on write) is Phase 3 and intentionally out of scope here.
2. **Follow-up jobs are now tenant-owned:** `FollowupJob.userId` is required; the scheduler filters legacy `data/followups.json` jobs that lack it (observed: 21 legacy jobs dropped on load) and resolves the sender mailbox per job owner.
3. **Rotate the previously-committed-style secrets.** `server/.env` (gitignored) still contains the old single-user Gmail app password and Microsoft client secret; they are no longer read by code and should be removed/rotated.

### Validation evidence
- `npx tsc --noEmit`: clean.
- `npx vitest run`: **11 passed / 3 files** — password hashing, JWT round-trip, full signup→login→refresh→/me HTTP flow (Prisma mocked), and the multi-tenant 401 gate on mail/followups.
- **Live Neon smoke test** (throwaway user, then deleted): signup `201` (tokens issued, no `passwordHash` in body), login `200`, refresh `200`, `/me` `200`, `GET /api/mail/sent` without a token `401`, `GET /api/mail/health` with a token `200` returning DB-resolved `mailboxes: []`. Confirms credentials are read from the database per authenticated user, not from `process.env`.

> **Update (Phase 3, 2026-07-06):** Consequence #1 above is now resolved — the OAuth **connect/callback flow** that writes mailbox rows via `upsertMailbox` is implemented. See **ADR-0003**.

---

## ADR-0003 — Phase 3: interactive OAuth2 connect flow (multi-account mailbox consent)

**One-line:** An authenticated user connects a Gmail/Microsoft inbox through a two-leg OAuth2 authorization-code flow; the callback is gated by a signed `state` (not a Bearer header) and persists the exchanged tokens via `mailboxStore.upsertMailbox` (encrypted-at-rest).

**Status:** Accepted · 2026-07-06

### Context
Phase 2 (ADR-0002) left the DB-backed resolver returning `AUTH: "No active <provider> mailbox connected"` until a `Mailbox` row exists, and deferred the row-writing consent flow to Phase 3. The legacy Microsoft flow persisted tokens to a flat `server/data/tokens.json`; there was no Google consent path and nothing tenant-scoped.

### Decision — two-leg flow (`server/src/auth/oauthRoutes.ts`, mounted at `/api/auth/oauth`)
- **`GET /:provider/start`** — behind `requireAuth`. The authenticated SPA calls it with its Bearer token; it mints a signed `state` bound to `req.auth.userId` and returns `{ authorizeUrl }` for the browser to navigate to. It returns JSON (not a 302) because a `fetch` with an `Authorization` header cannot perform a top-level browser redirect — the SPA does `window.location = authorizeUrl`.
- **`GET /:provider/callback`** — the provider's redirect target. It is a **top-level browser navigation and therefore carries NO `Authorization` header**, so it is deliberately *not* behind `requireAuth`. It exchanges the `code` server-side with the backend client credentials (`creds/oauth.ts` → `exchangeAuthorizationCode`), decodes the returned `id_token` to learn the mailbox address, and writes via `upsertMailbox`. It then 302-redirects the browser back to `WEB_ORIGIN` with `?connected=<provider>&email=…` on success or `?oauth_error=…` on failure.

### Decision — how the callback is protected (the anti-hijack requirement)
- The **signed `state` JWT is the sole gate** on the callback. It is minted only inside the authenticated `/start` leg (`signOAuthState`, `typ: 'oauth_state'`, 10-minute TTL, `sub = userId`, plus a random `nonce`) and verified in the callback (`verifyOAuthState`). Because forging one requires the server's `JWT_SECRET`, an unauthenticated attacker cannot fabricate a callback, and the mailbox is always written to the `userId` embedded in the *signed* state — never to a value read from the query string. A `state`/path-`provider` mismatch is also rejected. This is the standard stateless-OAuth CSRF defense and satisfies "an unauthenticated user cannot hijack the callback flow."
- On any failure (missing/invalid/expired state, provider error, missing refresh token, undetermined email) the callback writes **nothing** and bounces back with `?oauth_error=` — verified by test.

### Provider specifics
- **Scopes:** Gmail `https://mail.google.com/ openid email` with `access_type=offline&prompt=consent` (forces a refresh token even on re-consent); Microsoft `offline_access openid email https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`. `openid email` is requested *only* so the token response carries an `id_token` to identify the connected mailbox; IMAP/SMTP authenticate with the mail scopes.
- **Mailbox identity:** the `id_token` payload is base64url-decoded (not signature-verified — it arrived over TLS directly from the provider's token endpoint) for `email` / `preferred_username` / `upn`. For Microsoft the account's real home tenant (`tid` claim) is stored as `Mailbox.tenant` so refreshes target it; Gmail stores `null`.
- **Code exchange (`creds/oauth.ts`):** `exchangeAuthorizationCode` mirrors the existing `refreshAccessToken` (same `postForm`, same app-level env credentials, same Microsoft AADSTS700025 public-client retry that drops `client_secret`). No refresh token in the response ⇒ hard error (a mailbox with no refresh token can't be kept alive).
- **`redirect_uri` consistency:** built from a fixed canonical path (`<base>/api/auth/oauth/<provider>/callback`) so the value is byte-for-byte identical in the authorize URL and the exchange (providers reject a mismatch). `base` = `OAUTH_REDIRECT_BASE_URL` (new, optional config) or, when unset, the incoming request origin (dev convenience).

### Security configuration
- Tokens are encrypted before the DB write — the callback reuses `upsertMailbox`, which runs `encryptSecret` (AES-256-GCM) on `accessToken`/`refreshToken`; a test asserts the persisted columns are ciphertext (`v1:` prefix), never the plaintext values.
- Emails are masked in logs (`maskEmail`); tokens and the authorization `code` are never logged.
- New env `OAUTH_REDIRECT_BASE_URL` documented in `server/.env.example` alongside the exact redirect URIs to register with Google/Azure.

### Files
- `server/src/auth/oauthRoutes.ts` (new) — the two-leg router.
- `server/src/creds/oauth.ts` — added `exchangeAuthorizationCode` + `AuthCodeResult` (and `id_token` on the token-response type).
- `server/src/auth/jwt.ts` — added `signOAuthState` / `verifyOAuthState` (+ `OAuthStateClaims`).
- `server/src/auth/index.ts`, `server/src/index.ts` — export + mount `oauthRouter` at `/api/auth/oauth` (before the public auth router so its paths take precedence).
- `server/src/config.ts`, `server/.env.example` — `OAUTH_REDIRECT_BASE_URL`.
- `server/src/__tests__/oauth.test.ts` (new).

### Validation evidence
- `npx tsc --noEmit`: clean.
- `npx vitest run`: **17 passed / 4 files** (6 new). The OAuth tests prove: unauthenticated `/start` → `401`; authenticated `/start` → a Google authorize URL with the configured `redirect_uri` + a `state`; unknown provider → `400`; **callback with an invalid state → `302 ?oauth_error` and zero DB writes**; callback with a valid state → code exchanged, `upsertMailbox` called with the id_token email and **ciphertext** token columns, `302 ?connected=gmail`; provider `error` params passed back to the SPA.
- Not exercised here: a live end-to-end consent against real Google/Azure app registrations (needs real client credentials + registered redirect URIs).

### Follow-ups
1. **Live consent smoke test** once real app-registration credentials + redirect URIs are configured.
2. **`id_token` fallback:** if a provider ever omits the email claim, add a userinfo/Graph `/me` lookup. Current behavior is a clean `oauth_error` rather than a silent bad write.
3. **Frontend leg:** the SPA needs a "Connect inbox" action that `GET`s `/start` with the Bearer token and navigates to `authorizeUrl`, plus handling of the `?connected` / `?oauth_error` return params.

---

## ADR-0004 — Phase 4: outbound campaign engine + Unibox reply tracking

**One-line:** A DB-driven background worker dispatches active campaigns through the tenant's OAuth2 mailboxes with per-send inbox rotation and Spintax resolution; a polling Unibox listener detects inbound replies, AI-categorizes intent, and pauses the recipient's outbound sequence.

**Status:** Accepted · 2026-07-06

### Campaign dispatch worker (`server/src/campaigns/worker.ts`)
- An in-process `setInterval` loop (`CAMPAIGN_TICK_MS`, default 60s; overlap-guarded) — not OS cron — because the followup scheduler already established that pattern and single-instance Fly deployment makes it sufficient. Each tick: promote due `SCHEDULED` campaigns to `ACTIVE` (`updateMany` on `scheduledAt <= now()`), then process each `ACTIVE` campaign.
- **Recipient model:** Phase 1 deliberately has no campaign↔lead join table, so a campaign targets its owner's `Lead` rows in status `NEW` (highest `score` first); a dispatched lead moves to `CONTACTED`, which doubles as the "already sent" marker and prevents double-sends across ticks and campaigns. `progress` = % of the tenant's leads no longer `NEW`; when none remain the campaign flips to `COMPLETED`.
- **Batching:** `CAMPAIGN_BATCH_SIZE` (default 10) sends per campaign per tick keeps a tick short and paces volume. A per-lead send failure marks that lead `LOST` (with the error in `notes`) rather than stalling the batch.
- **Followups:** each dispatch queues the campaign's `autoFollowUps[]` (`{delay, unit, content}` cumulative offsets) through the existing followup scheduler with `skipIfReplied: true` and threading (`originalMessageId`/`initialSentAt`), so the pre-existing reply-gate keeps working.
- Worker + poller start in `index.ts` only when `DATABASE_URL` is set and `NODE_ENV !== 'test'` (the vitest suite imports the app module).

### Inbox rotation (`creds/mailboxStore.ts`)
- `pickRotationMailbox(userId)`: all active mailboxes (any provider) ordered `lastSentAt asc nulls first`; the first one that is warmed (`dailyLimit > 0`) and under its limit wins. Least-recently-used pick per send = even volume distribution across every connected inbox, exactly what the Phase-1 scalar columns (`dailyLimit`/`sentToday`/`counterDate`/`lastSentAt`) were designed for.
- `recordMailboxSend` increments `sentToday` (or resets it to 1 when `counterDate` is a previous UTC day — the app-logic counter reset promised in ADR-0001) and stamps `lastSentAt`.
- `connectionForMailbox(mailbox)` + `smtpGateway.sendFromMailbox(mailbox, …)` send from the SPECIFIC rotated row (token refreshed via the existing `ensureFreshAccessToken`), because the older `sendSmtpMail(userId, provider)` path resolves a mailbox by provider and would defeat rotation. When every mailbox is exhausted the batch stops for that tick (no error, retried next tick).

### Spintax (`campaigns/spintax.ts`)
- `resolveSpintax` resolves innermost `{a|b|c}` groups first (supports nesting), picks with `crypto.randomInt`, and leaves `|`-less brace groups (e.g. `{firstName}` placeholders) untouched via control-char sentinel masking. Applied per-recipient to campaign subject, body, and followup content.

### Unibox reply listener (`server/src/unibox/`)
- **Polling, not webhooks:** raw IMAP (the only inbox access this stack has) offers no push; Gmail/Graph push APIs would need different scopes + public webhook endpoints. `replyPoller.ts` polls every `UNIBOX_POLL_MS` (default 5 min): leads in `CONTACTED` (capped by `UNIBOX_SCAN_LIMIT`, oldest-contacted first), grouped per tenant, searched in each of the tenant's active inboxes (`FROM lead.email SINCE lead.lastContacted`) since a reply can land in any connected inbox.
- **Intent categorization (`intent.ts`):** the newest matching message's text (crude header-strip + tag-strip of the raw source — enough signal for classification) goes to Gemini `generateContent` (`GEMINI_API_KEY`, model `gemini-2.0-flash`, temperature 0, single-word answer) with categories `INTERESTED | NOT_INTERESTED | OUT_OF_OFFICE | NEUTRAL`. Any missing key / API failure / unparseable answer falls back to a keyword heuristic so reply handling never blocks on the AI service.
- **Sequence pause:** for a real reply (not `OUT_OF_OFFICE`), all of the tenant's still-scheduled followups to that recipient are cancelled across campaigns (new `cancelScheduledFollowupsForUserRecipient` in the followup scheduler, returning the affected campaignIds), each affected campaign's `repliedCount` is incremented, and the lead moves to `REPLIED` (`LOST` when `NOT_INTERESTED`) with `{replyIntent, replyDetectedAt}` merged into `Lead.intelligence`. An OOO autoreply pauses nothing — the reply-gated followups continue.

### Config / env (all optional, documented in `.env.example`)
`CAMPAIGN_TICK_MS`, `CAMPAIGN_BATCH_SIZE`, `UNIBOX_POLL_MS`, `UNIBOX_SCAN_LIMIT`, `GEMINI_API_KEY`, `GEMINI_INTENT_MODEL`.

### Validation evidence
- `npx tsc --noEmit`: clean.
- `npx vitest run`: **27 passed / 5 files** (10 new in `__tests__/phase4.test.ts`): Spintax alternatives/nesting/placeholder-preservation; intent heuristic + no-key fallback; rotation LRU pick, exhausted/unwarmed skip, stale-counter reset, all-exhausted → null; full worker tick over mocked Prisma proving two NEW leads dispatched from two DIFFERENT rotated mailboxes, Spintax-resolved subjects, reply-gated threaded followups scheduled, leads → CONTACTED, campaign → COMPLETED/100%.
- Not exercised: live SMTP/IMAP against real mailboxes and a live Gemini call (need real connected mailboxes + API key).

### Lessons / follow-ups
1. **Reply→campaign attribution rides on followup jobs.** `repliedCount` attribution comes from the cancelled jobs' `campaignId`s; a campaign with no `autoFollowUps` gets its leads paused/marked but no `repliedCount` bump. A proper per-send message log model would fix this (schema change deferred).
2. **Leads are tenant-global, not campaign-scoped** (Phase-1 4-model cap): two simultaneously ACTIVE campaigns for one tenant compete for the same `NEW` leads — first tick wins each lead. Acceptable now; needs a join table when campaign-specific audiences arrive.
3. **Single-instance assumption:** in-process interval + counter updates are not multi-node safe (no row locking / distributed lock). Fine on one Fly machine; revisit before scaling out.
