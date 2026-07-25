# Plan — Full deep code review of the CRM + newly added code

Date: 2026-07-25
Branch: `phase5-frontend-wiring` (working copy: `C:\Users\banjigum1\Documents\YSXXS\YSXXS` — NOT prod)
Scope: ~28.5k lines TS/TSX across server, CRM frontend, and the new client portal.

## Delegation mechanism

- `agy` IS on PATH (`C:\Users\banjigum1\AppData\Local\agy\bin\agy`) but **every call fails**:
  `Eligibility check failed: Your current account is not eligible for Antigravity.`
  This is an account/auth gate requiring a browser sign-in by the user — not a transient
  "high traffic" condition, and not something to route around.
  Confirmed against both `claude-opus-4-6-thinking` and `gemini-3.1-pro-high`.
- Per skill §5.6 (dead-worker fallback chain) → fall back to the Claude `Agent` tool.
- Tier chosen: **Opus** (skill §3a: high-stakes QA/review). Task classified **hard** (§5.3):
  many files, judgment-heavy, security-relevant, large blast radius.

## Decomposition (6 review units, fan-out capped at 4 concurrent per §5.4)

| # | Unit | Paths |
|---|---|---|
| 1 | Auth & security core | `server/src/auth/*`, `db/tenantDb.ts`, `config.ts`, `index.ts`, `httpErrors.ts`, `util/redact.ts` |
| 2 | Campaign engine + scheduling | `server/src/campaigns/*`, `followups/`, `scheduler/`, `leads/`, `analytics/`, `gemini/` |
| 3 | Mail / creds / unibox | `server/src/mail/*`, `creds/*`, `unibox/*`, `google/`, `scraper/` |
| 4 | Client portal backend (NEW) | `server/src/portal/*`, `clients/`, `projects/`, `invoices/`, `auth/clientJwt.ts`, `auth/clientMiddleware.ts` |
| 5 | Portal SPA (NEW) + health/monitor | `portal/**`, `server/src/health/monitor.ts`, `server/scripts/` |
| 6 | CRM frontend | `App.tsx`, `components/`, `src/`, `services/`, `hooks/`, `context/`, `types.ts` |

Units 1 and 4 get the heaviest security weighting; units 4 and 5 are the "new code".

## Verification (skill §4, §5.18)

Findings returned by workers are untrusted. Every HIGH-severity finding gets spot-checked
against the real source before being relayed. Anything not individually re-verified is
labelled as such in the final report.

## Explicitly out of scope

- No code changes this pass — review only. Fixes are a separate, user-approved step.
- Prod repo (`Desktop\YT-Scraper\YSXXS`) is not touched.
