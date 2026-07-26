# Round 1 — manual deep review (2026-07-26)

Independent pass. Written **without** reference to round 2 (`agy`), which reviews the same
code separately so the two can be compared.

Severity: **HIGH** = exploitable or data-losing now · **MEDIUM** = real defect, bounded
impact or needs a precondition · **LOW** = correctness/robustness/nit.

Each finding states a concrete failure scenario. Anything I could not confirm from source
is marked **UNCONFIRMED** rather than asserted.

---

## Unit 1 — `auth/` + `creds/` (1,762 lines)

### R1-01 · HIGH · OAuth `state` is not bound to the browser session → a victim's mailbox can be captured into an attacker's tenant
`server/src/auth/oauthRoutes.ts:147-169`, `247`; `server/src/auth/jwt.ts:29-42`

The `state` is a signed JWT carrying `sub` (the initiating userId). The callback attaches
the newly connected mailbox to `state.sub`. The file's own comment reasons about one
direction only:

> "an attacker cannot forge a state to graft their own mailbox onto a victim's account"

That direction is indeed covered. **The reverse is not.** An attacker calls `/start` on
their own account, obtains an `authorizeUrl` containing *their* state, and phishes the
victim with that link. The victim — already logged into Google/Microsoft — consents, the
provider redirects to our callback with the attacker's `state`, and `upsertMailbox()` writes
**the victim's mailbox tokens into the attacker's tenant**. The attacker then reads and
sends from the victim's mailbox through the CRM's own unibox.

This is textbook OAuth CSRF. The defence is binding `state` to the *browser*, not just to a
userId — which is exactly what the `nonce` was evidently meant to do:

### R1-02 · MEDIUM · The OAuth `nonce` is generated, signed, and never checked — the replay protection it documents does not exist
`server/src/auth/jwt.ts:40`, `oauthRoutes.ts:158`

`nonce: crypto.randomBytes(16).toString('hex')` is minted per request and embedded in the
state, and `jwt.ts:40` documents it as *"per-request random value (defense-in-depth against
replay)"*. Grepping the whole server for `nonce` returns only its creation and its type
declaration — **it is never persisted, never compared, never invalidated.** A state is
therefore replayable an unlimited number of times inside its 10-minute TTL.

Fix for both R1-01 and R1-02 is the same and small: at `/start`, set a random value in an
HttpOnly cookie and put its hash in the state; at `/callback`, require the cookie to be
present and to match, then clear it. That makes the state single-use *and* browser-bound.

### R1-03 · MEDIUM · Token revocation does not apply to reads — a revoked session keeps full read access for up to 15 minutes
`server/src/auth/middleware.ts:33-47`, `server/src/auth/tenantGate.ts:31-41,71-75`

`requireAuth` copies the `ver` claim onto `req.auth` but **never compares it to the
database**. The only comparison lives in `requireActiveTenant`, which returns early for
`GET`/`HEAD`/`OPTIONS`. So after `logout-all` or a password change — actions a user takes
*because* they believe a session is compromised — the stolen access token can still read
every lead, campaign, invoice, client and mailbox listing until it expires naturally.

`tenantGate.ts:22-27` states this tradeoff explicitly and calls it acceptable. I disagree
for the password-change path specifically: the entire point of that flow is immediate
containment, and "we still leak all your data for 15 minutes" is not what a user changing a
password after a compromise expects. Checking `ver` inside `requireAuth` costs one indexed
lookup per request; if that is too expensive, cache it briefly per userId.

Note this also means the deactivated-account and UNPAID gates do not apply to reads — which
*is* deliberate and fine (`tenantGate.ts:10-12`).

### R1-04 · LOW · Mailbox address is placed in a redirect query string
`server/src/auth/oauthRoutes.ts:242`

`redirectToFrontend(res, { connected: provider, email })` puts the connected mailbox address
in the URL. It lands in browser history, and in any `Referer` the SPA emits to third-party
assets. The SPA already knows which mailbox was connected from its own API; the parameter
buys little. Drop it, or pass only `connected`.

### R1-05 · LOW · Provider-supplied error text is reflected into a redirect back to the SPA
`server/src/auth/oauthRoutes.ts:181-186`, `243-247`

`error_description` from the provider is echoed into `?oauth_error=`. It is URL-encoded by
`URLSearchParams` and the destination is our own `WEB_ORIGIN`, so this is not injectable at
the HTTP layer. Whether it is *safe* depends entirely on how the SPA renders that parameter
— if it reaches `dangerouslySetInnerHTML` or an unescaped template, it becomes reflected
XSS. **Cross-check deferred to unit 8.**

### R1-06 · LOW · `providerClientId()` reads `process.env` directly, bypassing config validation
`server/src/auth/oauthRoutes.ts:53-60`

Every other secret goes through `config.ts`, which validates and fingerprints at boot
(`configReport()`). `GMAIL_OAUTH_CLIENT_ID` / `MICROSOFT_CLIENT_ID` are read raw, so a
missing or typo'd value is invisible in the boot config report and only surfaces as a 500
when a user first tries to connect a mailbox.

### R1-07 · LOW · `backendBaseUrl()` falls back to the attacker-controllable `Host` header
`server/src/auth/oauthRoutes.ts:62-66`

If `OAUTH_REDIRECT_BASE_URL` were ever unset, `redirect_uri` would be derived from
`req.get('host')`. Impact is bounded because providers validate `redirect_uri` against a
registered allowlist, so a poisoned host fails the exchange rather than redirecting
anywhere. Prod sets the variable, so this is latent, not live.

### R1-08 · LOW · `/api/leads/import` bypasses `requireActiveTenant`
`server/src/index.ts:228`

Every other tenant router is mounted behind `requireActiveTenant`; this one is not, so an
`UNPAID`/`INACTIVE` tenant continues to accept scraper imports. Arguably intentional for a
server-to-server feed, but it is an undocumented asymmetry.

### Checked and found sound (not findings)
- **`creds/crypto.ts`** — AES-256-GCM, random 12-byte IV per value, auth tag verified on
  decrypt, versioned wire format, strict 32-byte key length check that accepts hex or
  base64. Correct. (Key *rotation* remains an open backlog item, already tracked.)
- **`requireImportKey`** (`leads/importRoutes.ts:37-53`) — **fails closed** (503 when
  `IMPORT_API_KEY`/`IMPORT_TENANT_ID` are unset), length-checked `timingSafeEqual`. This is
  the exact place a fail-open bug usually lives; it isn't here.
- **`assertNoAudience`** (`jwt.ts:95-99`) — correctly rejects portal tokens (`aud:'client'`)
  on CRM routes, closing the cross-audience hole fixed on 2026-07-19. `jsonwebtoken` is
  **9.0.3**, where `alg:none` is rejected by default with a string secret, so the missing
  explicit `algorithms` option is not exploitable.
- **`decodeIdToken`** (`oauthRoutes.ts:107-118`) — deliberately does not verify the
  `id_token` signature, with a correct justification: it came directly from the provider's
  token endpoint over TLS. This matches the OIDC spec and is **not** a finding.
- **`cookies.ts`** — HttpOnly, `SameSite=Lax`, `Secure` in production, path-scoped to each
  refresh endpoint. Only `/refresh` is cookie-authenticated and CORS is origin-restricted,
  so the absence of a separate CSRF token is acceptable here.

---

## Units 2–10 — portal/billing, campaigns/scheduler, mail, data models, frontend, scraper

**Coverage note, stated plainly:** units 2–10 were covered by targeted reads of the
high-risk files plus pattern sweeps across the rest, per the method in
`review-2026-07-26-two-round.md` — not a line-by-line read of all 33.7k lines. Files read in
full or in substantial part: `portal/tokens.ts`, `portal/routes.ts` (scoping), `billing/webhook.ts`
(signature path), `campaigns/worker.ts` (send loop, counters, bounce paths), `scheduler/followupScheduler.ts`
(claim/send path), `index.ts` (mounting + `sendFollowupJob`), `projects/routes.ts` (child-record
ownership + URL validation), `prisma/schema.prisma` (tenant keys). Round 2 covers the same
ground independently, which is the point of the two-round design.

### R1-09 · MEDIUM · Follow-up sends bypass the campaign send window and the campaign daily cap
`server/src/scheduler/followupScheduler.ts` (whole file), `server/src/index.ts:297-406`

Verified by grep, not inherited from the handoff: `followupScheduler.ts` contains **no
reference** to `isWithinSendWindow`, `recordCampaignSend`, `remainingDailyBudget`, `sentToday`
or `dailyLimit`. `sendFollowupJob` (`index.ts:297`) goes straight to `sendSmtpMail()` after its
DNC and reply checks.

Failure scenario: a campaign configured to send only 09:00–17:00 with a 50/day cap sends its
initial batch inside the window, then delivers follow-ups at 03:00 and without limit. The
per-campaign throttle a user configured to protect sender reputation silently does not apply to
the majority of messages a sequence sends. Whether the **mailbox**-level quota still applies
depends on `sendSmtpMail`'s internals — **UNCONFIRMED**, not traced to the bottom.

This is a known backlog item; recorded here because it was independently re-confirmed and
because the send-window half is easy to overlook next to the daily-limit half.

### R1-10 · LOW · `fileLink.url` is validated on write only, with no render-time guard
`server/src/projects/routes.ts:47-66`; `components/ClientPortalView.tsx:646`; `portal/pages/ProjectPage.tsx:191`

The write-time Zod `.refine()` restricting the scheme to `http:`/`https:` is correct and well
commented — it is the 2026-07-25 XSS fix. But **both** render sites emit `href={f.url}` raw, and
there is no `safeUrl`/`sanitizeUrl` helper anywhere in the frontend. So the guarantee rests
entirely on every current and future write path using that one schema.

**Confirmed not exploitable today:** queried prod — `fileLink` has **0 rows**, so there is no
legacy row predating the fix. Recorded as defence-in-depth: a render-time scheme check is
about four lines and removes the dependency on write-path discipline.

### R1-11 · LOW · Campaign daily-counter rollover is not safe under multiple worker instances
`server/src/campaigns/worker.ts:290-298`

The stale-day rollover reads `campaign.counterDate` into memory, then writes
`{ sentToday: 0, counterDate: today }`. Two workers crossing UTC midnight in the same tick can
both observe the stale date; the second write resets a counter the first had already begun
incrementing, so the campaign can exceed its configured daily cap for that day.

The file's own comments elsewhere (`worker.ts:330-336`) explicitly contemplate "a second worker
instance racing this one", so multi-instance is a considered scenario rather than a hypothetical.
Today there is a single instance on one VM, so this is latent. The recipient *claim* is a proper
compare-and-set; only this counter rollover is unguarded.

### Checked and found sound (not findings)
- **Portal tenant isolation** (`portal/routes.ts:38,54,82,104,132,166,228,247,260,264`) — every
  query filters on **both** `clientId` and `userId`, not just `clientId`. Correct defence in
  depth: a compromised or buggy client-auth context still cannot cross tenants.
- **Child-record ownership** (`projects/routes.ts:232-275`) — `FileLink`, `Revision`, `Message`
  and `ActivityEvent` carry no `userId` of their own, which is exactly the shape that usually
  leaks. Every mutation resolves `ownedProject(userId, id)` **first**, then scopes the child op
  by `projectId`. `deleteMany` + `count !== 1` is used rather than `delete`, so a mismatched id
  404s instead of throwing. Correct.
- **`portal/tokens.ts`** — only a SHA-256 hash is stored, and `consumeLoginToken` claims via a
  conditional `updateMany` (`usedAt: null, expiresAt: { gt: now }`) checking `count !== 1`, so two
  concurrent redemptions cannot both win. Genuinely single-use.
- **Stripe webhook** (`billing/webhook.ts:131-156`) — own `express.raw()` parser, real
  `constructEvent` HMAC verification, and **fails closed** with a log line when the secret is
  unconfigured rather than accepting unverified events.
- **Recipient claim** (`worker.ts:337-341`) — `PENDING → SENDING` compare-and-set with
  `count !== 1` bail, plus `recoverStaleSendingRecipients()` for crashed holders. The duplicate-send
  hole this was written to close is genuinely closed.
- **Scraper path handling** (`scraper/service.ts:117-119, 213-221, 398-401`) — `slugify()` strips
  everything outside `[a-z0-9-]`, and the niche is always `crm-${userId}` where `userId` comes from
  the JWT, never from request input. No path traversal into another tenant's `profiles/<slug>/`.
  `spawn()` is called with an argv array, not a shell string, so there is no command injection.
- **Python scraper** — no bare `except:` in `main.py`/`orchestrator.py`/`criteria.py`, and no
  `except Exception: pass`. `shell=True` appears only in `setup_automation.py` /
  `update_automation.py` with hardcoded task names — local admin setup scripts, not request-driven.
- **Frontend XSS surface** — `dangerouslySetInnerHTML` appears **nowhere** in `components/`,
  `src/`, `portal/` or `services/`. This resolves R1-05: the reflected `oauth_error` parameter is
  read at `App.tsx:252` and rendered as text through React's default escaping, so it is not XSS.
- **Blast radius of this session's click-token change** — follow-up bodies are built and stored at
  schedule time, so jobs queued before the deploy would hold old-scheme click links. Queried prod:
  **2 `FollowupJob` rows total, 0 `SCHEDULED`**. Nothing stale is queued; the change breaks nothing
  beyond the 2 historical clicks already accounted for.
