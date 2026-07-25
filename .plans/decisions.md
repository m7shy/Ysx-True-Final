# Decision log

## 2026-07-25 — Full CRM deep review: agy unusable, fell back to Claude Agent tool on Opus
- User asked for the review to run on Opus 4.6 (falling back to Gemini 3.1 Pro on high traffic), i.e. via `agy`.
- `agy` is installed and on PATH, and `agy models` lists both `claude-opus-4-6-thinking` and `gemini-3.1-pro-high`.
- Every `agy -p` call fails at the eligibility gate: *"Your current account is not eligible for Antigravity. Verify your account to continue."* — reproduced on both models, with and without `--add-dir`/`--dangerously-skip-permissions`. This is an **account/auth block requiring the user to sign in via browser**, not a transient capacity failure, so §5.16's retry-then-fall-back logic doesn't apply; retrying is pointless.
- Decision: per §5.6, fell back to the Claude `Agent` tool at **Opus** tier (§3a "high-stakes QA/review"), not Sonnet — the user explicitly asked for a strong model on a security-relevant review.
- Consequence to revisit: if the user verifies the Antigravity account, a future pass could be re-run on Gemini 3.1 Pro for an independent second opinion, which has real value on a security review (different model = different blind spots).

### Update, same session: user fixed the agy account gate
`agy` verified working on `gemini-3.1-pro-high` mid-review. Units 1-4 had already completed on Claude Opus by then and were NOT re-run — re-running them would cost a full second review for no new information, since their findings were already verified against source by hand. The open opportunity is the *cross-check* pass described above (Gemini re-reviewing the same code independently), which is additive rather than duplicative. Not launched: the user asked to halt after the in-flight agents finish, so this needs their go-ahead.

## 2026-07-25 — Review split into 6 units rather than one pass
- 28.5k lines does not fit one useful context. Split by subsystem boundary so each worker gets a coherent, self-contained slice, with the two "new code" units (portal backend, portal SPA) weighted heaviest.
- §5.17 (25KB prompt chunking) did not apply — the Agent tool workers read files themselves rather than having source pasted into the prompt.
