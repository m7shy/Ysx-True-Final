# YSX Visuals Client Portal

A client-facing portal served at **`/portal`** on the same domain as the CRM. Its single job: eliminate client questions (status, expectations, action items, files, communication) and make YSX Visuals feel like a premium studio. It is deliberately NOT a CRM, admin panel, or analytics dashboard.

## Architecture

- **Frontend:** second Vite app in `portal/` (base `/portal/`, builds to `dist-portal/`), reusing `src/design` (tokens, motion, ui primitives) via the `@` alias. Tiny history-API router, no react-router. Own `apiClient` with a client-scoped localStorage key (`ysx_client_auth`) and the same refresh-and-retry pattern as the CRM.
- **Backend:** same Express server.
  - Client auth: `ClientUser` model + `aud:'client'` JWTs (`server/src/auth/clientJwt.ts`, `clientMiddleware.ts`). Client tokens never work on CRM routes and vice versa. Password AND magic-link login; invites are single-use hashed tokens (`ClientLoginToken`), emailed via the owner's connected mailbox (`server/src/portal/mailer.ts` — fails loud if no mailbox).
  - Client API: `/api/portal/*` (`server/src/portal/routes.ts`) — every query filters by the token's `clientId` (IDOR defense).
  - Admin API: `/api/clients`, `/api/projects`, `/api/invoices` — tenant-scoped via `tenantDb` (Client/Project/Invoice are in `TENANT_MODELS`); child rows are reached only through an owned parent.
  - Activity feed: `ActivityEvent` rows written inline after each meaningful mutation (`server/src/portal/activity.ts`).
- **Data:** `Client → ClientUser/Project/Invoice`, `Project → FileLink/Revision/Message/ActivityEvent`, `Invoice → Payment → Receipt` (deliberately separated concepts; MVP provider = `BANK_TRANSFER` with manual mark-paid; new providers = new `PaymentMethod` enum value + `providerRef` on Payment). Files are **external links only** — no binary storage.
- **Static content:** FAQ, contact card, and bank-transfer instructions live in `server/src/portal/content.ts` (bank details via `PORTAL_BANK_*` env vars — never in git).

## Portal pages (5)

1. **Login** — password, magic link, and invite set-password (`/login`, `/set-password`).
2. **Dashboard** — project cards with stage pill, progress, ETA, waiting-on-you badge, last activity; Active/Archive toggle; **Start New Project** (emails the agency, creates nothing).
3. **Project detail** — stage timeline, "What happens next", scope, files grouped by type with version badges, revision center (request → track → approve), messages, activity feed. One page answers Status/Expectations/Action/Files/Communication.
4. **Invoices** — outstanding balance, list, detail with due date + payment instructions; first open flips SENT → VIEWED; receipts appear on payment.
5. **Help** — FAQ accordion + contact/office hours.

## Admin (inside the CRM)

`Client Portal` sidebar view (`components/ClientPortalView.tsx`): Clients (create/invite), Projects (create + edit everything the client sees, respond to revisions, add file links, message), Invoices (draft → send → mark paid).

## Deploy

```
npm run build:all        # dist/ (CRM) + dist-portal/ (portal)
cd server && npm run build
nssm restart ysx-backend # user-run, elevated
```

Same origin (`ysxvisuals.online/portal`) → no CORS/Caddy changes. A future `portal.` subdomain is a Caddy-only change.

---

## Future Enhancements (deliberately NOT built)

| Idea | Problem solved | Est. ROI | Complexity | Why postponed |
|---|---|---|---|---|
| Real payment providers (Stripe/PayPal/Payoneer checkout) | Clients pay in-portal without a bank transfer | High once volume exists | Medium (provider interface exists: `PaymentMethod` + `providerRef`) | Zero paying portal clients yet; manual bank transfer covers first clients with no fees/integration risk |
| Email notifications per activity (stage change, new deliverable) | Clients learn of updates without logging in | Medium | Low-medium | Risks noise; the invite/invoice emails cover the two moments that matter. Add digest-style later if clients ask "did anything happen?" |
| Structured invoice line items + PDF export | Formal accounting needs | Medium | Medium | `lineItemsJson` renders fine in-portal; PDFs only matter when a client's bookkeeper asks |
| Read receipts on messages | "Did they see my note?" | Low | Low | The activity feed + fast replies solve the same anxiety with less surveillance feel |
| Structured project-request intake (brief form, files) | Richer new-project briefs | Medium | Medium | The email-based request is one click for the client; structure it once request volume is real |
| In-portal file upload (S3/R2 presigned) | No third-party link juggling | Medium-high later | High (storage, cost, egress) | Raw footage is tens of GB — link-based sharing (Drive/WeTransfer) is what clients already use |
| Per-client branding / white-label | Agency-tier polish | Low today | Medium | One brand (YSX) is the product right now |
| Notification badge / unread counts in portal nav | Orientation on login | Low | Low | Dashboard cards already surface "what changed" via last-activity + waiting badges |
| Admin-editable FAQ/content UI | No-deploy content edits | Low | Low | `content.ts` edits are rare and trivial for a technical owner |
| OVERDUE auto-flip cron for invoices | Status accuracy without manual toggling | Medium | Low | Worth doing soon; needs a tiny scheduler tick that flips SENT/VIEWED past `dueAt`. Deferred to keep MVP surface minimal — statuses are correct on mark-paid today |

## CTO review (post-build, ruthless)

**Kept lean, on purpose:** no analytics, no AI, no calendars, no permissions matrix, no per-message attachments, 5 pages total, one admin view. Progress % is admin-asserted (a promise, not a computed metric) — that's a feature: the portal shows exactly what the studio says.

**Known compromises, accepted for MVP:**
- **Magic-link/invite delivery depends on the owner's connected mailbox being healthy.** It fails loudly in the admin UI (409 `NO_MAILBOX` / 502 `SEND_FAILED`), but if the Microsoft token silently expires again, invites fail until reconnect. Watch this; it has broken once before.
- **No OVERDUE automation** (see table). Invoices only leave SENT/VIEWED when marked paid or cancelled.
- **`nextNumber()` uses count+1** — two admins creating invoices in the same millisecond could collide on the unique `(userId, number)`; the request would 500 and a retry succeeds. Fine at one-admin scale; replace with a sequence table if the team grows.
- **Revision rounds are unlimited** — no per-package cap. If scope creep appears, add `includedRevisions` to Project and a soft warning in both UIs.
- **Client "uploads" are messages containing links** — deliberate; a dedicated upload form would just be a second text box for the same URL.

**Watch for friction:** if clients reply to the invite email instead of using the portal, add a reply-to note; if they ask "what's included?" despite `scopeSummary`, the admin isn't filling it — the field, not the feature, is the fix.
