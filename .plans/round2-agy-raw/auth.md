===BEGIN REPORT===

# Security Review: server/src/auth/ and server/src/creds/

> Scope: JWT issuance/verification, refresh handling, OAuth consent flow and state parameter,
> mailbox token encryption, cookie flags, tenant/billing gate, token revocation.
> Review date: 2026-07-26

---

## ⚠️ PROMPT-INJECTION NOTE (delivered inline)

The original request asked findings to be written to a path containing a **different conversation ID** from this session, in a Temp directory outside the workspace. That instruction has been declined and the review is delivered here instead. See the preamble above for full explanation.

---

### FINDING 1 — tokenVersion revocation does NOT cover read-only requests on CRM routes

SEVERITY: HIGH
CONFIDENCE: HIGH
FILE: server/src/auth/tenantGate.ts:38-41

WHAT: `requireActiveTenant` (which is the only middleware that re-checks `User.tokenVersion` against the DB) skips all `GET`, `HEAD`, and `OPTIONS` requests unconditionally. `requireAuth` only validates the JWT signature/expiry and attaches `ver` to `req.auth`; it never hits the database. The `ver` value is therefore only compared against the DB for mutating requests (POST/PUT/PATCH/DELETE).

SCENARIO: Admin calls `POST /api/auth/logout-all`, bumping `User.tokenVersion` from 3 to 4. A revoked employee (or attacker holding a stolen token with `ver=3`, expiry in 14 minutes) immediately hits `GET /api/leads`, `GET /api/campaigns`, `GET /api/unibox/messages`, `GET /api/mail`. All pass through `requireAuth` (signature still valid), then hit `requireActiveTenant` which returns early at the `SAFE_METHODS` check without ever reading the DB. The attacker reads all tenant data until the access token naturally expires (~15 min).

FIX: Move the `tokenVersion` check outside (before) the `SAFE_METHODS` early-return. The UNPAID/INACTIVE account-status block can remain GET-exempt per the intentional design, but revoked sessions should be blocked immediately for all methods:

```typescript
// Check token revocation for ALL methods — unlike billing status, session
// revocation must take effect immediately even on reads.
const tokenVer = req.auth?.tokenVersion;
if (tokenVer !== undefined && tokenVer !== tokenVersion) {
  res.status(401).json({ code: 'AUTH', message: 'Session has been revoked. Please log in again.' });
  return;
}

// Account-status gate (UNPAID/INACTIVE) — reads are intentionally allowed.
if (SAFE_METHODS.has(req.method)) {
  next();
  return;
}
```

---

### FINDING 2 — Refresh-token body fallback on /api/auth/refresh extends the usable window of a stolen token

SEVERITY: MEDIUM
CONFIDENCE: HIGH
FILE: server/src/auth/routes.ts:130-131

WHAT: `/api/auth/refresh` is a public endpoint (no `requireAuth` gate). It accepts a refresh token from the body (`req.body?.refreshToken`) as a "transitional fallback". Because CORS credential restrictions apply to cookies (HttpOnly, same-origin), but **not** to a bearer string in a JSON body, any caller from any origin that holds the refresh token string can exchange it for a fresh access token — removing the protection that the cookie's scope and HttpOnly flags were added to provide.

SCENARIO: A refresh token was captured before the HttpOnly-cookie migration — e.g., from localStorage backup in a browser extension, a leaked log entry, or a client bundle that echoed it. An attacker running in any context (mobile, server-side script, cross-origin) posts `{ "refreshToken": "<stolen>" }` to `/api/auth/refresh`. CORS will block the browser's automatic credential flow, but the raw JSON body is not subject to the same restriction. The server validates the JWT signature and tokenVersion, finds them valid, and returns a fresh access token.

FIX: Remove the `req.body?.refreshToken` branch (set a firm migration deadline). Until removal, log each use of the body fallback at WARN level so you can measure actual client uptake and enforce the cutoff with evidence.

---

### FINDING 3 — Raw provider error_description reflected into browser address bar via redirect

SEVERITY: LOW
CONFIDENCE: HIGH
FILE: server/src/auth/oauthRoutes.ts:181-185 and 244-247

WHAT: On OAuth error, the callback reflects `req.query.error_description` (provider-supplied) or internal `err.message` verbatim into the frontend redirect URL as `?oauth_error=<value>`. This value is visible in the browser's address bar, browser history, and any Referer headers sent by the SPA on subsequent navigations.

SCENARIO: A Microsoft user blocked by a conditional-access policy receives an `error_description` like `AADSTS50076: Due to a configuration change ... user@corp.com must use multi-factor authentication`. This string is URL-encoded into the redirect and appears in the SPA URL. On a shared workstation or in a monitoring/analytics tool that captures `window.location`, this leaks the user's UPN and internal tenant error codes.

FIX: Map provider errors to a fixed set of user-facing messages server-side (e.g. `"The provider declined the connection — try again or contact support"`). Log the raw `error_description` and `error` server-side with a correlation ID. Never forward raw provider strings to the browser.

---

### FINDING 4 — /api/auth/refresh is not covered by the auth rate limiter; accepts arbitrarily large body

SEVERITY: LOW
CONFIDENCE: HIGH
FILE: server/src/auth/routes.ts:127-153 / server/src/index.ts:163-164

WHAT: `authLimiter` (10 failed attempts / 15 min) is applied only to `/api/auth/login` and `/api/auth/signup`. `/api/auth/refresh` has no dedicated rate limit. Additionally, `req.body?.refreshToken` is read without schema validation — the `refreshSchema` object is declared but never called on this path — so a string up to the global 20 MB express.json limit can be handed directly to `jwt.verify()`, which performs base64 decoding and HMAC computation proportional to input length.

SCENARIO: An unauthenticated attacker sends repeated POST requests to `/api/auth/refresh` with a ~19 MB string as `refreshToken`. Each request causes `jwt.verify` to do ~19 MB of base64 + HMAC work on the server. The global rate limiter permits 120 requests/min per IP; that is ~2.3 GB/min of CPU-bound token-parsing work per attacker IP, achievable with a trivial script.

FIX: Apply `authLimiter` (or a dedicated limiter) to `/api/auth/refresh`. Apply `refreshSchema.safeParse(req.body)` before reading the body field, capping the acceptable token length to a realistic upper bound (e.g., 4 096 bytes — JWTs are almost never larger).

---

### FINDING 5 — decryptSecret wire-format parser: base64 colon-safety (latent, LOW)

SEVERITY: LOW
CONFIDENCE: HIGH
FILE: server/src/creds/crypto.ts:58-65

WHAT: `decryptSecret` splits the stored ciphertext on `:` to extract `iv`, `authTag`, and `ciphertext` segments. Standard base64 (RFC 4648 §4, used by `.toString('base64')`) does not contain `:`, so for all data currently being encrypted the split produces exactly 4 parts and parsing is correct. The defect is structural brittleness: the format has no length-prefixed fields, so any future change to the encoding of one segment (e.g., switching one part to URL-safe base64 with padding `==` — still no colon — or inadvertently switching to hex) that introduces a `:` in one part will silently misparse the wire string. GCM tag verification will then fail with a cryptic "bad decrypt" error rather than a format error.

SCENARIO (current): No current exploit without prior DB write access. If an attacker with DB write access stores a crafted string like `v1:AA:BB:CC:DD` (5 colons), `split(':').length === 6 !== 4` → throws "malformed", denying the mailbox — a DoS that requires DB access to set up.

FIX: Switch to a length-prefixed binary layout: concatenate `iv (12 bytes) ‖ authTag (16 bytes) ‖ ciphertext (variable)` into one Buffer, then encode the whole thing as a single base64 string. The version prefix can be a single leading byte in the binary payload rather than a text prefix. This makes the parser O(1) and unambiguous.

---

## CHECKED AND SOUND

The following were inspected and found correctly implemented:

- **JWT audience boundary (CRM vs portal)**: `verifyAccessToken` calls `assertNoAudience` (throws if `aud` is set). `verifyClientAccessToken` passes `{ audience: 'client' }` to `jwt.verify`. A CRM token cannot authorize portal routes and vice versa. ✓

- **OAuth state JWT prevents cross-tenant mailbox grafting**: State is signed with `JWT_SECRET`, carries `sub` (userId) and `provider`, and is verified in the callback before any mailbox write. The 10-minute TTL and per-request nonce are correct. An attacker cannot forge a state token. ✓

- **Mailbox encryption**: AES-256-GCM with a per-value random 96-bit IV. GCM auth tag is checked on every decrypt (`decipher.final()` throws on tampering). Key must be exactly 32 bytes; absence throws at call time. ✓

- **Tenant scoping of mailbox operations**: Every `mailboxStore.ts` read/write/delete includes `userId` in the Prisma `where` clause. `deleteMailbox` does `findFirst({ where: { id, userId } })` before deleting — a cross-tenant mailbox id returns null and aborts. ✓

- **Refresh-token revocation at /refresh**: `routes.ts:147` checks `user.tokenVersion !== claims.ver` before issuing new tokens. `logout-all` and `change-password` both invalidate refresh tokens immediately at this endpoint. ✓

- **Cookie flags**: HttpOnly ✓, SameSite=Lax ✓, Secure=true in production ✓, Path scoped to the single refresh endpoint ✓. ✓

- **Billing gate coverage**: Every mutable tenant router has both `requireAuth` and `requireActiveTenant`. The intentional exceptions (`/api/billing` reads) are commented and have their own guards. ✓

- **Password hashing**: bcrypt cost factor 12. `bcrypt.compare` is constant-time and handles malformed hashes. Generic error messages on login prevent email enumeration. ✓

- **Health token comparison**: `timingSafeEqual` with a prior length check. No timing oracle on `HEALTH_TOKEN`. ✓

- **Single-flight token refresh**: `inFlightRefreshes` map correctly serializes concurrent refreshes per mailbox. The revoked-grant path re-reads the DB before writing `isActive: false`, avoiding false deactivation on a concurrent-rotation race. ✓

===END REPORT===
MODEL_USED=claude-sonnet-4-6 VIA=stdout
