# Mail / reply-detection review — 2026-07-28

Reviewed by me directly against source, not delegated. The readiness report named this
subsystem the single highest-value unreviewed area ("if you review one thing before sending at
volume, review this"), and `.plans/known-failures.md` records that `agy` refuses authz-shaped
prompts and has produced confidently wrong HIGHs here before.

Scope covered: `mail/replyCheck.ts` (279 lines) in full, plus its call path through
`index.ts:458-470` and `scheduler/followupScheduler.ts`. **NOT covered:** `mail/imapClient.ts`,
`mail/routes.ts`, `mail/smtpClient.ts`, `mail/smtpGateway.ts`, `unibox/routes.ts`,
`unibox/intent.ts`. Those remain unreviewed — this is a partial review and should not be
recorded as closing the item.

---

## F1 — The DSN content-type guard is dead code. HIGH confidence, verified.

`isNotAHumanReply(envelopeFrom, contentType)` takes two arguments and documents the second as
the load-bearing one:

> "Checks the sender, and the RFC 3464 report content type that every conforming DSN carries
> **regardless of who it claims to be from**."

Every call site passes only the first:

- `replyCheck.ts:103` — `isNotAHumanReply(from)`
- `replyCheck.ts:255` — `isNotAHumanReply(envelope?.from?.[0]?.address)`

And it could not work if it wanted to: both call sites fetch `{ envelope: true, internalDate:
true }`, which does not include `bodyStructure`, so the content type is not in the response at
all. `contentType` is `undefined` on every invocation, `String(undefined).toLowerCase()` is
`"undefined"`, and both `.includes()` checks are always false.

**Consequence.** Only `DSN_SENDER_RE` is actually protecting reply detection from bounces. Any
DSN whose sender does not match `^(mailer-daemon|postmaster|no-?reply|microsoftexchange<hex>|
*bounces?)@` is scored as a genuine human reply — which cancels the remaining sequence and
increments the campaign's `repliedCount`. Per §1 of the readiness report, that means the worst
addresses on a list get counted as its best responses.

The comment block at `replyCheck.ts:46-49` explicitly reasons that the guard "deliberately does
not depend on" whether an NDR carries `In-Reply-To`, because the content-type check covers it
either way. That reasoning is sound and the code does not implement it.

**This is the readiness report's own bug class:** a comment asserting two independent
protections where only one is wired up.

Fix is small but not free — it needs `bodyStructure` added to both fetches and the value
threaded to the guard. Not applied: it changes live send-gating behaviour and the deploy is
already carrying three migrations. Flagged for a decision.

## F2 — Reply detection fails OPEN on any IMAP error. HIGH confidence, verified.

`hasRecipientReplied` returns `false` on every failure path:

- `replyCheck.ts:148-154` — credentials cannot be resolved → `return false`
- `replyCheck.ts:269-272` — any error during connect/search/fetch → `logger.error` → `return false`

`false` means "has not replied". `index.ts:464-470` uses that to decide whether to send the
follow-up, so **an IMAP outage does not pause follow-ups — it sends all of them**, to everyone,
including the people who already replied asking to stop.

Worth contrasting with the report's §7 note that the `SINCE` day-granularity issue "fails in the
safe direction". This one fails the other way, and it is the same subsystem.

Whether this should fail closed is a judgement call — failing closed means an IMAP outage
silently stalls every sequence instead. My read is that stalling is the cheaper error, but it is
the user's call and it is not obviously wrong as written. Recorded, not changed.

## F3 — The subject fallback can cancel a sequence off an unrelated thread. MEDIUM.

`replyCheck.ts:244-266`: when the Message-ID searches miss, it searches for *any* message from
the recipient since the send date and accepts it if the subject matches `/^re\s*:/i`.

The prospect replying "Re: anything at all" on a completely different thread — a prior
conversation, a newsletter, a shared thread with a colleague — reads as a reply to this
campaign. The Message-ID paths above it are precise; this one is not scoped to the thread in any
way.

This is documented as a deliberate trade-off ("helps when clients omit References/In-Reply-To"),
and it errs toward *not* emailing someone, which is the safe direction. Flagging it as an
accepted risk rather than a defect — but it is worth knowing that `repliedCount` is inflated by
it, so reply-rate metrics are not trustworthy for campaign comparison.

## F4 — Not a finding: UID/sequence-number consistency is correct.

Checked because it is a classic IMAP defect. `replyCheck.ts` uses sequence numbers throughout
(`search()` and `fetch()` both without `{ uid: true }`), and `replyPoller.ts:42-46` uses UIDs
throughout (both with `{ uid: true }`). Each file is internally consistent, so neither mixes the
two numbering spaces. No bug.

---

## Still open in this subsystem

The readiness report's §1 open question — whether an Exchange NDR carries `In-Reply-To` on the
NDR itself — is still unanswered and still requires one live IMAP header fetch against the
production mailbox. F1 above makes it matter less than it did (fixing the content-type guard
covers the case regardless of the answer), but it does not make it moot, because F1 is not fixed.
