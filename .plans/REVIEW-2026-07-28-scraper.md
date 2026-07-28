# Scraper subsystem review — 2026-07-28

Reviewer: independent read-only pass over the SCRAPER subsystem.
Checkout: `C:\Users\banjigum1\Documents\YSXXS\YSXXS`, branch `phase5-frontend-wiring`, clean tree.
**Nothing in the checkout was modified.** No scraper was run, no database was queried, no service
was touched. The only file written is this one.

---

## 1. Summary

### What I read

- `server/src/scraper/` — `autoScheduler.ts`, `service.ts`, `routes.ts`, `cookieService.ts` (all four, in full).
- `server/src/scheduler/pulse.ts` in full, plus every `mayPoll(` / `reportWork(` call site
  (`campaigns/worker.ts`, `scheduler/followupScheduler.ts`, `unibox/replyPoller.ts`,
  `health/monitor.ts`, `index.ts`) and each poller's interval.
- `server/src/leads/importService.ts` (the write path the scraper feeds), `server/src/index.ts`
  startup block, `server/scripts/backup-db.mjs` (scraper-state archive), `prisma/schema.prisma`
  (`ScraperSchedule`), `server/src/__tests__/autoScraperPulse.test.ts`, `pulse.test.ts`.
- `scraper/` — `orchestrator.py` and `session_profile.py` in full; `main.py` in the areas that
  matter here (entry point, `run_gauntlet`, tracking-DB layer, email/link extraction, CSV writers,
  signal handling); `cookie_manager.py` in full.
- On-disk state under `scraper/profiles/` (listing only, no reads of tenant data).

### Headline

The subsystem is in better shape than the prior notes imply, and **two of the premises I was given
did not survive checking** — I say so explicitly in §4 rather than manufacturing findings around
them. What is genuinely broken is concentrated in three places: the cancel path, the
check-then-act gap in `startJob`/`startAutoJob`, and — found while verifying the new idle gate —
the **watchdog**, which the gate starves completely.

Confidence:

| Area | Verdict | Confidence |
|---|---|---|
| Q1 Concurrency / locking | Cross-tenant collision **impossible**; same-tenant collision **real**, three routes | High |
| Q2 Stale-run recovery across restart | Sound in-process; one restart hazard I could not close | Mixed (see §3.1) |
| Q3 The 2026-07-28 idle gate vs scheduled scrapes | **Safe for the scraper** — bounded at ~30 min, no drift, no starvation | High (simulated + hand-derived) |
| Q3b Same gate vs the watchdog | **Watchdog never runs while idle** | High |
| Q4 Error handling / partial failure | Mostly consistent; one uncaught SQLite path | High |
| Q5 Input handling | CSV injection and traversal are handled; one SSRF, one unbounded-buffer suspicion | Medium-High |
| Q6 Secrets | Two real exposures, both low-blast-radius | High |

---

## 2. Confirmed defects

Ordered by severity. Every one of these was read in source and reasoned to a specific wrong
outcome; where I could compute or simulate the result I say how.

---

### C1 — HIGH. Cancelling an auto-run kills the orchestrator and leaves `main.py` running

**Files:** `server/src/scraper/service.ts:573-580`; `scraper/orchestrator.py:203-218`;
`scraper/main.py:1993-2007`

`startAutoJob` spawns `orchestrator.py` (`service.ts:530-534`). `orchestrator.py` does **not** do
the scraping itself — `run_script()` at `orchestrator.py:203` launches `main.py` as its own
`subprocess.Popen` child. The process tree is therefore:

```
node (ysx-backend)  →  python orchestrator.py  →  python main.py
```

`cancelJob` holds only the direct child handle and calls `child.kill('SIGTERM')`
(`service.ts:578`). No process group is created (`spawn` is called without `detached`, `Popen`
without `start_new_session`/`CREATE_NEW_PROCESS_GROUP`), so the grandchild is not signalled.

Three consequences, all from the same line:

1. **The orphan keeps scraping.** `main.py` continues driving YouTube traffic from this machine's
   IP and keeps writing `profiles/<slug>/leads.csv` and `tracking.db` after the CRM believes the
   run is stopped.
2. **The guard releases immediately.** `cancelJob` sets `job.status = 'cancelled'` *synchronously*
   at `service.ts:576`, before the child has died. `activeJobFor` (`service.ts:257-259`) only
   matches `status === 'running'`, so the instant the cancel request returns 200, a new run is
   allowed. Failure scenario, entirely from the UI: user clicks **Stop**, then **Start** →
   `startJob` spawns a second `main.py` into the same profile directory while the orphaned one is
   still alive. That is precisely the same-profile collision the 2026-07-25 `recoverStaleRuns` fix
   was written to prevent, reached by a different door.
3. **The concurrency budget silently over-commits.** `releaseSlot` fires from the orchestrator's
   `close` handler (`service.ts:543`, `553`), so `activeChildCount` drops while the grandchild is
   still running. `MAX_CONCURRENT_CHILDREN = 4` and `MAX_CONCURRENT_AUTO_RUNS = 2` are both
   understated by the number of live orphans.

**Windows makes it worse, and defeats a documented safety net.** Node's `subprocess.kill()` on
Windows does not deliver a signal — `SIGINT`/`SIGTERM`/`SIGKILL` all become an unconditional
`TerminateProcess`. `main.py:1993-2007` installs a `SIGTERM` handler whose whole job is to write
`daemon_state.json` so an interrupted run resumes from its checkpoint. On this VM **that handler
can never run for a CRM-initiated cancel**: for a *manual* run `main.py` is the direct child and is
hard-terminated (no checkpoint written, in-flight `new_rows` for the current 50-channel chunk lost,
SQLite WAL left uncheckpointed); for an *auto* run it is never signalled at all.

*Corroborating on-disk evidence (listing only):* `scraper/profiles/crm-cmrdtilbj…/` has
`tracking.db` at 4,096 bytes beside a 1,083,592-byte `tracking.db-wal`, and
`scraper/profiles/fitness/` has 4,096 bytes beside a 2,035,312-byte `-wal`. A WAL that large
against an empty main database means the connection was never closed cleanly — consistent with
hard termination, not with a normal exit.

**Fix shape (not applied):** hold the process group. On Windows that means a Job Object or
`taskkill /T /PID`; on POSIX `detached: true` + `process.kill(-pid)`. And do not clear the
`running` status until the `close` event actually fires — introduce a `cancelling` state that
`activeJobFor` still counts as occupied.

---

### C2 — HIGH. `activeJobFor` / `assertCapacity` are check-then-act with a multi-await gap

**Files:** `server/src/scraper/service.ts:393-435` (`startJob`), `service.ts:493-527` (`startAutoJob`)

The guard and the state it protects are separated by five `await`s:

```
service.ts:393   if (activeJobFor(userId)) throw CONFLICT      ← CHECK
service.ts:396   assertCapacity();                             ← CHECK
service.ts:406   await fs.mkdir(profileDir, …)                 ← yield 1
service.ts:407   await fs.writeFile(keywordsPath, …)           ← yield 2
service.ts:411   const before = new Set(await readLeads(…))    ← yield 3
service.ts:419   await materializeCookiePool(cookiesDir, uid)  ← yield 4  (Postgres query + file IO)
service.ts:420   await writeProfileSettings(profileDir, uid)   ← yield 5  (Postgres query)
service.ts:433   jobs.set(id, job);                            ← SET
service.ts:435   reserveSlot();                                ← SET
```

Nothing between CHECK and SET is atomic, and the window contains **two round-trips to Neon**, which
from this VM is comfortably 100 ms+. Express does not serialise concurrent requests.

**Failure scenario:** the user double-clicks "Start scrape", or a slow network retries the POST.
Two `POST /api/scraper/jobs` requests arrive ~150 ms apart. Both pass `activeJobFor` (neither job
is in `jobs` yet), both proceed, both `spawn` `main.py --niche crm-<userId>` into the *same*
profile directory. Concretely:

- `service.ts:407` — request B's `keywords.txt` **overwrites** request A's. A's `main.py` may
  already have read the file, or may read B's list. Either way the job record shown to the user for
  run A (`job.keywords`) lists keywords that were not the ones scraped.
- Both processes open `profiles/<slug>/tracking.db`. See **C3** — this is what turns into `exit 1`.
- `materializeCookiePool` (`cookieService.ts:152-157`) **unlinks every `*.txt`** in the shared
  cookies dir before rewriting it. Request B's unlink can land while request A's `main.py` is in
  `CookieManager._load()` (`cookie_manager.py:91`), so A starts with an empty pool and falls
  through to the unauthenticated, bot-check-prone path.

The identical pattern exists in `startAutoJob`. It also means the two capacity limits are advisory:
`assertCapacity()` at `service.ts:396` and `reserveSlot()` at `service.ts:435` are separated by the
same five awaits, so *N* simultaneous starts all observe `activeChildCount < 4` and push it to *N*.

**How I proved it:** by reading, not running. The claim rests only on `startJob` being `async` with
`await`s between the guard and the mutation, which is directly visible at the line numbers above.
There is no lock, mutex, or in-flight set anywhere in `service.ts` (I checked: the only
synchronisation primitives in the file are `activeChildCount` and the `jobs`/`procs` Maps).

**Fix shape:** insert the job into `jobs` (status `starting`) synchronously, immediately after the
guard and before the first `await`, and have `activeJobFor` count it. Same for `reserveSlot()`.

---

### C3 — MEDIUM-HIGH. A `database is locked` from SQLite is uncaught and exits the scraper 1

**Files:** `scraper/main.py:1475-1485`, `1629-1655`, `1657-1686`, `1715-1731`, `2011-2205`, `2264-2394`

`_connect_tracking_db` sets `PRAGMA busy_timeout=5000` (`main.py:1481-1482`), so a second writer
retries for 5 seconds and then raises `sqlite3.OperationalError: database is locked`.

**Nothing catches it.** I grepped the whole file: there is no `sqlite3.Error`, no
`OperationalError`, no `except Exception` around any of `mark_processed` (`1629`),
`mark_recheck` (`1657`), `append_to_blacklist` (`1715`) or `is_seen` (`1607`). `run_gauntlet`'s
per-channel loop catches only `HttpError` (`main.py:2097`, `2116`) and `TypeError/ValueError`
(`2046`). `main()`'s `try` catches only `QuotaExhaustedError` (`main.py:2379`).

**Failure scenario:** any of the three same-tenant overlap routes above (C1 double-start, C2
double-click, C4 restart-orphan) puts two `main.py` processes on one `tracking.db`. The first
`mark_recheck` that waits out the 5 s busy timeout raises, unwinds through `run_gauntlet` and
`main()`, and Python exits **1** with a traceback into the CRM's live log. `finishJob`
(`service.ts:370-371`) then reports `scraper exited with code 1` — the exact symptom recorded in
HANDOFF's 2026-07-25 entry.

Silver lining, and the reason this is not HIGH: `main()`'s `finally` (`main.py:2384-2394`) still
flushes `new_rows` to `leads.csv`, and `finishJob` runs on any exit code, so the leads found before
the crash are not lost. The damage is a failed run and a burned crawl budget, not data loss.

---

### C4 — HIGH (adjacent to scope, found while verifying the gate). The idle gate starves the watchdog completely

**Files:** `server/src/scheduler/pulse.ts:50-54`, `94-121`; `server/src/health/monitor.ts:404`, `412`

This is **not** a scraper defect, but I found it while doing the task's item 3 and it is the most
severe thing in this report, so it belongs here. It also directly determines whether anyone would
ever notice a stuck scraper.

The gate's geometry: `IDLE_POLL_MS = 30 min`, `BURST_MS = 90 s`. Crucially,
`nextIdleWakeAt = now + IDLE_POLL_MS` (`pulse.ts:114`) anchors the next window to *whoever opened
this one*, not to a fixed grid. So the burst schedule locks onto one poller and stays there.

The watchdog ticks every **900 s** (`monitor.ts:404`). 1800 is an exact multiple of 900, so its
phase relative to the burst grid is fixed. Working it through by hand from a cold boot (all timers
registered together in `index.ts:648-668`, `lastWorkAt` initialised at module load,
`ACTIVE_GRACE_MS = 600 s`):

- Grace expires at t = 600 s. The pollers due at exactly 600 s are followup (10 s), campaign (60 s),
  replyPoller and autoScraper (300 s). One of them opens the burst: `burstUntil = 690`,
  `nextIdleWakeAt = 2400`.
- Watchdog ticks at 900, 1800, 2700, 3600 … i.e. at t ≡ 0 or 900 (mod 1800).
- Bursts open at t ≡ 600 (mod 1800) and are 90 s wide → `[600, 690]` mod 1800.
- **The two sets never intersect.** The watchdog's ticks land 300 s and 1200 s away from every
  window.

I confirmed this with a virtual-clock simulation that re-implements `mayPoll` line-for-line and
drives all five real pollers at their production periods (scratchpad only, nothing in the repo).
Over 14 simulated idle days:

| poller | turns granted | mean gap |
|---|---|---|
| followupScheduler | 731 | 27.6 min |
| campaignWorker | 681 | 29.6 min |
| replyPoller | 673 | 30.0 min |
| autoScraper | 673 | 30.0 min |
| **watchdog** | **0** | **never** |

Stable across per-tick timer drift of 0–20 ms and across boot-registration spreads of 0–5000 ms and
six seeds. It only recovers when something re-anchors the pulse: with one HTTP request every 6 h
(`reportActivity`, `index.ts:300`) the watchdog gets 55 turns in 14 days — i.e. **it runs only when
a human is using the app.** At an artificial 100 ms/tick drift it also recovers, so the outcome is
drift-sensitive; see §5.

**Failure scenario:** overnight, nobody logged in. A mailbox's OAuth token expires, or a scraper
schedule is wedged in `RUNNING`. `runDeepChecks` never executes, `watchdogPassWith` never runs, no
alert email is ever sent, and `pulseState()` (`pulse.ts:128-135`) reports the system as healthily
idle because it only exposes `nextIdleWakeAt`, not per-poller service. HANDOFF already records
that "the watchdog has been detecting real failures for weeks and writing them to a logfile nobody
reads" — after the 2026-07-28 gating change it does not detect them either.

**Fix shape:** in `mayPoll`, when a poller's period ≥ `IDLE_POLL_MS / 2`, grant it a turn whenever
`now - lastServed[name] >= IDLE_POLL_MS` rather than requiring it to land inside the 90 s window.
Or simply extend the burst so `BURST_MS > max(poller period)`. Either way, add a test that drives
the *real* pollers at their *real* periods against the real `mayPoll` — `pulse.test.ts` cannot
catch this because it advances time by hand, and `autoScraperPulse.test.ts` replaces `mayPoll` with
a boolean (`autoScraperPulse.test.ts:23-27`), so it proves the gate is *consulted*, not that the
cadences are compatible. That is precisely the failure mode `.plans/known-failures.md` logs under
"a unit test on a pure function proves the rule, not its application".

---

### C5 — MEDIUM. The in-memory `jobs` map is never evicted

**File:** `server/src/scraper/service.ts:57`

`const jobs = new Map<string, ScrapeJob>()` — there is no `jobs.delete` or `jobs.clear` anywhere in
the file (grepped). `procs` *is* cleaned up correctly (`service.ts:454`, `459`, `535`, `548`, `554`);
`jobs` is not.

Each retained entry holds up to `MAX_LOG_LINES = 800` log lines (`service.ts:55`, `264`) **and**
`job.rows` — every freshly-scraped CSV row, including `recent_video_transcript`, which is capped at
`TRANSCRIPT_WORD_LIMIT = 300` words per row (`main.py:51`, `1042`) but not capped in row count
(`service.ts:356`).

**Failure scenario:** 9 tenants × up to 5 auto-runs/day = ~45 jobs/day, plus manual runs. After a
month of uptime that is ~1,350 permanently-retained job objects. `activeJobFor` (`service.ts:258`)
and `listJobs` (`service.ts:252`) both do a full `[...jobs.values()]` materialisation and linear
scan, and `activeJobFor` is on the hot path of *every* start and *every* `recoverStaleRuns`
iteration (`autoScheduler.ts:128`) and every `GET /api/scraper` (`routes.ts:89`), which `App.tsx`
polls every 60 s app-wide. Growth is bounded only by process restarts.

---

### C6 — MEDIUM. Every scrape re-imports the whole `leads.csv`, two sequential Postgres queries per row

**Files:** `server/src/scraper/service.ts:359-364`; `server/src/leads/importService.ts:124-160`

`finishJob` reads the **entire** `leads.csv` (`readLeads` → `readLeadsRaw`, `service.ts:304-324`)
and passes all of it to `importLeadRows`. The comment at `service.ts:361` says this is deliberate
("Import every row (idempotent), but report against the freshly-found set"), and correctness-wise
it is fine. The cost is not.

`importLeadRows` loops row-by-row (`importService.ts:124`) issuing a `findFirst`
(`importService.ts:130`) then an `update` or `create` (`139`/`145`) — **two sequential round-trips
per row, unbatched, inside a `for…of` with `await`**.

**Failure scenario:** a profile's `leads.csv` is append-only and never pruned (`main.py:1781-1793`
appends; nothing ever truncates it). Today the live profiles are tiny (largest `leads.csv` is 1,250
bytes), so this is ~20 queries. At 1,000 accumulated leads it becomes **2,000 sequential Neon
round-trips per run**, × 3-5 runs/day × per tenant — recreating exactly the compute-hour class of
failure that took production down on 2026-07-28 and that the pulse gate was introduced to fix.

Second-order effect that is already true at any size: the `update` branch writes
`{ intelligence: mergedIntel, source }` for **every existing lead on every run**, so `Lead.updatedAt`
churns for the tenant's entire lead table 3-5×/day. Any UI ordering or "recently changed" filter
built on `updatedAt` is meaningless.

**Fix shape:** pass only `freshRaw` to the import (it is already computed at `service.ts:355`), or
batch the existence check into one `findMany({ where: { email: { in: … } } })` and skip updates
whose merged intelligence is byte-identical.

---

### C7 — MEDIUM. Decrypted YouTube session cookies are left on disk and swept into the backup archive in plaintext

**Files:** `server/src/scraper/cookieService.ts:140-162`; `server/scripts/backup-db.mjs:65-66`

`CookieFile.content` is AES-256-GCM encrypted at rest (`cookieService.ts:107`), which is right.
`materializeCookiePool` then decrypts it and writes plaintext Netscape cookie jars to
`profiles/<slug>/cookies/*.txt` (`cookieService.ts:159-161`) before every spawn. **Nothing ever
deletes them after the run** — the only unlink is the *next* materialization clearing stale files
(`cookieService.ts:152-157`), and that only happens if the DB pool is non-empty.

The backup script archives the whole tree:

```js
// server/scripts/backup-db.mjs:65-66
'tar', ['--exclude=*.bak-*', '-czf', path.basename(scraperOut), '-C', scraperDir, 'profiles']
```

The only exclusion is `*.bak-*`. So `C:\backups\ysx\ysx-scraper-<date>.tar.gz` — 14 days of them,
per the retention logic — contains every tenant's live YouTube session cookies in the clear, while
the copy in Postgres is encrypted. HANDOFF's own note at line 601 discusses moving this 1.9-2.3 MB
archive off-box; that would move the plaintext credentials with it.

The scraper's own docstring calls the directory "disposable" (`cookieService.ts:20-22`) — it is
disposable in the sense that it is rebuilt, not in the sense that it is ever removed.

**Fix shape:** add `--exclude=cookies` to the scraper tar (the pool is reconstructible from
Postgres, so there is nothing to back up), and unlink the dir in `finishJob`.

*Note:* no profile currently has a `cookies/` subdirectory (checked by listing), so this is
prospective on this checkout — it fires the first time any tenant uploads a cookie file.

---

### C8 — MEDIUM. The `YTDLP_COOKIES_FILE` legacy fallback shares one YouTube session across all tenants, and fires exactly when per-tenant isolation no-ops

**Files:** `scraper/cookie_manager.py:91-118`; `server/src/scraper/cookieService.ts:145`;
`server/src/scraper/service.ts:440`, `533`; `server/.env.example:7`

The 2026-07-25 fix gave each tenant its own cookies dir and set `YTDLP_COOKIES_DIR` per child. But
the child is spawned with `env: { ...process.env, … }` (`service.ts:440`, `533`), so it also
inherits **`YTDLP_COOKIES_FILE`**, which `server/.env.example:7` documents as the standard setting:

```
YTDLP_COOKIES_FILE=../scraper/cookies.txt
```

`materializeCookiePool` returns early and writes nothing when the tenant's DB pool is empty
(`cookieService.ts:145`). `CookieManager._load()` then finds an empty dir, falls back to
`YTDLP_COOKIES_FILE`, and **copies that one shared jar into the tenant's own pool as `legacy.txt`**
(`cookie_manager.py:110`). The two mechanisms compose exactly wrong: the fallback activates
precisely in the case per-tenant materialization declines to handle.

**Failure scenario:** tenant B has never uploaded cookies. Their auto-run adopts the operator's
personal YouTube session into `profiles/crm-<B>/cookies/legacy.txt` and crawls YouTube
authenticated as that account. If YouTube bot-checks it, `report_bot_check`
(`cookie_manager.py:155`) benches it for an hour — for that process only; the account is burned for
everyone. Direct evidence this path has run in this checkout: `scraper/cookies/legacy.txt` exists
alongside `scraper/cookies.txt`.

Related, smaller, and documented as intentional: `materializeCookiePool` selects
`{ OR: [{ userId }, { userId: null }] }` (`cookieService.ts:142`), so legacy unowned DB rows are
written into *every* tenant's dir, and `deleteCookieFile` (`cookieService.ts:123-125`) lets **any**
tenant delete a `userId: null` row out from under all the others.

---

### C9 — LOW. An `AT_CAPACITY` auto-run loses its whole slot

**File:** `server/src/scraper/autoScheduler.ts:79-87`, `97`

`runOne` calls `startAutoJob`, which throws `AT_CAPACITY` when `activeChildCount >= 4`
(`service.ts:81-88`) — a budget shared with manual runs. The `catch` at `autoScheduler.ts:84`
records the error, and then `autoScheduler.ts:97` advances `nextRunAt` to
`computeNextRunTime(new Date(), runsPerDay)`, i.e. **the next slot**.

**Failure scenario:** four users start manual scrapes. A tenant's 08:48 auto-run is claimed
(IDLE→RUNNING), immediately rejected at capacity, and rescheduled to the 16:48 slot. At
`runsPerDay = 3` that tenant loses a third of its day's scraping to a transient condition that
would have cleared in minutes. A `AT_CAPACITY` should retry on the next tick, not consume the slot.

---

### C10 — LOW. `computeNextRunTime` can schedule the next run a minute after the last one finished

**File:** `server/src/scraper/autoScheduler.ts:50-64`

```ts
const jitteredMs = slotStartMs + (0.1 + Math.random() * 0.8) * slotMs;
if (jitteredMs > after.getTime()) return new Date(jitteredMs);
```

The jitter is drawn uniformly across the whole slot and then *accepted if it happens to be after
`after`* — the conditional distribution is never re-normalised. So when a run finishes partway into
a slot, the next run is uniform over the remainder of that slot, including its first minute.

**Failure scenario:** `runsPerDay = 3` (slot 08:00-16:00, jitter range 08:48-15:12). A run
completes at 08:50. `computeNextRunTime(08:50, 3)` skips slot 0 and returns a uniform point in
(08:50, 15:12]. There is a ~2.6 % chance it lands within 10 minutes — two full YouTube crawls for
one tenant back-to-back, which is exactly the burst pattern `MAX_CONCURRENT_AUTO_RUNS` and the
"spread into tiny pieces" comment (`autoScheduler.ts:26-28`) exist to avoid. At `runsPerDay = 5`
the probability is ~4.3 %. This is amplified by the gate, which can delay a tick by up to 30
minutes and so push completions deeper into their slots.

Low severity, and the fix is one line (clamp the slot's lower bound to `after` before drawing).

---

### C11 — LOW. Two documentation/observability gaps that will cost someone a debugging session

**a. The signup hook the code documents does not exist.** `autoScheduler.ts:47` says
`computeNextRunTime` is used "for a brand-new schedule's first run (auth/routes.ts signup hook)".
Grepping `scraperSchedule` across `server/src` outside `server/src/scraper/` returns **only the
test file**. The sole creation path is `PATCH /api/scraper/auto` (`routes.ts:196-210`). So the
"3-5x/day per tenant" cadence applies only to tenants who have opened the Scraper settings and
saved; everyone else has no `ScraperSchedule` row and never auto-scrapes. That may be intended, but
it is not what the comment says, and `.plans/known-failures.md` has a standing entry about exactly
this class of self-authored claim.

**b. `/api/health/deep` has no auto-scraper check.** `health/monitor.ts` checks db, campaign
worker, followup scheduler, mailboxes, disk, alerting, quota, send capacity, and backup freshness.
Nothing checks the auto-scraper's last tick, nor for a `ScraperSchedule` wedged in `RUNNING`. The
only scraper-shaped check is archive freshness (`monitor.ts:298-328`). Combined with **C4**, a
scraper that stops entirely is invisible.

---

### C12 — LOW. SSRF in `crawl_for_email`

**File:** `scraper/main.py:1366-1432`

`crawl_for_email` takes URLs harvested from a channel's About tab (`_about_page_links`,
`main.py:1254`) — fully attacker-controlled by anyone who owns a YouTube channel that passes the
gauntlet — and fetches them with:

```python
resp = requests.get(page, timeout=_CRAWL_TIMEOUT, allow_redirects=True, impersonate=_IMPERSONATE)
```

There is no scheme allowlist beyond `http(s)`, no private/loopback/link-local host filter (only
`_is_social`, `main.py:1362`, which excludes social platforms), redirects are followed, and — unlike
`_fetch_html` (`main.py:701-712`) — **no proxy is used**, so the request originates from the backend
host itself.

**Failure scenario:** a qualifying channel sets its About link to `http://127.0.0.1:3001/` or
`http://169.254.169.254/…`. The server fetches it, plus `/` and `/contact` on the same host
(`_CONTACT_PATHS`, `main.py:1343`), up to `_CRAWL_MAX_FETCHES = 7`. Any email address appearing in
the response body is written into that tenant's `leads.csv` and imported as a lead.

Impact is genuinely limited — no credentials or cookies are attached to these requests, and the only
channel back to the attacker is "an email address from an internal page shows up in a lead list they
cannot see". I am reporting it as LOW, not inflating it. The realistic value is internal port and
host probing via timing.

---

## 3. Suspected but unproven

### S1 — Do scraper children survive an `nssm restart`? (determines whether the stale-run fix is complete)

`recoverStaleRuns` (`autoScheduler.ts:116-141`) deliberately reclaims only schedules with no
in-memory job, and the comment at `autoScheduler.ts:110-114` names "a real process crash/restart"
as the case it is designed for. That reasoning holds **only if the Python children die with the
Node process.**

- Node does not create a Windows Job Object for `spawn`ed children, so nothing in this codebase
  kills them.
- NSSM *does* have `AppKillProcessTree` (default 1 in 2.24+), which would kill them on a clean
  service stop — but not on an abrupt Node death (OOM, `TerminateProcess` on node.exe alone).
- HANDOFF's 2026-07-25 entry records **6 live orphaned scraper processes found on the VM**, so
  orphaning demonstrably happens in this deployment, whatever the mechanism.

**If children do survive:** a restart empties `jobs`, so after 30 minutes `recoverStaleRuns` finds
`activeJobFor(userId)` undefined, resets the row to IDLE, and the next due tick launches a **second**
scraper for a tenant whose first one never stopped. That is the double-claim the task asked about,
and it is the one restart hazard I could not close.

**What would settle it (read-only, does not touch the prod checkout or restart anything):**
`nssm get ysx-backend AppKillProcessTree`, plus
`Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Select ProcessId, ParentProcessId, CommandLine`
during and after a restart. I did not run either, per the constraints.

Two facts I *can* state with confidence: a restart **cannot** double-claim within the 30-minute
window (rows stay `RUNNING`, and the `due` query at `autoScheduler.ts:161` filters
`status: IDLE`), and the in-process guard is sound (see §4).

### S2 — Interleaved `leads.csv` appends could tear a row

If two `main.py` processes share a profile (C1/C2/S1), both call `append_rows`
(`main.py:1781-1793`), which opens in `"a"` mode and writes a whole chunk via
`csv.DictWriter.writerows`. Small writes to an O_APPEND handle are effectively atomic, but a chunk
containing a 300-word transcript exceeds the buffer and is flushed in pieces. I could not establish
whether Python's buffered writer emits a single `write()` per flush on Windows, so I am not calling
this confirmed. **Settles it:** two processes appending 8 KB rows to one file under
Process Monitor, or reading CPython's `_io.BufferedWriter` flush behaviour.

### S3 — No response-size cap on any HTTP fetch

Neither `_fetch_html` (`main.py:694-730`) nor `crawl_for_email` (`main.py:1366-1432`) uses
`stream=True` or checks `Content-Length`; both materialise `resp.text` entirely in memory. A
malicious site linked from a channel's About tab could serve an endless body. Whether this is
exploitable depends on whether `curl_cffi`'s `timeout` maps to `CURLOPT_TIMEOUT` (total) or only to
connect/read — if total, the 5 s `_CRAWL_TIMEOUT` bounds it to whatever fits in 5 s, which on a fast
link is still hundreds of MB. **Settles it:** read `curl_cffi`'s timeout mapping, or fetch a
generated endless-stream endpoint and watch RSS.

### S4 — The scraper backup can capture a torn SQLite snapshot

`backup-db.mjs` tars `profiles/` with no coordination against a running scrape, and captures
`tracking.db`, `-wal` and `-shm` at three different instants. If a scrape commits between the reads,
the archived triple may not be internally consistent. SQLite is usually forgiving here, but I did
not verify recovery from such an archive. **Settles it:** restore one archive to a scratch dir and
run `PRAGMA integrity_check`.

---

## 4. Claims verified as correct — do not redo this work

**Two premises I was handed did not hold. Both are recorded here so nobody chases them again.**

### V1 — ❌ REFUTED: "concurrent tenant runs against one profile directory will lock"

Not possible via the CRM. The profile slug is derived solely from the tenant id:
`niche = \`crm-${userId}\`` → `slugify` → `profiles/crm-<userId>/` (`service.ts:398-401`,
`498-501`, `117-121`, mirrored in `session_profile.py:66-75`). Two different tenants **cannot**
share a profile directory. Everything mutable is per-profile (`session_profile.py:46-63`); the
globals `use_profile` leaves shared (`main.py:2214-2260`) are network-layer only — proxy manager,
impersonation, pacing — and are per-process anyway.

Every real collision I found (C1, C2, S1) is **same-tenant**. That is a materially different bug to
fix, and the cross-tenant framing would send you to the wrong place.

### V2 — ❌ REFUTED (my own hypothesis): "the idle gate starves the auto-scraper"

I expected the 5-minute tick to phase-lock outside the 90-second burst, since 1800 is an exact
multiple of 300. **It does not.** Because `nextIdleWakeAt` is anchored to whoever opens the burst
(`pulse.ts:114`) and longer-period timers accumulate less absolute drift, the auto-scraper becomes
the burst anchor and self-locks *into* the window. Simulation over 14 idle days: **673 grants, mean
gap 30.0 min, max gap 30.0 min**, stable across drift 0-100 ms/tick, boot spreads 0-5000 ms, and six
seeds (details in §2 C4's table).

So the comment at `autoScheduler.ts:210-211` — *"Delaying a due scrape by up to one idle-poll window
is harmless here"* — is **accurate**. The delay is bounded at ~30 minutes against a 3-5×/day
cadence. The 2026-07-28 gating change is safe for the scraper.

The same analysis is what surfaced C4: the watchdog's 900 s period lands 300 s outside every window
and never recovers. So the gate is safe for the thing I was asked about and unsafe for its neighbour.

### V3 — `computeNextRunTime` does not drift and cannot starve or hot-loop

- **No cumulative drift.** Slots are re-derived from `after`'s own UTC calendar day on every call
  (`autoScheduler.ts:53`), so it re-anchors to an absolute grid rather than accumulating from the
  previous value.
- **Never returns a past time.** The loop requires `jitteredMs > after.getTime()` strictly
  (`autoScheduler.ts:58`), and the fallback is `tomorrowStart + positive jitter` where
  `tomorrowStart = dayStart + 24 h > after` by construction (`autoScheduler.ts:62-63`). So
  `nextRunAt` is always strictly in the future and the tick can never spin.
- **No run-count inflation.** Delaying a tick does not cause missed slots to be replayed — the row
  fires once whenever it is next observed, so the daily rate degrades gracefully rather than
  bursting.
- `runsPerDay` is constrained to `3 | 5` at the only mutation site (`routes.ts:180`) with a schema
  default of 3 (`schema.prisma:595`), so the `runsPerDay = 0` division-by-zero path
  (`slotHours = Infinity` → `new Date(Infinity)` → Prisma throw) is **not reachable** today.

### V4 — In-process double-claim is genuinely prevented

The `ticking` latch (`autoScheduler.ts:151-152`) serialises ticks; the `IDLE → RUNNING`
compare-and-set via `updateMany` with `where: { id, status: IDLE }` and a `claimed.count !== 1`
check (`autoScheduler.ts:172-176`) is a correct atomic claim; `recoverStaleRuns` re-checks
`status: RUNNING` in its own `updateMany` where-clause (`autoScheduler.ts:130-132`) so it cannot
clobber a row someone else just claimed. `runningCount` is incremented before the `void runOne(…)`
and released in `.finally` (`autoScheduler.ts:178-181`). The boot tick at `autoScheduler.ts:201`
runs **ungated**, so `recoverStaleRuns` executes immediately after a restart rather than waiting for
a burst — that is the right call and it is easy to miss.

### V5 — Partial failure leaves state consistent

A mid-run crash or non-zero exit is handled well, and I want this on the record because it is the
kind of thing a later reviewer will "fix" into a regression:

- `main()`'s `finally` (`main.py:2384-2394`) flushes any pending `new_rows` to `leads.csv`.
- Rows are flushed after **every 50-channel chunk** (`main.py:2374-2377`), so at most one chunk is
  ever in flight.
- `finishJob` (`service.ts:345-378`) runs on **any** exit code and imports the whole `leads.csv`,
  so leads written before a crash are picked up.
- Cancellation is the one path that skips the import (`service.ts:460-464`, `555-560`), but those
  rows are **not lost**: because C6's whole-file re-import is idempotent, the next successful run
  imports them. They are merely absent from that run's `created` count.
- Errors are surfaced, not swallowed: `runOne` writes the failure into `lastRunSummary`
  (`autoScheduler.ts:83`, `86`) and logs it; `finishJob` sets `job.error` (`service.ts:371`,
  `375`); the child's stderr is streamed into the job log (`service.ts:446`, `539`).

### V6 — Input handling that is already correct

- **CSV injection is neutralised.** `_csv_safe` (`main.py:1435-1440`) prefixes any field starting
  with `= + - @ \t \r` with a quote, applied to every field in `append_rows` (`main.py:1788`) and
  in `normalize_leads_csv`.
- **No shell injection.** Every spawn passes an argv array with no shell — `service.ts:438`, `530`,
  `177-181`; `orchestrator.py:199-211`.
- **No path traversal via the niche.** `slugify` collapses everything outside `[a-z0-9]` to `-`
  (`service.ts:119`, `session_profile.py:74`), and the input is a cuid from the verified JWT, not
  user text.
- **No path traversal via cookie filenames.** `sanitizeCookieName` (`cookieService.ts:64-80`) does
  `path.basename` → rejects leading `.` → requires `.txt` → restricts the stem to
  `[a-zA-Z0-9._-]` → strips leading `._`. On Windows `path.basename` handles both separators.
- **Upload size is capped.** multer memory storage at 2 MB × 20 files (`routes.ts:51-54`), with
  multer errors converted to clean 400s (`routes.ts:57-71`).
- **Criteria are clamped on both sides** — `routes.ts:223-235` mirroring `criteria.py`'s `_clamp`,
  with the `minSubs ≤ maxSubs` ordering fixed up at `routes.ts:408-413` and signal terms bounded at
  60 × 40 chars with a ≥4-char floor (`routes.ts:253-280`).
- **`parseCsv`** (`service.ts:268-301`) is a correct RFC-4180-ish reader (escaped quotes, embedded
  newlines, CR stripping) and every row goes through `scraperRowSchema.safeParse` with malformed
  rows dropped rather than throwing (`service.ts:318-322`).
- **Cookie contents are never logged.** `cookie_manager.py` logs only `Path(...).name`
  (lines 82, 152, 159); nothing prints jar contents.
- **`POST /settings/release` refuses to mutate `tracking.db` under a live scrape**
  (`routes.ts:445-448`).

---

## 5. Could not determine

Stated plainly rather than guessed:

1. **Whether `YTDLP_COOKIES_FILE` is actually set in the production environment.** It is in
   `server/.env.example:7` and the artifacts of the adoption path exist in this checkout
   (`scraper/cookies/legacy.txt`), but prod's `server/.env` and the NSSM environment are out of
   bounds for this review. C8's severity hinges on this.
2. **Whether scraper children survive a service restart** — see S1. Needs
   `nssm get ysx-backend AppKillProcessTree` and a live process-tree observation, neither of which I
   ran.
3. **Real `setInterval` drift per tick on this VM.** C4's watchdog starvation is robust for drift
   below ~20 ms/tick and disappears around 100 ms/tick. I modelled it; I did not measure it. A
   30-line script logging actual vs. nominal fire times for a 900 s interval over a few hours would
   settle it — and would be worth running before anyone decides C4 is theoretical.
4. **Anything requiring the database.** Neon is exhausted until 2026-08-05. I could not check
   whether any `ScraperSchedule` row is currently wedged in `RUNNING`, how many tenants have a
   schedule row at all (which bears on C11a), or how large the per-tenant `Lead` tables are (which
   sets the real magnitude of C6).
5. **Anything requiring a live scrape.** Per the constraints I did not run the scraper, so C3's
   `database is locked` path, C2's double-start race, and S2's CSV tearing are all reasoned from
   source rather than observed.
6. **`main.py` beyond the areas listed in §1.** I read roughly 900 of its 2,398 lines closely —
   the entry point, gauntlet, tracking-DB layer, extraction and I/O. The yt-dlp extraction cascade
   (`ytdlp_extract`, `_video_meta`, `channel_batch`, `resilient_extractor.py`,
   `payload_extractor.py`, `transcript_extractor.py`) and the webhook/DLQ layer were **not**
   reviewed. Do not record those as covered.

---

## 6. Suggested order of work

1. **C4** (watchdog starvation) — it is the reason nothing else on this list would be noticed.
   Config-only mitigation available immediately: set `PULSE_BURST_MS` above the watchdog's 900 s
   period, or lower `PULSE_IDLE_POLL_MS` to a value that is not an integer multiple of 900.
2. **C2** (check-then-act) — a few lines, removes the most reachable corruption route.
3. **C1** (cancel/orphan) — larger, needs a Windows process-tree kill and a `cancelling` state.
4. **C6** (whole-file re-import) — matters before the lead tables grow, and is the same
   compute-budget class as the outage.
5. **C7/C8** (cookie plaintext + shared legacy jar) — cheap, and both are one-line-ish.
6. C3, C5, C9-C12 as capacity allows.

None of these should ride along with the 2026-08-05 deploy, which already carries three migrations
and five behaviour changes on the send path.
