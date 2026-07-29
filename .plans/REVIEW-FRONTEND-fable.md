# Frontend review — 2026-07-29 (Fable 5, planner)

> **STATUS 2026-07-29 (later): the execution plan in §9 has been carried out by Opus 5,**
> plus F8, the far more serious F9 it exposed, and F10–F12 from a follow-on sweep of the surfaces
> the review had not reached. All uncommitted. Root `tsc` clean, **43** frontend tests (19 → 43,
> 4 new files), server `tsc` clean, **353** server tests (328 → 353).
> Every new test was mutation-checked by performing the mutation and confirming the failure, then
> restoring — the mutations and their results are recorded in each test file's header comment.
>
> **F9 is the headline and it changes send behaviour on deploy day — read it before shipping.**
> `addCampaign` discarded all thirteen sending-configuration fields the wizard collects, so every
> campaign ever created sent 24/7 unthrottled while the UI displayed the throttle the user chose.
> Fixing it means throughput now drops ~10× to what was always intended.
>
> Two things changed during implementation and are worth reading before the next pass:
> - **The first cut of E1 introduced the defect it was fixing.** A single in-flight flag would have
>   made "Send invoice B while A is in flight" a silent no-op. Caught by reading the diff, not by
>   the tests. The guard is now per-invoice, and `sends two different invoices concurrently`
>   exists specifically to fail if anyone narrows it again.
> - **One new defect was found while checking an interaction and deliberately NOT fixed** — see
>   F8 below. It needs its own test and a decision, not a late-session patch.

Checkout `C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring`, HEAD `6f158b7`
(one commit past the brief's `df9a0e0` — the extra commit only adds the review brief itself; tree
clean). Production untouched. Read-only review; nothing in application source was modified.

## 1. Summary

I cross-checked every client-side response type against the server route that populates it
(section 1 of the brief), swept for remaining mock imports, reviewed the campaign wizard against
the server's zod schemas, and re-checked the services error-handling classes. Findings below.

**Premise correction first (the brief asked for this):** the brief states that everything the
2026-07-28 frontend review found "that verified as real is already fixed". That is not true.
C1/C2/C3/C4/C6/C14 are fixed; **C5 (invoice Send double-click → client double-emailed), C10
("0 Recipients" on every campaign detail), and most of C12 (dead Download CSV / Share buttons)
are still live**, and C12 is now stranger than before: the server-side CSV endpoint the buttons
need was built (`server/src/campaigns/routes.ts:375`, spot-checked live per HANDOFF) and has
zero frontend callers.

The type cross-check found **no new white-screen-class mismatch**. The three historical instances
(portal refresh, ScraperView `cancelling`, portal shell) are all fixed, the fixes verify, and the
remaining `Record`-over-union lookups are either genuinely exhaustive or string-keyed with
fallbacks. The one contract mismatch that persists is `Campaign.recipients` (server always sends
`[]`) — wrong rendering, not a crash.

The most consequential new finding is in the wizard: **deselecting all seven Active Days produces
`sendDays: 0`, which the server accepts (`z.number().min(0)`) and which
`isWithinSendWindow` then evaluates as "no day is ever a send day"** — an ACTIVE campaign that
silently never sends anything, with no pausedReason, no error, and no UI hint. Same silent-failure
family as `MISSING_SENDER_IDENTITY`, but with no banner even planned.

Would I ship this frontend to a paying client on 2026-08-05? **Yes, with E1–E3 of the execution
plan landed first** (invoice double-send guard, sendDays=0 refusal, PerformanceView removal or
labelling). The portal — the surface the paying client actually sees — is in materially better
shape than the CRM: shapes match, auth is correct, XSS was re-verified clean on 07-28, and I found
nothing new there. The CRM's remaining defects embarrass the operator rather than the client,
except the invoice double-send, which emails the client twice.

## 2. Confirmed defects

### F1 — Invoice **Send** still double-fires and double-emails the client — MEDIUM-HIGH, pre-deploy
`components/ClientPortalView.tsx:857`. Verbatim the 07-28 review's C5, reported 07-25 and 07-28,
still unfixed while every sibling action in the same file got a busy flag (`payBusy:774` etc.).
`onClick={() => sendInvoice(inv.id).then(load)...}` — no disabled, no in-flight state. The server
route deliberately accepts DRAFT **or** SENT (`server/src/invoices/routes.ts:191`) and sends the
notification email on each accepted call; the 07-29 T5 fix corrected the loser's *response body*
on a concurrent race but did not make the route reject a second send. Failure: slow connection,
double-click, two `POST /api/invoices/:id/send`, client receives two identical invoice emails.
Proof: read both sides; the button stays enabled until `load()` resolves.

### F2 — Wizard allows "no send days"; server accepts it; campaign never sends, silently — MEDIUM, pre-deploy
`src/features/campaigns/steps/Step3Setup.tsx:156-173` (day toggles, nothing stops deselecting all
seven), `CampaignWizard.tsx:35-37` (`scheduleToSendDaysBitmask` → `0`), server
`campaigns/routes.ts:83` (`sendDays: z.number().int().min(0).max(127)` — 0 is valid),
`campaigns/engine.ts:75` (`sendDays != null && (0 & dayBit) === 0` → `false` on every day).
Failure scenario: user un-toggles all days (e.g. while cycling through them), starts the campaign,
toast says "activated", status shows ACTIVE, 0 sent forever. Unlike `MISSING_SENDER_IDENTITY`
there is no pausedReason — the worker just never finds it within its window, so nothing anywhere
records why. Fix on both sides: wizard `canAdvance(3)` requires ≥1 day; server rejects `sendDays === 0`
(or treats it as null) since 0 is never a meaningful configuration.

### F3 — PerformanceView: an entire routed screen of invented data — MEDIUM, pre-deploy (given by the brief; disposition below)
`components/PerformanceView.tsx:4` ← `services/mockPerformance`, routed at `App.tsx` case
`'PERFORMANCE'`. Every figure invented. **Recommendation: remove the nav entry and the route case**
(do not delete the files). Reasoning: there is no backing data model (fees, hours logged), so
"build the endpoint" is a multi-day schema project no one has scheduled before 08-05; a "sample
data" label on a money screen in a CRM the operator sells with is still a credibility hole; hiding
it is one small diff, reversible the day the data model exists.

### F4 — ComposeFollowUp feeds fixture emails into real AI drafts — LOW-MEDIUM
`components/ComposeFollowUp.tsx:103` calls `fetchSentEmails()` (mockZoho fixtures) to build
"style mimicry" examples for `generateFollowUpDraft`, **in live mode too** — the scheduling
controls are gated on `useRealApi` (`:606-665`) but this call is not. Failure: in Live mode, a
real follow-up draft to a real prospect is style-conditioned on three fictional emails written by
the fixture author, not the user. Silent — the user just gets drafts that don't sound like them.
Fix: gate on `settings.useRealApi` — skip examples (or use `gwFetchSent`) in live mode.
Sweep result: these two screens are the **only** live mock importers — `grep mockZoho|mockPerformance`
over components/src/portal/context/hooks/services returns only PerformanceView:4,
ComposeFollowUp:5, plus comments/strings (`SettingsModal.tsx:559` is display copy).

### F5 — Campaign detail still shows "0 Recipients" for every campaign — MEDIUM
Still-live C10. `server/src/campaigns/routes.ts:140` hardcodes `recipients: []`;
`CampaignDetailView.tsx:75,179` renders the count and the tab from it. Meanwhile
`GET /api/campaigns/:id/recipients` (`routes.ts:375-423`) returns the real rows **including
per-recipient status** (which would also fix the hardcoded "Pending" badge) and has zero frontend
callers. Failure: 5,000-row import reads "0 Recipients"; user re-imports; duplicate-avoidance
machinery gets exercised for no reason. Fix: fetch the endpoint from the detail view.

### F6 — Dead toolbar controls persist; the CSV one now has a working backend — LOW
Still-live C12 subset, re-verified: `CampaignsListView.tsx:162-169` (toolbar Download CSV, no
onClick), `:371-373` (row Download CSV, no onClick), `:374-376` (Share, no onClick). The row CSV
button's backend (`?format=csv`, correct headers, formula-escaped) exists and was live-tested per
HANDOFF:1941. Wiring it is ~5 lines via the existing `apiDownload` helper; Share should be removed.

### F7 — `Campaign.recipients` type asserts a shape the server never sends — LOW (documentation of the contract gap behind F5)
`types.ts:115` declares `recipients: Recipient[]` non-optional and `toClientCampaign` always sends
`[]`. Not a crash (empty array is safe everywhere), but it is the same "client type asserts what
the server doesn't send" class, and it is what lets F5 typecheck. If F5 is fixed by a separate
fetch, change the type to reflect reality (drop the field or mark it "always empty; see
/recipients endpoint").

### F13 — Unsubscribed people could still be emailed by hand — HIGH — **fixed**
`server/src/mail/routes.ts` POST `/send`, `server/src/unibox/routes.ts` POST `/threads/:id/reply`.

`suppression.ts` states the contract in its own comment: *"Callers on the send path check
isSuppressed() separately."* Four callers send mail. **Two honoured it, two did not:**

| Send path | DNC checked | Suppression checked |
|---|---|---|
| Campaign initial (`campaigns/worker.ts:429`) | yes | yes |
| Campaign follow-up (`index.ts:402`) | yes | yes |
| Unibox manual reply | yes | **no** |
| `POST /api/mail/send` (Dashboard follow-up composer) | **no** | **no** |

`POST /api/mail/send` had no opt-out enforcement of any kind. So a person who clicked unsubscribe
— the mechanism the campaign path fails closed to provide — could still be emailed from the
Dashboard composer, and the Unibox reply would reach anyone whose suppression record outlived their
Lead row (the suppression list exists precisely because it survives lead deletion).

Failure scenario: a prospect clicks unsubscribe. The campaign engine correctly stops. The operator
opens the Unibox or the Dashboard, sees the thread, and sends a manual "just circling back" — which
goes out. The one guarantee the unsubscribe link makes is broken by the two paths a human drives.

Fixed by checking DNC + suppression on both, per address, before any mailbox work. 5 new tests in
`dnc.test.ts` (multi-recipient, and the no-Lead-row case, both covered); each guard mutation-checked.

### F14 — Two send paths carry no unsubscribe link or postal address — HIGH — **FIXED (HMAC token, operator-approved)**

**Wired 2026-07-29 on the operator's decision.** Both manual paths now carry the same legal footer,
the same RFC 8058 headers, and the same fail-closed sender-identity check as the campaign path.

How, without a migration (the DB is offline until 08-05 and three migrations are already pending):

- **New address-scoped token** (`campaigns/trackingToken.ts`):
  `signAddressUnsubscribeToken(userId, email)` HMACs `"a" NUL userId NUL email` with the existing
  `TRACKING_SECRET`, so the opt-out URL needs no stored row. Domain-separated from the click (`"c"`)
  and recipient (unprefixed) tokens — **and that separation is load-bearing, not decorative**:
  without it the address payload `userId\0email` base64-decodes as a "recipientId" and
  `verifyTrackingToken` recomputes the *same* HMAC, so the two families collide outright. Proven by
  mutation: removing the separator makes the domain-separation test fail.
- **Tenant is inside the MAC**, so a token cannot be replayed to opt an address out of another
  agency's mail.
- **`unsubscribeUrlForAddress()`** (`campaigns/trackedHtml.ts`) mints the URL on the same public
  `/t/u/:token` route; `unsubscribeByToken` tries the address family first, then the recipient one.
- **The opt-out writes to the Suppression list** (`suppress(..., 'UNSUBSCRIBE')`) — unconditionally
  and *before* touching the Lead, because that record is keyed on the address and survives the lead
  being deleted. Flipping the Lead to DNC and running `enforceDnc` is best-effort on top.
- **Both send paths** now call `assertSenderIdentity()` and append `complianceFooter()` +
  `unsubscribeHeaders()`. `/api/mail/send` **refuses a multi-recipient send** (400
  `MULTIPLE_RECIPIENTS`): one message cannot carry a correct per-recipient opt-out link, and a wrong
  one would unsubscribe somebody else. Nothing sends multi today (`gwSend` takes a single address),
  so this closes the shape rather than a use case.

9 new tests in `server/src/__tests__/manualSendCompliance.test.ts`, asserting the **wiring** — the
bytes handed to SMTP — not the rule. A unit test on `complianceFooter()` would have passed happily
for this bug's entire life, which is this repo's own `isNotAHumanReply` lesson.

The end-to-end test is the one that matters: it reads the `List-Unsubscribe` URL out of the sent
message, POSTs it back to `/t/u/:token`, and asserts the *next* send to that address is refused
409 `SUPPRESSED`. Footer → link → opt-out → enforcement, closed loop.

> ⚠️ **BEHAVIOUR CHANGE — the manual paths now fail closed.** Until Settings → Sender identity has a
> business name and postal address, the Unibox reply and the Dashboard follow-up composer return
> 409 `MISSING_SENDER_IDENTITY` and send nothing. That is the campaign path's existing rule applied
> consistently, and HANDOFF already lists the postal address as a NO-GO item — but note it was
> previously the *only* thing those two paths did not check, so they worked before and will now
> stop until configured. Both screens surface the server's message verbatim, so the user is told
> exactly what to fix.
`complianceFooter()`, `unsubscribeHeaders()` and `assertSenderIdentity()` have **exactly two call
sites each, all on the campaign path** (`campaigns/worker.ts`, `index.ts`). The Unibox manual reply
and `POST /api/mail/send` add none of them: no visible unsubscribe link, no postal address, no RFC
8058 headers, and no sender-identity check — the campaign path *refuses to send* without these, and
HANDOFF lists the postal address as a NO-GO item that blocks sending. Both manual paths bypass that
gate entirely.

Why the machinery does not simply extend: the unsubscribe URL is built by
`unsubscribeUrlForRecipient(recipient.id)` from a **CampaignRecipient** row, and a one-off email to
a prospect has none. That is why the footer block is gated on `if (job.campaignId && job.leadId)`.

**Not fixed here, deliberately, and this needs your decision:**
- It is a legal question before it is a code question — whether a 1:1 manual reply in an existing
  thread needs the same footer as a cold blast is a judgement I should not make silently on your
  behalf.
- A migration-free design does exist and is what I would build: an HMAC unsubscribe token over
  `(userId, email)` signed with the existing `TRACKING_SECRET`, verified by the unsubscribe route,
  writing to the **suppression list that already exists** — no new table, no migration, and it
  composes with F13's new enforcement. Worth noting the DB is offline until 2026-08-05 and three
  migrations are already pending, so a schema-touching alternative is the wrong shape right now.

### F12 — Every AI failure reached the user as the wrong explanation — MEDIUM — **fixed**
`server/src/gemini/routes.ts` (5 responses), `components/BrandOSView.tsx:26`,
`components/StoryVaultView.tsx:29`, `components/ComposeFollowUp.tsx:123`.

Two independent losses stacked on the same path — **the eighth instance of the value-nothing-reads
class**:

1. **Server side.** The proxy answered `{ ok: false, error }`, but its only client reaches it
   through `apiClient.parseError`, which reads `data.code` / `data.message` and falls back to
   `res.statusText`. Every diagnostic the route carefully writes — "Gemini is not configured on
   this server (GEMINI_API_KEY unset)", the upstream quota message, the safety `blockReason` — was
   dropped on the floor and delivered as bare "Not Implemented" / "Bad Gateway". Every other route
   in the server already used `{ code, message }`; this one was the outlier.
2. **Client side.** Even a good message was then discarded. `BrandOSView` and `StoryVaultView`
   replaced it with *"An unexpected error occurred. Please check your network and try again."* —
   actively misleading, since it sends the user to debug the one component that is working.
   `ComposeFollowUp.handleGenerate` did not surface anything at all: `console.error` only, so the
   spinner stopped, no draft appeared, and the UI gave no reason whatsoever.

Failure scenario: `GEMINI_API_KEY` is unset on the box (its own 501 exists precisely to say so).
The user clicks **Generate Follow-up Draft** and gets a spinner that stops and nothing else. In
Brand OS they are told to check their network. Nothing anywhere names the actual cause, which is a
one-line server config fix.

Fixed at both ends: the route now returns `{ code, message }` (`NOT_CONFIGURED`, `VALIDATION`,
`RATE_LIMIT`, `UPSTREAM`, `EMPTY_RESPONSE`, `TIMEOUT`), and all three screens show the server's
message with their generic string as fallback. New `server/src/__tests__/geminiProxy.test.ts`
(5 tests) pins the shape — the route had no tests at all.

### F10 — The follow-up composer claimed to schedule; nothing schedules — MEDIUM — **FIXED (now genuinely schedules)**

**Wired 2026-07-29, after F14 made it safe to.** Scheduling now queues a real server-side job.

What was actually in the way, and what it cost to remove:

- `POST /api/followups/schedule` demanded a non-empty `campaignId` **and** `originalMessageId`.
  The only UI offering scheduling has neither — a one-off email belongs to no campaign, and an
  IMAP message often carries no Message-ID. Both are now `.optional()`, matching the DB, where
  `campaignId String?` and `originalMessageId String?` were **already nullable — no migration**.
- `followupScheduler.ts` threw `"campaignId is required"`. Removed, with a comment naming the trap.
- `sendFollowupJob`'s footer was gated on `if (job.campaignId && job.leadId)`. It now has an
  `else` branch stamping the same footer via `unsubscribeUrlForAddress` (F14's token). Without
  that, wiring scheduling would have re-opened the hole F14 had just closed.
- Client: `useEmailProvider.scheduleFollowUp()` calls the route; `DashboardView` finally uses the
  `date` it had been discarding; the composer's controls are live again.

**A timezone bug found while wiring, that would have shipped:** the composer handed over
`` `${scheduledDate}T09:00:00` `` — a local wall-clock string with no offset. The server would have
parsed it in *its own* timezone, so "9am" set in Los Angeles fires at 9am UTC, eight hours early.
Harmless while nothing consumed the value; the moment it schedules a real send it has to be an
instant, so it is now `new Date(...).toISOString()`.

3 new tests (`oneOffFollowupSchedule.test.ts`), both claims mutation-checked. Restoring the
required `campaignId` fails the accept test; deleting the else-branch footer fails the compliance
test.

**One existing test legitimately broke and was right to.** `followupReplyGate.test.ts` drives
`sendFollowupJob` with campaign-less jobs, which now take the new footer branch and call
`assertSenderIdentity` — its prisma mock had no `user` model. The failure was the change reporting
itself accurately: those jobs previously went out with no footer at all. Mock extended; the file
still tests reply gating.

> **Why scheduling is still not wired, after investigating it properly.** The request was to wire
> it. I traced the whole path and stopped for one specific reason, not squeamishness:
>
> - The plumbing *is* wireable. `sendFollowupJob` guards its campaign logic with
>   `if (job.campaignId)`, so a job with no campaign correctly skips the campaign-exists, paused and
>   send-window checks; and the reply gate treats `originalMessageId` as optional with an
>   In-Reply-To → References → subject fallback. Making `campaignId`/`originalMessageId` optional in
>   `scheduleSchema` and dropping the `throw` in `followupScheduler.ts` is a small change.
> - **The trap:** synthesising a `campaignId` (the obvious shortcut) is silently fatal.
>   `sendFollowupJob` looks the id up and calls `cancelFollowup(job.id, 'campaign_deleted')` when it
>   does not resolve. A synthetic id would produce a follow-up that is accepted, displayed as
>   scheduled, and then **silently cancelled at send time** — a brand-new instance of the exact
>   class this whole review has been fixing.
> - **The blocker:** the compliance footer is gated on `if (job.campaignId && job.leadId)`. Wiring
>   one-off scheduling as-is would add a *third* footerless commercial send path (F14) — and unlike
>   the two that already exist, this one would be new code I wrote knowingly.
>
> So the order is: settle F14, then scheduling rides on the same footer and is perhaps 40 lines.
> Doing it in the other order ships a legally-exposed path and calls it "wired".
`components/DashboardView.tsx:161` (pre-fix), `components/ComposeFollowUp.tsx:615-620, 705-722, 248`.

This was the 07-28 review's **S2, now confirmed** rather than suspected, with the mechanism pinned:
`handleActionComplete(date, content)` receives the chosen date and passes it to *nothing* — it
calls `sendFollowUp(selectedEmail, body)`, which sends immediately, and uses `date` only to pick
between two toast strings. So picking "+1 Week" and confirming produced **"Follow-up scheduled
successfully."** for an email that had already gone out.

Why nothing scheduled it: the client-side scheduling API (`services/followupApi.ts`
`scheduleFollowup`) is called only from `useEmailProvider`'s `sendNewEmail`, and **`sendNewEmail`
has no callers at all** (F11). The whole chain is dead.

The previous `settings.useRealApi` gate had the polarity backwards — it disabled the controls in
Live mode, where a real early send would be the harm, and left them operable in sandbox, where the
lie was free. Fixed by disabling the scheduling controls in every mode, replacing the "It will send
automatically if no reply is received" copy (false in all modes — nothing queues it and nothing
checks for a reply), and making the toast always say "sent".

Deliberately **not** wired up to the working backend route. `POST /api/followups/schedule` exists
and is tested, but its schema requires a non-empty `originalMessageId` and `campaignId`, and
gateway-fetched emails routinely have neither (`mailGateway.ts` sets `messageId` from
`envelope?.messageId`, which IMAP does not guarantee). That is a feature task with its own failure
modes, not a cleanup to land at the end of a session.

### F11 — Dead send/scheduling chain, ~280 lines — LOW (hygiene) — reported, not deleted
- `hooks/useEmailProvider.ts:130-254` — `sendNewEmail`, 125 lines of gateway send plus a
  follow-up-scheduling loop. Exported from the hook at `:304`, called by nothing. (The identically
  named `services/mockZoho.ts:257` export is a different function and is also unused.)
- `services/followupApi.ts` — `listFollowups` and `cancelFollowup` have **zero callers anywhere**;
  `scheduleFollowup` is reachable only from the dead `sendNewEmail`.

Left in place rather than deleted: it is inert, and the imminent deploy is the wrong moment to
remove 280 lines of send-path code for tidiness. Worth deleting in the same pass that either wires
scheduling up properly (F10) or decides not to.

### F9 — `addCampaign` discards the ENTIRE Setup step — HIGH — **fixed**
`context/CampaignContext.tsx:108` (pre-fix). The wizard collects thirteen sending-configuration
fields on step 3, passes every one of them into `addCampaign`, and `addCampaign` posted nine
fields that did not include any of them. Proved mechanically by diffing the two payloads:

```
sent by wizard but never posted:
dailyLimit, followUpPercent, linkTracking, openTracking, plainTextMode,
sendDays, sendIntervalMinutes, sendWindowEnd, sendWindowStart,
stopOnClick, stopOnOpen, stopOnReply, timezone
```

Every field is `.optional()` server-side, so each silently fell back to a column default and
nothing anywhere reported a loss. `tsc` was no help: `addCampaign`'s parameter type is
`Omit<Campaign, …>`, so the wizard's extra properties typecheck as accepted and are then simply
not read — **the seventh instance of this repo's "a value the code produces that nothing reads"
class, and the most consequential.**

Failure scenario: the user sets weekdays only, 09:00–18:00 in the prospect's timezone, 40/day, one
send every 20 minutes, stop-on-reply. The campaign is created with none of it and sends around the
clock, seven days a week, in batches of 10, to everyone, ignoring replies. The UI shows the settings
it just discarded.

This subsumes F8 — the same helper now feeds both create and duplicate.

> **DEPLOY-DAY CONSEQUENCE, read before shipping.** Because these settings now actually reach the
> server, throughput drops sharply and deliberately. With `DEFAULT_SCHEDULE`, a campaign goes from
> *10 per tick, 24/7, uncapped* to *1 per 20 minutes inside 09:00–18:00 Mon–Fri* — about **27 sends
> a day**, roughly a 10× reduction. `sendIntervalMinutes != null` is what flips the worker from
> `BATCH_SIZE` to one per tick (`worker.ts:360,467`). This is the app finally doing what the wizard
> has always claimed, not a regression — but it will look like "sending broke" to anyone who does
> not know, and the operator may want to revisit the 20-minute default in
> `src/features/campaigns/defaults.ts` before deploy.

### F8 — Duplicating a campaign silently drops every pacing and safety setting — MEDIUM — **fixed**
`context/CampaignContext.tsx:170-179`. `duplicateCampaign` re-POSTs only `name`, `subject`, `body`,
`scheduledAt`, `status`, `distributionMethod`, `autoFollowUps` and `sequence`. It does **not**
forward `sendWindowStart`/`sendWindowEnd`, `sendDays`, `timezone`, `dailyLimit`,
`sendIntervalMinutes`, `stopOnReply`, `stopOnClick`, `stopOnOpen`, `plainTextMode`,
`followUpPercent`, `openTracking` or `linkTracking`.

Failure scenario: an operator builds a campaign throttled to 40/day, weekdays only, 09:00–18:00
in their prospect's timezone, with stop-on-reply on. They click **Duplicate** to run the same
sequence at a second segment. The copy is created as a DRAFT with the server's column defaults —
no window, no day restriction, no interval, no daily limit — so activating it sends around the
clock, seven days a week, as fast as the worker will go, to whatever recipients are added. The UI
gives no indication that the copy differs from the original; "Copy of X" implies a copy.

Found while checking whether E2's new `sendDays: 0` refusal could break duplication (it cannot —
the field was not sent at all). Fixing it surfaced F9 above: the same fields were missing from
`addCampaign`, so the bug was never specific to duplication.

Both call sites now share `sendingConfigPayload` (`context/CampaignContext.tsx`), which drops
`null` (the create schema's `.optional()` accepts `undefined` but rejects `null`, and these columns
are null on any campaign that never set them — forwarding them verbatim would have 400'd the
*common* case), sends the send-window as a pair or not at all, and declines to copy a legacy
`sendDays: 0` the server now refuses.

## 3. The section-1 cross-check table (client type ↔ server route)

| Client type | Server producer | Verdict |
|---|---|---|
| `portal/services/apiClient.ts` `PortalAuthState` | `portal/auth.ts` `issueSession` (login, magic-link, set-password, **and refresh** since the 07-29 fix — refresh now calls `issueSession(cu,res,200,familyId,false)` at `auth.ts:339`) | **Match.** The white-screen path is closed; one response builder serves all four routes. |
| `portalApi.ts` `ProjectCard` | `portal/routes.ts:107-120` | **Match**, field-for-field incl. `awaitingApprovalCount`/`lastActivity`. |
| `portalApi.ts` `ProjectDetail`/`Revision`/`Message`/`FileLink`/`ActivityItem` | `portal/routes.ts:139` (raw Prisma include) | **Match** (server sends extra scalars — `clientId`, `userId` — harmless surplus, no missing field; `authorType` enum values match schema). |
| `portalApi.ts` `Invoice` | `portal/routes.ts:292,327` | **Match.** DRAFT excluded by the union AND the server filter; `payments[].receipt` shape matches; `lineItemsJson` is a Json column the client types as array-or-null — no writer sends another shape today. |
| `portalApi.ts` `InvoiceStatus` union (no DRAFT) | server filter `notIn: ['DRAFT','CANCELLED']` | **Safe**; `STATUS_BADGE` in `portal/pages/InvoicesPage.tsx:17` is exhaustive over the client union. |
| `types.ts` `Campaign` | `campaigns/routes.ts` `toClientCampaign` | **Match except `recipients`** (F5/F7). Status unions identical to Prisma enum. All 20 optional fields present both sides incl. `pausedReason`, `bouncedCount`. |
| `types.ts` `Thread`/`ThreadMessage` | `unibox/routes.ts` `toThread` | **Match.** `messages` never empty (synthetic outreach row), `leadCompany` coalesced, status enums identical, unknown intel values fall back to defaults before hitting the wire. |
| `types.ts` `Lead` ↔ `leadsApi.toLead` | `leads/routes.ts` (raw rows) | **Safe.** `toLead` coalesces every nullable; `notes` can become `undefined` against its non-optional type but every consumer guards (`LeadsView.tsx:242` uses `|| ''`). |
| `services/scraperApi.ts` `ScrapeJob` | `scraper/service.ts` | **Verified 07-29** (incl. `cancelling`; `statusMeta()` degrades unknowns; regression tests exist). Not re-derived. |
| `services/analyticsApi.ts` | `analytics/routes.ts:72` | **Verified 07-29**, 9 fields. Not re-derived. |
| `services/followupApi.ts` `FollowupJobDto` | `followups/routes.ts` (`{ jobs }`, `{ job }`, `{ ok }`) | **Match**; optional fields on the client side are genuinely optional server-side. |
| `services/mailGateway.ts` `GatewaySentItem` | `mail/routes.ts` `toSentItem:440-460` | **Two harmless drifts:** client declares `flags: string[]` — server never sends it — and `id: string` where server can send `undefined` (`envelope?.messageId || undefined`). Nothing reads `flags`; `id` flows into `Email.id`/`messageId` via `item.id || undefined`-style guards, worst case a missing React key. Also `GatewaySentResponse.ok` is never sent — `gwFetchSent` only reads `.items` with a `|| []` guard. Cosmetic; fold into the hygiene task. |
| `services/portalAdminApi.ts` `AdminClient`/`AdminProject`/`AdminInvoice` | `clients/`, `projects/`, `invoices/` routes | **Match on every field the CRM reads.** All relation fields are declared optional client-side, which correctly models the per-route include differences. `INVOICE_BADGE` (`ClientPortalView.tsx:73`) is `Record<string,...>` — degrades, cannot crash. `STAGE_LABEL` is exhaustive over a union identical to the Prisma enum. |

Unguarded `Record<Union>` lookup sweep (`Record<...Status...` + direct `[status]` indexing over
components/src/portal): the only direct exhaustive-Record hits are `STAGE_LABEL` (enum matches
schema exactly) and portal `STATUS_BADGE` (server filter guarantees the subset). `ScraperView`
goes through `statusMeta()`; `LeadsTable.tsx:34` has an inline `||` fallback. **No remaining
lookup can white-screen from a server-side union widening**, except that adding a seventh
ProjectStage or InvoiceStatus server-side would regress portal `STATUS_BADGE` — noted in the plan
as a cheap hardening, same one-line `?? fallback` pattern as `statusMeta`.

## 4. Campaign wizard vs server schemas (brief §3)

- **Wedge check:** the 07-28 wedge (C4) is genuinely fixed — date validation now runs before
  `setSubmitting(true)` and inside a guarded branch (`CampaignWizard.tsx:151-161`); a failed
  submit at step 4 lands in `catch` → `submitError` rendered in the footer (`:272`) → `finally`
  resets `submitting`. I traced every early exit; none leaves `submitting` true. **No wedge state
  found.**
- **Failed submit at step 4:** wizard stays open with all state intact; error text shown. Sound.
- **Partially-filled campaign recoverability:** there is none — Close (`:223`) discards
  leads/sequence/settings with no confirmation, and header X is the same `onClose`. One misclick
  after importing 800 leads loses everything. LOW-MEDIUM; fix is a ConfirmModal on close when
  `leads.length > 0 || sequence differs from default` (pattern already exists in the codebase).
- **Validation vs zod:** `dailyLimit` input has `min={1}` but no max, server caps at 2000 — a
  larger value 400s at submit with a raw zod message; recoverable but cryptic (LOW; clamp to 2000
  like `intervalMinutes` already does at `Step3Setup.tsx:214`). `sendDays` — F2, the real one.
  Recipients >5000 → server 400, wizard survives; Step1 does not warn at import time (LOW).
  `customFields` 60-key/2000-char caps: a wide CSV 400s at submit (LOW, same shape). Interval,
  window, timezone, name, statuses: client constraints are within server bounds. Send window is
  always sent as a complete pair, satisfying `requireCompleteSendWindow`.
- Step4's spam-test / test-email `window.alert('not yet implemented')` stubs remain (07-28 C12
  note): honest but still the one control a careful user reaches for before a 5,000-person send.

## 5. Services error handling (brief §4) — the "value nothing reads" sweep

- `sendFollowUp` result: **now read** — fixed 07-29, verified then; not re-derived.
- `AppErrorCode.AUTH_EXPIRED` checked-but-never-thrown (07-28 C14): **fixed** —
  `IntegrationsView.tsx:117` now accepts both auth codes, with a comment naming the old bug.
- `UniboxView` reply/refetch conflation (07-28 C6): **fixed** — `sendReplyToThread` goes through
  `apiPost` (throws on non-2xx) and the refetch failure no longer masquerades as a send failure
  (verified 07-29 §5).
- New instances found this pass: `GatewaySentResponse.ok` and `GatewaySentItem.flags` (declared,
  never produced/never read — the mirror image of the class; cosmetic), and the **/recipients
  endpoint itself** — a whole route produced for the Download CSV button that nothing calls (F6).
- `leadsApi`, `followupApi`, `mailGateway`, portal `apiClient`: every call path either throws a
  typed error or returns a value the caller inspects; the three services' local `authFetch`
  refresh-and-retry copies are consistent with each other and with `apiClient.apiRequest`.

## 6. Test-quality findings

- The 19 frontend tests (3 files: analyticsView, scraperView, portal auth-state) use `mockReset`
  — clean per 07-29 review; nothing I specify below should switch to `clearAllMocks`.
- **Nothing covers the wizard.** The mutation "revert F2's day-guard" (once written) must fail a
  test; today no test would notice `sendDays: 0` — nor the C4 regression if someone hoists the
  date computation back out of its guard. The wizard is 2,886 untested lines that send real
  email; E2's test is the highest-value new frontend test available.
- **Nothing covers ClientPortalView's invoice actions** — a busy-flag regression (F1's fix, then
  its future re-removal) would pass everything.
- No new vacuous suites found: I did not re-audit the three existing files line-by-line beyond
  their mock hygiene (07-29 already mutation-checked them).

## 7. Verified as correct (how)

- Portal refresh/identity contract — read both sides plus the comment trail; single response
  builder (`issueSession`) now serves login/magic-link/set-password/refresh.
- Wizard submit/wedge paths — traced all exits (§4).
- The C1→C14 fix status of the 07-28 review, individually re-checked: C1 ✔, C2 ✔ (07-29 §5),
  C3 ✔ (`CampaignsListView.tsx:62` renders a pausedReason explainer incl. the postal-address text),
  C4 ✔, C6 ✔, C14 ✔; C5 ✘ (F1), C10 ✘ (F5), C12 partial ✘ (F6); C7/C9/C11/C13 not re-derived
  (C7's fix is visible as `onAuthChange`/`isAuthed` in `portal/services/apiClient.ts:44-70`).
- Cross-check table rows marked Match (§3), each read on both sides this session.
- Mock-import sweep — exactly two live importers (§2 F3/F4), grep-proven.
- `Record` lookup sweep (§3 tail).

## 8. Could not determine

- Anything requiring execution or the live DB (offline until 2026-08-05): no finding here was
  reproduced at runtime; each is traced through source on both sides.
- Whether any campaign row with `sendDays = 0` already exists in prod data (would start silently
  frozen after deploy). One query on 08-05: `SELECT id, name FROM "Campaign" WHERE "sendDays" = 0`.
- `App.tsx` (592 lines), `context/`, `hooks/useEmailProvider.ts` beyond the specific paths named
  above, and `components/` screens not named in this or the two prior reviews (BrandOS, StoryVault,
  Documentation, EmailCard): not reviewed this pass — brief §5 territory the budget did not reach.
  The 07-28 review's partial coverage of these stands.

## 9. EXECUTION PLAN (for Opus 5)

Rules for every task: work ONLY in `C:\Users\banjigum1\Documents\YSXXS\YSXXS`. Never touch
`C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS`. After each task run root `npx tsc --noEmit` +
`npm test`, and (for E2's server half) `npx tsc -p . --noEmit` + `npx vitest run` in `server/`,
sequentially, never in parallel. Frontend tests: `mockReset`, never `clearAllMocks`. Do not commit.

### Must land before the 2026-08-05 deploy

**E1. Guard invoice Send (and the two small siblings).** `components/ClientPortalView.tsx`.
Add `sendingId` state; on the Send button (`:857`) `loading={sendingId === inv.id}` and set/clear
around the call, mirroring `payBusy` (`:774-790`). While there: add busy flags to `submitFile`
(`:444-453`) and `sendMsg` (`:455-464`). Test (new `test/clientPortalInvoices.test.tsx`, jsdom,
mock `services/portalAdminApi`): render an invoice row, make `sendInvoice` return a pending
promise, click Send twice, assert `sendInvoice` was called once. Mutation that must break it:
removing the `loading`/busy guard.

**E2. Refuse `sendDays: 0` on both sides.** Client: `CampaignWizard.tsx` `canAdvance(3)` becomes
`name.trim().length > 0 && Object.values(schedule.sendDays).some(Boolean)`, and Step3 shows an
inline warning when no day is selected (same amber pattern as `Step3Setup.tsx:303-308`). Server:
`campaigns/routes.ts:83` — change to `.min(1)` **or** add a superRefine rejecting exactly 0 with
message "sendDays: 0 would prevent the campaign from ever sending; omit it to send every day".
Prefer the refine: min(1) would silently shift the meaning of an honest 0. Tests: server — extend
the campaigns route suite: POST with `sendDays: 0` → 400 naming sendDays (mutation: removing the
refine); client — new wizard test rendering Step3 with all days off asserting Next is disabled
(mutation: reverting canAdvance).

**E3. Unroute PerformanceView.** `App.tsx`: remove the `'PERFORMance'` case and its nav entry
(grep for how the sidebar builds entries; remove the PERFORMANCE item). Do not delete
`PerformanceView.tsx`/`mockPerformance.ts`. Assert `npx tsc --noEmit` clean (unused-import
removal in App.tsx). Test: not warranted for a route removal; state that in the commit message.

### Should follow (post-deploy acceptable)

**E4. Wire campaign recipients.** `CampaignDetailView.tsx`: on mount fetch
`GET /api/campaigns/:id/recipients` (add `fetchCampaignRecipients` to a service; type from
`routes.ts:390-404`'s row shape), render count + table from it, use the real per-recipient
`status` instead of the hardcoded "Pending" (`:185`), keep a loading state. Then fix `types.ts`
`Campaign.recipients` per F7. Test: jsdom render with a mocked two-row response asserting count
"2" and one non-Pending badge. Mutation: reverting to `campaign.recipients`.

**E5. Wire or remove the CSV/Share controls.** Row Download CSV (`CampaignsListView.tsx:371`) →
`apiDownload(`/api/campaigns/${id}/recipients?format=csv`, `${name}_recipients.csv`)` (helper
exists in `services/apiClient.ts`). Remove the Share row item and the toolbar CSV button (no
backend for "share"; toolbar-level "all campaigns" CSV has no endpoint — removing beats faking).
Also make the status-filter dropdown click-toggleable, not hover-only (`:119-126` per 07-28 C12).

**E6. Gate style-mimicry examples on live mode.** `ComposeFollowUp.tsx:97-110`: skip the
`fetchSentEmails()` block when `settings.useRealApi` (examples stay empty — `generateFollowUpDraft`
already accepts `[]`). Comment why. Test optional; if written, mock settings live + spy that
`fetchSentEmails` is not called.

**E7. Confirm-on-close for a dirty wizard.** `CampaignWizard.tsx`: when `leads.length > 0` or any
sequence variant body is non-empty, route both Close controls through the existing `ConfirmModal`
("Discard this campaign draft?"). Mutation: removing the guard → test clicking Close with leads
present asserting the modal appears.

**E8. Hygiene.** Drop `flags`/`ok` from `mailGateway.ts` types (or make optional with a comment);
clamp Daily Send Limit to 2000 in `Step3Setup.tsx:234`; add an `?? fallback` on portal
`STATUS_BADGE[inv.status]` and `STAGE_LABEL` lookups (one line each, closes the last exhaustive-
Record exposure); Step1 count warning when parsed leads exceed 5,000.

### Explicitly NOT to do
- Do not build a real Performance data model or endpoint now.
- Do not make the invoice send route reject SENT re-sends server-side without product sign-off —
  deliberate re-send of a SENT invoice is a legitimate dunning action; the fix is the client-side
  in-flight guard (E1).
- Do not "fix" `clearAuth()` wiping stored settings (intentional; known-failures.md).
- Do not commit or push anything.

## 10. Closing state

### Planner's runs (pre-implementation)
- `git status`: clean except this report. Root `tsc` clean; root `npm test` **19/19** — matches
  the brief's baseline.

### Implementation runs (Opus 5, post-E1–E8 + F8–F12)
- Root `npx tsc --noEmit`: **clean**. Root `npx vitest run`: **43 passed (7 files)**.
- Server `npx tsc -p . --noEmit`: **clean**. Server `npx vitest run`: **353 passed (32 files)**.
- Nothing committed.

### What the follow-on sweep did and did not cover
The F9 discovery came from a *mechanical* check — diffing the keys a caller passes against the keys
the receiver reads — not from reading code attentively. Applying the same check onward found F10,
F11 and F12. Surfaces swept: `hooks/useEmailProvider.ts`, `services/followupApi.ts`,
`services/gemini.ts` + its route, `context/CampaignContext.tsx`, the AI-consuming screens.
**Still unswept:** `App.tsx` beyond routing, `context/SettingsContext.tsx`,
`context/AuthContext.tsx`, `components/TemplatesView.tsx`, `DocumentationView.tsx`, `EmailCard.tsx`,
and the bulk of `services/gemini.ts`'s prompt construction. Recommend the same mechanical diff there
before the next deploy rather than another read-through — that technique is now 4 for 4 in this
codebase, and reading was 0 for 4 on the same defects.

**Machine note for the next session:** `tsc` OOM'd three times mid-session at *tiny* heap sizes
(15–170 MB) with ~1 GB of 8 GB free — every failure in the young generation
(`NewSpace::EnsureCurrentCapacity`, "young object promotion failed"). Raising
`--max-old-space-size` made it **worse**, because V8 scales the semi-space to the max heap. What
worked reliably: `NODE_OPTIONS="--max-semi-space-size=2 --max-old-space-size=1024"`. The existing
known-failures advice to reach for `--max-old-space-size=4096` is the wrong lever when the machine
is memory-starved rather than the compile being large.

### New tests added (all mutation-checked)
| File | Tests | Covers |
|---|---|---|
| `test/clientPortalInvoices.test.tsx` | 5 | invoice double-send; per-invoice concurrency; error recovery |
| `test/campaignWizardSendDays.test.tsx` | 8 | empty send-days guard; discard-on-close confirmation |
| `test/campaignDetailRecipients.test.tsx` | 5 | real recipients + real statuses; unknown status degrades |
| `test/campaignSendingConfig.test.tsx` | 6 | F9/F8 — create and duplicate carry the sending config; nulls omitted |
| `server/src/__tests__/campaignRoutes.test.ts` | +3 | `sendDays: 0` refused on create and update |
| `server/src/__tests__/geminiProxy.test.ts` | 5 | F12 — error shape the client can actually read |

`campaignSendingConfig.test.tsx` drives the real provider rather than calling
`sendingConfigPayload` directly, on purpose: the defect was never in the rule, it was in the
wiring, and a unit test on the helper would have passed against the broken code. That is the
2026-07-28 `isNotAHumanReply` lesson applied before the fact rather than after.
