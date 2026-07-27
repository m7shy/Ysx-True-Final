# READINESS ASSESSMENT — 2026-07-27

Go/no-go for pointing this system at paying clients and real cold-email volume.
Scope: assessment only. Nothing was fixed, deployed, restarted, or reconfigured.

**Method.** Every claim below is checked against the live system, DNS from two public
resolvers, the production database, the production mailbox, or source at
`0e316d7`. The handoff was treated as unverified. Where I could not settle something,
it says so.

**One prod-side action was taken, and reverted:** a scratch database
`ysx_restore_drill` was created on the Neon project for the restore rehearsal
(§5) and dropped afterwards. `pg_database` is back to `neondb` + templates. No
prod data, config, or service was touched.

---

## VERDICT: NO-GO for volume cold outreach. Conditional GO for onboarding one client manually.

| # | Area | Verdict |
|---|---|---|
| 1 | Deliverability & feedback | 🔴 **BLOCKER** |
| 2 | Legal / compliance (cold outreach) | 🔴 **BLOCKER** |
| 3 | Money path | 🟠 **RISKY** — nothing is live, nothing is broken-but-live |
| 4 | Multi-tenancy in anger | 🔴 **BLOCKER** for a real second agency |
| 5 | Operations | 🔴 **BLOCKER** (backup), 🟠 RISKY (monitoring). Restore **works** — verified today |
| 6 | Capacity | 🟠 **RISKY** — three separate caps below the target volume |
| 7 | Known-unfixed blast radius | 🟢 mostly carryable; one item (mail/IMAP) matters |

The system is **not** in a "one bad week away from disaster" state — it is in a
"cannot yet do the thing at all" state. Most blockers are hours of work, not
weeks. The two that are not are legal (§2) and the M365 sending ceiling (§6).

---

## 1. DELIVERABILITY & FEEDBACK — 🔴 BLOCKER

### DKIM is NOT enabled. Two independent proofs.

**DNS.** The selector CNAMEs exist on the sending domain, and their targets do not:

```
selector1._domainkey.outreach.ysxvisuals.com
  CNAME -> selector1-outreach-ysxvisuals-com._domainkey.ysxvisuals.q-v1.dkim.mail.microsoft.com
           -> NXDOMAIN  (checked: local resolver, 8.8.8.8, 1.1.1.1)
selector2._domainkey.outreach.ysxvisuals.com -> same, NXDOMAIN
ysxvisuals.q-v1.dkim.mail.microsoft.com      -> NXDOMAIN
selector1/2._domainkey.ysxvisuals.com        -> do not exist at all
```

Microsoft publishes the key record at the CNAME target only once DKIM is
*enabled* for the domain in Defender. Published CNAMEs with a dead target is
exactly the signature of "records added, toggle never flipped."

**A real outbound message.** From the original headers embedded in an NDR in the
production mailbox (message of 2026-06-15), Microsoft's own stamp on our mail:

```
Authentication-Results: dkim=none (message not signed) header.d=none;
  dmarc=none action=none header.from=outreach.ysxvisuals.com
```

Outbound mail is going out **unsigned**. DMARC passes today only because SPF
aligns (envelope sender = From, `include:spf.protection.outlook.com`, `aspf=r`).
Any forward, any list, any SRS rewrite breaks the only leg holding it up.

### The corporate domain's SPF is a PermError

```
ysxvisuals.com TXT: v=spf1 include:dc-8e814c8572._spfm.ysxvisuals.com ~all
dc-8e814c8572._spfm.ysxvisuals.com -> NXDOMAIN
```

An `include:` of a non-existent domain is a permanent error; conforming
receivers treat the whole record as unusable. `ysxvisuals.com` is not the
campaign sender today, so this does not burn the outreach domain — but it is the
domain in your public identity, and `adkim=s; aspf=s` on its DMARC record means
nothing from it can ever align.

### The DMARC reports were never delivered — to a mailbox that does not exist

```
_dmarc.outreach.ysxvisuals.com: v=DMARC1; p=none; rua=mailto:dmarc@ysxvisuals.com; ...
```

The rua address is in a *different* domain from the record, so RFC 7489 §7.1
requires an authorization record at
`outreach.ysxvisuals.com._report._dmarc.ysxvisuals.com`. It **does not exist** →
Google, Microsoft and every other conforming reporter will refuse to send
aggregate reports at all.

And it would not matter if they did: `ysxvisuals.com` has **no MX record**, and
its A record (136.70.122.144) has **port 25 closed** (verified). Mail to
`dmarc@ysxvisuals.com` — and to `hello@ysxvisuals.com`, the contact address the
client portal shows to paying clients (`server/src/portal/content.ts:41`) —
bounces.

So the problem is not "nobody reads the rua reports." It is that they were never
generated, could not be delivered, and the mailbox does not exist.

The root domain's `rua`/`ruf` point at `m7shygaming.309.shorts@gmail.com`, which
is at least deliverable.

### The bounce auto-pause is guarding nothing — now confirmed empirically

Verified in source, not from the design doc:

- `Campaign.bouncedCount` is written in exactly one place —
  `server/src/campaigns/worker.ts:253`, inside `handleHardBounce()`.
- `handleHardBounce()` is called from exactly one place —
  `worker.ts:487`, inside the `catch` around the SMTP send, gated on
  `isHardBounceError(err)`.
- Nothing in the tree parses `multipart/report`, `message/delivery-status`,
  `mailer-daemon`, `postmaster`, or any DSN format. Grep returns zero hits.
- `CampaignRecipient` has **no `messageId` column** — the join key the ingestion
  design (`.plans/design-bounce-dsn-ingestion.md` step 1) needs does not exist
  yet.

So `bouncedCount` can only move when M365 rejects the message *during* the SMTP
conversation. In practice it accepts and reports failure later.

**The production mailbox proves it.** Its INBOX currently holds at least 15
`Undeliverable:` NDRs (2026-05-25 → 2026-06-15), most still unread, addressed to
real prospects. Not one of them is visible to the application. One of them reads:

```
Remote server returned '550 5.7.233 - Your message can't be sent because your
tenant has exceeded its daily limit for sending email to external recipients
(tenant external recipient rate limit).'
```

That is not a bad address — that is **Microsoft refusing to send**, delivered
asynchronously, invisible to the CRM, which recorded the send as successful.

**Can we send at volume and detect a problem before the domain burns? No.**
Bounce rate is structurally pinned at 0. `BOUNCE_PAUSE_MIN_SENT=20` /
`BOUNCE_PAUSE_RATE=0.05` can never trip. There is no complaint/FBL signal
either. The first real feedback would be a spam-folder placement you notice
because replies stop.

### Could not determine

`hasRecipientReplied()` (`server/src/mail/replyCheck.ts:125-149`) searches IMAP
for `HEADER In-Reply-To <id>` / `HEADER References <id>` **with the sender filter
deliberately removed** (comment at :95-97). Whether an Exchange NDR carries those
headers *on the NDR itself* (as opposed to in the attached original) decides
whether every bounce is silently recorded as a **reply** — cancelling the
sequence and inflating reply metrics. Graph does not expose the NDR's raw
headers and I did not want to spend a prod IMAP token refresh to fetch them.
**Unresolved; settle it with one IMAP `FETCH BODY.PEEK[HEADER]` before sending
at volume.** The Unibox reply poller is clear — it filters `from: lead.email`
(`replyPoller.ts:38`), which an NDR never matches.

### To close the gap

1. Enable DKIM for `outreach.ysxvisuals.com` in Defender (`Email & collaboration
   → Policies → Email authentication → DKIM`). Verify by re-resolving the CNAME
   target, then by `Authentication-Results: dkim=pass header.d=outreach.ysxvisuals.com`
   on a real send.
2. Fix or remove the broken `include:` in `ysxvisuals.com`'s SPF.
3. Publish `outreach.ysxvisuals.com._report._dmarc.ysxvisuals.com TXT "v=DMARC1"`
   and point `rua` at a mailbox that exists. Add an MX for `ysxvisuals.com` (or
   move `hello@` to the outreach domain) — a client-facing contact address that
   bounces is its own problem.
4. Build the DSN ingestion in `.plans/design-bounce-dsn-ingestion.md`, starting
   with the `CampaignRecipient.messageId` column. Until it exists, treat the
   auto-pause as decorative and cap sending manually.
5. Only then consider moving DMARC to `p=quarantine`.

---

## 2. LEGAL / COMPLIANCE — 🔴 BLOCKER

### No physical postal address in any campaign email

`server/src/campaigns/trackedHtml.ts` is the only place a footer is built. It
appends the unsubscribe line and nothing else. A repo-wide search for
`postal|physical address|street|mailing address|CAN-SPAM|COMPANY_ADDRESS` across
`server/`, `prisma/`, `docs/`, `.plans/` returns **zero hits**. `User.signatures`
exists in the schema but is never read by any send path.

CAN-SPAM (15 U.S.C. §7704(a)(5)) requires a valid physical postal address in
every commercial message. Every campaign email sent to a US recipient is
non-compliant, and the penalty is per-message. I am not a lawyer, but this one
is not ambiguous.

### Unsubscribe: mechanism is good, follow-up bodies are not

Verified working:

- RFC 8058 headers on the initial send (`worker.ts:135`) **and on follow-ups**
  (`index.ts:489-500` rebuilds the URL from the `(campaignId, leadId)` recipient —
  I read it, it is real).
- `GET /t/u/:token` renders a confirmation form and mutates nothing — correct
  defence against Safe Links / Proofpoint prefetch. `POST` does the work.
- Tokens are HMAC-signed over the recipient id and **never expire**, so an
  unsubscribe link in a year-old email still works.
- Live check against production: `POST https://crm.ysxvisuals.com/t/u/<bogus>`
  → 404 with the correct page, no auth, no CSRF gate. The endpoint providers
  will hit is genuinely reachable.

The gap: **follow-up bodies carry no visible unsubscribe link.** `sendFollowupJob`
sends `job.body` / `job.html` verbatim (`index.ts:478-513`) — it never goes
through `buildTrackedEmail()`, which is what appends the human-visible footer.
Follow-ups therefore have the machine header but nothing a person can click.
"Clear and conspicuous" means visible to the reader. Most of a sequence is
follow-ups.

### DNC / suppression: 🟢 genuinely solid

- One-click POST sets `Lead.status = DNC` and calls `enforceDnc()`
  (`trackingRoutes.ts:187-192`).
- `enforceDnc()` cancels every scheduled follow-up for that address **across all
  campaigns for that tenant** and flips PENDING recipients to SKIPPED
  (`leads/dnc.ts`).
- The follow-up send path re-checks DNC at claim time as a second layer
  (`index.ts:347-362`), covering jobs already in flight.

Two independent layers, both verified by reading. This part is ready.

One flaw: `DELETE /api/leads/:id` hard-deletes the row, taking the DNC record
with it. Re-import the same list and you will contact them again. Suppression
must outlive deletion.

### GDPR: nothing exists

The scraper harvests YouTube creators worldwide — overwhelmingly individuals,
not corporate role accounts.

- **Lawful basis:** undocumented. The only plausible one is legitimate interest
  (Art 6(1)(f)), which requires a written balancing test. None exists.
- **Art 14 notice:** required because the data was *not* collected from the data
  subject — the first email must say what data you hold and where you got it.
  It does not.
- **Erasure / access:** no data-subject route. A tenant admin can
  `DELETE /api/leads/:id`; a subject has no way to ask, and the contact address
  in the portal (`hello@ysxvisuals.com`) bounces (§1).
- **Retention:** no policy, no expiry, no job. Lead rows and TrackingEvents live
  forever. Scraper SQLite (`processed_channels`, `blacklist`, ~20k rows) holds
  channel identities on the VM with no lifecycle at all, and is not reachable
  by any deletion path.
- **Privacy policy:** the two links in the UI (`DocumentationView.tsx:41`,
  `LoginScreen.tsx:192`) are `href="#"`.
- No records of processing, no DPA/sub-processor list (Neon, Microsoft, Google
  Gemini all process this data).

Separately: ePrivacy/PECR generally permits unsolicited B2B email to corporate
subscribers, but sole traders and individuals are treated as individual
subscribers requiring consent. A YouTube creator's `gmail.com` address is an
individual subscriber. That is the sharp edge, and it is where the ICO and the
EU DPAs actually act.

### To close the gap

1. Add a per-tenant business identity (legal name + postal address) and render
   it in the footer of **both** the initial send and follow-ups. Route follow-ups
   through `buildTrackedEmail()` so they get the visible unsubscribe link too.
   One change fixes both CAN-SPAM problems.
2. Write the legitimate-interest assessment and a one-line Art 14 disclosure in
   the email template ("I found your channel on YouTube; reply STOP and I'll
   delete your details").
3. Make suppression survive deletion (a `Suppression` table keyed on
   `(userId, emailHash)`), and add a real erasure endpoint that also purges
   TrackingEvents and the scraper's SQLite rows.
4. Publish a privacy policy at a real URL and put a working address behind it.

---

## 3. MONEY PATH — 🟠 RISKY

### Stripe is not live. There is no way for anyone to pay you through the app.

- `server/src/billing/` is fully written (`stripe.ts`, `webhook.ts`, `usage.ts`,
  `routes.ts`) and `isBillingConfigured()` requires `STRIPE_SECRET_KEY` +
  `STRIPE_WEBHOOK_SECRET`. **Neither is in the production `.env`** (I enumerated
  every key name; there are no `STRIPE_*` entries).
- There is **no checkout route** anywhere — `billing/routes.ts` exposes exactly
  one endpoint, `GET /usage`. A tenant cannot subscribe even if Stripe were
  configured.
- Production reality: all **7 users are `tier: FREE`, `status: ACTIVE`,
  `currentPeriodStart: null`**.
- Consequence: `AccountStatus.UNPAID` and the whole `requireActiveTenant` dunning
  gate (`auth/tenantGate.ts`) are unreachable — only the Stripe webhooks set that
  status.

### Client invoicing is manual bank transfer — and the bank details are missing

`PaymentMethod` has exactly one value: `BANK_TRANSFER`. The portal shows
`BANK_TRANSFER_INSTRUCTIONS` from `portal/content.ts:46-56`, built from
`PORTAL_BANK_NAME / BENEFICIARY / IBAN / SWIFT`. **None of those four are set in
production.** The card a client sees today therefore renders as one line:

> Pay by bank transfer
> Please include the invoice number as the transfer reference.

**A client literally cannot pay an invoice from the portal.** Four env vars and a
restart. Also note these come from `process.env`, so they are **global** — a
second agency's client would be shown YSX Visuals' bank account.

### Invoice numbers: not defensible as gap-free

`nextNumber()` (`invoices/routes.ts:94-100`) is `count(rows for this tenant) + 1`.

- Not editable through the API (`number` is absent from `patchSchema`) — good.
- Monotonic **only as long as no row is ever deleted**, and that is not enforced:
  `Invoice` has `onDelete: Cascade` from both `User` and `Client`. Delete a
  client and their invoices vanish, the count drops, and the next invoice
  **re-issues an already-used number**. Same chain for `Receipt` (Client →
  Invoice → Payment → Receipt). There is no client-delete route today, so this
  is reachable only via the DB — but "the invariant holds because no one has
  pressed the button yet" is not an audit story.
- The P2002 retry (`withUniqueRetry`) handles concurrent creates correctly.

### Partial payments are silently wrong

`POST /:id/mark-paid` accepts an arbitrary `amountCents`, but **always** sets
`status: PAID` and `paidAt` (`invoices/routes.ts:241-248`), and a second call
409s. Record a €500 deposit against a €2 000 invoice and the invoice is now
fully paid, forever, with no way to record the balance.

### VAT / tax: no support at all

`Invoice` carries `amountCents`, `currency`, and freeform `lineItemsJson
[{label, amountCents}]`. There is **no tax rate, no tax amount, no seller VAT
number, no buyer VAT number, no reverse-charge wording, and no seller legal name
or address** anywhere on the invoice. That is not a compliant invoice in any EU
jurisdiction, and the currency defaults to `usd` with no FX handling.

### Refunds / corrections: none

A `PAID` invoice cannot be edited (PATCH 409s) or cancelled. There is no credit
note and no refund concept. A mis-clicked "mark paid" is unrecoverable in-app.

### What a client sees if payment fails

Nothing, because nothing automated can fail. The whole flow is: you read your
bank statement, you click mark-paid, they get a receipt. That is defensible for a
first client and does not scale.

### Reality check

Production has **1 invoice (DRAFT, $100), 0 payments, 0 receipts**. The money
path has never been exercised end-to-end. Whatever else is true, do not learn
about these gaps with a real client's money in flight — issue one real invoice to
yourself first.

---

## 4. MULTI-TENANCY IN ANGER — 🔴 BLOCKER

Data isolation itself looks sound (per-tenant unique constraints, `tenantDb`,
denormalised `userId`) and was fixed last session; I did not re-review it, and
nothing I touched contradicts it. The problem is everything *around* the data.

**A second agency signing up tomorrow would get stuck at step one.**

### They cannot connect a mailbox

`buildMicrosoftAuthorizeUrl` is called with no tenant, and the authority segment
resolves as `tenant || process.env.MICROSOFT_TENANT_ID || 'common'`
(`creds/oauth.ts:103-104`, `:200-201`). Production has
`MICROSOFT_TENANT_ID=7d9dc0cf-...` — **YSX Visuals' own Entra tenant**. The
authorize URL therefore points at a directory the new agency's account does not
exist in; consent fails.

The Gmail path fails earlier: `providerClientId('gmail')` reads
`config.GMAIL_OAUTH_CLIENT_ID`, which is **not set in production**, so
`/api/auth/oauth/gmail/start` throws a 500.

There is no self-serve mailbox connection for anyone but the owner. This is the
single fact that answers the question: they cannot send without you touching the
VM.

### Your brand is hardcoded into their client-facing surfaces

| Location | Text |
|---|---|
| `invoices/routes.ts:208` | `Invoice {n} from YSX Visuals` (email subject) |
| `clients/routes.ts:136` | "invited to the YSX Visuals client portal" |
| `portal/auth.ts:171` | "Your YSX Visuals sign-in link" |
| `projects/routes.ts:302` | `authorLabel: 'YSX Visuals'` on every agency message |
| `portal/components/PortalShell.tsx:24`, `LoginPage.tsx:144` | portal chrome |
| `portal/content.ts:41-42` | `hello@ysxvisuals.com`, GMT+2 office hours |

Plus the global bank details from §3. Their clients would be invoiced by you.

### Shared global resources

- `GEMINI_API_KEY` is one global key used for every tenant's reply-intent
  classification (`unibox/intent.ts:45`) — shared cost, shared rate limit, no
  per-tenant attribution.
- The YouTube cookie pool: `CookieFile.userId` is nullable, and the schema
  comment states plainly that legacy null-owner rows "remain readable by any
  tenant."
- Signup is **completely open** (`POST /api/auth/signup`, no invite, no email
  verification, no billing gate) on a public host. Anyone can create a tenant and
  start consuming Gemini and scraper capacity.

### Fairness: one busy tenant starves the others

- The campaign worker loads **every** ACTIVE campaign across all tenants ordered
  `createdAt asc` and processes them sequentially in one tick
  (`worker.ts:620-631`); a tick that overruns is silently skipped
  (`if (ticking) return`).
- The reply poller takes the globally oldest **100** `CONTACTED` leads per tick
  (`replyPoller.ts:153-157`) regardless of tenant — a tenant with 500 contacted
  leads means the others are never polled — and then issues **one IMAP SEARCH per
  lead**.

### What actually works

Client invite → set password → portal login is real and per-tenant
(`clients/routes.ts`, `portal/auth.ts`), apart from the branding. Tenant data
separation held everywhere I looked.

---

## 5. OPERATIONS — 🔴 BLOCKER (backup) / 🟠 RISKY (monitoring) / 🟢 restore verified

### 🔴 The daily backup has never once captured the scraper state

Last session recorded this gap as closed. It is not. Evidence:

```
C:\backups\ysx
  ysx-2026-07-27.json.gz          30 992   27/07 03:00:02   <- today's scheduled run
  ysx-scraper-2026-07-26.tar.gz  1 973 467  26/07 15:45:34  <- manual run only
  ysx-2026-07-26.json.gz          30 715    26/07 15:45:34
  ysx-2026-07-20.json.gz          10 196    20/07 07:27:05
```

The 03:00 task ran (`LastTaskResult 0`, next run scheduled) and produced the
database dump — and **no scraper archive**. There has never been one from a
scheduled run.

Mechanism, proven end to end:

- `backup-db.mjs:47-51` runs `execFileSync('tar', ['--force-local', ...])`.
- The registered task is `Execute: node`, `Arguments: scripts\backup-db.mjs`,
  `WorkingDirectory: ...\server` — no shell, so `tar` resolves through the
  machine/user PATH.
- The **only** `tar.exe` on that PATH is `C:\Windows\system32\tar.exe` (bsdtar).
  Confirmed directly: `tar.exe: Option --force-local is not supported`.
- GNU tar 1.35 (which supports the flag) lives in `C:\Program Files\Git\usr\bin`,
  which is **not** on the machine or user PATH — it is only present inside a Git
  Bash session. Which is how it was tested.
- `backup-db.mjs:54-58` catches the failure and writes it to `console.error`, and
  the registered task has **no output redirect** — unlike the command documented
  in `docs/RECOVERY.md:86`, which pipes to `backup.log`. The error goes nowhere
  and the script exits 0.

Same failure family as the `pg_dump` placement bug found last session: an
exit-code-0 success report over work that did not happen. ~20k rows of
processed-channel and blacklist state are still VM-only, one disk away from
being lost.

### 🟢 Restore rehearsal — DONE TODAY, AND IT WORKS

Performed against a real Postgres scratch target, not simulated:

1. `CREATE DATABASE ysx_restore_drill` on the same Neon project (role
   `neondb_owner` has `rolcreatedb`).
2. `prisma migrate deploy` → all 15 migrations applied cleanly to the empty DB.
3. Replayed `ysx-2026-07-27.json.gz` with a restore script written for this
   drill, inserting in FK-topological order derived from the target's own
   constraint graph.

Results:

| Check | Result |
|---|---|
| Rows restored | **53 / 53**, every table |
| Per-table counts vs live | **all match** (User 7, Lead 23, Campaign 1, Recipient 1, Mailbox 1, Client 1, ClientUser 2, ClientLoginToken 2, Invoice 1, TrackingEvent 4, FollowupJob 2, UsageRecord 1, CookieFile 4, ScraperSchedule 3) |
| FK integrity in the restored DB | 0 orphans |
| Timestamp fidelity | exact — `createdAt` byte-identical on all 23 leads |
| Encrypted mailbox tokens | **both `accessToken` and `refreshToken` decrypt** with `MAILBOX_ENCRYPTION_KEY` from the offline `.env` (2 947 / 1 472 chars plaintext) |

The only field differences were 22 `Lead.updatedAt` values, all changed in
production *after* the 03:00 snapshot — RPO drift, not corruption.

That last row is the important one: **a restore produces a working mailbox, not
just a working database.** The backup + the offline key together really do
reconstitute the system.

Caveats, all real:

- **No restore script existed.** `docs/RECOVERY.md:90` documents
  `pg_restore ... ysx-YYYY-MM-DD.dump` — an artifact this VM cannot produce,
  because `pg_dump` is not installed (verified) and the JSON fallback is
  therefore the *only* path ever taken. The documented recovery procedure does
  not apply to the backups that exist.
- The dump is **data only**. The schema must be rebuilt with `prisma migrate
  deploy` first, and `_prisma_migrations` must be excluded from the replay or it
  collides with the freshly-applied rows.
- **RPO is 24 hours** — one snapshot at 03:00, no PITR beyond Neon free tier's
  short window.
- Script kept at `.plans/artifacts/restore-from-json-dump.mjs`. It should become
  `server/scripts/restore-db.mjs` and `RECOVERY.md` should be corrected.

Scratch database dropped; Neon is back to `neondb` + templates.

### Backups still live only on the VM

Confirmed: Google Drive for Desktop is **not installed** (no `Drive File Stream`
/ `DriveFS` directory, nothing in the uninstall registry). `C:\backups\ysx` is on
the same disk as everything else. A VM loss still costs you every backup — and,
per the finding above, the scraper state was never in them anyway.

### Monitoring

- **UptimeRobot is still not configured.** I cannot verify this from here (no
  account access) — reported as unverified. The consequence is verifiable: the
  watchdog runs **inside** the node process (`startWatchdog()` at `index.ts:558`,
  `setInterval` at `monitor.ts:186`). A hung event loop, a crash loop, or a
  killed process alerts nobody, and `/api/health` is a bare `{"ok":true}` that
  NSSM's auto-restart masks — precisely the failure `monitor.ts:11-14` was
  written to describe.
- **Alerting has never actually delivered a message.** A search of the entire
  production M365 mailbox — all folders, including Sent Items — for
  `YSX watchdog` returns nothing. Exchange saves SMTP-AUTH sends to Sent Items by
  default, so this is consistent with "nothing has failed since it was switched
  on yesterday," not with "sending is broken." But end-to-end delivery is
  **unproven**; only SMTP AUTH was ever tested. And `sendAlert()` failures are
  only logged (`monitor.ts:135-137`).
- The `alerting: ok` line in `/api/health/deep` means *the env vars are set*, not
  that mail works. Worth knowing before you trust it.
- Live deep health right now: `overall ok` — db, campaignWorker (46s),
  followupScheduler (9s), mailboxes (1 active), disk (31 GB), alerting.

---

## 6. CAPACITY — 🟠 RISKY

**What breaks first at 5 clients / 500 leads / 200 emails per day, in order:**

**1. Microsoft's tenant external-recipient rate limit — and it has already
happened.** The `550 5.7.233` NDR of 2026-06-15 (§1) is Exchange Online refusing
to send because the tenant exceeded its daily external-recipient allowance. This
is provider-side, not something the code can raise, and it arrives
**asynchronously** — the CRM records those sends as successful. This is the
binding constraint on the whole plan and it needs a Microsoft-side answer
(tenant limits are lower for new/unpaid tenants), or a dedicated ESP.

**2. `Mailbox.dailyLimit = 50` on the only connected mailbox.** Verified in the
restored row. `pickRotationMailbox` refuses past it and
`resolveSendingMailbox` returns null → "no capacity this tick"
(`worker.ts:111`). 200/day is arithmetically impossible with one mailbox.

**3. FREE tier = 200 emails per *calendar month*.** `TIER_EMAIL_LIMITS`
(`billing/usage.ts:72-76`), enforced at both send choke points
(`smtpGateway.ts:62`, `:74`) via `assertUnderEmailLimit`. Every production user
is FREE. Current usage: 10 emails in July. At 200/day you hit a hard 402 on day
one — and since there is no checkout (§3), the tier can only be raised by editing
the database by hand.

**4. Per-campaign `dailyLimit` (100 on the existing campaign)** and
`BATCH_SIZE=10` per 60s tick.

**5. Single node process, single tick loop.** One process (101 MB RSS), sequential
SMTP sends, `if (ticking) return` silently drops a cycle when a tick overruns.
Fine at this volume; it degrades by getting quietly slower, not by erroring.

**6. IMAP fan-out.** The reply poller opens one connection per mailbox per 5 min
and then issues **one SEARCH per contacted lead** (capped at 100 globally). At
500 contacted leads across 5 tenants you will meet Exchange throttling and, well
before that, silent starvation of the tenants beyond the cap.

**7. Neon free tier.** Storage is a non-issue (10 MB of 0.5 GB). The real limits
are compute autosuspend and the short PITR window — which is why §5's dumps
matter.

**8. Scraper SQLite on the VM** — single-writer per profile; concurrent tenant
runs against one profile directory will lock.

**How would you notice? You would not.** `/api/health/deep` checks liveness,
ticks, mailbox count, disk and alerting config. It does not check: campaigns
blocked on a daily cap, tier-limit 402s, unread NDR volume, backup freshness, or
whether any mail actually went out today. Items 1–4 all fail *quietly by design*
— they defer or skip and log.

---

## 7. KNOWN-UNFIXED BLAST RADIUS

| Item | Verdict | Reasoning |
|---|---|---|
| **Refresh-token rotation + reuse detection** | 🟢 **carry** | Verified: `/api/auth/refresh` is cookie-only, stateless JWT, 30-day, no rotation; revocation is `tokenVersion` (all sessions at once). Blast radius = a stolen HttpOnly+Secure cookie gives 30 days, and the only cure logs you out everywhere. With one operator and no known XSS, that is acceptable. Revisit when real portal users exist at volume. |
| **IMAP `SINCE` date granularity** | 🟢 **carry** | Real and unfixable (IMAP has no finer granularity). Worst case: an unrelated email from the same address earlier the same day cancels a sequence. You stop emailing someone who emailed you — the safe direction to fail. |
| **`MAILBOX_ENCRYPTION_KEY` rotation** | 🟠 **partly** | The missing rotation path is not the risk; **the 8-character passphrase on the offline `.env.enc`** is. Today's drill proved that key + dump = working mailboxes, which is exactly why that passphrase is now the crown jewel. Lengthen it. Rotation itself can wait. |
| **~7 unverified round-2 findings** (`.plans/round2-agy-raw/`) | 🟢 **carry — do not spend time here** | LOW/MEDIUM robustness items from a source whose measured base rate last session was *four wrong HIGHs*. Nothing here is on the critical path to sending safely or getting paid. |
| **Portal backend — no second review** | 🟠 **matters, second** | Client-facing, handles auth, invoices and money display. Reading it today already surfaced the global bank details and hardcoded branding. |
| **Mail / IMAP — no second review** | 🔴 **matters most** | This is the subsystem that decides deliverability, bounce handling and reply detection — the exact areas where §1 found real defects today (no DSN path; the sender-less header search whose NDR behaviour is still unresolved). If you review one thing before sending at volume, review this. |
| **13k-line component tree — no second review** | 🟢 **carry** | Cosmetic/UX risk. Bugs here embarrass; they do not burn a domain or lose money. |

---

## Ordered plan (proposed — NOT started)

**Gate A — before a single campaign email goes out at volume**

1. Enable DKIM in M365 for `outreach.ysxvisuals.com`; verify by CNAME resolution
   *and* by `dkim=pass header.d=outreach.ysxvisuals.com` on a real message.
2. Add per-tenant business identity (legal name + postal address); render it in
   the footer of initial sends **and** follow-ups; route follow-ups through
   `buildTrackedEmail()` so they also carry a visible unsubscribe link.
3. Fix the backup: replace `--force-local` with a bsdtar-compatible invocation
   (or an absolute path to GNU tar), add the `>> backup.log 2>&1` redirect the
   runbook already specifies, and **verify by inspecting tomorrow's output
   directory**, not the exit code.
4. Resolve the open question in §1: does an Exchange NDR carry
   `In-Reply-To`/`References`? One IMAP header fetch.
5. Ask Microsoft what this tenant's external-recipient limit actually is, and
   raise `Mailbox.dailyLimit` / the tenant's `tier` to match reality.

**Gate B — before taking a client's money**

6. Set `PORTAL_BANK_*` in production (four vars) and issue one real invoice to
   yourself, end to end, including the receipt.
7. Decide the tax story: either add VAT fields + seller identity to `Invoice`, or
   deliberately invoice outside the app and use the portal for status only.
8. Make partial payments either work or be rejected explicitly rather than
   silently marking an invoice PAID.

**Gate C — before a second agency**

9. Make the Microsoft OAuth app multi-tenant (`/common` + multi-tenant app
   registration), or accept manual onboarding and say so.
10. Per-tenant branding and bank details; close open signup behind an invite.

**Gate D — durability & compliance debt**

11. Land the restore script as `server/scripts/restore-db.mjs`; correct
    `RECOVERY.md`; install Drive for Desktop so backups leave the VM.
12. Configure UptimeRobot against `/api/health/deep`.
13. Build DSN ingestion (`CampaignRecipient.messageId` + `bounceCheck.ts`).
14. GDPR: privacy policy at a real URL, Art 14 line in the template,
    suppression-survives-deletion, erasure endpoint.
15. Lengthen the `.env.enc` passphrase.
16. Independent review of the mail/IMAP layer, then the portal backend.

---

## Things I could not determine

- Whether UptimeRobot is configured (no account access) — assumed not, per handoff.
- Whether an Exchange NDR carries `In-Reply-To`/`References` on the NDR itself,
  which decides whether bounces are being counted as replies (§1).
- Whether the DKIM "Enable" toggle is off versus mid-provisioning in Defender —
  DNS and the message header both say not signed, but I have no admin-portal
  access to see the toggle itself.
- The exact external-recipient limit on this M365 tenant (only that it was
  exceeded once, on 2026-06-15).
- Cross-tenant data isolation was not independently re-reviewed this session; I
  relied on last session's fixes plus incidental reading.
