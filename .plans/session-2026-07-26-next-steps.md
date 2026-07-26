# Session plan — 2026-07-26 (continuation): HANDOFF next-steps 1–4

Scope agreed with the user: all of next-steps 1–4 plus a #6 design item, research via
Gemini, code via `agy` (Sonnet 4.6 tier) with every result independently verified here,
**commit only — no prod deploy this session.**

Baseline: working checkout `phase5-frontend-wiring` @ `9de5ae2`; prod checkout @ `91564a0`
(one commit behind, and that commit is **HANDOFF.md-only** — verified via `git show --stat`,
so prod code is identical, not stale).

## Ground truth established before planning (read-only prod Neon probe)

| Fact | Value | Why it matters |
|---|---|---|
| `Receipt` rows in prod | **0** | Migration needs no backfill; a NOT NULL column can be added directly |
| `Payment` rows in prod | **0** | Last session's mark-paid test data really was deleted |
| `Invoice` rows | 1 | — |
| Duplicate `(userId, number)` receipts | **none** | Unique constraint cannot fail on existing data |
| Duplicate `number` receipts globally | **none** | — |
| `Campaign` / `CampaignRecipient` rows | 1 / 1 | Legacy click-token exposure is ~nil |
| `TrackingEvent` | OPENED 1, CLICKED 2, REPLIED 1 | Breaking old click links costs 2 historical clicks |

## Task 1 — `HEALTH_TOKEN` (no code change)

`server/src/index.ts:124` `healthTokenGuard` is **already complete**: with `HEALTH_TOKEN`
set it accepts `X-Health-Token` or `?token=`, constant-time compared, else falls back to
`requireAuth`. `config.ts:111` requires `min(16)`. So this is config + ops only:
generate a token → prod `server/.env` → user does the elevated restart → UptimeRobot.
**Not delegated.** No tier.

## Task 2 — SendPulse SPF (research only)

Delegated to `gemini-3.1-pro-high` (per user: "use gemini for research"). Prompt demands
the exact `include:` from SendPulse's *own* docs with URLs, and explicitly instructs it to
answer `NOT FOUND IN OFFICIAL DOCS` rather than guess — a wrong SPF include silently
breaks mail. Output is a worker result: cross-check the include against a live DNS lookup
of SendPulse's own record before handing the user anything (skill §4a, §5.18).
DNS change itself is the user's (GoDaddy).

## Task 3 — `Receipt.number` uniqueness — **the handoff's suggested fix is wrong as written**

HANDOFF next-step 3 says "needs a migration (`@@unique` on `Receipt.number`)". Taken
literally that is a **multi-tenancy bug**: receipt numbers are sequential *per tenant*
(`nextNumber()` counts `receipt` scoped through `payment → invoice → userId`), so
`RCPT-0001` legitimately exists once per tenant. A global unique on `number` would make
the second tenant's first receipt fail forever.

`Invoice` gets this right with `@@unique([userId, number])` — but `Receipt` has **no
`userId` column** to do the same with. So the real fix is:

1. Add `userId` + `User` relation to `Receipt`, mirroring `Invoice`.
2. `@@unique([userId, number])` on `Receipt`.
3. Populate `userId` at creation in the mark-paid transaction.
4. Simplify `nextNumber('RCPT')` to count on `receipt.userId` directly.
5. **Bounded P2002 retry around the whole `$transaction`** — a unique constraint converts
   the duplicate into a thrown error, which without a retry just turns a silent duplicate
   into a 500. There is currently **no `P2002` handling anywhere in `server/src`**, so
   `INV` numbering has the same latent 500 on concurrent invoice creation; the same helper
   covers both.

Retry must sit **outside** `prisma.$transaction`, so the rollback un-claims the invoice
status and the retry re-runs the whole claim atomically. Retrying inside would see its own
prior `status: PAID` write and bail to a bogus 409.

Migration is **hand-written** (repo convention — the last one, `20260725090000_add_scraper_settings`,
is hand-written and was verified drift-free with `migrate diff`). Worker is **forbidden**
from running any DB-touching Prisma command; `DATABASE_URL` in this checkout points at
**prod Neon** (fingerprint-matched to the prod checkout's).

Tier: `claude-sonnet-4-6`.

## Task 4 — bind the click-redirect target into the token

`/t/c/:token?u=<b64url>` verifies only that the token signs a valid `recipientId`; `?u=` is
unconstrained, so anyone holding a real tracking token can point the redirect at any host
and borrow the domain's reputation for phishing.

Design: **no schema change and no URL-shape change needed** (the handoff guessed at
"a small schema/token-format change" — it isn't one). Add a separate, domain-separated
click signature over `(recipientId, target)`:

- `signClickToken(recipientId, target)` / `verifyClickToken(token, target)` in `trackingToken.ts`
- `trackedHtml.clickUrl()` signs the exact string it base64url-encodes into `?u=`
- `/t/c/:token` verifies token **and** decoded target together

Domain separation (a distinct HMAC prefix) also stops a pixel/unsub token being replayed as
a click token and vice versa. `signTrackingToken` stays as-is for the pixel and unsubscribe
links, which have no target.

**Backward compatibility: deliberate clean break, no legacy fallback.** Click links in
already-sent mail will 404. Justified by the probe above — 1 recipient and 2 CLICKED events
in the entire prod history. A legacy-accepting fallback would keep the exact hole open that
this change exists to close, for no practical benefit.

Tier: `claude-sonnet-4-6`.

## Task 5 — static IP

GCP console; user's action. Nothing to build. Write up the exact steps + the cost caveat
(a reserved static IP is only free while attached to a running instance).

## Task 6 — one #6 design item: async bounce/DSN ingestion

Highest value of the six: the bounce-rate auto-pause became real code last session (its
follow-up-cancellation hole was fixed) but **nothing feeds it** — bounces arrive as async
DSNs the app never reads, so the safety valve cannot fire. Scope a design this session; do
not half-build it.

## Verification gates (non-negotiable — see `.plans/known-failures.md`)

For every delegated unit, *before* any commit:
- read the **actual diff**, not the worker's summary
- re-run `npx tsc -p .` and `npx vitest run` **myself** in `server/`
- confirm each new test **fails without the fix**, not merely passes with it
- success condition is an observable effect (diff hash change / marker in output), never `agy`'s exit code
