# Cost ledger (append-only)

Per orchestrate skill §5.1. Token figures are rough estimates — `agy` does not report
usage, so these are order-of-magnitude only, not billing data.

## 2026-07-26 — HANDOFF next-steps 1–4

| # | Task | Model | Outcome | Est. cost |
|---|---|---|---|---|
| 1 | SendPulse SPF include research | `gemini-3.1-pro-high` | Usable. Answer correct but cited only a generic KB root; verified independently against live DNS, which also surfaced a second include it never mentioned | ~5k out |
| 2 | Receipt unique constraint (attempt 1) | `claude-sonnet-4-6` | **Wasted** — silent rc=0 no-op, 443 bytes narration, zero edits | ~2k out |
| 3 | Receipt unique constraint (retry) | `claude-sonnet-4-6` | Partial. Correct schema + migration; shipped a `TS1308` compile error, skipped `prisma generate`, wrote a test that asserted the wrong value and never exercised the retry, and never wrote its report file | ~25k out |
| 4 | Click-token target binding | `claude-sonnet-4-6` | see session notes | ~25k out |

**Rework done by hand after #3** (roughly as much effort as the delegation saved): fixed the
non-async arrow, ran `prisma generate` and discovered the root-vs-server client split, swapped
`instanceof` for a code-based P2002 check, added rollback to the test fake's `$transaction`,
and rewrote all three retry tests to be order-independent and to actually fail without the fix.

**Honest read on delegation value for this session:** for changes this small and this
high-blast-radius, delegation did not clearly pay for itself. The schema/migration scaffolding
was genuinely useful; everything downstream of it needed correcting by hand, and the
verification burden was identical either way. §5.14's "do-it-yourself floor" arguably applied
here and was overridden by an explicit user preference for delegation — which is a fine reason,
but worth recording so the tradeoff is visible next time rather than re-litigated from scratch.
