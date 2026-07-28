# Frontend review — CRM component tree + client portal SPA (2026-07-28)

Scope: `components/`, `portal/`, `src/`, `App.tsx`, `index.tsx`, `context/`, `hooks/`,
`services/`, `types.ts` on branch `phase5-frontend-wiring` in
`C:\Users\banjigum1\Documents\YSXXS\YSXXS`. Read-only; nothing in the checkout was modified.
The only command run was `npx tsc --noEmit` (exit 0, as HANDOFF says it should be).

Static review only — the Neon compute is exhausted until 2026-08-05, so nothing here was
executed. Every finding below was derived by reading the frontend **and** the server route it
talks to; where a claim depends on server behaviour I say which file and line I checked it
against. Findings that looked bad on a first pass and turned out to be fine are listed in §4
rather than silently dropped.

---

## 1. Summary

**13 confirmed defects, 3 suspected, and a set of earlier findings verified as genuinely fixed.**

The single most important one is not on the brief's list and is not subtle:

> **The client portal white-screens on every page reload.** `/api/portal/auth/refresh` returns
> only `{ accessToken }`, but the portal's refresh handler stores `clientUser: data.clientUser`
> (undefined) and `PortalShell` then dereferences `auth?.clientUser.email`. There is no error
> boundary. Confidence: high — both sides read directly, only one consumer, and `tsc` passes
> only because the declared type lies about the response shape.

On the brief's specific questions:

- **Cross-tenant / cross-client exposure (§1):** nothing found. The portal's in-memory-only
  auth state, the `onSessionCleared` fan-out in the CRM, and the unmount-on-logout behaviour of
  every data view all check out. Details of how I checked are in §4.
- **Auth / 401 / the rotation deploy (§2):** the CRM handles a failed refresh correctly and
  does not loop, spam, or wedge. The portal does **not** wedge on a blank screen either — but it
  never routes to the login page on a mid-session session loss (finding C7), and it *does*
  blank-screen on reload for an unrelated reason (C1). Two secondary consequences of the deploy
  are C1's trigger condition and C9 (local settings wiped for every user).
- **Sender identity / `MISSING_SENDER_IDENTITY` (§5):** **not surfaced at all** outside the
  Settings modal's own tab. `pausedReason` has zero consumers in the frontend, and the campaign
  creation toast affirmatively says the campaign is "activated". C3.
- **Money / destructive actions (§4):** invoice **Send** double-fires and double-emails the
  client (C5); the follow-up composer reports success on a failed send (C2); Unibox reports
  failure on a successful send, inviting a duplicate (C6).
- **XSS (§7):** clean. Re-verified independently — see §4.

---

## 2. Confirmed defects

Ranked by user impact.

### C1 — CRITICAL. The client portal crashes to a blank page on every reload after sign-in

**Files:** `portal/services/apiClient.ts:115-119`, `portal/components/PortalShell.tsx:58`,
`server/src/portal/auth.ts:326-328`, `portal/index.tsx:6-10`

`refreshTokens()` stores the identity from the refresh response:

```ts
// portal/services/apiClient.ts:113-120
const data = await res.json();
saveAuth({
  accessToken: data.accessToken,
  clientUser: data.clientUser,   // <- not in the response
  client: data.client,           // <- not in the response
});
```

But the refresh route returns the access token and nothing else:

```ts
// server/src/portal/auth.ts:326-328
res.json({
  accessToken: signClientAccessToken(tokenInput(cu)),
});
```

Only `issueSession()` (`server/src/portal/auth.ts:74-96`, used by login / magic-link /
set-password) returns `clientUser` and `client`. `/refresh` does not call it.

`PortalShell` then does:

```tsx
// portal/components/PortalShell.tsx:58
title={auth?.clientUser.email}
```

`?.` short-circuits on `auth` being null, not on `auth.clientUser` being undefined — so this is
`undefined.email`, a TypeError. `portal/index.tsx` mounts `<App/>` with no error boundary, so
React unmounts the tree: blank page.

**Failure scenario.** A client signs in (login → full session → portal works). They press F5,
or close the tab and come back tomorrow with the 30-day `ysxportal_rt` cookie
(`server/src/auth/cookies.ts:44`, `maxAge = JWT_REFRESH_TTL`). `portal/App.tsx:51` runs
`bootstrapSession()` → `refreshTokens()` → 200 → `saveAuth` with `clientUser: undefined` →
`authed = Boolean(loadAuth())` is `true` (`portal/App.tsx:14`) → `Routes` renders
`<PortalShell>` → crash. The client sees a white page and has no way to recover other than
clearing cookies, because every subsequent load takes the same path.

**How I verified.** Read both sides. `grep -rn "clientUser" portal` — the only consumer is
`PortalShell:58`. `grep -n "refresh" server/src/index.ts` — one mount,
`app.use('/api/portal/auth', portalAuthLimiter, portalAuthRouter)` at line 270; there is no
second refresh route. `git log -S` confirms the `clientUser` payload has only ever existed
inside `issueSession`. `tsc` passes because `PortalAuthState.clientUser` is declared as a
required object (`portal/services/apiClient.ts:22`), so the type asserts a shape the server
never sends — and the comment at `:105-107` states, incorrectly, that "The response carries the
new access token plus the identity payload."

**Interaction with the rotation deploy.** Immediately after deploy, every stored refresh token
is unknown to the `refresh_tokens` table, so `consumeRefreshToken` returns `invalid`
(`server/src/auth/refreshStore.ts:127`, whose own comment says "This is also every pre-rotation
stateless session, which is why the deploy logs everyone out once"). The refresh 401s,
`authed` is false, and the client correctly lands on the login page. So the *first* load after
deploy is fine. The crash begins on the first reload after each client signs back in.

**Fix.** Two things, both worth doing: (a) have `/refresh` return `clientUser`/`client` (or add
`GET /api/portal/auth/me` and call it from `bootstrapSession`), and (b) change `PortalShell:58`
to `auth?.clientUser?.email` regardless — a `title` attribute must not be able to take the app
down. (b) alone converts this from fatal to a missing tooltip.

---

### C2 — HIGH. "Follow-up sent successfully" is shown even when the send failed

**Files:** `components/DashboardView.tsx:144-156`, `hooks/useEmailProvider.ts:256-296`

`sendFollowUp` **never throws**. Every failure path is caught internally and returned:

```ts
// hooks/useEmailProvider.ts:285-291
} catch (err: any) {
  const appErr = ...;
  setError(appErr);
  return { success: false, error: appErr, followups: baseFollowups };
}
```

The caller awaits it, discards the result, and toasts unconditionally:

```tsx
// components/DashboardView.tsx:149-155
await sendFollowUp(selectedEmail, body);
setSelectedEmailId(null);
showToast('SUCCESS', date ? "Follow-up scheduled successfully." : "Follow-up sent successfully.");
```

The `catch` on line 153 is unreachable for send failures.

**Failure scenario.** Live API mode. The user drafts a follow-up to a prospect, clicks
**Send Now**, confirms the "This email will be sent immediately" dialog. The gateway is down /
the mailbox password is stale / the SMTP host rejects → `gwSend` throws → `sendFollowUp` swallows
it → the composer closes and a green "Follow-up sent successfully." toast appears. The email was
never sent. The only counter-signal is a red banner in the *left* list pane fed by
`appError` (`DashboardView.tsx:304-315`), which the user has just been navigated away from.

**Fix.** `const res = await sendFollowUp(...); if (!res.success) { showToast('ERROR', res.error?.message ?? ...); return; }`

---

### C3 — HIGH. A campaign blocked by `MISSING_SENDER_IDENTITY` looks perfectly healthy

**Files:** `context/CampaignContext.tsx:122-129`, `components/CampaignsListView.tsx:226-230`,
`components/CampaignDetailView.tsx:59-62`, `types.ts:143`,
`server/src/campaigns/routes.ts:169`, `server/src/campaigns/worker.ts:515-532`

`pausedReason` is declared in `types.ts:143` and returned by
`server/src/campaigns/routes.ts:169`. `grep -rn "pausedReason"` over `components/`, `src/`,
`services/`, `context/`, `hooks/`, `portal/` returns **the type declaration and nothing else** —
no component reads it.

**Failure scenario (this is the brief's §5, and it is worse than a generic error — it is
silence).** A user with no business name / postal address configured:

1. Builds a campaign in the wizard and clicks **Start Campaign**.
2. `POST /api/campaigns` succeeds — the create route does **not** check sender identity (I read
   the whole handler in `server/src/campaigns/routes.ts`; `assertSenderIdentity` is called only
   from `worker.ts:128` and `index.ts:592`).
3. `CampaignContext.addCampaign` toasts: *"Campaign 'X' activated. The outbound engine will
   begin dispatching shortly."* (`context/CampaignContext.tsx:128`)
4. On the next worker tick, `assertSenderIdentity` throws, the recipient claim is released, and
   the campaign gets `pausedReason: 'MISSING_SENDER_IDENTITY'` while `status` stays **ACTIVE**
   (`worker.ts:520-527`).
5. The campaigns list renders `<Badge variant={getStatusVariant(campaign.status)}>{campaign.status}</Badge>`
   — **ACTIVE**, 0% progress, 0 sent, indefinitely. `CampaignDetailView:61` is the same.

Nothing anywhere tells the user why, or that Settings → Sender identity is the fix.

**What does exist** (and is genuinely good): `components/SettingsModal.tsx:412-497` has a proper
Sender identity tab with an explanation of *why* it is required, an amber "Not configured yet —
campaign sending is currently blocked" alert (`:425-432`), and an amber dot on the tab itself
(`:217-222`). But the dot only renders once the modal is open **and** the
`/api/settings/sender-identity` fetch has resolved (`:49-70`), so the user must already be
looking in exactly the right place to see it.

**Fix.** Minimum: render `pausedReason` in `CampaignsListView` (a warning badge on the row and
a top-of-page banner when any campaign has one) with a link that opens Settings on the SENDER
tab. Better: call `GET /api/settings/sender-identity` when the wizard opens and block/annotate
**Start Campaign** with `configured === false`, so the "activated" toast is never a lie.

---

### C4 — HIGH. The campaign wizard wedges permanently, losing all entered work

**Files:** `src/features/campaigns/CampaignWizard.tsx:139-178`,
`src/features/campaigns/steps/Step3Setup.tsx:115-131`,
`src/features/campaigns/steps/Step4Review.tsx:165-170`

```ts
// CampaignWizard.tsx:139-146
const submit = async (asDraft: boolean): Promise<void> => {
  setSubmitError(null);
  setSubmitting(true);
  const main = sequence[0]?.variants[0];
  const scheduledAt = startNow ? new Date().toISOString() : new Date(startAt).toISOString();  // ← line 143
  const recipients = leads.map(wizardLeadToRecipient);

  try {                                                                                        // ← line 146
```

Line 143 is **outside** the `try`. `startAt` defaults to `''` (`:94`), `Step3Setup` renders the
`datetime-local` input with no `required` (`Step3Setup.tsx:124-131`), and `canAdvance(3)` only
checks that the name is non-empty (`CampaignWizard.tsx:114-115`).

**Failure scenario.** Import 800 leads (step 1), write a 3-stage sequence (step 2), on step 3
select **"Schedule for later"** and leave the date picker empty, advance to step 4, click
**Start Campaign**. `new Date('')` is Invalid Date, `.toISOString()` throws `RangeError`, the
`finally` at `:175` never runs, so `submitting` stays `true` forever. **Start Campaign**
(`Step4Review.tsx:166`) and **Save as Draft** (`CampaignWizard.tsx:278`) are both
`disabled={submitting}`, and `submitError` is still `null` so the footer shows nothing. The user
sees a permanently spinning "Starting…" button, no error, and the only way out is to close the
wizard — which discards the leads, the sequence and every setting.

**Fix.** Move the date computation inside the `try`, and gate step 3 on
`startNow || startAt.trim() !== ''` in `canAdvance`.

---

### C5 — MEDIUM-HIGH. Invoice **Send** double-fires and emails the client twice

**Files:** `components/ClientPortalView.tsx:856-860`, `server/src/invoices/routes.ts:180-220`

```tsx
// components/ClientPortalView.tsx:856-860
{inv.status === 'DRAFT' && (
  <Button size="sm" variant="secondary" onClick={() => sendInvoice(inv.id).then(load).catch((e) => setError(e.message))}>
    Send
  </Button>
)}
```

No in-flight state, no `disabled`, no confirmation. The server route is deliberately
non-idempotent for this case:

```ts
// server/src/invoices/routes.ts:191
if (existing.status !== 'DRAFT' && existing.status !== 'SENT') { ...409... }
```

DRAFT **or SENT** is accepted, and each accepted call sends the notification email
(`:203-215`).

**Failure scenario.** On a slow connection the admin double-clicks **Send** (the button stays
rendered until `load()` returns, several hundred ms later). Two `POST /api/invoices/:id/send`
requests fire; both pass the status check; every portal user of that client receives two
identical *"Invoice INV-00xx from YSX Visuals"* emails. On a chased/overdue invoice this reads
as dunning spam.

This was reported in `.plans/REVIEW-2026-07-25-frontend.md` as a MEDIUM double-submit gap and
is **still unfixed**, which is notable because every *other* mutating action in the same file
was fixed: `payBusy` (`:774`), `archiveBusy` (`:397`), `removeBusy` (`:401`), `deliverBusy`
(`:393`), plus ConfirmModals for archive and file removal (`:525-544`). Two smaller siblings are
also still unguarded: `submitFile` (`:444-453`) and `sendMsg` (`:455-464`) have no busy flag, so
a double-submit adds two file links / posts two identical messages to the client's portal.

**Fix.** A `sendingId` state, `loading={sendingId === inv.id}` on the button. Mirrors what the
Mark-paid flow already does.

---

### C6 — MEDIUM. Unibox reports a *successful* reply as a failure, inviting a duplicate send

**File:** `components/UniboxView.tsx:85-103`

```ts
try {
  await sendReplyToThread(selectedThreadId, replyText);
  const updatedThreads = await fetchInboxThreads();   // ← inside the same try
  ...
  showToast('SUCCESS', "Reply sent successfully.");
} catch (e) {
  showToast('ERROR', "Failed to send reply. Please try again.");
}
```

**Failure scenario.** The reply POST succeeds and the email goes out. The follow-up
`GET /api/unibox/threads` then fails — transient network, a 502 from the proxy, or a 401 whose
refresh fails. The user sees "Failed to send reply. Please try again.", the reply box still
holds their text (it is only cleared on the success path, `:94`), and the obvious action is to
press Send again. The prospect receives the same reply twice.

**Fix.** Split the two awaits; treat a refresh failure as "sent, list may be stale".

---

### C7 — MEDIUM. Portal never routes to the login screen when the session is lost mid-session

**Files:** `portal/App.tsx:11-27`, `portal/services/apiClient.ts:151-160`,
`portal/pages/DashboardPage.tsx:37-42, 88-93`

The CRM solved this properly: `services/authStorage.ts:32` exposes `onSessionCleared`, and
`context/AuthContext.tsx:43` subscribes with `setUser(null)` so a mid-session 401 that survives
a refresh drops the app back to `<LoginScreen/>`. The comment there (`:38-42`) describes exactly
the failure being avoided.

**The portal has no equivalent.** `portal/App.tsx:14` computes `const authed = Boolean(loadAuth())`
from module state at render time, and `clearAuth()` inside `apiRequest` (`:158`) notifies
nobody.

**Failure scenario.** A client leaves the portal tab open past the access-token TTL, or an admin
revokes their session. Their next action (opening a project, loading invoices) 401s; the refresh
fails; `clearAuth()` runs; `apiRequest` throws with the server's message. `DashboardPage`'s
`.catch` sets `error`, so the client is shown a raw
**"Refresh token has been revoked"** / **"This session was ended for security reasons. Please
sign in again."** alert (strings from `server/src/portal/auth.ts:302, 313`) sitting above a
spinner that never resolves, inside the still-rendered authenticated chrome. `Routes` does not
re-render, so neither the `!authed` redirect effect (`App.tsx:18-22`) nor `LoginPage` appears.

It does **not** loop or spam requests, and clicking any nav item recovers (that re-renders
`Routes`). But a client who just sits there is stuck looking at a security error with no sign-in
affordance. Given the rotation deploy will end sessions, this is the wrong screen to hand a
paying client.

**Fix.** Port the CRM's pattern: an `onSessionCleared` listener in `portal/services/apiClient.ts`,
with `App` holding `authed` in React state.

---

### C8 — MEDIUM. Analytics and Performance show fabricated numbers; a real, mounted endpoint sits unused

**Files:** `components/AnalyticsView.tsx:3, 161, 174, 200, 208-212`,
`services/mockZoho.ts:424-441`, `services/analyticsApi.ts` (whole file),
`components/PerformanceView.tsx:3`, `services/mockPerformance.ts:35-46`,
`server/src/index.ts:304`

- `AnalyticsView.tsx:3` imports `getFunnelMetrics` from **`../services/mockZoho`**, which counts
  hardcoded `mockLeads`/`mockEmails` arrays.
- `services/analyticsApi.ts` calls the real `GET /api/analytics/summary` — mounted at
  `server/src/index.ts:304` behind `requireAuth`/`requireActiveTenant` — and even exposes
  `sent/opened/clicked/bounced`. `grep -rn "analyticsApi"` across the repo: **zero importers.**
- On top of the mock, the page hardcodes: `{funnel.dmsSent + 142}` as "Sent Emails" (`:161`),
  `42.8%` as "Open Rate" (`:174`), `"+12% vs last period"`, `"+5.2% vs last period"`,
  `"-1.1% vs last period"`, and a fixed 12-bar "Engagement Overview" chart (`:208-212`).
- The page header reads *"Performance metrics for the last 30 days."*
- `PerformanceView` is the same shape: *"Performance & Money — Tracking the profitability and
  efficiency of your editing business"*, fed entirely by `MOCK_PROJECTS` in
  `services/mockPerformance.ts:35-46` (invented client names, fees, hours logged, revenue).

Neither page is labelled as demo data and neither respects `settings.useRealApi` — the same
toggle that drives the "Simulated"/"Live" pill in the header (`App.tsx:532-544`).

**Failure scenario.** The user switches to Live API mode, sees the "Gmail Live" pill, opens
Analytics, and reads an open rate, a sent count and a set of period-over-period deltas that
were never measured. Since `+142` is added to a mock count, the number is wrong in a way that
looks plausible rather than obviously placeholder.

**Fix.** Swap the import to `services/analyticsApi` and delete the hardcoded tiles/chart, or
label both pages as sample data until they are wired.

---

### C9 — MEDIUM. Local settings are wiped on every boot without a valid session

**Files:** `context/AuthContext.tsx:21-36`, `services/authStorage.ts:75-85`,
`context/SettingsContext.tsx:26-45, 74-77`

The boot effect always attempts a silent refresh and calls `clearAuth()` when it fails:

```ts
// context/AuthContext.tsx:22-28
refreshAccessToken().then((success) => {
  if (!success) { clearAuth(); setUser(null); return; }
  ...
```

`clearAuth()` fires the `onSessionCleared` listeners (`authStorage.ts:78`), and
`SettingsContext.tsx:74-77` responds by deleting `ysxflow_settings` and resetting to defaults.

That listener was added for a good reason — a shared browser used to leak the previous tenant's
OAuth client secrets and refresh tokens out of that blob. But those keys have since been
stripped on load (`REMOVED_SETTING_KEYS`, `SettingsContext.tsx:26-45`), so what it destroys now
is only the user's own preferences: email signature, default tone, active provider,
sandbox/live mode, auto-sync, lookback window. And its trigger is not "a tenant switched" — it
is "boot without a valid refresh cookie", which is every visit to the login screen.

**Failure scenario, amplified by this deploy.** After the rotation deploy every user's stored
refresh token is unknown to the server, so their first load runs `clearAuth()` and their
configured signature and provider selection are gone. They log back in to a workspace reset to
defaults, and (because `useRealApi` resets) the header flips back to "Simulated".

**Fix.** Either move these preferences server-side alongside the sender identity, or scope the
storage key per user id and stop clearing it on a plain boot-without-session.

---

### C10 — MEDIUM. Campaign detail always reports "0 Recipients" and an empty recipients table

**Files:** `server/src/campaigns/routes.ts:139`, `App.tsx:411-415`,
`components/CampaignDetailView.tsx:75, 179-189`

`toClientCampaign` hardcodes the field:

```ts
// server/src/campaigns/routes.ts:139
recipients: [] as { email: string; name: string; company: string }[],
```

`App.tsx:412` resolves the detail view's campaign out of the API-backed list
(`campaigns.find(c => c.id === selectedCampaignId)`), so this empty array is what the view
always receives.

**Failure scenario.** The user builds a campaign from a 5,000-row CSV, opens it, and the header
reads **"0 Recipients"** (`CampaignDetailView.tsx:75`) with an empty Recipients tab
(`:179-189`). The natural conclusion is that the import failed, and the natural remedy is to
re-import or duplicate — creating exactly the kind of state the recipient upsert was designed to
avoid. Separately, `:185` hardcodes every recipient's status badge to "Pending", so even once
the array is populated the column would be wrong.

**Fix.** Include recipients (or at least a count) in `toClientCampaign`, or drop the count and
the tab until they are backed.

---

### C11 — LOW-MEDIUM. Portal project page replaces itself with "Couldn't load this project" after an action that succeeded

**File:** `portal/pages/ProjectPage.tsx:54-58, 62-69, 78-116`

`load()`'s only failure handling is `setError(e.message)`, and `error` is rendered as a
**full-page replacement** (`:62-69`) that is never cleared. `load()` is called after every
mutation: `submitRevision` (`:85`), `approve` (`:97`), `sendMessage` (`:109`).

**Failure scenario.** A client posts a message. The POST succeeds. The follow-up
`GET /api/portal/projects/:id` hits a transient failure. The entire project page — timeline,
files, revisions, message history — is replaced by *"Couldn't load this project"* and a "Back to
projects" button, immediately after an action that worked. Nothing distinguishes this from the
project having been deleted.

The same "error replaces the page and is never cleared" shape is in
`portal/pages/InvoicesPage.tsx:38, 117` and `portal/pages/FaqPage.tsx:17`.

---

### C12 — LOW. Dead controls that look functional

- `App.tsx:545-547` — header **Sync Now** button: no `onClick`.
- `components/CampaignsListView.tsx:135-142` — toolbar **Download CSV**: no `onClick`
  (has `aria-label` and `title`, so it reads as functional to screen readers too).
- `components/CampaignsListView.tsx:327-329` — row menu **Download CSV**: no `onClick`.
- `components/CampaignsListView.tsx:330-332` — row menu **Share**: no `onClick`.
- `components/CampaignsListView.tsx:119-126` — the status-filter trigger has no `onClick`; the
  dropdown opens on `group-hover` only, so it is unreachable by keyboard.
- `components/CampaignsListView.tsx:202` — per-row selection checkbox is uncontrolled with no
  handler and no bulk action anywhere in the view.
- `src/features/campaigns/CampaignWizard.tsx:241-242` — **Run spam test** / **Send test email**
  are `window.alert('… is not yet implemented.')`. Honest, but on the final review step of a
  campaign about to send to thousands of people, "send a test email first" is the one control
  a user will reach for.

This is the same class as the `UniboxView` "Archive conversation" button reported on 2026-07-25
(that one is now gone — see §4).

---

### C13 — LOW. Unresolved-request races on tab/param switches

No cancellation guard on any of these effects, so an older response can overwrite a newer one:

- `portal/pages/DashboardPage.tsx:37-42` — toggling Active/Archive quickly can render the
  archived list under the Active tab. Same client's own data, so no cross-client exposure — just
  a wrong list with no indication.
- `portal/pages/InvoicesPage.tsx:113-115`, `portal/pages/ProjectPage.tsx:54-60`,
  `components/ClientPortalView.tsx:127-130, 268-272, 403-419, 776-781` — same shape.

`components/ScraperView.tsx`, `components/LeadsView.tsx` and `components/UniboxView.tsx` all use
an `isMounted` ref properly, so the pattern is understood in this codebase; these are the places
it was not applied.

---

### C14 — LOW. The 2026-07-25 "OAuth error-code mismatch" moved rather than disappeared

**Files:** `components/IntegrationsView.tsx:108-130`, `services/mailGateway.ts:99`,
`types.ts:215-227`

`IntegrationsView` keys its per-integration error highlighting on
`appError.code === AppErrorCode.AUTH_EXPIRED` (`:110`). After the `oauth-api` removal, the only
producer of an auth-class `AppError` in the whole frontend is `mailGateway.ts:99`, which throws
`AppErrorCode.AUTH_ERROR`. `types.ts:221-222` says `AUTH_EXPIRED` was "retained for the
gateway/mailbox paths" — but the gateway path does not raise it.

**Failure scenario.** A mailbox's credentials expire. Fetching mail 401s. The Integrations page's
"needs attention" state (`:116-127`) never lights up, so the one screen dedicated to connection
health shows the mailbox as fine. Impact is limited to a missing warning — unlike the original
finding, nothing gets stuck — which is why this is LOW.

---

## 3. Suspected but unproven

**S1 — Mixed-currency outstanding balance.** `server/src/portal/routes.ts:285-290` sums
`amountCents` across invoices with no currency grouping, and
`portal/pages/InvoicesPage.tsx:46` labels the total with `data.invoices[0]?.currency ?? 'usd'`.
A client holding one USD and one EUR invoice would be shown the numeric sum in whichever
currency the newest invoice happens to use. **Latent today:** the create schema defaults to
`'usd'` (`server/src/invoices/routes.ts:29`) and the admin UI never sends a currency
(`ClientPortalView.tsx:803-809`, `portalAdminApi.ts:97` has it optional and unused). *What would
settle it:* whether any non-USD invoice has ever been created — one query once Neon is back.

**S2 — The follow-up "Schedule" path does not schedule anything.**
`components/ComposeFollowUp.tsx:159-166` calls the same `onComplete` as the immediate-send path,
and `DashboardView.tsx:150-152` uses the `date` argument **only** to choose the toast wording —
`sendFollowUp` sends immediately either way. My first read of this was as a HIGH; it is not,
because the entire scheduling block is `disabled={settings.useRealApi}`
(`ComposeFollowUp.tsx:622, 648, 653, 663`) with an explicit "Scheduling is not supported…"
warning at `:606-611`. So in live mode the control cannot be operated. What remains true in
sandbox mode: the confirmation dialog states *"This email will be automatically sent on
&lt;date&gt; if no reply is received"* (`:239`) and the panel states *"It will send
automatically if no reply is received"* (`:688`), and neither is true in any mode. *What would
settle the residual risk:* whether the `useRealApi` guard is ever intended to be lifted without
also rewiring `handleActionComplete` — if so, the immediate-send would ship silently.

**S3 — Whole-array rollbacks in CampaignContext.** `deleteCampaign` (`:138, 144`) and
`renameCampaign` (`:189, 195`) capture `campaigns` and restore the entire array on failure, so a
rollback can revert an unrelated concurrent change (e.g. a rename that landed while a delete was
in flight). `toggleCampaignStatus` (`:159`) does it correctly, per-item. Requires two
overlapping mutations to observe; I could not construct a scenario a single user would hit
reliably.

---

## 4. Claims verified as correct

### Earlier findings spot-checked as genuinely fixed

| 2026-07-25 finding | Status |
|---|---|
| #1 Three follow-up calls bypass refresh-and-retry | **Fixed.** `services/followupApi.ts:22-41` now has a local `authFetch` with refresh-and-retry, used by all three (`:104, 124, 139`). |
| #2 `AUTH_ERROR` vs `AUTH_EXPIRED` leaves the app stuck | **The stuck state is gone** — the `clearToken` branch was removed with the transport; no `AUTH_ERROR` handling remains in `hooks/useEmailProvider.ts`. A vestige of the mismatch survives elsewhere: see C14. |
| #3 OAuth client secrets + refresh tokens in localStorage | **Fixed.** `grep -n "ClientSecret\|RefreshToken\|ClientId" types.ts` → no matches; `REMOVED_SETTING_KEYS` (`SettingsContext.tsx:26-45`) strips them from any already-persisted blob before it is spread back into state. |
| #4 `oauth-api` transport is dead | **Removed.** No `services/realGoogle.ts` / `realZoho.ts` in the tree; `SettingsModal.tsx:121-126` and `:313-320` document the removal; transport is now a single informational card. |
| #5 Both portal tokens in localStorage | **Fixed.** Access token in memory only, refresh in an HttpOnly cookie, and the legacy `ysx_client_auth` key is actively purged on boot (`portal/services/apiClient.ts:17, 70-76, 85`). |
| #6 Magic-link token persists in history | **Fixed.** `router.tsx:33-40` implements `replace`; `LoginPage.tsx:35` and `:60` use `{ replace: true }` after consuming a magic link and after set-password. |
| `API_URL` defaulting to localhost in five files | **Fixed.** `?? ''` in `apiClient.ts:3`, `followupApi.ts:6`, `mailGateway.ts:5`; the other two files no longer exist. |
| Double-submit: campaign pause/resume, Duplicate, Add Lead, Archive, Remove file-link | **Fixed.** `togglingId`/`duplicatingId` (`CampaignsListView.tsx:33-35, 262-275, 309-326`), `isAddingLead` (`LeadsView.tsx:42, 85, 107`), ConfirmModals + busy flags for Archive and Remove (`ClientPortalView.tsx:396-401, 525-544`). **Invoice Send is the one that was missed** — C5. |
| `UniboxView` "Archive conversation" button with no `onClick` | **Gone** — the button was removed. |
| `AuthContext` hydration effect has no cancellation guard | **Still absent, and now harmless.** Both branches only ever call `setUser` once, `AuthProvider` never unmounts (it wraps the whole app in `index.tsx:20-22`), and React 18 no longer warns on setState after unmount. Not re-reported. |

### Things I checked and found genuinely fine

- **XSS — clean, verified independently of the earlier review.**
  `grep -rn "dangerouslySetInnerHTML\|innerHTML\|eval("` over `components/`, `src/`, `services/`,
  `context/`, `hooks/`, `portal/`, `App.tsx`, `index.tsx`, `types.ts` → **zero matches**. The only
  interpolated `href`s are `ClientPortalView.tsx:647` and `portal/pages/ProjectPage.tsx:192`,
  both wrapped in `safeHttpUrl` (`services/safeUrl.ts:13-24`), which parses with `new URL` and
  returns `undefined` for anything outside `http:`/`https:` — so a stored `javascript:` URL
  renders inert rather than dangerous. Attacker-influenced content (inbound email bodies at
  `UniboxView.tsx:321`, scraped channel names, portal messages at `ProjectPage.tsx:296`, admin
  messages at `ClientPortalView.tsx:714`, invoice notes and line-item labels at
  `InvoicesPage.tsx:165, 172`) is all rendered as escaped JSX text children.
- **Cross-tenant / cross-client state.** No leak found.
  - Portal: auth state is a single module-level variable, cleared by `logout()`, and every data
    view unmounts when `Routes` switches to `LoginPage`. No `localStorage`/`sessionStorage`
    caching of client data anywhere in `portal/`.
  - CRM: `clearAuth()` fans out to `SettingsContext` (`:74-77`) and `App.tsx:291-294` resets
    `scraperBusy`; `CampaignContext` empties its list on `isLoggedIn === false` (`:92-95`);
    `LeadsView`, `UniboxView`, `ScraperView`, `ClientPortalView` all unmount because
    `AppContent` returns `<LoginScreen/>` before `renderView` (`App.tsx:380-382`).
  - The one residue is benign: `currentView` and `selectedCampaignId` survive in `AppContent`
    state across a logout, but `campaigns.find(...)` returns undefined for the previous tenant's
    id and `App.tsx:413` renders `null`. No data crosses.
- **CRM 401 handling under the rotation deploy.** No loop, no request storm, no blank screen.
  `refreshAccessToken` de-duplicates concurrent refreshes through a module-level promise
  (`services/apiClient.ts:15-49`); `apiRequest` attempts **exactly one** refresh + one retry and
  then throws (`:92-100`); a failed refresh calls `clearAuth()` which drives `AuthContext` back
  to `<LoginScreen/>` via `onSessionCleared`. The boot path (`AuthContext.tsx:21-36`) fails
  closed to the login screen. `apiDownload` (`:124-143`) has the same one-shot behaviour.
- **`UniboxView.tsx:224` — `thread.messages[thread.messages.length - 1].content` is safe**,
  despite looking like an unguarded index. `toThread` (`server/src/unibox/routes.ts:57-63`)
  unconditionally pushes a synthetic "Initial outreach sent." message before anything else, so
  the array is never empty. `leadCompany` is coalesced to `''` server-side (`:85`), so the
  `.toLowerCase()` filters at `UniboxView.tsx:123-125` cannot throw either. **Not a finding** —
  noting it because it is exactly the shape a pattern-matching review reports as a white screen.
- **`portal/pages/InvoicesPage.tsx:83, 126` — `STATUS_BADGE[inv.status]` has no `DRAFT` entry**,
  which would render `badge.variant` on `undefined`. Safe: the portal routes filter
  `status: { notIn: ['DRAFT', 'CANCELLED'] }` on both the list and the detail
  (`server/src/portal/routes.ts:269, 299`). The `CANCELLED` branch at `InvoicesPage.tsx:180` is
  therefore dead code, not a bug. **Not a finding.**
- **`ProjectPage`/`SettingsModal` early returns before function declarations** are not hook-order
  violations — every `useState`/`useEffect`/`useCallback` in both files precedes the first
  conditional `return` (`ProjectPage.tsx:45-60` before `:62`; `SettingsModal.tsx:29-72` before
  `:91`).
- **`Button loading` really does disable** (`src/design/ui/Button.tsx:64`,
  `disabled={disabled || loading}`), so the `loading={busy}` guards throughout
  `ClientPortalView`, `LeadsView` and the portal pages are effective rather than decorative.
- **`ConfirmModal` closes on confirm** (`components/ConfirmModal.tsx:40`), so the archive/delete
  flows cannot be fired twice from the modal.
- **`Modal`** handles Escape, focus-on-open and focus-restore-on-close
  (`src/design/ui/Modal.tsx:46-66`).
- **`window.confirm` return values are checked** at both remaining call sites
  (`ScraperView.tsx:243`, `UniboxView.tsx:299`).
- **Gemini** is proxied — `services/gemini.ts:25` posts to `/api/gemini/generate`; no API key,
  no direct SDK import.
- **`npx tsc --noEmit` → exit 0.** Worth stating explicitly: this is why C1 survived. The
  declared `PortalAuthState.clientUser` is non-optional, so the compiler asserts a response shape
  the server never produces.

---

## 5. Could not determine

- **Anything requiring execution.** The database is offline until 2026-08-05 and the brief
  forbids testing against the live app, so no finding here was reproduced at runtime. Each is
  traced through source on both sides of the wire.
- **Whether C1 is currently visible in production.** HANDOFF records prod as running the
  `d573af5` build from Jul 26 with `dist/` from 15:47. I did not diff that bundle against this
  branch, so I cannot say whether the deployed portal already has this or whether it arrives
  with the next deploy. Worth checking before shipping — it is the difference between "a
  regression we are about to introduce" and "clients are hitting this right now".
- **The production `JWT_ACCESS_TTL`.** It comes from the environment (`config.ts`); the comment
  at `server/src/index.ts:210-213` implies ~15 min. This only affects how quickly a client
  reaches C7, not whether they do.
- **Whether any non-USD invoice exists** (S1) — needs one query against live data.
- **Partially read files.** `services/gemini.ts` (prompt construction only skimmed),
  `services/mockZoho.ts` (only `getFunnelMetrics` and the thread helpers),
  `components/ScraperView.tsx:430-928`, `src/features/campaigns/steps/Step1ImportLeads.tsx`
  (CSV parsing not line-by-line), `Step2Sequences.tsx`, `components/BrandOSView.tsx`,
  `components/StoryVaultView.tsx`, `components/DocumentationView.tsx`,
  `components/EmailCard.tsx`, and `src/design/ui/*` other than `Button`, `Modal` and the barrel.
  These are the lowest-risk surfaces in scope (no money, no auth, no tenant boundary), which is
  why they were deprioritised — but they are not covered.
- **Response-type cross-checks** between `services/scraperApi.ts` / `services/portalAdminApi.ts`
  and their routes were not done field-by-field; this gap was also flagged in the 2026-07-25
  review and remains open.

---

## 6. Suggested order

1. **C1** — portal blank screen. One-character mitigation (`auth?.clientUser?.email`) plus a
   real fix on the refresh payload. Nothing else matters if clients cannot load the portal.
2. **C3** — surface `pausedReason`. This is the first thing the user hits after deploying, and
   right now the app gives them nothing to act on.
3. **C4** — move one line inside the `try`. Prevents total loss of wizard work.
4. **C2** — check `sendFollowUp`'s return value. Small, stops the app lying about a send.
5. **C5** — a `sendingId` guard on invoice Send. Stops double-emailing paying clients.
6. **C7** — port `onSessionCleared` into the portal. Directly relevant to the rotation deploy.
7. **C9** — stop wiping settings on a plain boot-without-session, before the deploy logs
   everyone out.
8. **C6, C10, C8, C11** — correctness of what the UI claims.
9. **C12, C13, C14** — dead controls, request races, the vestigial error code.
