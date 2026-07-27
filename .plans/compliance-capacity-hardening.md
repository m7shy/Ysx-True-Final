# Plan — compliance, capacity visibility, and known-unfixed hardening

Covers READINESS-2026-07-27 blockers **2 (legal/compliance)**, **6 (capacity)** and
**7 (known-unfixed blast radius)**. Blocker 1 is being handled by the user outside
the code. Blocker 3 (Stripe) is deliberately deferred. Blocker 4 (multi-tenancy)
is **not** in scope for this plan.

Status: **awaiting go-ahead. Nothing started.**

## Delegation decision (orchestrate §5.1)

`agy` v1.1.7 is on PATH. Almost nothing here should go to it:

| Work | Blast radius | Route |
|---|---|---|
| Refresh-token rotation + reuse detection | auth/sessions/tokens | **inline** |
| Encryption-key rotation | crypto | **inline** |
| Suppression list, sender identity | schema + migration + multi-tenant | **inline** |
| Send-path footer + guards | silent failure mode | **inline** |
| Health checks / fairness | silent failure mode | **inline** |
| Independent review of mail/IMAP + portal backend | read-only, produces findings not edits | **`agy` (§7.2 runner)** |

Every test written under this plan gets the §5.7 mutation check: break the fix,
confirm the test goes red, restore. Verification is by observable effect (§5.6),
not by a passing suite alone.

---

## Phase 1 — Legal / compliance (Blocker 2)

### 1.1 Per-tenant sender identity — migration

```prisma
model User {
  businessName     String?   // legal/trading name shown in the footer
  businessAddress  String?   // free-form multi-line postal address
  senderProvenance String?   // Art 14 line; null → built-in default copy
}
```

### 1.2 One footer builder, used by every commercial send

Extract `appendComplianceFooter({ text, html, unsubscribeUrl, identity })` and have
**both** `buildTrackedEmail()` and the follow-up sender call it. Single source of
truth on purpose — two copies of one rule is a drift trap this repo has already hit
twice.

Footer contains, in order: unsubscribe link (existing), business name + postal
address, provenance line.

### 1.3 Follow-ups get the footer

`sendFollowupJob` (`server/src/index.ts:478-513`) currently sends `job.body` /
`job.html` verbatim. Route it through the shared builder so follow-ups carry the
**visible** unsubscribe link and the postal address, not just the RFC 8058 header.

### 1.4 Refuse to send without an identity

`assertSenderIdentity(userId)` at the campaign + follow-up send choke points.
Missing `businessName`/`businessAddress` → the campaign will not dispatch, with a
clear reason surfaced on the campaign, not a silent skip. Manual 1:1 unibox replies
are exempt (not commercial bulk).

### 1.5 Suppression that survives lead deletion — migration

```prisma
model Suppression {
  id        String   @id @default(cuid())
  userId    String
  emailHash String   // sha256(lower(trim(email))) — no plaintext PII retained
  reason    String   // UNSUBSCRIBE | DNC | ERASURE | HARD_BOUNCE
  createdAt DateTime @default(now())
  @@unique([userId, emailHash])
}
```

- Written by `enforceDnc()`, the one-click unsubscribe, and hard-bounce handling.
- Checked at the send choke point (campaign, follow-up) and on lead import.
- Survives `DELETE /api/leads/:id`, so a re-imported list cannot re-contact someone
  who opted out.

### 1.6 Erasure endpoint

`POST /api/leads/:id/erase` — deletes the Lead and its TrackingEvents, writes a
`Suppression` row with `reason: ERASURE`. The hash-only suppression key is what
makes "forget me" and "never email me again" compatible.

Out of scope for this phase, flagged not forgotten: the scraper's SQLite
`processed_channels`/`blacklist` rows are not reachable by this endpoint.

### 1.7 Minimal UI

Business identity fields in the existing settings view + the API to persist them.
Without this the feature is unusable without DB access.

### Not code, still required

Privacy policy at a real URL (the two links in the SPA are `href="#"`), and the
written legitimate-interest assessment. Both are yours; I can draft the LIA text.

---

## Phase 2 — Capacity visibility (Blocker 6)

**Correction to the readiness report:** `isLimitExceededError` *is* handled
correctly in the worker (`campaigns/worker.ts:476-485`) — the claim is released and
the campaign breaks for the tick. It does not mark leads bounced. The defect is not
correctness, it is that **every ceiling fails silently**. So this phase is
observability, not repair.

### 2.1 New deep-health checks (auto-picked-up by the watchdog)

| Check | Degrades when |
|---|---|
| `emailQuota` | tier usage ≥80% of `TIER_EMAIL_LIMITS`; critical at 100% |
| `sendCapacity` | every active mailbox is at `dailyLimit`, or a campaign broke on a cap this tick |
| `backups` | newest file in `BACKUP_DIR` older than 26h, **or** no `ysx-scraper-*` for today |

The watchdog iterates all checks, so these alert with no extra wiring. The
`backups` check is what would have caught the tar failure in §5 of the readiness
report on day one.

### 2.2 Surface the ceiling on the campaign

Record *why* a campaign stopped dispatching (`DAILY_CAP` / `TIER_LIMIT` /
`NO_MAILBOX_CAPACITY`) so the UI can say "paused: plan limit reached" instead of
appearing idle.

### 2.3 Fairness under multiple tenants

- Reply poller (`unibox/replyPoller.ts:153-157`): replace the global oldest-100
  scan with a per-tenant round-robin share, so one busy tenant cannot starve the
  rest.
- Campaign worker (`campaigns/worker.ts:620-631`): interleave active campaigns by
  tenant rather than strict `createdAt asc`.

### 2.4 Follow-up path parity

Check and fix how `sendFollowupJob` handles `LimitExceededError` — the campaign
worker handles it deliberately; the follow-up path likely treats it as a generic
send failure and burns retries.

### Not code

`Mailbox.dailyLimit` (currently 50) and the owner's `tier` (currently FREE = 200/mo)
are data. I'll add `server/scripts/set-tier.mjs` so changing them is not a manual
SQL edit, but the numbers are your call and depend on what Microsoft says about the
tenant's external-recipient limit.

---

## Phase 3 — Known-unfixed (Blocker 7)

### 3.1 Refresh-token rotation with reuse detection — migration

```prisma
model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  familyId   String    // one family per login; rotation stays within it
  tokenHash  String    @unique
  expiresAt  DateTime
  usedAt     DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId])
  @@index([familyId])
}
```

On `/refresh`: unknown or revoked hash → 401. **`usedAt` already set → reuse
detected → revoke the entire family** and 401. Otherwise mark used and issue the
successor in the same family. Applied to the CRM *and* the portal refresh path
(portal users are client-facing, which is exactly where this matters).

⚠️ **Deploy consequence: everyone is logged out once** — existing stateless tokens
have no DB row. Same as the last deploy; expected, not a bug.

### 3.2 A bounce can never be counted as a reply

`hasRecipientReplied()` (`mail/replyCheck.ts:125-149`) drops the sender filter for
its header search. Whether an Exchange NDR carries `In-Reply-To` on itself is still
unresolved — so rather than depend on the answer, add a DSN guard: reject any
candidate whose sender is a null-return/DSN address (`postmaster@`,
`mailer-daemon@`, `MicrosoftExchange<hex>@`) or whose content type is
`multipart/report`. Correct either way.

I'll settle the open question at the same time with one read-only IMAP
`FETCH BODY.PEEK[HEADER]` against an existing NDR and record the answer in
`.plans/known-failures.md`.

### 3.3 IMAP `SINCE` date granularity

Cannot be fixed at the protocol level. Mitigate by post-filtering: fetch each
candidate's `internalDate`/envelope date and discard anything earlier than
`initialSentAt`. Removes the misattribution without pretending IMAP got precise.

### 3.4 Encryption-key rotation path

`creds/crypto.ts` decrypts against `MAILBOX_ENCRYPTION_KEY`, falling back to
`MAILBOX_ENCRYPTION_KEY_PREVIOUS`; encryption always uses the primary. Plus
`server/scripts/rotate-mailbox-key.mjs` to re-encrypt every `Mailbox` row, with the
same decrypt-and-byte-compare-before-declaring-success discipline as
`backup-env.sh`.

Note: today's restore drill proved backup + key = working mailboxes, which is
exactly why the **8-character passphrase** on `.env.enc` is now the weakest link.
Lengthening it is a user action, not code.

### 3.5 The ~7 unverified round-2 findings

Read each of the seven files in `.plans/round2-agy-raw/` against source, fix what
is real, and record the rest as dismissed-with-reason. Measured base rate on that
source is four wrong HIGHs, so these get verified before they get acted on
(§5.9) — and none of them block launch.

---

## Phase 4 — The one delegated unit

Independent review of the two subsystems that never got a second opinion and that
actually matter: **mail/IMAP** first, **portal backend** second. Read-only, produces
findings not edits — low blast radius, which is what makes it delegatable.

Run through the §7.2 runner (dual-channel deliverable capture, one attempt per
model, account-wide error signatures abort the chain). Findings get spot-checked
against source before anything is acted on. Logged to `.plans/cost-ledger.md`.

---

## Separate ask — a one-line fix outside this plan's scope

The scraper backup has never run from the scheduled task (readiness §5): `tar
--force-local` resolves to system32 bsdtar under Task Scheduler, which rejects the
flag. The fix is to drop `--force-local` and pass an absolute archive path, plus add
the `>> backup.log 2>&1` redirect the runbook already documents. Roughly two lines,
and it is currently costing you ~20k rows of scraper state per day of exposure.

**It is in blocker 5, which you did not ask me to touch. Say the word and I'll
include it.**

---

## Order of execution

1. Phase 1 (compliance) — this is the one with legal exposure attached.
2. Phase 2 (capacity visibility) — cheap, and it is how you'll notice Phase 1
   working or not.
3. Phase 3.2 + 3.3 (bounce/reply correctness) — small, and they protect the
   deliverability work being done today.
4. Phase 4 (delegated review) — can run in the background alongside 2 and 3.
5. Phase 3.1 (refresh rotation) — deliberately last: it forces a logout, so it
   should ride with a deploy you're expecting.
6. Phase 3.4, 3.5 — cleanup.

Each phase: `tsc` clean + full vitest run + mutation check on every new test +
read the real artifact (rendered email, HTTP response, DB row), not the summary.
