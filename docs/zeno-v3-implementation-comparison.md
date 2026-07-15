# Zeno v3 implementation comparison

**Analysis date:** 2026-07-15
**Analysis branch:** `codex/zeno-v3-transformation-analysis`
**Common base:** `9a3d7255065371a043b392fc1bdbe186bfa93a33` (`main`)
**Candidates:** `zeno-v3-opus`, `origin/zeno-v3-fable`, `codex/zeno-v3-transformation-507b`

## Executive decision

**Use `origin/zeno-v3-fable` as the Zeno v3 integration base. Do not merge it unchanged.**

Fable is the best overall implementation because it combines:

- the cleanest and most consistent architecture;
- the largest current deterministic verification ring;
- the strongest Git/process audit trail;
- the most recent real-funnel debugging and behavioral hardening;
- prompt-cost telemetry and phase-scoped prompt improvements absent from the other final tips.

The recommendation is conditional because all three candidates share a **critical verified-identity claim-and-merge vulnerability**, and Fable still has transaction, idempotency, payment-concurrency, and migration blockers. Those issues must be fixed before merging to `main`.

The best final Zeno v3 result is therefore not a blind branch merge. It is:

1. Fable as the base;
2. Opus's handler-rollback pattern ported into Fable;
3. Codex's fresh-database migration discipline reproduced for Fable;
4. the common identity-ownership design replaced before release.

## Ranking

The scores are a decision aid, not a statistical measurement. Correctness and security receive the highest weight because Zeno handles identity, health answers, payments, policies, and GDPR data.

| Criterion | Weight | Fable | Opus 4.8 | Codex |
|---|---:|---:|---:|---:|
| Correctness and security | 35 | 22 | 19 | 14 |
| Architecture and maintainability | 15 | 14 | 14 | 13 |
| Tests and behavioral evidence | 20 | 19 | 19 | 18 |
| Plan fidelity and completeness | 15 | 14 | 15 | 13 |
| Deployment and migrations | 10 | 4 | 3 | 9 |
| Process and auditability | 5 | 5 | 4 | 3 |
| **Total** | **100** | **78** | **74** | **70** |

**Final order:** Fable first, Opus second, Codex third.

## Candidate snapshot

| Candidate | Tip | Commits after base | Changed files | Test files in tree | Spec scenarios registered | Migration SQL files |
|---|---|---:|---:|---:|---:|---:|
| Opus 4.8 | `0e265bb` | 435 | 579 | 279 | 28/61 | 8 legacy |
| Fable | `533ddd6` | 314 | 594 | 289 | 21/61 | 8 legacy + 2 later additions |
| Codex | `845e8a6` | 205 | 566 | 276 | 18/61 | 23 v3 migrations |

Fable's insertion count is inflated by large recorded conversation fixtures, so raw lines of code were not used as a quality signal.

## Verification performed

### Current Fable tip — independently reproduced

The current consolidated Fable tip was exported into a fresh temporary checkout and tested against a disposable PostgreSQL 16 database.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | pass |
| Unit project | 191 files, **1,172/1,172 tests passed** |
| Integration project | 92 files, **281/281 tests passed** |
| Deterministic total | **1,453/1,453 tests passed** |
| Fresh schema via `prisma db push` | pass |
| Seed on fresh schema | pass |

The integration run emitted repeated `pg` deprecation warnings: `client.query()` was called while the same client was already executing a query. They did not fail this run, but should be fixed before the project upgrades to pg 9.

Fable's latest checked-in live-simulation report also records an initial stochastic happy-path failure followed by **3/3 passing full-funnel reruns**. That report is honest about a remaining model behavior: the agent can occasionally cancel a newly issued quote and loop while reopening the application (`origin/zeno-v3-fable:docs/debug-reports/2026-07-09-cmrd5qmh00001400ei34wcvzk.md`).

### Opus and Codex exact tips

Both tips are unchanged since the earlier clean-database gate captured in analysis commit `5e83a87` on `origin/claude/zeno-v3-model-analysis-s2p62x`.

| Candidate | TypeScript | Unit/integration evidence | Total green |
|---|---|---|---:|
| Opus | pass | 1,045 unit + 270 integration | **1,315** |
| Codex | pass | combined ring | **1,170** |

Those runs used per-branch PostgreSQL databases. Opus required schema push, seed work, committed index scripts, and manual reconstruction of two indexes. Codex successfully used its checked-in baseline plus v3 migration chain on an empty database.

No paid live-LLM simulation was rerun for this report. Existing recorded live-simulation evidence was inspected, while deterministic tests and code paths were used for the ranking.

## Critical issue shared by all three branches

### Unverified contact mirrors can become account owners

All three implementations mirror a merely declared email or phone onto `Customer`, then later treat the row holding that mirror as the canonical owner during a verified claim.

Representative Fable path:

- declared values are mirrored at `origin/zeno-v3-fable:lib/customer/profile-service.ts:22` and `:41`;
- after the current shell proves control of the target, owner lookup uses only `Customer.email`/`Customer.phone` at `origin/zeno-v3-fable:lib/customer/verification-service.ts:141`;
- the just-verified shell is merged into that mirror holder at `:150`;
- conversations, applications, quotes, policies, and payments are repointed in `origin/zeno-v3-fable:lib/customer/claim-merge.ts:23`.

The equivalent paths exist in:

- Opus: `lib/customer/profile-service.ts:55`, `lib/customer/verification-service.ts:117`;
- Codex: `lib/customer/profile-service.ts:50`, `lib/customer/verification-service.ts:58` and `:256`.

Concrete attack:

1. Attacker creates anonymous customer A and declares the victim's email or phone. A receives the mutable mirror without proving control.
2. Victim creates customer B, receives the real OTP/link, and legitimately verifies that same target.
3. The verified-claim code finds A by the mirror and treats A as canonical.
4. B's live records are repointed to A. The attacker still controls A's session and gains the victim's newly attached insurance data.

This is a release blocker for every branch. A mutable profile mirror cannot be an identity-ownership registry.

Required design:

- create a unique normalized verified-channel identity record, or require consumed verification evidence on the canonical owner;
- claim by verified identity, never by `Customer.email`/`Customer.phone` alone;
- add an integration test in which an attacker pre-declares the victim's target, the victim verifies it, and the attacker must not become canonical;
- ensure both OTP and magic-link paths use the same safe ownership rule.

## Why Fable wins

### 1. Best current architecture

Fable consistently separates pure business rules from database adapters:

- declarative exposure and legality live in `lib/engines/derive-and-expose.ts`;
- eligibility, suitability, quote, payment, policy, consent, and consequence decisions live in focused pure modules;
- database access is isolated in named loaders, stores, services, and appliers;
- commits pass through one gateway with an in-transaction advisory-lock recheck;
- commit and read retry policies are clearly separated.

Its gateway is substantially smaller and easier to audit than Opus's while preserving the key pinned ordering. Type discipline is strong, and the branch contains very little dead legacy surface.

### 2. Strongest current verification picture

Fable now has the largest current deterministic suite: **1,453 passing tests**, independently reproduced for this report. It includes negative endpoint tests, real-database gateway and money tests, concurrency coverage, spec traceability, diagnostic checks, prompt-assembly tests, and recorded-behavior assertions.

Opus maps more Gherkin scenarios directly—28 versus Fable's 21—and that traceability harness is worth porting. Fable compensates with newer production-readiness tests and diagnostics from the sales and autonomy consolidation.

### 3. Best iteration after the original transformation

The 84 commits added after the older Fable comparison snapshot materially improve the candidate:

- field re-ask and verification-endgame hardening;
- structured tool-failure signals and loop diagnostics;
- DNT card and questionnaire behavior fixes;
- aborted-turn persistence;
- real OpenAI/Anthropic cache-usage telemetry;
- phase-scoped prompt sections and lower application-phase prompt cost;
- prompt-cost reporting and quality-signal scoring;
- current full-funnel diagnosis and reruns.

This is valuable for Zeno because the application is not only a rules engine; it is an LLM-driven funnel whose production quality depends on feedback loops and behavioral diagnostics.

### 4. Best process record

Fable's commits most consistently explain why a change exists, reference the relevant plan decision, and record verification. Its consolidation notes openly document schema drift, flaky simulation behavior, and operational steps. This is the easiest history for the Zeno team to maintain and audit.

## Fable blockers before merge

### P0 — fix verified identity ownership

Replace mirror-based ownership as described in the shared critical finding above.

### P0 — make commit failures atomic

Fable handlers commonly catch exceptions and return `{ success: false }`, for example `origin/zeno-v3-fable:lib/tools/handlers/quote-handlers.ts:250`. The gateway then writes the rejected envelope and returns normally inside the same transaction at `origin/zeno-v3-fable:lib/tools/gateway.ts:302` and `:379`.

If a handler writes partially and then returns failure, those partial writes can commit with the rejection ledger row.

Port the Opus `HandlerRejection` design:

- convert handler failures and unexpected throws into a sentinel exception;
- roll back the entire apply transaction;
- write the rejection audit row in a separate transaction;
- add a negative integration test whose handler writes once and then fails, asserting zero domain writes and exactly one rejected ledger row.

### P0 — serialize payment sessions by schedule or installment

The gateway lock is keyed by conversation (`origin/zeno-v3-fable:lib/tools/gateway.ts:307`), but payment lookup can fall back to the latest customer schedule (`lib/tools/handlers/payment-handlers.ts:25` and `:40`). Two conversations for one customer can therefore take different locks, observe no pending attempt, and each create a provider intent and `Payment` row (`:140` and `:148`).

Fix with both:

- a lock scoped to the schedule/installment or customer for money commits;
- a database uniqueness rule preventing more than one open payment attempt per installment;
- a true concurrent two-conversation integration test.

### P1 — scope replay identities to aggregate instances

`write_question_answer` and `modify_answer` use `app_answer:<questionCode>` without the application id at `origin/zeno-v3-fable:lib/tools/gateway.ts:92`. Re-answering the same value in a later application in the same conversation can replay an old envelope and skip the new write.

Include `application.id` in the target reference and test cancel/reapply/re-answer with the same value.

`acknowledge_disclosures` also has constant material arguments per quote. If a new disclosure version is published after the first acknowledgement, a later call can replay the old envelope instead of acknowledging the new version. Include the required disclosure-version set in the replay identity or mark the operation state-guarded.

### P1 — make resumed provider sessions usable

Fable returns `clientSecret: null` and `redirectUrl: null` when resuming an open payment attempt (`origin/zeno-v3-fable:lib/tools/handlers/payment-handlers.ts:115`). The Stripe UI always mounts `<Elements>` with `clientSecret` (`components/chat/rich/payment-card.tsx:323`). A returning customer therefore cannot resume a real Stripe session.

Persist/retrieve the provider resume credential or create a provider-specific resume operation. Add Stripe and PayU negative/positive tests; mock-provider success is insufficient.

### P1 — author deployable migrations

Fable's own consolidation note states that its heavy schema changes rely on `prisma db push` and that the cloud/Fable/sales line authored no corresponding migration files (`origin/zeno-v3-fable:docs/superpowers/notes/2026-07-07-fable-branch-consolidation-plan.md:42`). Only two later telemetry/prompt migrations were added.

The first committed legacy migration starts by altering an assumed existing `Agent` table, so the history is not a fresh baseline. Before merge:

- create a reviewed catch-up/baseline migration strategy;
- prove `prisma migrate deploy` from an empty database;
- prove upgrade from the current production/main schema with representative data;
- prove required partial unique indexes exist after migration;
- stop using `db push` as the production deployment mechanism.

### P1 — complete payment reconciliation inputs

Fable compares `Payment.amountMinor` with `Installment.amountMinor` in settlement (`origin/zeno-v3-fable:lib/payments/settlement.ts:107`). Both values originate inside Zeno, while the live provider event does not supply the captured amount. The check cannot detect a provider-side partial or wrong-amount capture.

Extract provider-reported amount/currency, pass them into `SettlementEvent`, and test mismatched Stripe and PayU events.

### P2 — harden late-funnel behavior

The latest live report documents occasional unsolicited cancellation of a newly issued quote followed by repeated `set_application` calls. Add an engine/business guard requiring explicit customer change/cancel intent, or a deterministic loop breaker that escalates after repeated no-op reopen attempts.

### P2 — remove pg 9 incompatibility warnings

The fresh integration run repeatedly warned that `client.query()` was called while already executing a query. Locate and serialize or use separate client flows before upgrading `pg`.

## Opus assessment

### Strengths

- Strongest A1/A2 adversarial correctness in the gateway.
- Only candidate with a robust rollback sentinel for handler-declared and thrown failures (`zeno-v3-opus:lib/tools/gateway.ts:46` and `:718`).
- Excellent pure-engine layering and strong code comments explaining plan errata.
- Best direct Gherkin mapping: 28/61 scenarios, with an anti-gaming traceability and backlog ratchet.
- 1,315 deterministic tests passed at the exact current tip.
- Extensive post-plan live debugging of DNT and chat races.

### Why it is second

Opus shares the critical identity takeover. It also contains material branch-specific defects:

- application-answer replay keys omit application identity (`lib/tools/gateway.ts:220`);
- settlement treats every inbox insert exception as replay (`lib/payments/settlement.ts:70`), so a transient database error can acknowledge a captured payment without applying it;
- resumed Stripe payments return an empty client secret;
- the declared ID-document-before-payment requirement is not enforced by the production exposure path;
- the gateway is large and duplicates logic across funnel/operator paths;
- schema deployment relies on `db push`, index scripts, and manually recreated partial indexes rather than a production migration chain.

Opus contains the single most valuable pattern to port—the `HandlerRejection` rollback design—but moving all of Fable's newer funnel, telemetry, and diagnostic work onto Opus would cost more and carry more regression risk than porting that focused pattern into Fable.

## Codex assessment

### Strengths

- Best database delivery story by a wide margin: a baseline plus 22 incremental v3 migrations, independently demonstrated on an empty database.
- Strong pure-engine modularity and type discipline.
- Excellent gateway/idempotency tests, including concurrency and exact-envelope assertions.
- Good test-database safety guard against truncating non-test databases.
- 1,170 deterministic tests passed at the exact current tip.

### Why it is third

Codex shares the critical identity takeover and has the largest set of serious correctness deviations:

- replay finds the earliest historical identical args and uses instance-unscoped target references (`lib/tools/gateway.ts:65` and `:234`), so legitimate repeat-value operations can be swallowed; this can leave a payment schedule unchanged while returning a stale success envelope;
- `generate_quote` is deliberately non-replayable despite the pinned spec requiring original-envelope replay (`lib/tools/gateway.ts:46`);
- terminal policies are loaded customer-wide without a status filter, keeping customers in POLICY and blocking later sales (`lib/engines/snapshot-loader.ts:261`);
- claim-and-merge does not remap the active session to the canonical customer, causing post-verification customer mismatches;
- GDPR erasure can leave quoted applications' health answers and verification targets behind;
- PayU webhook statuses other than `COMPLETED` become sticky failures (`lib/payments/providers/payu.ts:257`);
- live webhook paths do not provide provider-captured amount to reconciliation;
- required identity documents are declared but not enforced;
- provider refund calls execute inside the database transaction, enabling external/DB state divergence after rollback;
- `DomainSnapshot.answers` is empty in production even though eligibility derivation reads it.

Codex's migrations should be used as a quality reference, but its runtime branch needs more high-risk repair than Fable or Opus.

## Recommended integration sequence

Every runtime change below must follow TDD: write the failing test first, then implement the fix.

1. Branch from current `origin/zeno-v3-fable` into a protected integration branch.
2. Fix verified-channel ownership and add the pre-claimed-target takeover test.
3. Port the Opus rollback sentinel and add partial-write failure tests.
4. Add application-scoped replay ids and disclosure-version replay coverage.
5. Add schedule/instalment-scoped locking plus the two-conversation concurrent payment test.
6. Fix provider resume credentials and provider-reported amount reconciliation.
7. Build and review Fable's production migration/baseline path, borrowing Codex's structure rather than copying SQL blindly.
8. Verify all new/changed endpoints retain auth guards, tenant scoping, DTO/input validation, and at least one 400/403 negative test.
9. Run `tsc`, the complete unit and integration suite, migration tests from empty and from the main schema, and the pathology scripts.
10. Run at least 10 happy-path live simulations and require no deterministic errors; separately report stochastic model behavior rather than hiding reruns.

## Merge recommendation

**Approve Fable as the integration base. Block its merge to `main` until the P0 and P1 items above are complete and verified.**

Do not merge all three branches together. Their architectures overlap, and their shared identity flaw would survive a mechanical consolidation. Port only the proven patterns and tests that improve the selected base.
