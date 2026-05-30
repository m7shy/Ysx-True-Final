# Testing YSX Flow locally

## Running the app (single port, no CORS)
Serve the built frontend through the Express server so `/api/*` calls are same-origin:

```bash
npx vite build
cd server && PORT=3001 npx tsx src/index.ts
```

The server mounts the Vite `dist/` at `/` (see `server/src/index.ts` — `express.static(path.join(__dirname, '../../dist'))`) AND all `/api/*` routes. Frontend fetches use relative URLs, so running both on the same port avoids needing a Vite proxy or CORS config.

A dev-mode alternative (Vite on `:3000` + server on `:3001`) requires configuring a proxy or an absolute API base URL, so same-origin is the easier path for end-to-end UI testing.

## Bypassing login
`LoginScreen` exposes a **Demo Sandbox** button that sets `zohoConnected=true` in-memory without hitting any real OAuth. No credentials or secrets are required to enter the app for UI testing.

## Taskbar cuts off the bottom of the page
The app's sticky footers (wizard Next/Back controls, etc.) sit below the desktop taskbar on the 1024×768 test display, so mouse clicks on them land on the taskbar instead. Fix by pressing **F11** (fullscreen) in Chrome before clicking any bottom-anchored button. `wmctrl` is not installed on the sandbox image — use `xdotool` or Chrome F11 instead.

## The `computer console` tool often says "Chrome is not in the foreground"
Even when `xdotool getactivewindow getwindowname` confirms Chrome is focused, the `computer` tool's `console` action sometimes refuses to run. In that case:
- Prefer native UI interactions (click, type) over devtools console JS.
- For assertions that really need DOM state, capture a screenshot and visually verify instead.

## Campaign Wizard — what to verify
The wizard lives under `src/features/campaigns/`. Navigate to it via the **New Campaign** sidebar entry (adds a `CAMPAIGN_CREATE` view in `App.tsx`).

### Expected defaults (locked by spec)
- **Step 1**: `first_name → First Name`, `email → Email` auto-mapped; all other CSV headers default to `Custom Field`. `Next` is gated on Email being mapped.
- **Step 2**: 3 stages, 1-day waits between, exact subject/body text for Email 1/2/3 (see `src/features/campaigns/defaults.ts`); `{{variable}}` tokens must render as rounded blue pills (not plain text) via `VariableHighlightEditor` (textarea + aligned overlay).
- **Step 3**: Timezone `America/Los_Angeles`; Mon-Fri selected; 09:00-18:00; interval 20min; max 100 leads/day; `100% Follow up leads` toggle ON.
- **Step 4**: `{{variable}}` tokens must be fully substituted with the selected lead's CSV data — no literal `{{…}}` should appear in the rendered preview.

### Sample CSV for testing
Headers must be exactly: `first_name,email,video_title,timestamp_1,issue_1,fix_1,timestamp_2,issue_2,fix_2,niche,content_type,cta`. A convenient 3-row fixture is at `/home/ubuntu/test-leads.csv` when available.

### Submission
Clicking **Start Campaign** POSTs to `/api/campaigns`. Server log line `Campaign received campaignId=camp_... leads=N stages=3 senders=M` confirms success; UI shows a "Campaign queued." toast and routes back to All Campaigns.

## Known non-blocker: smoke CI is red on main
`.github/workflows/smoke.yml` runs `npm start` without `npm run build`, so `server/dist/index.js` doesn't exist. It's orthogonal to any feature work — fixable by adding a build step or switching to `tsx src/index.ts`.

## Devin Secrets Needed
None for wizard UI testing — the Demo Sandbox login and `/api/campaigns/sender-accounts` demo fallback cover the full flow. Real email delivery (Gmail/Zoho/Microsoft) would require `GMAIL_USER`/`ZOHO_USER`/`MICROSOFT_USER` and associated OAuth secrets, but those are stubbed for the wizard's happy path.
