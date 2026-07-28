# YSX CRM — Action Plan
**Written 28 July 2026. Everything here is free. Nothing here requires paying for anything.**

---

## How to use this with Gemini (read this first)

Gemini has never seen this project. It does not know your server, your files, or your setup.
That makes it genuinely useful for some steps and actively dangerous for others.

**✅ Good things to ask Gemini:**
- "Where is the DKIM setting in the Microsoft 365 admin centre?"
- "How do I add a TXT record at [your domain registrar]?"
- "Write me a simple privacy policy for a UK/EU B2B email outreach business."
- "What does this error message mean?"

**🛑 Do NOT let Gemini invent commands for Part 2 (the update).** Those commands are specific to
this project and there are traps in it that a general assistant will get wrong — it will confidently
give you a command that looks right and breaks the server. Type the commands in Part 2 **exactly as
written here**. If something goes wrong, stop and ask rather than trying a suggested fix.

**If Gemini contradicts this document, this document wins.** It was written by someone looking at
the actual code and the actual live system.

---

## Where things stand right now

The app is **switched off**, and that is expected. The free database plan gives 100 hours of
database time per month; the app used 110, so the provider paused it. It switches back on by
itself.

**Nothing is broken. Nothing is lost. You do not need to pay anything.**

The cause has been fixed in the code — five separate background timers were poking the database
constantly and never letting it sleep. That fix is written and tested but is **not on the server
yet**. It goes on in Part 2.

---

# PART 1 — Do these now, while the app is down

You can do all of these today. None of them need the app to be running. They are in order of
importance.

## Step 1. Turn on DKIM ⭐ MOST IMPORTANT
**Time:** ~10 minutes · **Cost:** free

**What it is:** a digital signature proving your emails really came from you.

**Why it matters:** without it, Gmail and Outlook trust your emails much less and send more of them
to spam. This is the single biggest thing hurting your email delivery right now.

**Do this:**
1. Go to **https://security.microsoft.com** and sign in with your Microsoft 365 admin account.
2. Find **Email authentication settings** → **DKIM**. (If you can't find it, use the search box at
   the top and type "DKIM". Menu names change — this is a good thing to ask Gemini about.)
3. In the list of domains, click **outreach.ysxvisuals.com**.
4. Switch **"Sign messages for this domain with DKIM signatures"** to **ON**.

**Note:** the DNS side is already done and correct. You are only flipping a switch. If it complains
about missing CNAME records, stop — something changed and that needs looking at.

**How you'll know it worked:** tell me and I'll verify it from the outside. Don't just trust the
screen saying "enabled".

---

## Step 2. Fix the DMARC report address
**Time:** ~5 minutes · **Cost:** free

**What it is:** your domain tells the world to send daily email-delivery reports to
`dmarc@ysxvisuals.com` — **and that mailbox does not exist.** Every report is being thrown away.

**Why it matters:** those reports are how you find out that someone is rejecting your email.

**Do this — pick ONE:**
- **Easier:** create the mailbox/alias `dmarc@ysxvisuals.com` in Microsoft 365, OR
- Go to wherever your DNS is managed, find the TXT record named `_dmarc.ysxvisuals.com`, and change
  the `rua=mailto:...` part to an email address you actually read.

---

## Step 3. Fix the broken SPF record on ysxvisuals.com
**Time:** ~5 minutes · **Cost:** free

**What it is:** the record currently points at something that no longer exists, which makes the
whole record invalid.

The current (broken) value:
```
v=spf1 include:dc-8e814c8572._spfm.ysxvisuals.com ~all
```
That `include:` points to a dead address.

**Why it's not urgent:** this is your *company* domain, not the one you send campaigns from. Your
sending domain (`outreach.ysxvisuals.com`) is healthy. But mail from `ysxvisuals.com` can never
pass checks while this is broken.

**Do this:** in your DNS settings, either remove the dead `include:` or replace it with the correct
one for your mail provider. If Microsoft 365 handles that domain's mail, the value should be:
```
v=spf1 include:spf.protection.outlook.com -all
```
⚠️ Only change this if you're sure Microsoft handles mail for `ysxvisuals.com`. If unsure, leave it
— it isn't hurting your campaigns.

---

## Step 4. Set up free uptime monitoring
**Time:** ~15 minutes · **Cost:** free tier is enough

**Why it matters:** the app went down at 1am and nobody knew for hours. The app's own alarm did
email you — this is the independent second opinion for when the app itself is what's broken.

**Do this:**
1. Sign up at **https://uptimerobot.com** (free plan).
2. Add a new monitor, type **HTTP(s)**.
3. URL: `https://crm.ysxvisuals.com/api/health`
4. Check interval: 5 minutes. Add your email for alerts.

**Note:** use `/api/health` (the simple one). There's a more detailed one but it needs a password,
which complicates this. The simple one is enough to tell you the server is alive.

---

## Step 5. Get your backups off this machine
**Time:** ~15 minutes · **Cost:** free (15GB Google Drive)

**Why it matters:** every backup is currently on the **same computer** as the thing it's backing up.
If that machine dies, you lose the database and every backup of it at the same time.

**Do this:**
1. Install **Google Drive for Desktop**: https://www.google.com/drive/download/
2. Sign in.
3. Find the backup folder on the server (ask me for the exact path when you get to this).
4. Either move it inside the Google Drive folder, or set Drive to back that folder up.

**How you'll know it worked:** open Google Drive in a browser on your phone and see the backup files
there.

---

## Step 6. Ask Microsoft what your sending limit is
**Time:** one support ticket · **Cost:** free

**Why it matters:** on 15 June, Microsoft **refused** to send one of your emails because you'd hit a
limit — and the app recorded it as sent successfully. So this can happen without you seeing it. You
need the real number before sending in volume.

**Do this:** open a support ticket in the Microsoft 365 admin centre and ask:
> "What is the daily external recipient limit for my tenant, and what is the per-mailbox daily
> send limit?"

Write the answer down and tell me — it changes how the app should be configured.

---

## Step 7. Lengthen the password on your key backup
**Time:** ~5 minutes · **Cost:** free

**What it is:** there's an encrypted file (`.env.enc`) holding a backup of your secret keys,
protected by an **8-character password**.

**Why it matters:** that one file plus that password unlocks every connected mailbox. Eight
characters can be cracked. Use a long phrase instead — four random words is far stronger than eight
random characters.

**Do this:** ask me when you're ready and I'll walk you through re-encrypting it. Don't improvise
this one — do it wrong and you lose the backup.

---

## Step 8. Write a privacy policy
**Time:** an hour of writing · **Cost:** free

**Why it matters:** legally required for cold outreach to people in the EU/UK. Not a blocker for
emailing a few test contacts. **Is** a blocker for sending in volume.

**This is a good one to use Gemini for.** Ask it:
> "Write a privacy policy for a UK video-production agency that does B2B cold email outreach,
> covering GDPR legitimate interest, what data we store about prospects, and how someone requests
> deletion."

Then put it on your website at a real, public URL and tell me the address — it needs to go in the
emails.

---

# PART 2 — The update, on or after 5 August 2026

**⚠️ Do not start this before 5 August.** That is when the database allowance resets. Starting
early just fails.

**⚠️ This is the risky part.** Follow it exactly. Do not let Gemini rewrite these commands.

**⏱ Set aside an hour.** Don't do it right before you need the app.

### Before you start
- Type commands exactly as written.
- If any step gives an error, **stop and ask**. Don't continue and don't try a suggested fix.
- If you get stuck halfway, the app stays down — it doesn't get worse. There's a recovery guide at
  `docs/RECOVERY.md`.

### Step 1 — Check the database is actually back
Open this in a browser:
```
https://crm.ysxvisuals.com/api/health
```
If it says `{"ok":true}` the server is running (it has been all along — it's the database that was
off). To confirm the *database* is back, ask me to check, or look at the Neon console and confirm
the project no longer says "paused".

**If it's still paused, stop here and wait.**

### Step 2 — Check for a data problem BEFORE changing anything
One of the updates adds a rule that revision round numbers must be unique, and duplicates would
make it fail halfway through.

**Good news: this is almost certainly a non-issue.** I checked your 27 July backup — the revisions
table is **completely empty** (you have no projects yet), so there is nothing for the rule to trip
over. Run the check anyway, because the backup is 8 hours older than the shutdown. It is read-only
and cannot break anything.

Run this against the database (ask me to run it if you're not sure how):
```sql
SELECT "projectId", "roundNumber", COUNT(*) FROM "Revision"
GROUP BY "projectId", "roundNumber" HAVING COUNT(*) > 1;
```
- **No rows returned** → good, carry on.
- **Any rows returned** → stop and tell me. It's fixable, but I want to look first.

### Step 3 — Get the new code
Open PowerShell and run:
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS
git pull
```

### Step 4 — Take a fresh backup
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
node scripts/backup-db.mjs
```
Confirm it says it succeeded and wrote a file. **Do not continue without a successful backup.**

### Step 5 — Update the database structure
```powershell
npx prisma migrate deploy
```
This applies three updates. It should name all three and say they were applied.
**If it errors, stop immediately and tell me.**

### Step 6 — The step that catches people out
There's a known trap here: a file has to be copied into the right place or the next step fails with
a confusing error. Ask me to do this one, or run it exactly:
```bash
cd /c/Users/banjigum1/Desktop/YT-Scraper/YSXXS/server
for f in ../node_modules/.prisma/client/*; do b=$(basename "$f"); \
  case "$b" in *.node) ;; *) cp -f "$f" node_modules/.prisma/client/"$b";; esac; done
```
(That one is Git Bash, not PowerShell.)

### Step 7 — Build it
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
npx tsc -p .
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS
npm run build
npm run build:portal
```
All three should finish with no errors.

### Step 8 — Add your bank details (do this BEFORE the restart)
**Without this, your clients literally cannot pay you** — the portal shows them an invoice with no
payment instructions on it. I checked: these are currently **not set** on the live server.

These are not in the app's Settings screen — they live in a config file, and they only take effect
when the server restarts. That's why this goes **before** Step 9, so one restart covers both.

Open this file in Notepad:
```
C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server\.env
```
Add these four lines at the bottom, filling in your real details:
```
PORTAL_BANK_NAME=Your Bank Name
PORTAL_BANK_BENEFICIARY=Your Business Name
PORTAL_BANK_IBAN=GB00XXXX00000000000000
PORTAL_BANK_SWIFT=XXXXGB00
```
⚠️ No spaces around the `=`. No quotes. Save and close.

⚠️ **This file holds all your passwords and keys. Don't share it, don't paste it into Gemini or any
other chat, and don't screenshot it.** If you need help, tell me which line is giving trouble — not
its contents.

### Step 9 — Restart the server
Open PowerShell **as Administrator** (right-click → Run as administrator):
```powershell
nssm restart ysx-backend
```
If it doesn't come back, use stop-then-start instead:
```powershell
nssm stop ysx-backend
nssm start ysx-backend
```

### Step 10 — ⚠️ FILL IN YOUR ADDRESS IMMEDIATELY
1. Log in to the app (**you will have to log in again — everyone gets logged out once. This is
   intended.**)
2. Go to **Settings → Sender identity**.
3. Enter your **business name** and **full postal address**.

**Until you do this, every campaign is blocked and will not send.** That's deliberate — anti-spam
law requires a real postal address in commercial email, so the app now refuses to send without one.
It is not broken. It is waiting for you.

### Step 11 — Test it properly
1. Send **one** test campaign to your own email address.
2. Open the email you receive.
3. **Read the bottom of it.** You should see your business name, your postal address, and an
   unsubscribe link.

If the footer is missing or wrong, tell me before sending to anyone real.

4. Open the client portal and look at an invoice. Your bank details from Step 8 should now appear
   as payment instructions. If that section is blank, the `.env` edit didn't take — tell me.

---

# PART 2B — OPTIONAL: move to Supabase and get the app back before 5 August

**Only do this if you don't want to wait until 5 August.** Waiting is free and zero-risk. This is
the alternative, not an extra step. **Do Part 2B *instead of* Part 2, not after it** — it contains
all of Part 2's steps in the right order.

## Should you do this at all?

**The honest case for waiting:** the app can't send campaigns right now anyway — DKIM is off, your
postal address isn't set, and clients can't pay you. Those are the real blockers, they're all in
Part 1, and you can do all of them today with the app down.

**The honest case for moving:** the "hours of database time" limit that broke you is specific to
Neon — it charges for time the database is *awake*, which is why background polling killed it.
Supabase doesn't bill that way, so this class of outage can't repeat. It's a permanent fix, not
just a workaround.

**What you lose:** roughly 8 hours of overnight activity — anything between the last backup
(27 July, 17:12) and the shutdown (28 July, ~01:01). The app died at 1am, so this is almost
certainly nothing at all.

**⚠️ This is a one-way move.** If you migrate and start using the app, then Neon wakes up on
5 August still holding the old data, the two have drifted apart. Pick one and stay on it. Don't
switch back and forth.

## What your data actually is

I checked the backup file. The whole database is: **7 users, 23 leads, 1 campaign, 1 invoice,
1 mailbox, 2 queued follow-ups.** 31 KB compressed. It fits in any free tier many times over, and
there is very little here to lose.

---

### Step B1 — Create the Supabase project
1. Sign up at **https://supabase.com** (free, no card).
2. **New project.** Give it a name.
3. **Set a database password — save it somewhere safe immediately.** Supabase shows it once. If you
   lose it you have to reset it.
4. **Region:** pick the one closest to your server. Your current database is in **AWS US East 1
   (N. Virginia)** — matching that is a safe default.
5. Wait for it to finish setting up (a minute or two).

### Step B2 — Copy the two connection strings
In the project: **Settings → Database → Connection string**.

You need **two different ones**, and they are not interchangeable:
- **Transaction / pooled** (port **6543**) → this becomes `DATABASE_URL`
- **Direct** (port **5432**) → this becomes `DIRECT_URL`

Replace `[YOUR-PASSWORD]` in each with the password from Step B1.

⚠️ On the pooled one, add this to the end: `?pgbouncer=true&connection_limit=1`
Without it the app throws confusing errors under load.

### Step B3 — Back up your current settings file
So you can undo this if anything goes wrong:
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
copy .env .env.before-supabase
```

### Step B4 — Get the new code
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS
git pull
```

### Step B5 — Point the app at Supabase
Open `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server\.env` in Notepad.

Find the lines starting `DATABASE_URL=` and `DIRECT_URL=`. **Don't delete them** — put a `#` at the
start of each so you keep the old Neon values:
```
#DATABASE_URL=postgresql://...neon...
#DIRECT_URL=postgresql://...neon...
```
Then add your two new lines underneath:
```
DATABASE_URL=<the pooled one, port 6543, ending ?pgbouncer=true&connection_limit=1>
DIRECT_URL=<the direct one, port 5432>
```
While you're in this file, also add your bank details (same as Part 2 Step 8):
```
PORTAL_BANK_NAME=Your Bank Name
PORTAL_BANK_BENEFICIARY=Your Business Name
PORTAL_BANK_IBAN=GB00XXXX00000000000000
PORTAL_BANK_SWIFT=XXXXGB00
```
Save and close.

⚠️ **This file contains every password and key in the system. Never paste its contents into Gemini
or any other chat.**

### Step B6 — Build the database structure
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
npx prisma migrate deploy
```
This creates all the tables in the empty Supabase database. It should apply every migration and
report success.

**Note:** the risky migration everyone was worried about (revision round numbers) is a guaranteed
no-op here — I checked the backup and that table is empty. Nothing for it to trip over.

### Step B7 — Load your data in
**This must come after B6.** The structure has to exist before the data goes in.

In **Git Bash** (not PowerShell):
```bash
cd /c/Users/banjigum1/Desktop/YT-Scraper/YSXXS/server
RESTORE_URL="<your DIRECT connection string, port 5432>" \
  node scripts/restore-db.mjs /c/backups/ysx/ysx-2026-07-27.json.gz
```
Use the **direct** string here, not the pooled one.

It should report the tables it filled. If it errors, **stop and tell me** — don't rerun it blindly.

### Step B8 — Sync the Prisma file (the known trap)
Exactly as Part 2 Step 6. In **Git Bash**:
```bash
cd /c/Users/banjigum1/Desktop/YT-Scraper/YSXXS/server
for f in ../node_modules/.prisma/client/*; do b=$(basename "$f"); \
  case "$b" in *.node) ;; *) cp -f "$f" node_modules/.prisma/client/"$b";; esac; done
```

### Step B9 — Build
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
npx tsc -p .
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS
npm run build
npm run build:portal
```

### Step B10 — Restart
PowerShell **as Administrator**:
```powershell
nssm restart ysx-backend
```

### Step B11 — Check it worked
1. Open `https://crm.ysxvisuals.com/api/health` → should say `{"ok":true}`.
2. Log in (**you'll be logged out once — that's intended**).
3. Check your leads are there. You should see **23 leads and 1 campaign**. If the app is empty, the
   restore didn't take — stop and tell me.

### Step B12 — Then do Part 2 Steps 10 and 11
- **Settings → Sender identity** — business name and postal address. Campaigns stay blocked until
  you do.
- Send yourself one test campaign and **read the footer**.
- Check an invoice in the portal shows your bank details.

### If it goes wrong — how to undo
Nothing is destroyed. Your Neon data is untouched and comes back on 5 August. To revert:
```powershell
cd C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS\server
copy .env.before-supabase .env
```
Then restart as Administrator. You're back to waiting for Neon, having lost nothing.

### After you've moved
- **Tell me**, so I can update the notes — the handoff still says Neon everywhere.
- Supabase free projects pause after about a week of **no activity at all**. Yours is polled
  constantly, so this shouldn't bite — but if you leave it untouched for a fortnight, expect to
  click "restore" in their dashboard.
- **Part 3's "watch your database usage" no longer applies.** Supabase doesn't bill by
  compute-hours. That whole problem goes away.

---

# PART 3 — The week after the update

## Watch your database usage
Go to the Neon console → your project. Check the **Compute** number every few days.

- Your limit is **100 hours per month**, resetting on the **5th**.
- Last month you used **110** — that's what caused the outage.
- The fix should cut this a lot, but it has **never been measured on the real system**.

**If by 12 August it's above 30 hours, tell me** — that means the fix isn't enough and there's a
free setting I can turn up. Don't wait until it runs out again.

## Things that are still not done
These are known and written up properly in `HANDOFF.md`. None blocks you sending email:
- Most of the email-handling code has never had a second pair of eyes on it.
- The client portal's backend has never had an independent review.
- If a mailbox breaks permanently, follow-ups for that person pause forever instead of sending.

---

# Quick reference

| Thing | Value |
|---|---|
| App address | https://crm.ysxvisuals.com |
| Simple health check | https://crm.ysxvisuals.com/api/health |
| Server folder (LIVE) | `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS` |
| Work folder (NOT live) | `C:\Users\banjigum1\Documents\YSXXS\YSXXS` |
| Service name | `ysx-backend` |
| Restart (as Admin) | `nssm restart ysx-backend` |
| Database resets on | the **5th** of each month |
| Database allowance | 100 compute-hours/month (free) |
| Sending domain | `outreach.ysxvisuals.com` |
| Recovery guide | `docs/RECOVERY.md` |
| Full technical notes | `HANDOFF.md` |

**⚠️ The two folders are different.** `Desktop\YT-Scraper\YSXXS` is the live one. `Documents\YSXXS\YSXXS`
is the working copy and changing it does nothing to the live site. Six copies of this project have
existed on this machine — always check which one you're in.
