# Deep review part 2 — portal SPA, health/ops, CRM frontend (2026-07-25)

Completes the coverage gap left by `REVIEW-2026-07-25.md`, which covered the server only.
Units 5, 6a, 6b. **Nothing here is fixed** — this is findings only, unlike the server-side
HIGHs which have all been fixed and committed.

**[V]** = re-verified by hand against the source. Everything else is worker-reported and
unconfirmed — a lead, not a fact.

---

## HIGH

### 1. Three follow-up API calls bypass the refresh-and-retry helper [V]
`services/followupApi.ts:72, 92, 107` — `scheduleFollowup`, `listFollowups` and
`cancelFollowup` use raw `fetch()` with a hand-rolled `authHeaders()` instead of
`apiGet`/`apiPost`. When the short-lived access token expires, the server 401s, and the code
throws a generic "Failed to cancel follow-up" toast. No refresh is attempted even though
`refreshAccessToken` is exported from `apiClient.ts` for exactly this. The action silently
does not happen and the user is not told to re-auth.

This is the **third** instance of this exact bug class in this repo — `services/mailGateway.ts`
has a header comment describing the previous two fixes. It was simply never applied here.
**Fix:** route all three through `apiClient.ts`.

### 2. OAuth error-code mismatch leaves the app permanently stuck [V]
`hooks/useEmailProvider.ts:119` checks `AppErrorCode.AUTH_ERROR`, but `services/realGoogle.ts:86`
and `services/realZoho.ts:121` throw `AppErrorCode.AUTH_EXPIRED`. The `clearToken(provider)`
branch therefore never runs, `settings.googleAccessToken` is never cleared, and every later
`loadEmails()`/`sendNewEmail()` repeats the identical failure forever. `useTokenManager` only
refreshes when the field is *empty*, so nothing else breaks the loop either. The user has no
path back to a working state short of manually clearing Settings.
**Fix:** accept both codes, or standardise on one.

### 3. OAuth client secrets and refresh tokens sit in localStorage [V]
`types.ts:198-202` — `UserSettings` carries `zohoClientSecret`, `googleClientSecret`,
`zohoRefreshToken`, `googleRefreshToken`, and `context/SettingsContext.tsx:37-39` writes the
whole object to `localStorage['ysxflow_settings']` on every change. Any XSS in the SPA reads
not just the CRM session but the tenant's **OAuth app client secret** plus a long-lived refresh
token — enough to mint mailbox access indefinitely, without ever touching the CRM backend
again. Materially larger blast radius than the JWT exposure.
**Fix:** client secrets have no business in a browser. Move the token exchange/refresh
server-side, mirroring the existing Gemini proxy pattern.

### 4. The whole `oauth-api` transport mode is dead [V, corroborated]
`services/realGoogle.ts:4-5` and `realZoho.ts:5` call `/api/google/*` and `/api/zoho`.
`server/src/google/routes.ts` exists but **is never mounted** in `index.ts`, and there is no
`server/src/zoho/` at all. Unit 3 found the same unmounted router independently from the
server side. So with `transportMode: 'oauth-api'`, every fetch/send 404s. These calls also
never carry the CRM JWT — only the provider token in the body — so even mounted, they would
be unauthenticated against the CRM's own model. This is probably *why* nobody noticed finding 3.
**Fix:** delete the mode, or build and mount it properly behind `requireAuth`.

### 5. Both portal tokens in localStorage [V]
`portal/services/apiClient.ts:8,28` — access **and** refresh under one key. Reported HIGH;
I'd call it **MEDIUM**: it's the standard SPA pattern and mirrors the CRM side, so it's an
architectural choice to revisit, not a defect the portal introduced. Rated here as MEDIUM.

### 6. Magic-link token persists in browser history [V]
`portal/router.tsx:30-33` — `navigate()` only ever calls `pushState`, so after the token is
consumed, `/portal/login?token=<TOKEN>` remains one back-button press away, visible in the
address bar on a shared device and exposed as a `Referer` on the next outbound request.
**Fix:** add a `replace` option using `replaceState`, and use it after consuming. ~3 lines.

---

## MEDIUM / LOW (not individually re-verified)

- `API_URL` defaults to `http://localhost:3001` in **five** files (`apiClient.ts:3`,
  `mailGateway.ts:5`, `followupApi.ts:4`, `realGoogle.ts:3`, `realZoho.ts:4`). Safe only
  because of the out-of-band `VITE_API_URL="" npx vite build` convention that HANDOFF.md
  records as having already caused deploy incidents. Defaulting to `''` would make an
  accidental plain build degrade to same-origin instead of an unreachable host.
- Double-submit gaps, all in `components/`: invoice **Send** (`ClientPortalView.tsx:798`),
  campaign **pause/resume** toggle (`CampaignsListView.tsx:256` — non-idempotent, and
  out-of-order resolution can desync the UI), **Duplicate** campaign (`:291`), **Add Lead**
  (`LeadsView.tsx:78-102`), project **Archive** (`ClientPortalView.tsx:503`) and file-link
  **Remove** (`:595`) — the last two also with no confirmation, inconsistent with every other
  mutating action in the same file.
- `components/UniboxView.tsx:309-317` — "Archive conversation" button has no `onClick` at all.
- `server/src/health/monitor.ts:54` — `/api/health/deep` leaks DB hostnames in error detail
  to an unauthenticated caller (also found server-side as unit 1 finding 7).
- `server/scripts/backup-db.mjs` — JSON fallback loses `Bytes` types; `pg_dump` credentials
  visible in the process list; a size check is skipped, so an incomplete backup can report
  success.
- `context/AuthContext.tsx:21-35` — hydration effect has no cancellation guard.

---

## Checked and clean — worth knowing

- **No XSS anywhere in `components/**` or `src/**`.** No `dangerouslySetInnerHTML`. Every
  attacker-controlled input — scraped channel names, inbound email bodies/subjects, thread
  messages, CSV-derived content — is rendered as an escaped JSX text child.
- **Framer Motion is clean in both apps.** 7 portal usages and ~35 CRM usages all pass
  `variants` as a named prop. The `{...variantsObject}` spread that once rendered whole pages
  `display:none` is absent.
- **Both `window.confirm` call sites check their return** (`ScraperView.tsx:116`,
  `UniboxView.tsx:299`). The unchecked-null bug that shipped before is gone.
- **Portal build config is correct** — `root`/`base`/`outDir` all `__dirname`-relative,
  `API_BASE = ''`. The "portal build silently emits the CRM app" bug is genuinely fixed.
- **No Gemini key in the bundle** — `services/gemini.ts` only calls `/api/gemini/generate`.
- **No 401 storm in `apiClient.ts`** — refresh is de-duplicated via a module-level promise,
  one refresh + one retry per call.
- **Campaign optimistic updates roll back correctly** on error.

## Coverage gaps — explicitly not reviewed

Unit 6b ran out of budget before: `Step3Setup.tsx`, `CampaignNameModal.tsx`, `StepProgress.tsx`,
`AnalyticsView.tsx`, `BrandOSView.tsx`, `DocumentationView.tsx`, `IntegrationsView.tsx`,
`LoginScreen.tsx`, `PerformanceView.tsx`, `SettingsModal.tsx`, `StoryVaultView.tsx`,
`TemplatesView.tsx`, and most of `src/design/ui/*`.

Unit 6a did not line-by-line cross-check `analyticsApi.ts`, `scraperApi.ts` or
`portalAdminApi.ts` response types against their routes.

## Suggested order if these get fixed

1. Finding 1 (follow-up refresh-and-retry) — silent data loss, third recurrence, small fix.
2. Finding 6 (`replaceState`) — ~3 lines.
3. Finding 2 (error-code mismatch) — one-line, unbreaks a stuck state.
4. Finding 4 — decide: delete `oauth-api` or build it. Finding 3 partly evaporates if deleted.
5. `API_URL` default to `''` — removes a documented recurring deploy footgun.
6. Double-submit guards — mechanical, low risk.
