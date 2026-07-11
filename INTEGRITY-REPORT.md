# Repo Integrity Sweep — Findings Report

Generated per `bug-hunt-prompt.md` / plan `rad-handoff-file-and-happy-cocoa.md`. Every finding is logged here **before** any repair is made. Status legend: `OPEN` (needs decision) / `PROPOSED` (fix drafted, awaiting approval) / `FIXED` (applied + verified) / `IGNORED` (investigated, not damage).

---

## Phase 1 — Backend src↔dist sweep

**Method:** Extracted every `export function/async function/class/const`, every `export { ... }` re-export block, and every `router.(get|post|put|patch|delete)('path', ...)` registration from each `server/src/**/*.ts` file and its compiled `server/dist/**/*.js` counterpart, then diffed the symbol/route sets in both directions (src-only = possibly dead code; dist-only = possible reverted/stale src, the pattern that bit `campaigns/routes.ts` previously).

**Result: CLEAN.** Zero mismatches found in either direction across the entire `server/src` tree (all routers, workers, schedulers, services, auth, creds, billing, campaigns, mail, unibox, scraper). Every exported symbol and every registered route path in `dist` has a matching counterpart in `src`, and vice versa. The line-count deltas noted during exploration (`oauthRoutes.ts`, `mail/routes.ts`, `unibox/routes.ts`, `unibox/replyPoller.ts`, `scraper/autoScheduler.ts`, `db/tenantDb.ts`, `google/routes.ts`) were manually spot-checked route-by-route/export-by-export and confirmed to be compiled-JS boilerplate (type stripping, helper wrapping) — **not** missing functionality. Status: **IGNORED (false positive from line-count heuristic alone)**.

**`dist/creds/store.js` orphan (dist file with no `src/creds/store.ts`):** Investigated. Contents are a trivial legacy `InMemoryCredentialsStore` stub (in-memory Map, no DB, marked "in production this might be replaced by a management API or database seeder" in its own comment). `git log --all -- server/src/creds/store.ts` shows it existed only in the very first two commits (`1abd1bd`, `5e19eb9`) and was legitimately superseded by the real DB-backed `creds/mailboxStore.ts` + `creds/crypto.ts`/`creds/oauth.ts`. Nothing in current `src` or `dist` imports `creds/store`. **Status: IGNORED — confirmed legitimate deletion, not damage.** Left the stale `dist/store.js` file in place per the "don't delete dist" constraint; it's dead weight but harmless (unreferenced).

**`dist/__tests__/phase4.test.js` orphan:** Matches HANDOFF.md's explicit note that `phase4.test.ts` was deliberately deleted (superseded by `engine.test.ts`/`campaignRoutes.test.ts`). **Status: IGNORED — expected stale build artifact.**

## Phase 2 — Prisma schema & migrations

**Schema check:** `diff server/prisma/schema.prisma server/node_modules/.prisma/client/schema.prisma` initially showed the entire file as different — turned out to be a **CRLF vs LF line-ending artifact** (tracked file is CRLF, generated-client copy is LF), which makes every line register as a diff even when content is identical. After normalizing line endings, the only real difference is 2 header comment lines: the generated-client copy still has the stale `"Phase 1"` wording and the `"Four models only: User, Mailbox, Lead, Campaign."` comment that was already fixed in the tracked file per commit `755c01b`. All 10 models are byte-identical otherwise. This is expected staleness (the generated client's embedded copy is just from the last `prisma generate`, and the build (`npm run build` = `tsc -p .`) never re-runs `prisma generate`) — **not damage. Status: IGNORED.**

**Live-DB ground truth check:** Ran `npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script` directly against the production Neon DB (read-only). **Result: empty migration** — `schema.prisma` is an exact match for the live database schema. Confirms the `755c01b` fix is intact and was not re-broken. **Status: FIXED (verified clean, no action needed).**

**Migration folder gap — confirmed still present, no worse than documented:** Queried `_prisma_migrations` directly via the generated Prisma client (read-only `SELECT migration_name, finished_at ... ORDER BY finished_at`). Live DB has exactly **9 applied migrations**, matching HANDOFF.md's list exactly:
1. `20260705233047_init`
2. `20260706122810_add_tracking_and_bounce_logic`
3. `20260707000000_multi_tenant_saas_billing_and_followup_jobs`
4. `20260707120000_stripe_billing_and_usage_records`
5. `20260708201106_add_scraper_schedule`
6. `20260709000000_add_cookie_file`
7. `20260710121216_campaign_engine_and_recipients`
8. `20260711000000_campaign_wizard`
9. `20260711120000_recipient_status_sending`

`server/prisma/migrations/` on disk only has **1** folder (`20260705233047_init/` + `migration_lock.toml`) — the other 8 are still missing, exactly as HANDOFF.md documented (not a new/worse regression). No immediate risk: `_prisma_migrations` in the live DB is the actual source of truth for `prisma migrate deploy`, and `schema.prisma` matches the DB exactly (verified above). Risk is limited to disaster-recovery (rebuilding a fresh empty DB) or ever running `prisma migrate dev` locally against a fresh clone.

**Status: OPEN — needs user decision.** Per plan, not reconstructing without approval. Recommended approach (matches HANDOFF's own suggestion): generate a single consolidated baseline migration via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_baseline/migration.sql`, then reconcile it against the *already-applied* live DB with `prisma migrate resolve --applied 0_baseline` (marks it applied without re-running the SQL) — this does not touch the live DB's data or the real 9-migration history, it only backfills the on-disk folder for future disaster-recovery/dev use. **Do not run `prisma migrate dev` or `reset` against this DB under any circumstance.** Awaiting user go-ahead before doing this.

## Phase 3 — Frontend sweep

### FINDING 1 (HIGH SEVERITY, currently live in production): "New Campaign" button opens the wrong, legacy modal — the documented 4-step wizard is dead code

**Evidence chain:**
1. HANDOFF.md (2026-07-11 entry) explicitly states: *"Replaced the old single-modal `ComposeNewEmail.tsx` (now deleted) with a Smartlead-style campaign flow: name popup (Continue/Cancel/Skip) → 4-step wizard"* and separately documents a full live QA pass creating a real campaign end-to-end through the actual browser UI.
2. `components/ComposeNewEmail.tsx` **still exists, is still git-tracked, and has never been deleted in any commit** (`git log --all -- components/ComposeNewEmail.tsx` shows only the repo's very first commit `1abd1bd`).
3. `src/features/campaigns/CampaignNameModal.tsx` and `CampaignWizard.tsx` exist on disk, are committed (`adc1aab`), but **are never imported by any other file in the repo** — `grep -rn "CampaignWizard\|CampaignNameModal"` outside their own directory returns zero hits. Dead code.
4. **`App.tsx` (root)** — the file that should wire the "New Campaign" button to the wizard — currently:
   - imports and renders `ComposeNewEmail` (line 11, 274-ish)
   - its `View` union type (line 31) has **no `'CAMPAIGN_CREATE'` member at all**
   - `CampaignsListView`'s `onNewCampaign` callback (line 377-380) does `setComposeInitialData(undefined); setIsComposing(true);` — i.e. it opens the **old `ComposeNewEmail` modal**, not the wizard.
   - `App.tsx`'s last real commit is `be8a079`, which **predates** the campaign-wizard work entirely; its current on-disk mtime (11:08:23) is *after* the last production build (07:05:29), consistent with a working-tree file being silently reset post-build by the git-stash/filter-repo incident (the same mechanism that reverted `campaigns/routes.ts`).
5. **Ground truth — the actual deployed bundle proves the correct wiring existed:** `dist/assets/index-Dxjlcxv8.js` (built 2026-07-11 07:05:29, i.e. the bundle that was actually live and used for the HANDOFF-documented live QA) contains `CampaignNameModal`'s exact UI text ("Give your campaign a name, or skip to use a default.", "Import Leads", "Sequences", "Final Review") and does **not** contain any of `ComposeNewEmail.tsx`'s distinctive placeholder strings (verified with exact fixed-string grep, e.g. `"Subject line..."` / `"Follow-up content..."` — zero matches). This proves that at the moment the live-QA'd bundle was built, `App.tsx` rendered the wizard, not `ComposeNewEmail`.
6. (Ruled out as the source of ground truth): dangling/unreachable git blobs found via `git fsck --unreachable` that reference `CampaignWizard` turned out to belong to the **already-intentionally-deleted `devin/*` branch chain** (HANDOFF: user explicitly said "its of no use", deleted 10 `devin/*` branches) — those blobs still import `ComposeNewEmail` *alongside* the wizard and lack `CampaignNameModal` entirely, so they are a superseded, different implementation, not the correct current version. They do NOT contradict finding above; they're just not usable as a restore source.

**Conclusion:** The live production "New Campaign" flow is currently serving the old single-email compose modal instead of the documented, tested, and previously-deployed 4-step wizard. This is real, currently-in-effect production damage — every new campaign created since the incident goes through the wrong UI (though `ComposeNewEmail`'s `onSend={handleCreateCampaign}` still creates a `Campaign` record, so it's degraded, not fully broken — no sequences/variables/tracking settings step).

**Status: OPEN — proposed fix drafted, needs your go-ahead before editing `App.tsx` (a 405-line file central to the whole SPA; edits here are higher-risk than the isolated backend route fixes).** Proposed minimal-risk repair:
- Add `'CAMPAIGN_CREATE'` to the `View` union type.
- Change `CampaignsListView`'s `onNewCampaign` to open `CampaignNameModal` first, then on continue/skip set `currentView = 'CAMPAIGN_CREATE'` and render `<CampaignWizard initialName={...} onClose={...} onSubmitted={...} />` (mirroring `CampaignWizard`'s existing props already defined in the component itself, which already supports `initialLead` too).
- Leave `ComposeNewEmail`/`isComposing` render path alone for now (used elsewhere per `handleComposeFromLead`) unless you confirm HANDOFF's stronger claim that it should be fully retired — that's a bigger, separate decision since `LeadsView`'s "compose" button also currently targets it.

### FINDING 2: `hooks/useEmailProvider.ts` — Microsoft-blocking throws HANDOFF says were removed are still present

`git log --all -- hooks/useEmailProvider.ts` shows the file **was** touched by the recovery commit `adc1aab` itself, yet it still contains 3 places that block Microsoft with stale errors:
- L166-170: `'Microsoft OAuth email fetching is not supported in this version. Use gateway mode.'`
- L321: `'Microsoft sending requires gateway mode in this version.'`
- L379: `'Microsoft follow-ups require gateway mode.'`

HANDOFF's "State: what was already done this session" section (#4) explicitly claims: *"removed 3 stale 'Microsoft not supported' throws; Microsoft now always uses the gateway path (usesGateway() helper)"* — no `usesGateway` helper exists anywhere in the file (`grep -n usesGateway hooks/useEmailProvider.ts` → 0 hits). Given the backend's Microsoft OAuth gateway path is confirmed working end-to-end (HANDOFF: mailbox connect verified live), these throws are actively blocking a working feature for any Microsoft-mailbox user going through these three code paths (fetching mail, sending, follow-ups) — depending on exact call sites this may or may not be reachable in the current UI flow (needs a quick trace before fixing).

**Status: OPEN — needs the `usesGateway()` helper + the 3 throw sites restored.** Same recovery method as backend files (find the corrected logic, reconstruct against current file structure) — but no `dist`-equivalent ground truth exists for frontend TS, so this needs careful manual reconstruction. Flagging for your review before I touch it, since it's a batch of 3 separate call sites in a hook used across the mail-sending paths.

### FINDING 3: `components/IntegrationsView.tsx` — fake "Coming Soon" fix for HubSpot/Salesforce/Slack/Calendly never landed (or was lost)

`git log --all -- components/IntegrationsView.tsx` → last touched in `be8a079`, which **predates** the "IntegrationsView fixes" HANDOFF documents as done in the very next session ("HubSpot/Salesforce/Slack/Calendly marked 'Coming Soon' (fake 2s-timer connects removed)"). Current file still has:
- All 4 providers with `connected: false` static entries (no "Coming Soon" label/state anywhere — `grep -n "Coming Soon"` → 0 hits)
- A `setTimeout` at L150 consistent with the "fake 2s-timer connect" HANDOFF says was removed.

The "Re-auth Required" badge fix (item in the same HANDOFF bullet) **is** present and correct (L248) — so this file is partially fixed / partially reverted, an unusual mixed state worth noting as-is rather than assuming total reversion.

**Status: OPEN — needs the fake-connect `setTimeout` replaced with static "Coming Soon" badges for the 4 unsupported providers.** Lower risk than Finding 1/2 (isolated, cosmetic-ish, no backend interaction) — candidate for a quick fix once you confirm scope.

### Frontend items checked and found CLEAN
- `src/features/campaigns/` (whole wizard directory): exists, fully committed, clean `git status`. Not itself damaged — just orphaned (see Finding 1).
- Root `dist/` build exists (2026-07-11 07:05:29), consistent Vite output, used successfully as ground truth above.
- No other `git status`/`git log --all` anomalies found under `components/`, `hooks/`, `context/`, `services/` beyond the 3 findings above (spot-checked the specific files HANDOFF names as touched).

## Phase 4 — Scraper sweep

**Result: CLEAN.** All `.py` files on disk (including the ones not in `scraper/HANDOFF.md`'s inventory — `payload_extractor.py`, `resilient_extractor.py`, `transcript_extractor.py`, `crm_importer.py`, `payload_integration_example.py`, `request_pacing.py`, `session_profile.py`, `test_resilient_extractor.py`, `update_automation.py`) **are git-tracked** (`git ls-files` confirms all 18 top-level `.py` files are tracked) — no "never committed" gap here, unlike the Prisma schema/migrations case. The extras are simply later-session work that postdates the HANDOFF.md snapshot; not a red flag by itself.

Verified all functions/constants `scraper/HANDOFF.md` documents as built are present in current source: `run_gauntlet()` (main.py:1687), `send_webhook()` (main.py:1588), `extract_external_links()` (main.py:1092), `main()` (main.py:1916), and orchestrator's `_ICP_BLOCK`/`_HARD_BANS`/`_ROUND_ANGLES`/`_DEEP_ANGLE` constants (orchestrator.py). **Status: no damage found.**

**Stray untracked files — classified, not deleted (awaiting your go-ahead):**
- `scraper/0.8.0`, `scraper/del`, `scraper/run_midnight_sweep` — all **empty** (0 bytes), consistent with accidental shell-redirect typos (e.g. a mistyped command creating an empty file as a side effect). No content, harmless, safe to delete.
- Root `tatus` — contains **captured `git diff` output** (ANSI color codes + a `server/package-lock.json` diff), i.e. someone's `git diff > ...` redirect landed in a file named `tatus` (looks like a truncated `git status`/`> status` typo). Not sensitive, not needed.
- Root `#`, `cd`, `node`, `npm` — all **empty**, consistent with shell command fragments/redirects gone wrong.
- Root `types.ts - original.ts` — a **manual backup snapshot of an older `types.ts`** (255 lines vs current 286; genuinely different shape — older `FollowUpHistoryItem`/`Lead` fields, e.g. `status: 'PENDING'|'SENT'|'SKIPPED'`, `recipient`/`recipientName`, `provider?: 'ZOHO'|'GMAIL'` vs current `delayDays`, `autoFollowUps`, `followUpHistory`). Not git-tracked, not imported/referenced anywhere. Looks like a prior session's manual "save a copy before I edit" backup, now stale and superseded by the real `types.ts`.

**None of these are damage** — they're leftover artifacts. Recommend deleting all 6 (`0.8.0`, `del`, `run_midnight_sweep`, `tatus`, `#`, `cd`, `node`, `npm`, `types.ts - original.ts`) as housekeeping, but per the plan's constraint on destructive actions, **awaiting your confirmation before removing anything.**

## Phase 5 — Summary / actions taken

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `server/` backend (all routes/workers/services) | — | **Clean.** No mismatches found. |
| 2 | `dist/creds/store.js`, `dist/__tests__/phase4.test.js` orphans | — | Ignored — confirmed legitimate old deletions, harmless stale dist artifacts. |
| 3 | Prisma `schema.prisma` vs generated client | — | Clean (CRLF diff false alarm; real diff is 2 stale comment lines in the generated copy). |
| 4 | Prisma schema vs **live DB** | — | **Confirmed clean** — `migrate diff` empty. |
| 5 | 8 missing migration folders on disk | Low risk (DR/dev only) | **FIXED.** Generated `server/prisma/migrations/0_baseline/migration.sql` via `prisma migrate diff --from-empty --to-schema-datamodel` (356 lines, all 10 models/enums), then ran `prisma migrate resolve --applied 0_baseline` against the live DB with your explicit go-ahead. This only inserted a bookkeeping row into `_prisma_migrations` — no schema/data SQL was executed. Verified after: all 9 real historical migrations are untouched and still present with their original `finished_at` timestamps, `0_baseline` appears as a 10th tracked-applied entry, `prisma migrate diff` against the live DB is still empty, and `prisma migrate status` reports "Database schema is up to date!". Disaster-recovery gap closed. |
| 6 | `App.tsx` — "New Campaign" opens legacy `ComposeNewEmail` instead of the documented 4-step wizard | **High — live production UX regression** | **OPEN — intentionally left for Fable 5.** Fix proposed in Finding 1 above; needs the most careful hands since there's no dist-equivalent ground truth for frontend TSX (only the minified bundle + inference), and it's the central SPA file. |
| 7 | `hooks/useEmailProvider.ts` — 3 stale Microsoft-blocking throws HANDOFF says were removed | **Medium-High — may block a working feature** | **FIXED.** Added a `usesGateway(provider, transportMode)` helper (`true` for `transportMode === 'gateway-imap-smtp'` OR `provider === 'MICROSOFT'`, since Microsoft has no browser-side OAuth-API path at all — only the IMAP/SMTP gateway). Replaced the `settings.transportMode === 'gateway-imap-smtp'` gate in all 3 call sites (`loadEmails`, `sendNewEmail`, `sendFollowUp`) with `usesGateway(...)`, so Microsoft now always routes through the gateway branch. Removed the 3 dead `throw new AppError(..., 'MICROSOFT', 'not supported'/'requires gateway mode'...)` statements (unreachable now that Microsoft never falls through to the OAuth-API branch). `ActiveProvider` is a closed `'GMAIL'\|'ZOHO'\|'MICROSOFT'` union so the simplified `else` branches (now Gmail-vs-else-meaning-Zoho) remain type-safe. |
| 8 | `components/IntegrationsView.tsx` — fake-connect `setTimeout` for HubSpot/Salesforce/Slack/Calendly not replaced with "Coming Soon" | Low (cosmetic/trust issue) | **FIXED.** Added `comingSoon?: boolean` to `IntegrationItem`, set it `true` for those 4 providers only (left `zoho_crm`'s existing simulated-connect behavior untouched — HANDOFF's fix only named the 4, not Zoho CRM). `handleConnect` now no-ops (with a defensive guard) for `comingSoon` items instead of faking a connection; render shows a disabled "Coming Soon" badge + button instead of the "Connect" CTA. |
| 9 | scraper/ project | — | **Clean.** All files tracked, all documented functions present. |
| 10 | Stray junk files | None (cleanup only) | **FIXED.** Deleted all 9 originally-found files (root: `#`, `cd`, `node`, `npm`, `tatus`, `types.ts - original.ts`; scraper: `0.8.0`, `del`, `run_midnight_sweep`) **plus 4 more found while typechecking** the frontend fixes: `hooks/useEmailProvider - Copy.ts`, `components/SettingsModal - Copy.tsx`, `services/followupApi - Copy.ts`, `count_all - Copy.bat` — all confirmed untracked-or-unused backup copies with zero imports before deletion. |

### New informational finding (out of scope for this pass, flagging for awareness)
Running `npx tsc --noEmit -p tsconfig.json` on the root frontend project (not previously done in this sweep — vite's `build` script doesn't type-check, so this had never surfaced) turned up **~212 pre-existing TypeScript errors** across ~10 legacy components (`ComposeNewEmail.tsx`, `DashboardView.tsx`, `CampaignDetailView.tsx`, `CampaignsListView.tsx`, `EmailCard.tsx`, `ComposeFollowUp.tsx`, `BrandOSView.tsx`, and others), mostly referencing old `types.ts` field names that no longer exist (`Email.sentDate`/`recipientName`/`company`/`provider`, `Campaign.sequence`/`recipients`/`stats`/`progress`/`distributionMethod`). **Confirmed not caused by any edit in this session** — none of the error line numbers fall inside the diffs for `IntegrationsView.tsx` or `useEmailProvider.ts` (both of which have a small number of their own pre-existing, likewise-untouched errors: `AppErrorCode.AUTH_EXPIRED` missing from the enum, and 2 call-signature mismatches around `toFollowupProviderKey`/`sendGoogleFollowUp`/`sendZohoFollowUp`). This is a large, separate pre-existing gap between `types.ts` and its legacy consumers — not part of today's git-incident/never-committed damage pattern, and out of scope for this pass, but worth a dedicated follow-up since it means the frontend build isn't actually type-safe despite deploying successfully (Vite transpiles without checking).

### Verification performed
- `cd server && npx tsc -p . --noEmit` → **clean, zero errors.**
- `cd server && npx vitest run` → **13/13 test files, 95/95 tests passing.**
- `npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script` → **empty** (post-fix, re-confirmed).
- `npx prisma migrate status` → **"Database schema is up to date!"**
- Root frontend `npx tsc --noEmit` → confirmed my 2 edited files introduce **zero new errors** (pre/post error sets for those files are identical).

### Finding 6 — FIXED (App.tsx reconstruction, plus two more reverted pieces it exposed)

The exact deployed wiring was recovered from the minified production bundle (`dist/assets/index-Dxjlcxv8.js`, the build that passed live QA) rather than guessed. Key discoveries beyond the original finding:

1. **The bundle used an overlay flow, not a `CAMPAIGN_CREATE` view** (the view-string does not exist in the bundle). Deployed state machine, restored verbatim into [App.tsx](YSXXS/App.tsx): `wizardFlow: 'closed' | 'naming' | 'wizard'` + `wizardInitialName` + `wizardInitialLead`; `closeWizard()` resets all three and lands on `CAMPAIGNS`. Three entry points all restored: sidebar **Compose** button, CampaignsListView's **New Campaign**, and **LeadsView's per-lead compose** (which passes the lead into the wizard via its `initialLead` prop — this is how `ComposeNewEmail` could be fully retired).
2. **The `SCRAPER` view was also missing from App.tsx** — the bundle has a "Scraper" sidebar item (between Leads and Story Vault), a "YouTube Scraper" header title, and renders `ScraperView` (which existed on disk, committed, but orphaned — same pattern as the wizard). Restored.
3. **`components/ComposeNewEmail.tsx` deleted** (`git rm`) — matches HANDOFF ("now deleted") and the bundle (zero ComposeNewEmail strings). Nothing references it anymore. Also removed 15 of the pre-existing type errors.
4. **NEW FINDING 11 (exposed by re-wiring ScraperView): `services/apiClient.ts` was ALSO reverted** — it was missing the `apiUpload` and `apiDownload` exports that `services/scraperApi.ts` **and** `services/leadsApi.ts` import, and its `apiRequest` lacked the FormData special-case (no JSON-stringify / no forced Content-Type for uploads). This meant (a) the current tree could not even production-build, and (b) lead CSV export + scraper CSV download + cookie-file upload were all broken. All three pieces were extracted from the production bundle's minified implementations (`fl`, `yf`, `Sd` functions) and reconstructed line-for-line: FormData-aware `apiRequest`, `apiUpload(path, files, field='files')`, and `apiDownload(path, filename)` with the same 401-refresh-retry + blob/objectURL download behavior. Fixed 4 type errors, introduced 0.

**Verification of Finding 6 + 11:**
- Frontend `tsc`: zero errors in `App.tsx`/`apiClient.ts`; total pre-existing count dropped 212 → 193 (my changes only removed errors). The 3 remaining errors in `src/features/campaigns/` and 5 in `leadsApi.ts` are pre-existing types.ts-drift (see informational finding), untouched.
- **Production build verified**: `vite build` to a scratch directory (live `dist/` deliberately untouched — rebuilding it would hot-deploy to prod) compiles clean, and the new bundle's feature-string profile now matches the deployed ground-truth bundle exactly: "Give your campaign a name" ✓, "Import Leads"/"Final Review" ✓, "SCRAPER"/"YouTube Scraper" ✓, `ComposeNewEmail`'s "Subject line..."/"Follow-up content..." strings gone ✓.
- Live browser check via dev server (:3000 → prod backend): the module-load crash that `apiClient.ts`'s missing exports caused is gone; app renders to the login screen cleanly with zero console errors. (Interactive post-login QA of the wizard flow pending — needs the user to log in; Claude does not enter passwords.)

**Deploy note:** these fixes are source-only. Production still serves the old (correct) bundle; when you want the fixes live, run `VITE_API_URL="" npx vite build` at repo root (there is no backend change, so no `nssm restart` needed — Caddy/the backend serve static files from `dist/` per request).
