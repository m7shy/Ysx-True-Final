# RECOVERY — rebuild the whole app on a fresh VM

**Purpose:** the app runs on a single free-trial VM. When it dies (or the trial ends), everything below rebuilds production from scratch. All state that matters lives in **Neon Postgres** — a new VM pointed at the same `DATABASE_URL` resumes campaigns and follow-ups automatically (the workers re-scan the DB on every tick and `recoverStaleSending*()` un-strands anything caught mid-send). The maximum campaign gap is simply the VM downtime.

**What is NOT in the database and must be backed up separately (see §1):**
- `server/.env` (all secrets)
- NSSM service definitions (recreated from commands in §4)
- `scraper/cookies/` cookie files + `scraper/.env` (if used)
- Nothing else — Caddyfile, code, schema, and migrations are all in git.

---

## 1. The secrets inventory (`server/.env`)

**Keep an offline copy of `server/.env`** (personal password manager or private drive — never in git). If a key is lost, this is what it costs:

| Key | If lost |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Re-copy from Neon console (Dashboard → Connection Details; pooled URL for DATABASE_URL, direct for DIRECT_URL) |
| `JWT_SECRET` | Generate a new random 32+ char string — everyone logs in again, nothing else breaks |
| `MAILBOX_ENCRYPTION_KEY` | ⚠️ **Unrecoverable**: all connected mailboxes' stored OAuth tokens become undecryptable. Generate a new key and reconnect every mailbox in Integrations |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` | Re-copy from Google Cloud console / Azure AD app registration (or create new secrets there). **Azure gotcha: copy the secret VALUE, not the secret ID** — this exact mistake has caused two outages |
| `OAUTH_REDIRECT_BASE_URL`, `WEB_ORIGIN`, `PUBLIC_BASE_URL` | Just URLs — `https://crm.ysxvisuals.com` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*` | Re-copy from Stripe dashboard; webhook secret regenerates when you re-add the endpoint |
| `IMPORT_API_KEY` / `IMPORT_TENANT_ID` | New random string + your user id (from the DB `User` table) |
| `GEMINI_API_KEY` (if set) | Re-issue in Google AI Studio |
| `PORTAL_SMTP_HOST/PORT/USER/PASS/FROM` | Re-copy from Brevo (or regenerate a Gmail app password) |
| `ALERT_EMAIL` | Your own email |
| `PORTAL_BANK_*`, `PORTAL_CONTACT_EMAIL`, `PORTAL_OFFICE_HOURS` | Cosmetic portal content — retype |
| `SCRAPER_DIR`, `PYTHON_BIN`, `YTDLP_COOKIES_*` | Paths — see §4; cookie files must be re-exported from a logged-in browser if lost |

The full authoritative key list is the zod schema in `server/src/config.ts`.

## 2. New VM (free): GCP free trial

1. Create a Windows Server VM (e2-medium is enough), note its public IP.
2. Point DNS A records for `crm.ysxvisuals.com` (and `ysxvisuals.com` if hosting the portfolio here) at the new IP. TTL is usually minutes.
3. Open firewall: TCP 80 + 443.

## 3. Install toolchain

Node 20+, Git, Python 3.12 (for the scraper), Caddy (single .exe is fine), NSSM, PostgreSQL client tools (for `pg_dump`/`pg_restore` — installer's "Command Line Tools" only). Add all to PATH.

## 4. App rebuild

```powershell
git clone https://github.com/m7shy/Ysx-True-Final.git C:\app\YSXXS
cd C:\app\YSXXS
git checkout phase5-frontend-wiring
npm install
cd server && npm install
# restore server\.env from your offline copy  ← the critical manual step
npx prisma generate --schema ..\prisma\schema.prisma
npx prisma migrate deploy --schema ..\prisma\schema.prisma   # no-op against the live DB; applies everything on an empty one
npm run build
cd ..
$env:VITE_API_URL=""; npx vite build                          # CRM  → dist/
npx vite build --config portal/vite.config.ts                 # portal → dist-portal/
# scraper (optional day one): cd scraper; python -m venv venv; venv\Scripts\pip install -r requirements.txt; restore cookies\
```

**Services (elevated PowerShell):**

```powershell
nssm install ysx-backend "C:\Program Files\nodejs\node.exe" "dist\index.js"
nssm set ysx-backend AppDirectory C:\app\YSXXS\server
nssm set ysx-backend AppEnvironmentExtra NODE_ENV=production   # ONLY this — everything else lives in .env (see §6)
nssm set ysx-backend AppStdout C:\app\YSXXS\server\server.log
nssm set ysx-backend AppStderr C:\app\YSXXS\server\server.err
nssm start ysx-backend

nssm install caddy-proxy C:\caddy\caddy.exe "run --config C:\app\YSXXS\Caddyfile"
nssm start caddy-proxy
```

Caddy obtains TLS automatically once DNS resolves. If NSSM ever needs a multi-line `AppEnvironmentExtra`, use a here-string (`@'...'@`) — backtick-`n` escapes silently corrupt the value, and after any AppEnvironmentExtra edit do a full `nssm stop` + `nssm start` (a paused/crash-looped service ignores plain `restart`).

**Smoke test:** `/api/health` 200 → `/api/health/deep` shows all checks ok/disabled → log in at `https://crm.ysxvisuals.com` → `/portal/login` renders → campaigns view shows the pre-crash campaigns (they resume on their own).

## 5. Backups

- Daily dump: `cd C:\app\YSXXS\server && node scripts\backup-db.mjs` → `C:\backups\ysx\ysx-YYYY-MM-DD.dump`, keeps 14. Schedule it (elevated):

```powershell
schtasks /Create /TN "YSX DB Backup" /SC DAILY /ST 03:00 /RU SYSTEM `
  /TR "cmd /c cd /d C:\app\YSXXS\server && node scripts\backup-db.mjs >> C:\backups\ysx\backup.log 2>&1"
```

- **Occasionally copy the newest dump off the VM** (Drive/local PC) — a backup on the dying VM is not a backup.
- **Restore** (into an empty Neon DB or branch): `pg_restore --no-owner --dbname "<direct-url>" C:\backups\ysx\ysx-YYYY-MM-DD.dump`, then `npx prisma migrate status` should report up to date.
- Neon free tier also has short point-in-time restore history (console → Branches → restore) for oops-deletes; the dumps are for everything bigger.

## 6. Config rules (learned the hard way)

- **`server/.env` is the single source of truth.** NSSM `AppEnvironmentExtra` holds ONLY `NODE_ENV=production`. Anything else there silently overrides `.env` and has caused two production outages.
- Every boot, the backend logs `Effective config (redacted fingerprints)` — one fingerprint per key. If behavior doesn't match `.env`, compare that log line against `.env` (change a value → fingerprint must change; if it doesn't, something is overriding it) and check `nssm get ysx-backend AppEnvironmentExtra`.
- Frontend builds must use `VITE_API_URL=""` (relative URLs). A plain `npx vite build` bakes in `http://localhost:3001` and breaks production. The portal build must pass `--config portal/vite.config.ts`.

## 7. Monitoring

- `/api/health/deep` — DB, campaign-worker + follow-up-scheduler tick freshness, mailbox health, disk, alerting config. 503 only when the DB is down.
- In-process watchdog re-checks every 15 min and emails `ALERT_EMAIL` (via `PORTAL_SMTP_*`, deliberately NOT the OAuth mailbox) on new failures and recoveries, throttled to one email per check per 6 h.
- **External (do once, free): UptimeRobot** — create a free account, add an HTTP(s) monitor for `https://crm.ysxvisuals.com/api/health/deep`, 5-min interval, email alerts. This is the only thing that catches whole-VM death.

## 8. Transactional-email fallback (`PORTAL_SMTP_*`)

Portal invites/magic links/invoice emails and watchdog alerts use the owner's connected mailbox first, then fall back to plain SMTP. To enable the fallback (recommended — the OAuth mailbox has broken twice):

- **Brevo** (free tier, 300/day account-wide): Settings → SMTP & API → SMTP: host `smtp-relay.brevo.com`, port 587, login + SMTP key → `PORTAL_SMTP_HOST/PORT/USER/PASS`, `PORTAL_SMTP_FROM` = a sender you verified in Brevo. ⚠️ **Unconfirmed as of 2026-07-20: new/low-reputation senders may be capped well below 300/day (e.g. ~30/day) until the sending domain builds reputation** — verify the actual current ramp-up limit in Brevo's dashboard/docs before relying on this for real volume, and update this line with the real number. If portal transactional volume (invites/magic-links/invoice notices) could exceed whatever that ramp limit is, use the Gmail option below instead, or warm the Brevo sender first.
- Or **Gmail app password**: enable 2FA → App passwords → `PORTAL_SMTP_HOST=smtp.gmail.com`, `PORTAL_SMTP_PORT=465`, user = the Gmail address, pass = the 16-char app password. (Gmail's own daily send cap applies — ~500/day for a regular account — but no new-sender ramp-up the way Brevo has.)
- Set `ALERT_EMAIL` to your personal address to activate watchdog emails.
