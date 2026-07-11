# HANDOFF — Full-App Functional Audit (for next session)

## 2026-07-11 (later same day) — Security audit fixes + git-history incident recovery

**Context:** Ran a 5-criteria security/architecture stress test (credential leaks, architecture/scalability, multi-tenancy isolation, deliverability, campaign concurrency) via a plan-mode audit, then switched to Sonnet 5 to implement the fixes (F2–F9; F1 explicitly left for the user). Mid-implementation, discovered this session's shell is directly on the prod VM. Mid-*that*, the user pasted a 4-phase git remediation plan from a separate agent ("Gemini") that had **already executed** `git-filter-repo` (secret purge) + a force-push to `github.com/m7shy/Ysx-True-Final.git` on `phase5-frontend-wiring` **before I could act**, and a third agent ("Devin") had also pushed 8 unrelated branches to the same live repo. The filter-repo rewrite + a concurrent `git stash` silently reset several tracked source files back to old committed versions — some of my own just-applied fixes were lost, and (separately, pre-existing) the campaign-wizard's `campaigns/routes.ts` was also reverted.

**Findings/fixes actually shipped this session (built + deployed to `ysx-backend`):**
- **F2** — deleted the legacy unauthenticated `server/index.js` / `server/mail/{smtp,imap}Client.js` monolith (confirmed nothing referenced it; real backend is `server/src/index.ts` → `dist/index.js`).
- **F3** — `campaigns/worker.ts`: atomic `PENDING→SENDING` compare-and-set claim (`updateMany` + `count===1` check) before dispatch, preventing duplicate sends on crash/concurrent ticks. Added `recoverStaleSendingRecipients()` (15 min timeout) so a crash mid-send doesn't strand a recipient forever. `openCount`/`terminalCount` now treat `SENDING` as open so a campaign can't flip `COMPLETED` with a stranded recipient. New `RecipientStatus.SENDING` enum value + migration `20260711120000_recipient_status_sending`, applied to prod DB.
- **F4** — confirmed `scraper/service.ts`'s `MAX_CONCURRENT_CHILDREN` semaphore (`SCRAPER_MAX_CONCURRENT` env, default 4) is intact.
- **F5** — `scheduler/followupScheduler.ts`: same stale-claim reaper pattern (`recoverStaleSendingJobs()`, 10 min timeout) for follow-up jobs stuck in `SENDING`.
- **F6** — CORS pinned to `config.WEB_ORIGIN` instead of reflecting any Origin (`server/src/index.ts`).
- **F7** — confirmed `ScraperSchedule` is in `tenantDb.ts`'s `TENANT_MODELS`; `CookieFile` deliberately excluded (documented why — legacy null-owned rows).
- **F8** — `creds/oauth.ts`/`mailboxStore.ts`: `invalid_grant` on refresh now throws a `MailError` with `revoked:true`, which `ensureFreshAccessToken` catches to set `Mailbox.isActive=false` (terminal "reconnect required" instead of retrying forever). Also restored a genuinely-missing `deleteMailbox()` export (lost in the same revert, not part of the original F-list) and JWT `tokenVersion` claim wiring in `auth/jwt.ts` / `middleware.ts` / `routes.ts` / `index.ts` (revocation-on-logout-everywhere).
- **Recovered `campaigns/routes.ts`** (found via `dist/campaigns/routes.js` being 375 lines vs `src` at 201 — same "silently reverted" pattern as the above, but pre-existing/out of F-scope): restored `GET /:id/recipients` (with `?format=csv` export) and the `customFields` merge-on-upsert logic that `campaignRoutes.test.ts` expects.
- Deleted `server/src/__tests__/phase4.test.ts` — confirmed obsolete (tested the pre-`CampaignRecipient` dispatch architecture against a raw-`prisma` mock; superseded by `engine.test.ts`/`campaignRoutes.test.ts`).
- Recovery method throughout: for any tracked file where `git status`/`git diff` showed no change vs a suspicious old `HEAD`, cross-referenced `server/dist/*.js` (the actually-running compiled output, untouched by any git operation) as ground truth and rewrote the TS source to match.

**Result:** `npx tsc -p . --noEmit` clean. `npx vitest run` — 13/13 files, 95/95 tests passing. Committed (`git commit`, amended once pre-push after catching that the initial commit had swept in `scraper/leads.csv`, `blacklist.csv` (94k lines), `__pycache__/`, and other scraper runtime-state files — stripped those and added gitignore rules) and pushed to `origin/phase5-frontend-wiring`. Backend rebuilt (`npm run build`); **the final `nssm restart ysx-backend` had to be done by the user** — this session's shell is not elevated (confirmed via `whoami`/`net session`; `PowerShell`/`nssm` both got `Access is denied` even with sandbox override off) and self-elevation isn't possible without a UAC prompt only the user can approve.

**Still outstanding — not done this session, needs the user:**
1. **F1 — credential rotation.** Gmail app password, Microsoft client secret, Neon DB password, `JWT_SECRET`, `MAILBOX_ENCRYPTION_KEY` are confirmed still the original leaked values (`server/.env` mtime unchanged since 2026-07-08; `nssm get ysx-backend AppEnvironmentExtra` shows no rotation either). This is the actual "already-happened" compromise from the original audit — do this before routing real leads through the platform, independent of anything else in this file.
2. **F9 nit** — verify the prod NSSM service definition pins `NODE_ENV=production` (if not, `jwt.ts`'s dev-fallback secret is reachable even after F1 rotation).
3. The 8 `devin/*` remote branches pushed to GitHub during this incident were never reviewed — unknown whether they contain anything worth merging or are safe to ignore/delete.
4. Confirm the `nssm restart ysx-backend` the user ran after this session picked up the rebuilt `dist/` — spot-check `/api/health` and that a mailbox delete / campaign recipients CSV export works post-restart.

---

## 2026-07-11 — Campaign creation wizard built, deployed, and live-QA'd

**What shipped:** Replaced the old single-modal `ComposeNewEmail.tsx` (now deleted) with a Smartlead-style campaign flow: name popup (Continue/Cancel/Skip) → 4-step wizard (Import Leads → Sequences → Setup → Final Review). New UI lives at `src/features/campaigns/` (salvaged + rewritten from the stale `origin/devin/1776980999-campaign-wizard` branch's UI only — its in-memory backend stub was discarded; wired to the real `server/src/campaigns/routes.ts`/`worker.ts` instead). Full plan is in the session that did this work; summary below is what actually landed.

**Backend additions:**
- `prisma/schema.prisma`: `Campaign` gained `sendIntervalMinutes`, `nextSendAt`, `stopOnClick`, `stopOnOpen`, `plainTextMode`, `followUpPercent`, `bouncedCount`, `pausedReason`; `Lead` gained `customFields Json?` (raw CSV row per lead, for `{{variable}}` interpolation). Migration `20260711000000_campaign_wizard` — **applied to prod DB** (`prisma migrate deploy`, confirmed).
- `server/src/campaigns/variables.ts` — `renderTemplate`/`buildVariableMap`: `{{first_name}}`/`{{company}}`/arbitrary CSV columns resolve per-lead at send time, runs after `resolveSpintax`, strips braces from substituted values.
- `server/src/campaigns/trackingToken.ts`, `trackingRoutes.ts` (mounted at `/t`, unauthenticated), `trackedHtml.ts` — real open-pixel (`GET /t/o/:token`) and click-redirect (`GET /t/c/:token`) tracking, HMAC-signed tokens, writes `TrackingEvent` rows. **Verified live in prod** (see QA below).
- `server/src/campaigns/worker.ts` / `engine.ts`: per-campaign send pacing (`sendIntervalMinutes` + 30–60s random jitter via `nextSendAt`), stop-on-open/stop-on-click (`stopRecipientForEvent`), follow-up-vs-new-lead priority throttling (`followUpPercent`), hard-bounce detection + auto-pause at 5% bounce rate (20-send floor, per-campaign scope). Async DSN-bounce parsing in `replyPoller.ts` was scoped out (optional/cuttable per plan) — only synchronous SMTP 5xx bounce detection is live.
- Tests: extended `campaignRoutes.test.ts`, `engine.test.ts`; new `variables.test.ts`, `tracking.test.ts`. 106 tests passing across 13 files (`cd server && npx vitest run`).

**Deploy (executed this session, on this VM = prod):** `prisma migrate deploy` → `prisma generate` (was blocked by a file lock from the *old* running `ysx-backend` process itself — resolved by restarting the service) → `server: npm run build` → root `VITE_API_URL="" npx vite build` → `nssm restart ysx-backend`. New process confirmed on port 3001, `/api/health` 200, clean startup log.

**Live QA (real account, real send, no synthetic mocks):** Created `[[Wizard QA Test]]`-style campaign end-to-end through the actual browser (Claude-in-Chrome on the user's real Chrome — the sandboxed Browser pane tool was broken all session, failed to load even example.com, never diagnosed further). CSV upload/mapping, sequence editor with `{{var}}` pill highlighting, all three settings groups, and Final Review preview all rendered and behaved correctly. Confirmed via live DB + live HTTP against `ysxvisuals.online`:
- Campaign persisted with correct `sendWindowStart/End`, `sendDays` bitmask, `sendIntervalMinutes`, `followUpPercent`, etc.
- A real email actually sent through the user's connected mailbox.
- Both follow-ups scheduled at exactly +2 and +5 days (relative-delay math confirmed correct).
- Pacing/jitter confirmed: `nextSendAt` landed 98.7s after the send (60s interval + 30–60s jitter → expected 90–120s window).
- Open pixel (`/t/o/:token`) returns a real GIF, writes `OPENED`, 5-min dedupe intact. Click redirect (`/t/c/:token`) 302s correctly, writes `CLICKED`, increments `Campaign.clickedCount`.

**Two real gaps found during live QA (not yet fixed):**
1. `{{first_name}}` rendered as the raw email address instead of the CSV-provided name, for a lead that **already existed** in the CRM before this campaign. Root cause: `upsertRecipientsAsLeads` in `server/src/campaigns/routes.ts` only merges `customFields` on an existing-lead upsert — it never updates `name`/`company` (this was already the existing behavior before today's work, not a regression, but the wizard now makes it more visible since fresh CSV names are expected to "just work"). Fresh/new leads interpolate correctly — this only bites on re-import over a pre-existing lead row.
2. The wizard's Step 1 has **no "From CRM leads" tab** — only CSV upload. Selecting existing tenant leads directly into a new campaign isn't wired up, despite being in the original plan.

**Test data left in prod on purpose (user's call, do not touch):** campaign `Wizard QA Test` (id `cmrg1aiz500014zrktimx3b89`) is intentionally left running with 2 real follow-ups still scheduled (Jul 13, Jul 16) to the user's own inbox — user asked to leave it as-is.

---

**Date:** 2026-07-10. Previous session hit its usage limit mid-exploration. This file carries everything needed to construct the audit plan in a fresh chat.

## The ask (user's words, distilled)
Test **every feature** in the app end-to-end so the CRM is bulletproof. Find and fix the bugs that keep surfacing. Plan first (plan mode), then execute after approval.

- Use the user's real signed-in account for testing: `sofffa.309.youssef@gmail.com` / `Youssef122` (they authorized this explicitly — for follow-ups, sending, campaign settings).
- **HARD NO: never delete accounts.** Creating extra test accounts is allowed only when genuinely needed.
- Specific suspicions to verify: are campaign settings even wired to the backend? Follow-ups? Sending?

## Critical environment facts (verified this session)
- **This Windows Server VM IS production.** `ysxvisuals.online` (Caddy `caddy-proxy` service → localhost:3001) is served by NSSM service `ysx-backend` running `node dist/index.js` from `server/` in THIS repo. The Neon Postgres `DATABASE_URL` in `server/.env` is the **production DB** — dev scripts and the prod service share it. Any test data created is real data; clean up carefully (delete only rows you created — never users).
- Redeploy: `VITE_API_URL="" npx vite build` (repo root) + `npm run build` (server/) + elevated `nssm restart ysx-backend`. Claude's shell is NOT elevated; last elevation attempt was permission-blocked, so ask the user to run the restart, or request permission.
- Frontend dev server: `npm run dev` (port 3000) hits the PROD backend on 3001 (`services/apiClient.ts` defaults to `http://localhost:3001`). There is a `.claude/launch.json` with backend/frontend configs (backend one can't bind 3001 — prod owns it).
- The prod backend process carries extra env NOT in `server/.env` (e.g. `OAUTH_REDIRECT_BASE_URL=https://ysxvisuals.online`), set via NSSM `AppEnvironmentExtra`.
- Server tests: `npx vitest run` in `server/` — 47 tests, all passing as of this session.

## State: what was already done this session (deployed to prod except where noted)
1. **Microsoft 365 OAuth connect — VERIFIED WORKING end-to-end.** User connected their mailbox successfully after (a) re-enabling the disabled Azure app "YSX Mail Gateway" (AADSTS7000112) and (b) adding redirect URI `https://ysxvisuals.online/api/auth/oauth/microsoft/callback` (AADSTS50011). App registration is single-tenant (`MICROSOFT_TENANT_ID` pinned).
2. **Real mailbox disconnect**: new `DELETE /api/mail/mailboxes/:id` in `server/src/mail/routes.ts` + `deleteMailbox()` in `server/src/creds/mailboxStore.ts`; wired in `components/IntegrationsView.tsx` (per-mailbox + per-integration). Tests in `server/src/__tests__/disconnect.test.ts`.
3. **IntegrationsView fixes**: Sync Now wired to re-check; "Re-auth Required" badge now works for MICROSOFT (was Google-only); HubSpot/Salesforce/Slack/Calendly marked "Coming Soon" (fake 2s-timer connects removed).
4. **useEmailProvider.ts**: removed 3 stale "Microsoft not supported" throws; Microsoft now always uses the gateway path (`usesGateway()` helper); removed false "follow-ups Gmail-only" error branch (backend supports Microsoft).
5. **tenantDb.ts CRITICAL FIX (built, tests pass — RESTART MAY STILL BE PENDING, verify!):** the tenant-scoping Prisma extension AND-wrapped `where` for ALL ops, which Prisma rejects for unique-where ops. Symptom user hit: `prisma.lead.upsert()` "Unknown argument userId_email" when composing an email. Fix: `UNIQUE_WHERE_OPS` (findUnique/update/delete/upsert) now use sibling-merge `{...where, userId}`; filter ops keep AND-merge. Verified against the live DB incl. cross-tenant isolation (blocked, P2025). **First step next session: confirm the user restarted `ysx-backend` and compose-email works; if not, get the service restarted.**

## Bug-class warning (this is the pattern to hunt)
The tenantDb bug was invisible until a real user exercised the path. Suspect ALL under-exercised paths, especially every caller of `tenantDb()` doing update/delete/findUnique/upsert (campaigns, leads, unibox, followups), JSON-blob fields cast with `as any`, and frontend features that only manipulate local state (the fake integrations were such a case).

## Exploration status (both agents were cut off — findings PARTIAL)
Known app surface to map/test (from earlier reads):
- **Views** (components/): DashboardView (has mock emails from `services/mockZoho.ts` when `useRealApi` off — check default), IntegrationsView (done), CampaignsView?, Unibox/Inbox, Leads/Workspace, ScraperView, SettingsModal (transportMode radio, provider selection, googleClientId/Secret fields — legacy browser-side Google OAuth, a security smell), ComposeNewEmail.
- **Backend routers** (server/src/): auth, auth/oauth, mail, followups, gemini, campaigns, leads, leads/importRoutes, unibox, scraper, billing (+ Stripe webhook). Workers: campaigns/worker.ts, scheduler/followupScheduler.ts, unibox/replyPoller.ts, scraper autoScheduler.
- **Key open questions to answer during exploration:**
  1. Does campaigns/worker.ts honor Campaign fields: schedule, dailyLimit, sequence, distributionMethod, autoFollowUps — or are some write-only (UI saves them, nothing reads them)?
  2. Unibox reply detection → does it cancel follow-ups correctly (`skipIfReplied`)?
  3. Dashboard stats: real data or mock? `useRealApi` default?
  4. SettingsModal: which fields actually do anything?
  5. followupScheduler: durable? survives restart? Uses DB (FollowupJob model) — verify jobs actually fire (tick interval, error paths).
  6. Frontend `useEmailProvider.ts` executeWithRetry uses browser-held Google client secret from settings — legacy path; decide whether to kill legacy 'oauth-api' transport mode entirely.

## Testing ground rules (user-approved constraints)
- Send test emails **to the user's own address** (self-send) or an address you control — never to real prospects/leads.
- Follow-up tests: schedule with MINUTES delays so they fire during the session; verify send + `skipIfReplied` behavior; cancel/clean up leftover scheduled jobs after.
- Campaign tests: create a clearly-named test campaign (e.g. `[CLAUDE-TEST] ...`), tiny recipient list (user's own address), then remove test leads/campaign rows afterward.
- Use the app through the browser preview (frontend dev on :3000 → prod backend) or directly against `https://ysxvisuals.online`; drive UI with preview_* tools; user's login above.
- Delete only data created during testing. **Never `prisma.user.delete`** (allowed sole exception: none — the earlier throwaway-tenant cleanup pattern is now off-limits per the hard-no; if a test account is created, leave it and tell the user).

## Suggested plan shape (for the next session to refine)
Phase 0: verify tenantDb fix is live (compose email works). Phase 1: finish the two exploration sweeps (frontend wiring map + backend route/worker audit). Phase 2: feature-by-feature live testing matrix (auth/session, leads CRUD+import/export, compose+send, follow-ups incl. reply-cancel, campaigns end-to-end incl. worker dispatch, unibox, scraper view, settings, billing reads, dashboard). Phase 3: fix bugs found (batch), full test suite, redeploy once, re-verify. Keep a running BUGS.md or plan-file checklist so nothing found gets lost.
