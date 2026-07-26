# Fix status — two-round review, 2026-07-26

Committed on `phase5-frontend-wiring`, **not yet deployed.** `tsc` clean
(server + root), **vitest 185/185** (was 175 before this work).

Every fix below was verified by reverting it and confirming the new test fails,
not merely that it passes with the fix in place.

## FIXED

| # | Finding | Commit |
|---|---|---|
| R1-01 | OAuth `state` not bound to the browser — victim's mailbox capturable into an attacker's tenant | `2f6196c` |
| R1-02 | OAuth `nonce` minted, signed, never compared (documented replay protection that did not exist) | `2f6196c` |
| R1-03 / S-07 | Token revocation did not apply to reads (~15 min of full read access after logout-all) | `2f6196c` |
| S-06 | `/api/auth/refresh` accepted the token from the request body, undoing the HttpOnly migration | `2f6196c` |
| S-05 | Connecting a mailbox bypassed the billing/status gate | `2f6196c` |
| R1-04 | Mailbox address echoed into a redirect URL (history + Referer) | `2f6196c` |
| R1-05 / agy F3 | Provider `error_description` reflected into the redirect | `2f6196c` |
| R1-06 | OAuth client ids read from `process.env`, invisible to config validation | `2f6196c` |
| S-01 | `ClientUser.email` globally `@unique` across tenants | `777ec0a` |
| S-02 | `CookieFile.name` globally `@unique` across tenants | `777ec0a` |
| — | Portal test fake matched compound unique keys against the FIRST row (cross-tenant, silently passing) | `777ec0a` |
| S-03 | Pausing a campaign permanently destroyed its scheduled follow-ups | `8172873` |
| S-04 | Setting `HEALTH_TOKEN` locked admins out of `/api/health/deep` (**was live in prod**) | `52c0243` |
| R1-10 | File-link URLs validated on write only, no render-time guard | `52c0243` |
| agy F4 | `/api/auth/refresh` had no dedicated rate limit | `52c0243` |
| R1-11 | Campaign daily-counter rollover race across UTC midnight | `d95f870` |
| R1-07 | `Host`-header fallback for the OAuth redirect base URL | `d95f870` |

Two migrations, both verified safe against live data first:
`20260726120000_receipt_number_unique`, `20260726160000_scope_unique_constraints_per_tenant`.

## NOT FIXED — deliberate, with reasons

**R1-09 · follow-ups ignore the campaign send window and daily cap** — MEDIUM.
This is a genuine design change, not a patch: follow-up sends would need to
participate in the same window/limit accounting as initial sends, which means
deciding what happens to a follow-up that comes due outside the window (defer?
how far? does it keep its place in the sequence?). Doing it badly is worse than
the current honest gap. Deserves its own session. Already tracked in the
existing backlog.

**R1-08 · `/api/leads/import` bypasses `requireActiveTenant`** — LOW. Arguably
correct for a server-to-server feed authenticated by a shared secret rather than
a user session; billing state gating a machine integration is a product
decision, not a bug. Left alone rather than changed on my own judgement.

**agy auth F5 · `decryptSecret` colon parsing** — LOW, latent. The wire format is
`v1:iv:tag:ciphertext` and base64 never contains `:`, so the split cannot
currently misparse. Real only if the format gains a field.

**worker.ts:386 · duplicate send when a DB write fails after SMTP success** —
PLAUSIBLE, unconfirmed. The mechanism is real (send happens before the status
write; the catch path releases the claim back to `PENDING`), but I did not trace
every branch of that catch, and a wrong "fix" to a send path risks duplicate cold
email — the exact harm it would be fixing. Needs a careful read first.

**worker.ts:483 · campaign flips to `COMPLETED` while recipients are `IN_SEQUENCE`** —
depends on whether `COMPLETED` means "initial sends done" (defensible) or
"sequence finished". Now less pressing: with S-03 fixed, a non-ACTIVE campaign
suspends rather than destroys its follow-ups, so this no longer risks silent data
loss even if the semantics are debatable.

**~20 unverified round-2 findings** — scraper Python file handling and SQLite
connection lifetime, portal SPA sign-out and StrictMode double-consumption, the
`apiClient` refresh race, missing indexes on `FollowupJob.nextRetryAt` and
`Revision(projectId, roundNumber)`, partial send-window config. Preserved in
`.plans/round2-agy-raw/`. **Not acted on because they were never verified against
source**, and this session has now twice caught round 2 stating a HIGH confidently
and wrongly. Verifying them is cheap and is the obvious next task.

**Three round-2 units never delivered** — `portal`, `mail`, `frontend_views`. The
portal backend, the mail/IMAP layer and the 13k-line component tree still have no
independent second opinion.

## Deploy notes

Server-only except `services/safeUrl.ts`, `components/ClientPortalView.tsx` and
`portal/pages/ProjectPage.tsx` — **a frontend rebuild IS required this time**
(`VITE_API_URL="" npx vite build` for the CRM, `npx vite build --config
portal/vite.config.ts` for the portal).

`prisma migrate deploy` is required for the second migration, and the stale-client
trap applies again: regenerate and sync `server/node_modules/.prisma/client`
before restarting, or Prisma rejects the new fields at runtime. See
`.plans/known-failures.md`.

**Expected one-time user-visible effect:** dropping the refresh body fallback and
enforcing revocation on reads means any session running a stale bundle is logged
out once.
