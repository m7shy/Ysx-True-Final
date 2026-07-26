# Decision log

## 2026-07-25 — Full CRM deep review: agy unusable, fell back to Claude Agent tool on Opus
- User asked for the review to run on Opus 4.6 (falling back to Gemini 3.1 Pro on high traffic), i.e. via `agy`.
- `agy` is installed and on PATH, and `agy models` lists both `claude-opus-4-6-thinking` and `gemini-3.1-pro-high`.
- Every `agy -p` call fails at the eligibility gate: *"Your current account is not eligible for Antigravity. Verify your account to continue."* — reproduced on both models, with and without `--add-dir`/`--dangerously-skip-permissions`. This is an **account/auth block requiring the user to sign in via browser**, not a transient capacity failure, so §5.16's retry-then-fall-back logic doesn't apply; retrying is pointless.
- Decision: per §5.6, fell back to the Claude `Agent` tool at **Opus** tier (§3a "high-stakes QA/review"), not Sonnet — the user explicitly asked for a strong model on a security-relevant review.
- Consequence to revisit: if the user verifies the Antigravity account, a future pass could be re-run on Gemini 3.1 Pro for an independent second opinion, which has real value on a security review (different model = different blind spots).

### Update, same session: user fixed the agy account gate
`agy` verified working on `gemini-3.1-pro-high` mid-review. Units 1-4 had already completed on Claude Opus by then and were NOT re-run — re-running them would cost a full second review for no new information, since their findings were already verified against source by hand. The open opportunity is the *cross-check* pass described above (Gemini re-reviewing the same code independently), which is additive rather than duplicative. Not launched: the user asked to halt after the in-flight agents finish, so this needs their go-ahead.

## 2026-07-26 — HANDOFF next-steps 1–4: `agy` on Sonnet 4.6, per the user's explicit choice
- User chose "delegate to agy, I verify" over doing it inline, and "commit only, no deploy".
- Tier: `claude-sonnet-4-6`, not Opus — `known-failures.md` records Opus 4.6 hitting both a
  quota gate and silent rc=0 no-ops last session, and §5.16 says stop chasing a tier that has
  shown a failure pattern. Sonnet was the right call: it produced real work on retry.
- **Rejected the handoff's own prescription for `Receipt.number`.** HANDOFF next-step 3 said to
  add `@@unique` on `Receipt.number`. Reading the code first showed that would be a
  multi-tenancy bug — numbers are per-tenant, so `RCPT-0001` legitimately recurs per tenant and
  the second tenant to be paid would fail permanently. Added `userId` + `@@unique([userId, number])`
  instead, mirroring `Invoice`. A worker handed the handoff text verbatim would have shipped the bug.
- **Rejected the handoff's framing of next-step 4 too**: it called for "a small schema/token-format
  change". Neither is needed — binding the target into a domain-separated HMAC leaves both the
  schema and the URL shape untouched.
- Decided a **clean break** on legacy click tokens (no back-compat fallback) after probing prod:
  1 campaign recipient and 2 CLICKED events in all of history. A fallback would have preserved the
  exact hole the change closes, for ~2 historical clicks.
- Changed `withUniqueRetry` from `instanceof PrismaClientKnownRequestError` to a code-based check.
  This repo resolves `@prisma/client` from **two** node_modules trees (root and `server/`), and an
  error raised through one copy is not an instanceof the class imported from the other — so
  instanceof alone can silently fail to catch a genuine P2002 in production.
- Modelled rollback in the test fake's `$transaction` (it previously had none, by explicit design).
  Without it the mark-paid retry test would have passed against broken behaviour, since the retry's
  correctness depends entirely on the failed attempt un-claiming the invoice's PAID status.

## 2026-07-25 — Review split into 6 units rather than one pass
- 28.5k lines does not fit one useful context. Split by subsystem boundary so each worker gets a coherent, self-contained slice, with the two "new code" units (portal backend, portal SPA) weighted heaviest.
- §5.17 (25KB prompt chunking) did not apply — the Agent tool workers read files themselves rather than having source pasted into the prompt.
