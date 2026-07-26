# Design — asynchronous bounce / DSN ingestion

Status: **design only, nothing built.** Scoped 2026-07-26 as the chosen item from the
HANDOFF next-step 6 backlog. This is the highest-value of the six because the code it feeds
already exists and is live — it simply never receives data.

## The problem, precisely

`server/src/campaigns/worker.ts` has two bounce paths, and **both fire only from a
synchronous SMTP error raised inside the send loop**:

| Path | Trigger | Effect |
|---|---|---|
| `handleHardBounce()` (worker.ts:218) | `isHardBounceError(err)` on the send call | lead `isBounced=true`, recipient `FAILED`, `BOUNCED` TrackingEvent, `campaign.bouncedCount++`, and the auto-pause check |
| soft-bounce branch (worker.ts:~435) | repeated soft errors, `SOFT_BOUNCE_THRESHOLD` | same terminal effects once the threshold is crossed |

The auto-pause itself (worker.ts:246-261) is correct and now genuinely stops a campaign —
last session fixed its one real hole, so it also cancels scheduled follow-ups via
`cancelScheduledFollowupsForCampaign`. Thresholds: `BOUNCE_PAUSE_MIN_SENT = 20`,
`BOUNCE_PAUSE_RATE = 0.05`.

**But `bouncedCount` is only ever incremented from those two synchronous paths.** In real
sending through Gmail and Microsoft 365, the SMTP submission almost always succeeds — the
provider accepts the message for delivery and returns 250. The failure comes back
*minutes later* as an asynchronous DSN (RFC 3464 delivery status notification) email into
the sending mailbox's INBOX. Nothing in this codebase reads those.

Net effect: **for the actual production send path, `bouncedCount` stays 0 no matter how
bad the list is, so the bounce-rate auto-pause can never fire.** The safety valve is real
code guarding nothing. This is the mechanism that is supposed to stop us burning sender
reputation on a dead list, and it is inert.

## Why this is cheap to fix here

`server/src/mail/replyCheck.ts` already does the hard parts:
- it opens an authenticated IMAP connection per mailbox (`getImapConfig`, `ImapFlow`)
- it is already invoked on a schedule by the follow-up scheduler
- it already canonicalizes Message-IDs (`normalizeMessageId`) and matches on
  `In-Reply-To` / `References`

DSN correlation uses the same key. A bounce notification embeds the original message —
either as a `message/rfc822` part or via `In-Reply-To` — so the original `Message-ID` is
recoverable and maps straight back to a `CampaignRecipient`.

## Proposed design

1. **Persist the outbound Message-ID per recipient.** Confirm whether
   `CampaignRecipient` already stores it; if not, add a nullable `messageId` column
   (additive migration) written at send time in the worker. This is the join key. Without
   it, correlation degrades to matching the recipient's email address, which is ambiguous
   when a lead is in more than one campaign.

2. **New `server/src/mail/bounceCheck.ts`**, sibling to `replyCheck.ts`, reusing its IMAP
   plumbing rather than opening a second connection stack. Per poll it should:
   - search INBOX for DSNs — `FROM` containing `mailer-daemon` / `postmaster`, or
     `HEADER Content-Type multipart/report`, restricted by date
   - parse the `Action:` and `Status:` fields of the `message/delivery-status` part
     (RFC 3464). `Action: failed` + a `5.x.x` status is a **hard** bounce;
     `4.x.x` is **soft/transient** and must NOT flip `isBounced` on its own
   - recover the original Message-ID and resolve it to a `CampaignRecipient`

3. **Reuse the existing terminal handlers, do not duplicate them.** Refactor
   `handleHardBounce()` so the DSN path and the synchronous path converge on one function.
   Duplicating the lead/recipient/event/counter updates is how the two paths drift apart —
   and drift between two copies of the same rule is a trap this repo has already hit twice
   (the scraper's `_ICP_BLOCK`, per the 2026-07-25 entries).

4. **Idempotency is mandatory.** IMAP polling re-reads messages; a DSN must not increment
   `bouncedCount` twice or the auto-pause threshold trips on double-counted noise. Key the
   dedupe on the DSN's own `Message-ID`, persisted, with a uniqueness constraint — the same
   shape as the `Receipt.number` fix landed this session, and for the same reason.

5. **Date granularity.** The existing IMAP `SINCE` search is date-granular, not
   time-granular — already a known MEDIUM finding for `replyCheck` (it can misattribute an
   unrelated pre-existing email as a reply). A DSN poller inherits it. Over-fetch by a day
   and rely on the idempotency key from (4) rather than trying to make `SINCE` precise;
   IMAP simply does not offer better granularity.

## Explicitly out of scope

- Feedback-loop / ARF complaint reports — a different format and a separate signal.
- Provider webhook APIs (Gmail/Graph push) — a much larger change; IMAP polling matches the
  existing architecture and needs no new external surface.

## Risk if left undone

Unchanged from today: a campaign to a stale list keeps sending at full rate with no brake,
and the first real signal is a damaged sending domain. Note the watchdog alerting is
*also* still inert (`PORTAL_SMTP_PASS` empty, per the 2026-07-25 entry), so nothing would
surface it by mail either.
