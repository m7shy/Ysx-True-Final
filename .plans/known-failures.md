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

## This repo — multiple checkouts, easy to review the wrong one
Six YSXXS checkouts have existed on this VM. **Prod is `C:\Users\banjigum1\Desktop\YT-Scraper\YSXXS`** (confirm via `nssm get ysx-backend AppDirectory`). The working copy is `C:\Users\banjigum1\Documents\YSXXS\YSXXS` (has a `THIS-IS-NOT-PROD.md` marker). Always pin the absolute path in delegated prompts and explicitly forbid the others.

## Delegated review output has been wrong before (skill §5.18)
A prior delegated review in this project produced ~100 findings, two of which were confidently stated and factually wrong (one from misreading loop iteration order, one an overstated claim about API behaviour). Spot-check every HIGH before relaying; never paste a findings list through unverified.
