# Fable v3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 9 findings from `docs/zeno-v3-implementation-comparison.md` (analysis branch) on a hardening branch cut from `origin/zeno-v3-fable` (533ddd6), so the Fable implementation can merge to `main`.

**Architecture:** All fixes follow Fable's existing layering — pure rules in `lib/engines/`, DB access in loaders/services, one commit gateway. The one imported pattern is Opus's `HandlerRejection` rollback sentinel, adapted to Fable's smaller gateway with a `keepWrites` escape for the deliberate `quoteDecision` audit write. Every task is TDD: failing test → smallest fix → green → commit.

**Tech Stack:** Next.js 16 / Prisma 7.5 / PostgreSQL 16 / Vitest 4 (unit + serialized real-DB integration ring).

**Verification databases:** integration ring → `zeno_test` (5435); migration tests → disposable `zeno_mig_*` databases created/dropped by script; sims → NEW `zeno_fable_sim` DB (never touch the `zeno` dev DB — it holds other branches' dev data).

**Validated corrections to the report** (from code inspection, must be honored):
1. `generateQuote` deliberately writes a `quoteDecision` audit fact and then returns `{success:false}` (T7.D4). Rollback-on-rejection must NOT erase it → `ToolResult.keepWrites` escape.
2. The payment race is reached via two conversations sharing one application (resume/binding), not via the customer fallback (legality blocks that). Test fixture: two conversations, same `activeApplicationId`.
3. `set_application` is ONE_SHOT on `application:none` → after cancel_quote, an identical re-open REPLAYS a stale envelope and creates nothing (the real mechanic of the 40× loop). Fix by making it state-guarded (REPLAY_EXEMPT), like `open_dnt_session`.
4. `__tests__/integration/channel-verification-commits.test.ts:32` currently asserts the VULNERABLE identity merge; it must be rewritten as a negative test.
5. Unexpected non-infra handler throws currently rethrow with NO ledger row (audit gap) — the sentinel path must also catch those.

---

### Task 1: Handler-rejection atomicity (P0-2)

**Files:**
- Modify: `lib/tools/gateway.ts` (runApplyTransaction + new sentinel)
- Modify: `lib/tools/types.ts` (ToolResult.keepWrites)
- Modify: `lib/tools/handlers/quote-handlers.ts` (generateQuote decision-audit returns get `keepWrites: true`)
- Test: `__tests__/integration/handler-rejection-atomicity.test.ts`

- [ ] Write failing integration test: register a scratch operator-gated commit tool whose handler writes a `CustomerInsight` row then (a) returns `{success:false}`, (b) throws. Assert: zero insight rows, exactly one `CommitLedger` row (`outcome: 'rejected'`, `idempotencyDisposition: 'fresh'`), safe envelope returned. Third case: handler returns `{success:false, keepWrites: true}` → insight row SURVIVES + rejected ledger row.
- [ ] Run test → FAIL (insight row committed today).
- [ ] Implement `HandlerRejection` sentinel in gateway (carries envelope + phaseFrom + targetRef + argsHash); throw it on `!handlerResult.success && !handlerResult.keepWrites`; wrap `handler(...)` so non-infra throws become the sentinel too (Timeout/CircuitOpen still rethrow to `toUnavailable`); catch OUTSIDE `prisma.$transaction`, write the rejection ledger row via the global client, return the envelope.
- [ ] Add `keepWrites?: boolean` to ToolResult with a doc comment; set it on generateQuote's post-audit `{success:false}` returns.
- [ ] Run new test + `gateway*`, `generate-quote-commit`, `handler-tx` integration files → PASS.
- [ ] Commit: `fix(gateway): roll back partial handler writes on rejection (HandlerRejection sentinel)`

### Task 2: Identity ownership takeover (P0-1)

**Files:**
- Modify: `lib/customer/verification-service.ts` (applyVerifiedClaim, issueChallenge target normalization)
- Modify: `__tests__/integration/channel-verification-commits.test.ts` (invert vulnerable assertion)
- Test: `__tests__/integration/identity-ownership.test.ts`

- [ ] Write failing tests: (1) attacker pre-declares victim's email → victim verifies (confirmByCode) + applyVerifiedClaim → `merged === false`, victim keeps own customer, attacker's mirror CLEARED, victim's Customer.email = target; (2) legit returning customer (prior CONSUMED challenge on account A) → new shell verifying same target merges INTO A; (3) same attack via confirmByLinkToken → same negative result; (4) concurrency: two shells verify same never-verified target in parallel → no merge into declared holder, deterministic mirrors, then a third shell merges into the EARLIEST verifier.
- [ ] Run → FAIL (today: victim merged into attacker).
- [ ] Implement: normalize targets at issue time (email lowercase/trim, phone strip `[\s-]`); owner lookup = customer ≠ self, unmerged/unerased, holding a CONSUMED `VerificationChallenge` for (channel, normalized target), earliest `consumedAt` wins; merge only into such an owner. When only declared mirror-holders exist: clear their mirror column(s), set the verifier's mirror, never merge. Wrap non-tx path in `prisma.$transaction`.
- [ ] Rewrite the vulnerable assertion in channel-verification-commits.test.ts as the negative expectation.
- [ ] Run identity/claim/channel/auth-verify integration files → PASS.
- [ ] Commit: `fix(identity): ownership by consumed verification evidence only — declared mirrors never absorb a verifier`

### Task 3: Replay scoping to aggregate instances (P1-4)

**Files:**
- Modify: `lib/tools/gateway.ts` (resolveTargetRef; ONE_SHOT/REPLAY_EXEMPT membership)
- Test: `__tests__/integration/replay-instance-scoping.test.ts`

- [ ] Write failing tests: (a) app1 → answer Q=V → cancel quote (pointer nulled, app frozen/cancelled) → `set_application` again MUST create a NEW application (not replay) → answer Q=V again MUST be a fresh applied write on app2; (b) acknowledge_disclosures on v1 → publish doc v2 → acknowledge again MUST ack v2 fresh (not replay) and unblock accept_quote.
- [ ] Run → FAIL (replayed envelopes).
- [ ] Implement: `app_answer:${state.application?.id ?? 'none'}:${questionCode}` for write_question_answer/modify_answer; move `set_application` from ONE_SHOT to REPLAY_EXEMPT (state-guarded — legality already blocks it while an application is bound); add `acknowledge_disclosures` to REPLAY_EXEMPT (handler is naturally idempotent per missing-docs set + DB unique belt).
- [ ] Run new test + gateway-idempotency + set-application + acknowledge-disclosures files → PASS.
- [ ] Commit: `fix(gateway): replay identities scoped to application instance; set_application + acknowledge_disclosures state-guarded`

### Task 4: Duplicate payment sessions (P0-3)

**Files:**
- Modify: `lib/tools/gateway.ts` (customer-scoped advisory lock for money commits)
- Modify: `prisma/seeds/index.ts` (+ partial unique `Payment_one_open_per_installment`)
- Modify: `__tests__/helpers/test-db.ts` (ensure the index exists for the ring)
- Test: `__tests__/integration/payment-concurrency.test.ts`

- [ ] Write failing test: one customer, one accepted quote + schedule, TWO conversations pointing at the same application; `Promise.all` two `ensure_payment_session` executeCommits → assert exactly ONE `PENDING` Payment for the installment, one result `mode:'started'`, the other `'resumed'`. Also: direct second `payment.create` with status PENDING for same installment throws P2002.
- [ ] Run → FAIL (two PENDING rows today).
- [ ] Implement: `MONEY_TOOLS = {ensure_payment_session, change_payment_option, accept_quote}`; in `runApplyTransaction`, after the conversation lock, `SELECT pg_advisory_xact_lock(hashtext('customer:' || customerId))` for money tools (constant lock order → no deadlock). Add `CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_open_per_installment" ON "Payment"("installmentId") WHERE status = 'PENDING'` to the seed bootstrap (migration lands in Task 9).
- [ ] Run new test + ensure-payment-session + change-payment-option files → PASS.
- [ ] Commit: `fix(payments): customer-scoped lock for money commits + partial unique one open attempt per installment`

### Task 5: Resumed payment sessions usable (P1-5)

**Files:**
- Modify: `lib/payments/types.ts` (PaymentProvider.retrievePaymentIntent)
- Modify: `lib/payments/providers/stripe.ts`, `payu.ts`, `mock.ts`
- Modify: `lib/tools/handlers/payment-handlers.ts` (persist create-time credentials in Payment.metadata; resume via provider retrieve; unusable → supersede + fresh)
- Create: `lib/payments/card-state.ts` (pure card view-state resolver)
- Modify: `components/chat/rich/payment-card.tsx` (guard null credentials via resolver)
- Test: `__tests__/integration/payment-resume.test.ts`, `__tests__/lib/payments/card-state.test.ts`, `__tests__/lib/payments/providers.test.ts` (extend)

- [ ] Write failing tests: backend — resume of a fresh open attempt returns non-null clientSecret in `uiAction.payload` (mock provider); unusable open attempt (provider says not usable) → superseded + fresh intent; frontend — `resolvePaymentCardState` returns 'unavailable' for stripe+null secret and payu+null redirect, provider forms otherwise (new/resumed/expired/unusable session shapes).
- [ ] Run → FAIL.
- [ ] Implement provider interface + three providers (stripe: paymentIntents.retrieve, usable = requires_payment_method|requires_confirmation|requires_action|processing; payu: order status + metadata fallback for redirect; mock: always usable). Handler: metadata `{clientSecret, redirectUrl}` persisted at create; resume branch calls retrieve, falls back to metadata, supersedes when unusable. Component renders explicit error/retry state on 'unavailable' instead of mounting `<Elements>`.
- [ ] Run payment integration + unit files → PASS.
- [ ] Commit: `fix(payments): resumed sessions carry live provider credentials; unusable intents supersede; card guards null secrets`

### Task 6: Provider settlement validation (P1-6)

**Files:**
- Modify: `lib/payments/types.ts` (WebhookEvent.amountMinor/currency), providers (extract), `lib/payments/settlement.ts` (SettlementEvent.providerAmountMinor/providerCurrency + compare), webhook routes (pass through)
- Test: `__tests__/integration/settlement-provider-amounts.test.ts`, extend provider unit tests, `__tests__/integration/webhook-routes.test.ts` (bad signature → 400)

- [ ] Write failing tests: valid settlement (matching provider amount → no anomaly), amount mismatch → exactly one `amount_mismatch` ALERT_FLAG carrying provider-reported values (duplicated webhook does NOT double it, disposition replay), currency mismatch → `currency_mismatch` anomaly, Stripe/PayU mapping extracts amount+currency, webhook route with bad signature → 400.
- [ ] Run → FAIL.
- [ ] Implement: providers surface `amount_received`/`amount` + `currency` (Stripe) and `totalAmount` + `currencyCode` (PayU); routes thread them into `settlePaymentEvent`; settlement compares provider-reported vs `payment.amountMinor`/`payment.currency`, flags once, settlement proceeds (existing operator-reconciles policy).
- [ ] Run settlement + provider + route tests → PASS.
- [ ] Commit: `fix(settlement): compare provider-reported amount/currency, not two internal copies`

### Task 7: cancel_quote customer-intent guard (P2-8)

**Files:**
- Modify: `lib/engines/domain-types.ts` (REASON_CODES + `customer_intent_required`; DomainSnapshot.lastCustomerMessageAt)
- Modify: `lib/engines/snapshot-loader.ts` (load latest customer message timestamp)
- Modify: `lib/engines/derive-and-expose.ts` (cancel_quote rule + ENGINE_VERSION bump)
- Test: `__tests__/integration/cancel-quote-intent.test.ts` (+ fixture fixes in existing cancel-quote tests)

- [ ] Write failing test: issued quote, latest customer message BEFORE quote.createdAt → cancel_quote rejected `customer_intent_required`; insert customer message after issuance → exposed → confirm-token two-step → applied. (Deterministic reproduction of the 2026-07-09 self-cancel loop entry.)
- [ ] Run → FAIL (cancel currently applies).
- [ ] Implement snapshot fact + pure rule: cancel_quote exposed only when a customer message exists after `quote.createdAt`; blockedReason `customer_intent_required` explains recovery. Fix existing cancel-quote test fixtures to insert a customer message where they legitimately cancel.
- [ ] Run engine unit tests + cancel-quote integration files → PASS.
- [ ] Commit: `fix(engine): cancel_quote requires customer intent after issuance — kills the self-cancel loop entry`

### Task 8: pg concurrent-query serialization (P2-9)

**Files:**
- Modify: `lib/customer/claim-merge.ts` (two `Promise.all` on one tx client → sequential) + any other sites the audit finds
- Test: extend `__tests__/integration/claim-merge.test.ts` (process warning listener)

- [ ] Write failing check: run `claimAndMerge` under a `process.on('warning')` / console capture asserting no "already executing a query" warning (validate the capture actually catches it first).
- [ ] Serialize the flagged sites (sequential awaits inside transactions).
- [ ] Full integration ring run output contains zero such warnings.
- [ ] Commit: `fix(db): serialize same-transaction queries (pg concurrent-query warnings)`

### Task 9: Production migration chain (P1-7)

**Files:**
- Create: `prisma/migrations/20260401000000_base_init/migration.sql` (idempotent pre-chain base schema — generated from the parent commit of the first legacy migration, transformed to IF NOT EXISTS / guarded DO blocks)
- Create: `prisma/migrations/20260715000000_v3_catchup/migration.sql` (`prisma migrate diff --from-migrations → schema.prisma` + the 5 partial unique indexes + drops of dead Workflow/SkillPack tables)
- Create: `scripts/verify-migrations.ts` (fresh-deploy + upgrade-from-main against disposable DBs)
- Modify: `README.md` (migrate deploy is now real)

- [ ] Generate base_init from `git show 10ebd109^:prisma/schema.prisma` via `migrate diff --from-empty`, make idempotent (CREATE TABLE/INDEX IF NOT EXISTS; enums + FKs in exception-guarded DO blocks).
- [ ] Generate v3_catchup via `migrate diff --from-migrations --to-schema-datamodel` (shadow DB), append partial uniques, review drops.
- [ ] Write `scripts/verify-migrations.ts`: (1) fresh empty disposable DB → `migrate deploy` → `migrate diff --from-url` says "No difference" → seed OK → 5 partial indexes present → drop DB; (2) main-representative disposable DB (main schema via db push from `git show main:prisma/schema.prisma`, representative rows inserted, main's 8 migrations marked applied) → `migrate deploy` → diff empty, rows survive, workflow tables gone → drop DB. Non-zero exit on any failure.
- [ ] Run the script → PASS both scenarios.
- [ ] Commit: `feat(migrations): deployable chain (idempotent base init + v3 catch-up + partial uniques) with fresh/upgrade verification`

### Task 10: Full verification battery + docs

- [ ] `npx tsc --noEmit` → clean.
- [ ] `npx vitest run --project unit` / `--project integration` / full `npx vitest run` → record exact counts (baseline: 1172 unit / 281 integration / 1453 total).
- [ ] `npm run lint`, `npm run build`.
- [ ] All 15 deterministic verify scripts on `zeno_fable_sim` (fresh DB via migrate deploy + seed — doubles as a live test of Task 9's chain).
- [ ] `scripts/verify-migrations.ts` (again, final chain).
- [ ] Live sims (OpenAI+Anthropic keys in .env): `run-spec-sims.ts 3 2` (all 6 scenarios) + `run-spec-sims.ts 10 8 --only happy-path` (≥10 happy-path trials; report pass rate; deterministic errors are blockers, stochastic model behavior is reported separately).
- [ ] Write `docs/superpowers/notes/2026-07-15-fable-v3-hardening-verification.md` with exact counts + evidence.
- [ ] Commit docs.

### Task 11: Merge + cleanup (per user instructions)

- [ ] Push `codex/fable-v3-hardening`.
- [ ] `git switch main` && `git pull --ff-only origin main` → merge `--no-ff` hardening branch.
- [ ] Rerun full verification on merged main (tsc, full vitest, verify-migrations, spec sims smoke).
- [ ] Push main; confirm merge commit on origin/main (no CI exists — verified: no .github/workflows).
- [ ] Remove the CLEAN 507b worktree (`git worktree remove`), delete `zeno-v3-opus` + `codex/zeno-v3-transformation-507b` locally and on origin. Preserve `zeno-v3-fable` + `codex/zeno-v3-transformation-analysis`.
