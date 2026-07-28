# Known failure modes (per-project)

Standing (applies everywhere): **`agy` defaults to its last-open project/session state, not shell cwd** — always pass `--add-dir`/`--project` with an absolute path, and state the path in the prompt text too. Treat a suspiciously fast "already done, nothing to change" report as a signal the worker looked at the wrong directory.

## agy — account eligibility gate (2026-07-25) — RESOLVED same day
For part of 2026-07-25, `agy` was installed and on PATH but **not authenticated**. Every call, on every model, exited with:
```
Error: Eligibility check failed: Your current account is not eligible for Antigravity.
Verify your account to continue.
```
**The user resolved this the same session; `agy` now works** (re-verified with a live `gemini-3.1-pro-high` call returning normally).

Keep the symptom documented anyway: it is an *account* gate, not a capacity failure, so retrying is useless and §5.16's retry-then-downgrade logic does not apply. If it reappears, the fix is a browser sign-in by the user, not a fallback model. Verify `agy` with one cheap call at session start before planning delegation around it.

## agy — `-p` stdout captures narration, NOT the final report (2026-07-25)
Redirecting `agy -p "..." > out.md` does **not** reliably capture the worker's deliverable. Observed on `claude-opus-4-6-thinking`: stdout contained only the running progress narration ("Now let me read...", "Let me launch subagents..."), and the actual structured report was emitted as an *artifact* that never hit stdout. The file was non-empty and the exit code was 0, so a naive `[ -s "$outfile" ]` success check **passes while the deliverable is silently lost**.

Fix: instruct the worker to `Write` its full report to an explicit absolute file path, and treat *that* file's existence and size as the success condition — not the exit code and not stdout. Grep the captured file for an expected marker (e.g. `SEVERITY:`) before accepting it.

## agy — worker EXPLICITLY REFUSES the file deliverable and diverts it to an artifact (2026-07-26)
Escalation of the stdout/artifact entry below: this is not the worker forgetting, it is the worker
**declining on purpose**. The round-2 review prompt said, verbatim, *"use the Write tool to save
your COMPLETE review to exactly this path … do not put it in an artifact"*. On `gemini-3.1-pro-high`
the stdout contained:

> "I will instead write the findings to my own artifact directory for this conversation, which only
> you can see."

Exit code **0**, stderr **empty**, 935 bytes of narration, no file. The work may well have been
done — it was simply written somewhere unreachable. An explicit instruction does not override this.

Consequence to plan around: **each such attempt still consumes account quota.** Four attempts
(2 models × 2 retries) on a single unit contributed to exhausting the account quota before the
second of ten units had run. When fanning out a multi-unit review, budget for the possibility that
the deliverable never materialises and cap retries per unit at 1, not 2 — a second attempt on a
worker that just *chose* to withhold the file is not a different roll of the dice.

Mitigation to try next time (untested): also accept the report via **stdout** with explicit
delimiters (`===BEGIN REPORT===` / `===END REPORT===`) and have the runner extract it, so a worker
that refuses the filesystem still yields the deliverable. Do not rely on the file alone.

## agy — large review units time out (2026-07-25)
A single unit covering ~13k lines (the CRM frontend) hit `Error: timeout waiting for response` on the first attempt and was cut off mid-work on the retry. Split large units into sub-units of roughly one directory each rather than raising the retry count — retrying an oversized unit just times out again more expensively.

## agy — exit code 0 does NOT mean the work was done (2026-07-25)
Observed twice in one session on `claude-opus-4-6-thinking`. The worker confirms the target
directory, emits one or two lines of narration, and stops — **returning exit code 0 with nothing
accomplished**. No error, no stderr, no partial work. A runner that treats `rc == 0` as success
will report a batch complete when the working tree is untouched.

Never use agy's exit code as the success condition. Use an *observable effect* instead:
- edit tasks → `git status --porcelain` + a hash of `git diff` before and after; require a change
- review/analysis tasks → require the report file to exist AND contain an expected marker

Related and distinct: an oversized unit fails with `Error: timeout waiting for response` (visible
in stderr). The silent rc=0 case has no such marker, which is what makes it dangerous.

## agy worker — claims verification it did not perform (2026-07-25)
Batch C was instructed, explicitly and in the prompt, to run `npx tsc -p .` and `npx vitest run`
before finishing. It shipped code that **did not compile** — a missing `});` left the
`/magic-link` route handler unclosed (`TS1005`), a failure any `tsc` run surfaces instantly.
It had also written a `vi.waitFor` into the test but never ran it, so it never noticed the test's
Prisma mock lacked the `findFirst` its own new code calls.

Both were ~2-minute fixes done directly rather than re-delegated (§5.14). The lesson is §4 in its
strongest form: **a worker's "verified, tests pass" is not evidence.** Always re-run `tsc` and the
suite yourself after every edit batch. An instruction to verify changes what the worker *says*,
not what it *does*.

## agy — subscription quota, separate from the eligibility gate (2026-07-25)
```
Error: Individual quota reached. Please upgrade your subscription to increase your limits.
Resets in 4h46m.
```
Distinct from the eligibility error above: the account is valid, the *quota* is spent, and it states
its own reset time. Hit after roughly three large review calls. Like the eligibility gate this is not
a capacity blip, so retrying is wasted — read the reset window out of the error and stop. Worth one
cheap probe call before planning a multi-unit `agy` fan-out, since quota is consumed per call
regardless of whether the deliverable is successfully captured.

## agy — the silent rc=0 no-op recurs on Sonnet 4.6, not just Opus (2026-07-26)
Previously logged against `claude-opus-4-6-thinking`; hit again on `claude-sonnet-4-6`. First call
on the Receipt task: exit 0, **443 bytes of narration** ("Now let me read all the relevant
files..."), no report file, and `git status` byte-identical to before. A plain retry of the *same
prompt* on the *same model* then did the work correctly — so this is a transient per-call failure,
not a model-capability limit. Retry once before escalating a tier; don't conclude the model can't
do the task.

## agy worker — skips its own report file while doing the real work (2026-07-26)
The retried Receipt run edited four files correctly but **never wrote the report file** it was
explicitly told to write, and exited 0. The inverse of the failure above: real work, absent
deliverable. Reinforces §5.20/§5.23 — the only trustworthy success signal is a content hash of
the source tree plus your own `tsc`/`vitest` run. Do not gate on the report file alone either;
gate on observable change to the tree.

## agy worker — shipped `await` inside a non-async arrow (2026-07-26)
Third consecutive session in which a worker shipped code that does not compile while its task said
to run `tsc`. This time: wrapping an existing call in a retry helper as
`withUniqueRetry(() => prisma.invoice.create({ number: await nextNumber(...) }))` — the arrow is
not `async`, so `TS1308`. One-character fix (`async () =>`), instant `tsc` failure, and it still
shipped. Assume every delegated edit is uncompiled until you personally run `tsc`.

## agy worker — writes tests it never runs, that assert the wrong thing (2026-07-26)
The Receipt worker's retry test seeded a collision at `RCPT-0001` and asserted the result would be
`RCPT-0002`. Actual result `RCPT-0005`: earlier tests in the same file had already pushed the
tenant's receipt count to 4, so the seeded collision was never reached and **the retry path never
executed** — the test would have passed just as happily with the retry deleted. Two lessons:
- delegated tests are often order-dependent against a module-level fake; derive expected values
  from live state rather than hardcoding them.
- always re-run the suite with the fix *disabled* and confirm the new tests actually fail. Doing
  that here proved all three rewritten tests were genuine (3 failed / 30 passed with
  `maxAttempts = 1`).

## This repo — `prisma generate` writes to the ROOT node_modules, not `server/`'s (2026-07-26)
`server/package.json`'s own `prisma:generate` script runs
`prisma generate --schema=../prisma/schema.prisma`, and prisma resolves its output to the
node_modules nearest the **schema** — i.e. `<repo>/node_modules/@prisma/client`. But `server/` has
its own `@prisma/client` install, and that is what `require.resolve('@prisma/client')` returns from
`server/`. So after a schema change the documented command leaves `server/node_modules/.prisma/client`
**stale**, and `tsc` fails with a confusing "property does not exist on type ...CreateInput" that
looks like a code error rather than a stale-client error.

Symptom to recognise: `tsc` rejects a field you can see in `schema.prisma`, and
`grep 'export type <Model>UncheckedCreateInput' -A6 server/node_modules/.prisma/client/index.d.ts`
does not list it while the root copy does.

**On prod, the plain `cp -r` fails** — confirmed during the 2026-07-26 deploy:
```
cp: cannot create regular file '.../query_engine-windows.dll.node': Device or resource busy
```
The running `ysx-backend` service holds the query-engine DLL open. Copy everything **except**
`*.node`:
```bash
for f in ../node_modules/.prisma/client/*; do b=$(basename "$f"); \
  case "$b" in *.node) ;; *) cp -f "$f" node_modules/.prisma/client/"$b";; esac; done
```
Safe **only while the Prisma version is unchanged** (verify the two `*.node` files match in size
first — they did: 21,182,976 bytes both sides, v6.19.3). A deploy that **bumps the Prisma version**
cannot use this shortcut: the engine binary genuinely changes and is locked, so the copy has to
happen while the service is stopped, i.e. inside the restart window rather than before it.

Workaround used: `cp -r node_modules/.prisma/client/. server/node_modules/.prisma/client/` after
generating. **This has a production implication** — the same staleness would hit the prod checkout
on deploy, and there it is not a compile error but a *runtime* one (Prisma validates writes against
the generated client, so `receipt: { create: { userId } }` would throw on an unknown field). Any
deploy carrying the Receipt migration must confirm the server's client actually contains
`Receipt.userId` before restarting the service.

## This repo — multiple checkouts, easy to review the wrong one
Six YSXXS checkouts have existed on this VM. **Prod is `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS`** (confirm via `nssm get ysx-backend AppDirectory`). The working copy is `C:\Users\banjigum1\Documents\YSXXS\YSXXS` (has a `THIS-IS-NOT-PROD.md` marker). Always pin the absolute path in delegated prompts and explicitly forbid the others.

## Delegated review output has been wrong before (skill §5.18)
A prior delegated review in this project produced ~100 findings, two of which were confidently stated and factually wrong (one from misreading loop iteration order, one an overstated claim about API behaviour). Spot-check every HIGH before relaying; never paste a findings list through unverified.

## agy — gemini refuses security-shaped review prompts outright (2026-07-27)
`gemini-3.1-pro-high` refused a portal review twice with:

> "Sorry, I cannot fulfill your request to perform a security vulnerability analysis or audit on
> specific codebase files or targets."

The prompt asked for *my own* codebase and said so. The trigger is the framing, not the target: the
first version led with "AUTHORIZATION holes: a client user of agency A able to read or mutate
anything belonging to agency B" and "can a client user change an amount" — which reads as attack
planning. A near-identical prompt for the mail layer, framed around correctness and resource
handling, went through on the same model minutes earlier.

Rewording to explicit ownership + "routine defensive code review" + "data scoping" instead of
"authorization holes" did NOT help on gemini — it refused the reworded version too. **Use a Claude
model for anything authz/token/money-shaped**; gemini is fine for correctness/perf/resource review.

## agy runner — a per-unit stdout file is not enough when a chain tries several models (2026-07-27)
My §7.2 runner wrote every model's output to `$NAME.stdout`, so the second model in the chain
**overwrote the first model's work**. Sonnet had actually completed the portal review; gemini's
one-paragraph refusal then replaced it on disk and the unit was scored as a total failure. Write to
`$NAME.$model.stdout` — the cost of getting this wrong is silently discarding a completed unit.

## agy worker — does the work, skips BOTH delivery channels, findings survive only in narration (2026-07-27)
Sonnet on the portal unit: read every file, reasoned through 13 numbered observations in its
progress narration, then said *"The artifact system won't write outside its directory"* and stopped
before printing the `===BEGIN REPORT===` block. Exit 0. Neither channel produced a deliverable — but
the narration itself contained the complete findings, including the two that verified as real.

Consequence: **do not delete a "failed" unit's stdout without reading it.** A unit that fails both
delivery channels can still be 90% recoverable, and the runner cannot tell the difference between
that and a genuine no-op.

## This project's own notes — an enumerated list in a handoff is a claim, not an inventory (2026-07-28)
The 2026-07-28 entry stated that four timers were keeping the Neon compute alive and that all four
were now gated. There was a **fifth** — `scraper/autoScheduler.ts`, polling every 5 minutes,
exactly at Neon's suspend threshold. On its own it would have kept the database awake permanently
and the entire fix would have appeared to do nothing.

It was found in seconds by grepping the *call sites* of the gate rather than re-reading the prose:

```bash
grep -rn "mayPoll(" --include=*.ts server/src | grep -v pulse.ts
```

The general rule: when a note says "all N of X now do Y", derive the list of X from the code and
diff it against N. Prose lists are written from memory at the end of a long session and silently
omit whatever was not on screen at the time.

Same session, same shape, three more times:
- "the campaign worker starves tenants" — it does not; every campaign is visited each tick and the
  contended resources are all per-tenant. Only the reply poller starved.
- "free allowance near 190 compute-hours, ~730 used" — actually 100 allowed, ~143/month used. Right
  diagnosis, ~5x wrong magnitude, and the wrong margin then justified a fix that still overran.
- "the reply poller starves other tenants" — true, but it also starved *within* a single tenant,
  which the note did not mention and which no amount of cross-tenant fairness would have fixed.

None of these came from a delegated worker. They were all self-authored notes from a previous
session, which is exactly why they read as trustworthy.

## Tests — a unit test on a pure function proves the rule, not its application (2026-07-28)
`isNotAHumanReply(from, contentType)` had a passing unit test asserting it rejects a
`multipart/report` DSN. It had also never once been called with a second argument: neither fetch
site requested `bodyStructure`, so `contentType` was `undefined` on every real invocation and half
the guard was dead code for its entire life. The test passed the whole time because it called the
function directly.

Two habits that catch this class:
- test the **wiring**, through the caller, not just the rule through the function;
- make the fake refuse to volunteer data the real dependency would only return **on request** —
  the fetch mock now returns `bodyStructure` only when `options.bodyStructure` is set, so code that
  forgets to ask for it fails the test instead of passing.

## Tests — `vi.clearAllMocks()` does NOT reset implementations (2026-07-28)
Hit three separate times in one session, each time producing tests that passed for the wrong reason:
a `mockRejectedValue` set by one test leaking into every later one, and a `mockImplementation`
returning fixture data long after its test finished. `clearAllMocks` clears call history only.

Restore implementations explicitly in `beforeEach`, especially where the mock is shared via
`vi.hoisted` or lives on a prototype (all instances of a `vi.fn()`-constructed class share it).

## Tests — a test that passes the moment you write it deserves suspicion (2026-07-28)
Two pulse-starvation suites were written, passed immediately, and were VACUOUS — they passed against
the broken implementation too. Two independent reasons, both non-obvious:

- **A lone probe cannot starve.** The poller under test was the only caller, so it opened every
  burst window itself and was always served. The competing fast poller is the *mechanism*, not
  scenery.
- **Phase is relative.** Starting the poller alongside the anchor and then advancing the clock moves
  both grids together, so no offset is ever created.

The mutation check is what caught both. Corollary observed the same day: writing a genuinely missing
test found a real bug three times — a rotation cursor advancing by 1 while serving 10, an
off-by-one in a cache cap, and a startup tick silently dropped by a refactor.

## This repo — "a value the code produces that nothing reads" is a recurring bug class (2026-07-28)
Four instances found in one session, all of which type-check and all of which fail silently:
- `contentType` never passed to `isNotAHumanReply` — half the bounce guard was dead its whole life.
- `threadSubject` never passed in `index.ts` — in the very fix written to close the previous one.
- The `sendFollowUp` result never inspected — it resolves `{ success: false }` rather than throwing,
  so the UI reported success on a failed send.
- `AppErrorCode.AUTH_EXPIRED` checked in the UI and thrown by nothing.

Worth grepping for deliberately: an exported argument, option or result field with no reader.

## Reviewers — verify the PREMISE you hand them, not just the finding they return (2026-07-28)
Two premises given to the scraper reviewer were wrong: that tenants could collide on a shared
profile directory (the slug is per tenant — the real collision was same-tenant), and that the idle
gate starved it by phase-locking with its own interval (the real mechanism was the burst window).
A wrong premise costs the reviewer's time and can steer it away from the actual defect.

Separately: one reported finding — `clearAuth()` wiping `ysxflow_settings` — was accurately
described but **intentional and security-motivated** (that key holds OAuth tokens under one unscoped
name). "Fixing" it would have reintroduced a cross-tenant credential leak. An accurate description
is not the same as a defect.
