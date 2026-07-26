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

## Second pass — verified the remaining round-2 findings, then fixed the real ones

The ~20 findings previously left unverified were checked against source. Result:
**5 real and fixed, 2 refuted, and one that neither round had spotted turned out
to be the worst defect in the codebase.**

| Finding | Verdict | Commit |
|---|---|---|
| **Sign-out never cleared the refresh cookie (BOTH apps)** | **CONFIRMED — worse than reported** | `b2f57c2` |
| `PENDING_VERIFICATION_FILE` shared across tenants | CONFIRMED | `1cbd54e` |
| Half-configured send window silently ignored | CONFIRMED | `1cbd54e` |
| Raw DB error echoed in the deep-health payload | CONFIRMED | `1cbd54e` |
| Duplicate send when post-send bookkeeping fails | CONFIRMED (traced) | `bd4a95c` |
| R1-09 follow-ups ignore send window / daily cap | DECIDED + implemented | `bd4a95c` |
| "Standalone follow-up infinite retry loop" | **REFUTED** — job is finalized SENT; no loop exists | — |
| "Unindexed `FollowupJob.nextRetryAt`" | **REFUTED** — only ever written; claim query uses the indexed `(status, scheduledAt)` | — |

### The sign-out defect
Round 2 flagged the portal half. Tracing it showed the CRM half is worse:
**`POST /api/auth/logout` did not exist.** The SPA has always called it and
swallowed the 404 with `.catch(() => {})`, so the failure was invisible. The
portal called no endpoint at all. Both apps therefore left an HttpOnly refresh
cookie valid for 30 days after "Sign out" — on a shared browser the next person
to load the app was signed in as the previous user. A regression from moving
refresh tokens out of localStorage, where logout used to destroy them by
accident of storage location.

### Decisions made rather than deferred (R1-09)
- **Send window: enforced** for follow-ups. It governs when a recipient is
  contacted, and follow-ups are most of a sequence. Deferred, not dropped.
- **Daily cap: counted, not blocked.** Counting makes the limit honest and makes
  new outreach yield to in-flight sequences. Blocking would strand sequences
  mid-way, which reads as ghosting and only reorders the mail rather than
  preventing it.

## STILL NOT FIXED — deliberate, with reasons

**R1-08 · `/api/leads/import` bypasses `requireActiveTenant`** — LOW. Arguably
correct for a server-to-server feed authenticated by a shared secret rather than
a user session; billing state gating a machine integration is a product
decision, not a bug. Left alone rather than changed on my own judgement.

**agy auth F5 · `decryptSecret` colon parsing** — LOW, latent. The wire format is
`v1:iv:tag:ciphertext` and base64 never contains `:`, so the split cannot
currently misparse. Real only if the format gains a field.

**worker.ts:483 · campaign flips to `COMPLETED` while recipients are `IN_SEQUENCE`** —
depends on whether `COMPLETED` means "initial sends done" (defensible) or
"sequence finished". Now less pressing: with S-03 fixed, a non-ACTIVE campaign
suspends rather than destroys its follow-ups, so this no longer risks silent data
loss even if the semantics are debatable.

**Remaining unverified round-2 findings** — the lower-value tail: SQLite
connection lifetime in `_connect_webhook_db`, Gemini safety-blocked responses in
`orchestrator.py`, the `release_blacklist.py` log-parser regex, portal SPA
StrictMode double-consumption, the `apiClient` 401 refresh race, missing
`@@unique([projectId, roundNumber])` on `Revision`, and `process_lookalike.py`
profile isolation. All are LOW/MEDIUM robustness items with no security or data
-integrity consequence I could see from their descriptions. Preserved in
`.plans/round2-agy-raw/` and still **unverified — do not act on them without
checking the source first.**

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
