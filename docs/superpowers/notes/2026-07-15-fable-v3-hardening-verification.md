# Fable v3 hardening — verification record (2026-07-15)

Branch: `codex/fable-v3-hardening` (cut from `origin/zeno-v3-fable` @ `533ddd60`).
Plan: `docs/superpowers/plans/2026-07-15-fable-v3-hardening.md`.
Source findings: `codex/zeno-v3-transformation-analysis:docs/zeno-v3-implementation-comparison.md`.

All nine comparison-report findings were first re-validated against the tip
(all still present), then fixed TDD (failing test → smallest fix → green),
one logical change per commit.

## Findings → fix (commit)

| # | Sev | Finding | Fix | Commit |
|---|-----|---------|-----|--------|
| 1 | P0 | Unverified contact mirror becomes account owner | Ownership only from consumed verification evidence; declared mirror never absorbs a verifier; targets normalized; both OTP + magic-link | `66ccd179` |
| 2 | P0 | Handler failure commits partial writes | `HandlerRejection` sentinel rolls back the apply tx; reject ledgered in a separate tx; `keepWrites` for deliberate audit writes | `20232efe` |
| 3 | P0 | Duplicate payment sessions across conversations | Customer-scoped advisory lock for money commits + partial unique `Payment_one_open_per_installment` | `587c0dfb` |
| 4 | P1 | Replay ids under-scoped | `app_answer:<appId>:<code>`; `set_application` + `acknowledge_disclosures` state-guarded (REPLAY_EXEMPT) | `735dae8a` |
| 5 | P1 | Resumed payment sessions return null secret | `retrievePaymentIntent` + persisted credential; `resolvePaymentCardState` guards the card; external-cancel reordered | `22bca8f8` |
| 6 | P1 | Settlement compares internal copies | Provider-reported amount+currency threaded through webhooks → settlement; amount/currency mismatch flagged once | `22402c30` |
| 7 | P1 | No deployable migration chain | baseline_main + v3_upgrade chain; `scripts/verify-migrations.ts` proves fresh + upgrade on disposable DBs | `9c433e8b` |
| 8 | P2 | Fresh-quote self-cancel loop | `cancel_quote` gated on `customer_intent_required` (customer message after issuance) | `eda1d7ba` |
| 9 | P2 | pg concurrent-query warnings | App-level Promise.all-on-tx serialized (claim-merge, resume_application); residual is Prisma-adapter-internal include parallelism | `62a38a93` |

Plus `93383f02` (hoist `AmountSummary` — removes the lint error the P1-5 change would have extended).

## Deterministic test totals (branch tip)

| Suite | Baseline (533ddd6) | After hardening |
|-------|--------------------|-----------------|
| `npx tsc --noEmit` | pass | **pass** |
| Unit (`--project unit`) | 191 files / 1172 | **193 files / 1183** |
| Integration (`--project integration`) | 92 files / 281 | **101 files / 305** |
| Deterministic total | 1453 | **1488** |

New tests added by the hardening (all red-before, green-after):
handler-rejection-atomicity (3), identity-ownership (5), replay-scoping unit (3)
+ replay-instance-scoping (3), payment-concurrency (2), card-state unit (6) +
payment-resume (3), settlement-provider-amounts (4) + webhook-routes (1),
cancel-quote-intent (2), tx-no-concurrent-query (1); plus updated existing tests
(channel-verification, acknowledge-disclosures, cancel-quote-commit).

## Migration evidence — `scripts/verify-migrations.ts` (disposable DBs)

`ALL MIGRATION CHECKS PASSED`:
- **[1] fresh empty DB → `migrate deploy`**: all 23 spot-checked v3 tables present,
  5 retired workflow/skill-pack tables absent, zero structural drift vs
  schema.prisma, seed OK, all 5 partial unique indexes present, catalog seeded.
- **[2] main-schema DB + representative durable data → baseline resolved-applied
  → `migrate deploy`**: retired tables dropped, PaymentSchedule created,
  customer/product(insuranceType cast)/conversation rows preserved, zero drift.
- Re-proved end-to-end by provisioning the disposable `zeno_fable_sim` database
  via `migrate deploy` + `prisma/seeds/index.ts` (used for the live sims).

## Lint / build

- `npx eslint` on every changed **source** file: clean (0 errors). payment-card
  went from 3 pre-existing `react-hooks/static-components` errors to 0.
- Repo-wide eslint still reports ~50 PRE-EXISTING errors in untouched files
  (no CI gate exists on this branch); none introduced by the hardening.

## Deterministic verify scripts (against disposable `zeno_fable_sim`)

- `verify-identity-flow` — PASS (exercises the P0-1 identity path).
- `verify-gateway-concurrency` — PASS (concurrent GUI+agent commit applied once).
- `verify-migrations` — PASS (both scenarios).
- `verify-quote-lifecycle`, `verify-payment-ops`, `verify-customer-ssot` — FAIL at
  fixture setup on `value_not_grounded`. Pre-existing and unrelated to the
  hardening: these scripts write scripted DNT answers through an UN-actored
  context, which the pre-existing grounding guard (`lib/tools/handlers/grounding-guard.ts`,
  last modified before this branch's tip, untouched by any hardening commit)
  rejects on a fresh DB; the integration fixtures correctly use `actor: 'gui'`.
  The authoritative behavioral gate is the full vitest integration ring (green).

## Live simulations (against disposable `zeno_fable_sim`, OpenAI+Anthropic keys)

Harness: `scripts/sims/run-spec-sims.ts` (in-process `handleChatTurn`, no dev server).

- **Spec battery — 6/6 scenarios PASS (18/18 trials, 3 each):** happy-path,
  dnt-card-flow, dnt-typed-flow, verification-typed-code, dnt-refusal,
  quote-decline.
- **Happy-path stress — 8/10 PASS** (threshold 6). The two failures are
  `goal_not_reached` (stochastic late-funnel): trial 6 an email-verification
  `repeated_assistant_message` loop; trial 7 a customer-message-then-cancel that
  never re-reached ACCEPTED. Both are the pre-existing ~1-in-4 fragility the
  2026-07-09 report documented (baseline passed 3/3 on rerun); 8/10 is at/above
  that baseline.
- The deterministic diagnoser (`diagnose-conversation.ts`) on a failed happy-path
  export reports **0 error / 0 engine-handler findings** — every finding is
  LLM-behavior class (`repeated_assistant_message` warnings). No code regression.
- The P2-8 guard behaved as designed: the reported SAME-TURN self-cancel (a
  `cancel_quote` with no customer message between `generate_quote` and the
  cancel) is now blocked (`customer_intent_required`); trial 7's cancel followed
  a customer message that legitimately unlocked it. Reported honestly, not
  hidden by reruns.

Conclusion: no behavioral regression from the hardening; residual happy-path
failures are stochastic model behavior at/above the documented baseline.

## Residual risks / follow-ups

- pg `client.query()` deprecation still emitted from the Prisma pg-adapter's
  internal parallel `include` loading inside interactive transactions (framework
  behavior, non-failing; resolved by the pg@9 / adapter upgrade the warning gates).
- A main→v3 in-place upgrade requires DRAINING in-flight funnel data (Answer,
  Payment) — those tables were redesigned (conversation→application scope;
  flat→installment) and have no source rows in the main model. Durable
  customer/policy/quote data and the (cast) product catalog are preserved.
- Opus's Gherkin traceability harness (28 mapped scenarios) remains worth porting
  (out of scope for this hardening).
