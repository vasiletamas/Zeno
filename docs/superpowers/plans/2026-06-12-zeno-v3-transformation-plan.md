# Zeno v3 Transformation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Zeno's sales funnel around a deterministic engine — "talk is free, commits are constrained": one pure `deriveAndExpose` function computes phase + exposed/blocked actions every turn; every state change goes through a commit gateway returning a typed consequence envelope; the agent, the GUI, and operators are three clients of the same engine (the swap test).

**Architecture:** 26 work packages in 6 blocks. Block A lands the spine (pinned vocabulary, `deriveAndExpose` decision core, commit gateway + ledger, orchestrator integration, prompt-sections rework, dead-config cleanup). Block B lands the customer foundation (CustomerProfile SSOT with per-field provenance, ConsentEvent ledger, customer-scoped DNT aggregate, passwordless identity + document verification, application lifecycle with `select_coverage`). Block C lands the decision engines (dependency/consequence planner, canonical eligibility, suitability). Block D lands money + policy (quote lifecycle with disclosures, the coupled policy-creation flip, payment operations, policy machine + refunds). Block E lands content/operator/GDPR/re-engagement surfaces. Block F lands verification (BDD harness, observability completion, spec fold-back, triage tooling LAST, final validation).

**Tech Stack:** Next.js + TypeScript, Prisma/Postgres (PrismaPg adapter, client generated to `lib/generated/prisma`), Vitest (`__tests__/**/*.test.ts`, `@` alias), Stripe/PayU/Mock payment providers, scripts via `npx tsx`.

**Binding sources:** the discussion agenda `docs/superpowers/notes/2026-06-11-zeno-transformation-discussion-agenda.md` — its "Resolved decisions (running log)" section overrides everything; this plan implements it. All customer data is DEMO data: destructive migrations + reseed, no backfills.

---

## How to execute this plan

1. **Precedence:** Package errata > task text. Addendum tasks are binding tasks. The agenda resolution log outranks both if a conflict is ever found — stop and flag it.
2. **TDD, no exceptions:** every behavior task starts with a failing test (superpowers:test-driven-development). "Build succeeds" is never verification. Run the full suite at the end of every package; the only tolerated failure is the documented `instrumentation.test.ts` flake when it is the sole failure.
3. **Execution order:** follow the order table below. A package may start only when its dependencies are complete.
4. **Plan-wide void rule:** any bullet in Blocks B–F that edits `lib/chat/default-tools.ts`, `prisma/seeds/seed-skill-packs.ts`, or `prisma/seeds/seed-workflows.ts` is VOID — those files are deleted in Block A.
5. **Line anchors are indicative** (verified at drafting time, may drift): re-verify with Grep before editing.
6. **Canonical test-DB helper:** `__tests__/helpers/test-db.ts`, created in package A2 (addendum). Every other path mentioned for it in task text refers to this one file. Integration tests point `DATABASE_URL` at the test database via the vitest integration config so `@/lib/db` and tests share one client (kills the split-brain the Block E verifier found); the helper uses the PrismaPg adapter exactly like `lib/db.ts` (never the `datasources` constructor option).
7. **Ownership rulings (apply across packages):** ConsentEvent + the whole consent-truth flip (model, `sign_dnt` capture fold, capture-tool retirement, snapshot-loader switch, Customer column drops) belong to **B1** in one package — A2 bullets creating ConsentEvent or dropping consent columns are void. `ApplicationStatus` is owned by **B4** with the ratified set `OPEN/PAUSED/REFERRED/COMPLETED/CANCELLED` (no DECLINED; underwriter reject = CANCELLED + reason `underwriting_rejected`). The Answer re-key `(questionId, applicationId)` is owned by **B4**; C1 keys its active-revision partial unique on `applicationId` (C1 bullets keying on `conversationId` are void). The questionnaire tool surface (`get_next_question`, `write_question_answer`, `modify_answer`) is owned by **C1**, which also retires `save_application_answer`/`set_answer`. The suitability report at quote issuance is owned by **D4** (C3 report bullets void). E2 lands BEFORE D1: its referral-resolution side defines `resolve_referral` against the WorkItem model; the referred-producer wiring lands in D1; the reject-path customer notification dispatch lands in E4.
8. **No new code against old phase names** (`SELECTION/CONSENT/QUESTIONNAIRE/CLOSING` as phases are dead after A1).
9. **i18n cross-cutting (M6):** the engine emits stable snake_case ReasonCodes + params, never prose; all new authored customer-facing fields are bilingual `{ro, en}`.
10. **Legal/compliance flags carried by this plan** (config + confirmation, never hardcoded assertions): free-look anchor/window, retention durations per data class, RO-mandatory document list, suitability rule content.

## Execution order

| # | Package | Depends on |
|---|---------|------------|
| 1 | **A1** — A1 (ATOMIC) — Pinned vocabulary, DomainSnapshot loader, deriveAndExpose core, retirement of both old phase vocabularies | — |
| 2 | **A2** — A2 — CommitResult envelope, commit gateway (#8 order), CommitLedger, confirm tokens, idempotent replay, M10 outcomes (consent-truth flip moved to B1 per ruling 7) | A1 |
| 3 | **A3** — A3 — Orchestrator exposure integration, executor hard-reject, GUI gateway parity (M4), identity-requirements mechanism, DEFAULT_DISCOVERY_TOOLS retired | A1, A2 |
| 4 | **A4** — A4 — Prompt sections rework per (phase, subphase) with M13 acceptance criteria | A1, A3 |
| 5 | **A5** — A5 — Dead-config cleanup: Workflow* machine, SkillPack subsystem (M12, salvage first), registry drift | A3, A4 |
| 6 | **B0** — CustomerProfile SSOT: per-field provenance store + ONE service + claim-and-merge (M1) | A1 |
| 7 | **B1** — ConsentEvent ledger: derived consent state, withdraw_consent, engine halt rule, sign_dnt capture fold | A2, B0 |
| 8 | **B2** — DNT aggregate: Dnt/DntSession/DntAnswer, pinned 6-tool surface, customer-scoped validity | A2, B0, B1 |
| 9 | **E2** — WorkItem operator queue: persisted escalations, referral resolution through the gateway, admin queue UI (M5) | A2, B0 |
| 10 | **B3** — Identity: one challenge primitive, claim-and-merge on verify, identity-requirements rows, document pipeline | A3, B0, B1, E2 |
| 11 | **B4** — Application lifecycle: customer-scoped applications, set_application/select_coverage, status machine, resume + prefill-as-proposals | A3, B0, B2, B3 |
| 12 | **C1** — Dependency graph + consequence planner/applier | A2, B2, B4 |
| 13 | **C2** — Canonical eligibility module (one rule source, three evaluation points) | A1, C1 |
| 14 | **C3** — Suitability engine (demands-and-needs, M7) | A1, B2, C2 |
| 15 | **D1** — Quote lifecycle: typed generate_quote decision, freeze-at-issue, cancel_quote, lazy expiry | A2, B4, C1, C2, C3, E2 |
| 16 | **D2** — THE COUPLED FLIP: disclosures + narrow accept + PaymentSchedule + webhook inbox + policy-at-first-payment + conversation terminality | A3, B1, B3, D1 |
| 17 | **D3** — Payment operations: get_payment_status, ensure_payment_session, change_payment_option | D2 |
| 18 | **D4** — Policy machine + post-sale: transition table, operator commits, free-look cancellation with refunds, get_policy_info, document retiming | D2, E2 |
| 19 | **E1** — Product data: derived pricing_examples, eligibility_bounds, versioned ProductContent, protect content migration (T11) | A5, C2 |
| 20 | **E3** — GDPR: retention-policy module, operator-approved erasure, delete-data route alignment, data-access export (M3) | B0, E2 |
| 21 | **E4** — Customer-scoped reads + re-engagement v1: get_customer_profile on B0, get_open_items, proactive outbound job (M2) | B0, B1, B3, D4, E2 |
| 22 | **F1** — BDD harness: gherkin traceability meta-suite, scenario translation, agent assertion layer | D4, E4 |
| 23 | **F2** — Observability completion: per-turn legality snapshots, recompute-and-diff replay, invariant monitors, compliance evidence views, ConversationExport v2 | F1 |
| 24 | **F3** — Spec fold-back: apply every logged amendment to zeno_tool_catalog.md + zeno_workflow.feature, delete duplicate copies | F1 |
| 25 | **F4** — Conversation triage tooling (LAST): pure diagnostics catalog + diagnose-conversation CLI + Claude Code skill + runbook | F2 |
| 26 | **F5** — Final validation: full gauntlet over the finished system | F4 |

> Dependency normalization: this table is authoritative. `depends_on` values inside package JSON (e.g. "B-identity") are superseded; four drafting-time cycles (B4↔C1, D1↔E2, C3→D2→D1→C3, B3→E2→D1→C3→D2→B3) were broken by the ownership rulings above and this ordering.

---

# BLOCK A — Architecture spine

## Block overview

Block A builds the architecture spine everything else imports: (A1, atomic per contradiction #10) the pinned 5-phase/3-subphase vocabulary in one types module, a DomainSnapshot loader, and the single pure deriveAndExpose(snapshot) decision core that replaces BOTH old vocabularies (lib/chat/derive-state.ts 6-phase and lib/chat/phase.ts 3-phase, incl. the compliance keying at orchestrator.ts:651); (A2) the CommitResult envelope + commit gateway implementing the pinned #8 order (actor → replay-first → legality → confirm token → validation → transactional apply + CommitLedger row → post-derive), with per-conversation advisory locks, HMAC state-fingerprint confirm tokens, ledger-based idempotent replay, M10 unavailable/pending semantics, and the ConsentEvent ledger as sole consent truth; (A3) orchestrator integration — per-turn tool list = deriveAndExpose.available (killing the static DEFAULT_DISCOVERY_TOOLS list), executor hard-reject of non-exposed tools, blocked_actions injected into the prompt, re-derivation after every commit round, action-adapter full gateway parity with actor='gui' (M4), and the identity-requirements table MECHANISM (rows land in Block B); (A4) the per-(phase,subphase) prompt-sections rework with M13's acceptance criteria as literal tasks (inventory before, mapping doc, retired-because-X notes, pathology scripts green before AND after); (A5) dead-config cleanup after A3/A4 — Workflow*/WorkflowSession machinery, the SkillPack subsystem (M12, salvage-audit first), phantom seed tools, ALWAYS_ALLOWED drift, and the stale '25 TOOLS' banner. KNOWN LIVE REGRESSION FIXED BY CONSTRUCTION: since commit ce1b27d the agent sees only the static 10-tool DEFAULT_DISCOVERY_TOOLS list (orchestrator.ts:417, recommendedSlugs=[] at :597, tools built once at :789-794), so sign_dnt/start_application/generate_quote/accept_quote are unreachable in the standard chat path — A3 makes exposure engine-computed per turn and per commit round, which is the structural fix. Contradiction #11's orchestrator COMPLETED-guard removal is deliberately NOT in this block (it lands with the narrow-accept package in the quote block, per the log); A1's PAYMENT/POLICY predicates are written target-correct and become reachable when that lands. Demo-data rules applied throughout: destructive migrations + reseed, no backfills, no tolerant readers for historical TurnDebug phase strings (history is disposable per M9).

## Package A1: A1 (ATOMIC) — Pinned vocabulary, DomainSnapshot loader, deriveAndExpose core, retirement of both old phase vocabularies

**Execution slot:** 1 | **Depends on:** —

**Goal:** One types module owns the pinned Phase/AppSubphase/CommitOutcome/CommitEffect/ReasonCode/IdentityTier vocabulary; one pure function deriveAndExpose(snapshot) computes phase+subphase (contradiction #10 predicate table) and exposure (full-snapshot predicates per #12, nextBestAction names only available actions); a thin loader maps today's DB into the target DomainSnapshot shape; lib/chat/derive-state.ts and lib/chat/phase.ts are deleted, compliance is re-keyed off the new Phase, all pinned tests are migrated, and a taxonomy-closure meta-test (enum closure + no-second-vocabulary scan) lands with the enum. No new code is ever authored against old phase names.

**Migrations / seeds:**
- No schema migration in A1 (pure code + loader over the existing schema).
- prisma/seeds/seed-agents.ts: sweep Agent.systemPrompt/constraints prose for retired phase names (SELECTION/CONSENT/QUESTIONNAIRE/CLOSING as phase labels); re-run npx tsx scripts/reseed-agents.ts after the sweep.

### Task A1.1: Pinned domain types module + enum-closure meta-test seed
**Files:**
- Create: lib/engines/domain-types.ts
- Test: __tests__/lib/engines/domain-types.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { PHASES, APP_SUBPHASES, IDENTITY_TIERS, COMMIT_OUTCOMES, COMMIT_EFFECTS, REASON_CODES } from '@/lib/engines/domain-types'

describe('pinned vocabulary closure (taxonomy-closure seed)', () => {
  it('Phase is exactly the 5 pinned values in funnel order', () => {
    expect([...PHASES]).toEqual(['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'])
  })
  it('AppSubphase is exactly the 3 pinned values', () => {
    expect([...APP_SUBPHASES]).toEqual(['DNT', 'QUESTIONNAIRE', 'QUOTE_GENERATION'])
  })
  it('CommitOutcome is exactly the 9 pinned values', () => {
    expect([...COMMIT_OUTCOMES]).toEqual(['applied', 'rejected', 'referred', 'pending', 'unavailable', 'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures'])
  })
  it('CommitEffect is exactly the 7 pinned values', () => {
    expect([...COMMIT_EFFECTS]).toEqual(['advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand', 'questions_removed', 'eligibility_recheck', 'terminal'])
  })
  it('IdentityTier is exactly the 3 pinned values', () => {
    expect([...IDENTITY_TIERS]).toEqual(['anonymous', 'declared', 'verified_channel'])
  })
  it('every ReasonCode is stable snake_case (M6: engine never emits prose)', () => {
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/domain-types.test.ts` — fails with "Cannot find module '@/lib/engines/domain-types'".
- [ ] Step 3: Minimal implementation — lib/engines/domain-types.ts (the ONLY module allowed to declare phase/envelope vocabulary; everyone imports from here):
```ts
export const PHASES = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const
export type Phase = (typeof PHASES)[number]
export const APP_SUBPHASES = ['DNT', 'QUESTIONNAIRE', 'QUOTE_GENERATION'] as const
export type AppSubphase = (typeof APP_SUBPHASES)[number]
export const IDENTITY_TIERS = ['anonymous', 'declared', 'verified_channel'] as const
export type IdentityTier = (typeof IDENTITY_TIERS)[number]
export const COMMIT_OUTCOMES = ['applied', 'rejected', 'referred', 'pending', 'unavailable', 'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures'] as const
export type CommitOutcome = (typeof COMMIT_OUTCOMES)[number]
export const COMMIT_EFFECTS = ['advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand', 'questions_removed', 'eligibility_recheck', 'terminal'] as const
export type CommitEffect = (typeof COMMIT_EFFECTS)[number]
export const REASON_CODES = ['no_product_in_focus', 'no_open_application', 'application_already_open', 'application_paused', 'requires_consent', 'dnt_not_signed', 'dnt_incomplete', 'dnt_expired', 'questionnaire_incomplete', 'selection_incomplete', 'quote_already_issued', 'no_issued_quote', 'quote_expired', 'quote_already_accepted', 'requires_confirmation', 'requires_identity', 'requires_disclosures', 'already_applied', 'stale_confirm_token', 'invalid_args', 'handler_rejected', 'temporarily_unavailable', 'degraded_mode', 'no_policy', 'payment_not_pending', 'permission_denied', 'not_exposed'] as const
export type ReasonCode = (typeof REASON_CODES)[number]

export type CommitActor = 'agent' | 'gui' | 'system' | 'operator'
export type Provenance = 'declared' | 'verified' | 'conflict'

export interface DomainSnapshot {
  conversationId: string
  customerId: string
  product: { id: string; code: string; insuranceType: string } | null // committed > candidate
  candidateProductId: string | null
  identity: { tier: IdentityTier; fields: Record<string, { provenance: Provenance } | undefined> }
  consents: { gdprProcessing: boolean; aiDisclosure: boolean; marketing: boolean } // from ConsentEvent once A2.8 lands
  dnt: { signed: boolean; valid: boolean; validUntil: string | null; coversProductTypes: string[]; answeredCount: number; totalCount: number; sessionActive: boolean }
  application: { id: string; status: 'OPEN' | 'PAUSED' | 'COMPLETED'; tier: string | null; level: string | null; addon: boolean | null; answeredCount: number; requiredCount: number; missingCodes: string[] } | null
  quote: { id: string; status: string; premiumAnnual: number; validUntil: string; expired: boolean } | null // issued, unaccepted
  acceptedQuote: { id: string; acceptedAt: string | null } | null
  schedule: { exists: boolean; settled: boolean; nextDueAt: string | null; lastPaymentStatus: string | null } // Block D re-points; loader stubs exists:false
  policy: { id: string; status: string } | null
  eligibility: { verdict: 'eligible' | 'ineligible' | 'unknown' } // engine lands per contradiction #9 (other block)
  suitability: { verdict: 'suitable' | 'conditionally_suitable' | 'unsuitable' | 'unknown' } // M7 (other block)
  openItems: Array<{ kind: string; refId: string }>
  circuit: { openTools: string[] } // M10 input to exposure
  answers: Record<string, string>
}

export interface DerivedStateV3 {
  phase: Phase
  subphase: AppSubphase | null
  product: DomainSnapshot['product']
  selection: { tier: string | null; level: string | null; addon: boolean | null }
  identity: DomainSnapshot['identity']
  consents: DomainSnapshot['consents']
  dnt: DomainSnapshot['dnt']
  application: DomainSnapshot['application']
  quote: DomainSnapshot['quote']
  schedule: DomainSnapshot['schedule']
  policy: DomainSnapshot['policy']
  eligibility: DomainSnapshot['eligibility']
  suitability: DomainSnapshot['suitability']
  openItems: DomainSnapshot['openItems']
  nextBestAction: string // MUST only name actions present in ExposedActions.available
}

export interface BlockedAction { action: string; reason: ReasonCode; params?: Record<string, unknown> }
export interface ExposedActions { available: string[]; blocked: BlockedAction[] }
export interface DeriveAndExposeResult { state: DerivedStateV3; actions: ExposedActions }

export interface CommitResult {
  outcome: CommitOutcome
  reason?: ReasonCode
  effects: CommitEffect[]
  phaseDelta?: { from: Phase; to: Phase }
  data?: unknown
  confirmToken?: string
  needs?: string[]
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/engines/domain-types.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): pinned phase/envelope vocabulary module + enum-closure meta-test (A1.1)"`

### Task A1.2: DomainSnapshot loader + real-test-DB harness
**Files:**
- Create: lib/engines/snapshot-loader.ts
- Create: __tests__/integration/helpers/test-db.ts
- Test: __tests__/integration/snapshot-loader.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (real test DB per T12.D3 — truncate+seed, NO mocked prisma):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'

describe.skipIf(!process.env.DATABASE_URL)('loadDomainSnapshot (integration)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('maps a fresh anonymous conversation to the empty target snapshot', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
    const snap = await loadDomainSnapshot(conv.id)
    expect(snap.product?.code).toBe(product.code)
    expect(snap.identity.tier).toBe('anonymous')
    expect(snap.application).toBeNull()
    expect(snap.quote).toBeNull()
    expect(snap.policy).toBeNull()
    expect(snap.schedule.exists).toBe(false)
    expect(snap.dnt.signed).toBe(false)
  })

  it('derives dnt.valid=false when dntValidUntil is in the past (expired DNT bug fixed)', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id, dntSignedAt: new Date('2024-01-01'), dntValidUntil: new Date('2024-12-31') } })
    const snap = await loadDomainSnapshot(conv.id)
    expect(snap.dnt.signed).toBe(true)
    expect(snap.dnt.valid).toBe(false)
    expect(snap.identity.tier).toBe('declared')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/snapshot-loader.test.ts` — module not found.
- [ ] Step 3: Minimal implementation. Helper __tests__/integration/helpers/test-db.ts:
```ts
import { prisma } from '@/lib/db'
export async function resetFunnelTables(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Payment","Policy","Quote","Answer","Application","Message","ConversationSummary","TurnTrace","TurnDebug","Conversation","CustomerInsight","Customer" RESTART IDENTITY CASCADE')
}
export async function ensureTestProduct() {
  const existing = await prisma.product.findFirst({ where: { code: 'protect' } })
  if (existing) return existing
  return prisma.product.create({ data: { code: 'protect', name: { ro: 'Protect', en: 'Protect' }, description: { ro: '-', en: '-' }, insuranceType: 'LIFE', isActive: true } as never })
}
```
Loader lib/engines/snapshot-loader.ts — thin DB→snapshot mapping, accepts a client so the A2 gateway can pass a transaction handle:
```ts
import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import type { DomainSnapshot } from './domain-types'

type Db = typeof prisma

export async function loadDomainSnapshot(conversationId: string, db: Db = prisma): Promise<DomainSnapshot> {
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })
  const customer = await db.customer.findUniqueOrThrow({ where: { id: conversation.customerId } })
  const activeProductId = conversation.productId ?? conversation.candidateProductId ?? null
  const prod = activeProductId ? await db.product.findUnique({ where: { id: activeProductId } }) : null
  const application = await db.application.findUnique({ where: { conversationId } })
  // questionnaire completeness (reuses the question-group engine exactly like the old deriveState)
  let appState: DomainSnapshot['application'] = null
  if (application) {
    const groupCodes = (await resolveGroupCodes(application.productId, 'application')) ?? []
    const questions = groupCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: groupCodes } } }, select: { id: true, code: true } }) : []
    const answered = await db.answer.findMany({ where: { conversationId, questionId: { in: questions.map((q) => q.id) } }, select: { questionId: true } })
    const answeredIds = new Set(answered.map((a) => a.questionId))
    const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId } }) : null
    const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
    appState = {
      id: application.id, status: application.status as 'OPEN' | 'PAUSED' | 'COMPLETED',
      tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon,
      answeredCount: answeredIds.size, requiredCount: questions.length,
      missingCodes: questions.filter((q) => !answeredIds.has(q.id)).map((q) => q.code ?? q.id),
    }
  }
  // DNT facts (interim source: Conversation.dntSignedAt/dntValidUntil; Block B re-points to the Dnt aggregate behind this seam)
  const dntGroupCodes = prod ? ((await resolveGroupCodes(prod.id, 'dnt')) ?? []) : []
  const dntQuestions = dntGroupCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: dntGroupCodes } } }, select: { id: true } }) : []
  const dntAnswered = dntQuestions.length > 0 ? await db.answer.findMany({ where: { conversationId, questionId: { in: dntQuestions.map((q) => q.id) } }, select: { questionId: true } }) : []
  const dntValid = conversation.dntSignedAt != null && conversation.dntValidUntil != null && conversation.dntValidUntil.getTime() > Date.now()
  // quotes: issued (today: DRAFT, non-expired) and accepted
  const issued = application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'DRAFT' }, orderBy: { createdAt: 'desc' } }) : null
  const accepted = application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'ACCEPTED' } }) : null
  const policy = accepted ? await db.policy.findUnique({ where: { quoteId: accepted.id } }) : null
  return {
    conversationId, customerId: conversation.customerId,
    product: prod ? { id: prod.id, code: prod.code, insuranceType: prod.insuranceType } : null,
    candidateProductId: conversation.candidateProductId,
    identity: { tier: customer.isAnonymous ? 'anonymous' : 'declared', fields: {} }, // B0 provenance store replaces fields
    consents: { gdprProcessing: customer.gdprConsentAt != null, aiDisclosure: customer.aiDisclosureAcknowledgedAt != null, marketing: false }, // A2.8 flips source to ConsentEvent
    dnt: { signed: conversation.dntSignedAt != null, valid: dntValid, validUntil: conversation.dntValidUntil?.toISOString() ?? null, coversProductTypes: dntValid && prod ? [prod.insuranceType] : [], answeredCount: dntAnswered.length, totalCount: dntQuestions.length, sessionActive: conversation.dntSignedAt == null && dntAnswered.length > 0 && dntAnswered.length < dntQuestions.length },
    application: appState,
    quote: issued ? { id: issued.id, status: issued.status, premiumAnnual: issued.premiumAnnual, validUntil: issued.validUntil.toISOString(), expired: issued.validUntil.getTime() <= Date.now() } : null,
    acceptedQuote: accepted ? { id: accepted.id, acceptedAt: accepted.updatedAt.toISOString() } : null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null }, // Block D (PaymentSchedule) re-points
    policy: policy ? { id: policy.id, status: policy.status } : null,
    eligibility: { verdict: 'unknown' }, suitability: { verdict: 'unknown' },
    openItems: [], circuit: { openTools: [] }, // A2.7 wires circuit; M2 (Block B) wires openItems
    answers: {},
  }
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/snapshot-loader.test.ts` (requires DATABASE_URL pointing at the dev/test Postgres; run `npx prisma migrate deploy && npx tsx prisma/seeds/index.ts` first).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): DomainSnapshot loader + real-test-DB harness (A1.2)"`

### Task A1.3: derivePhase — the contradiction #10 predicate table as pure code
**Files:**
- Create: lib/engines/derive-and-expose.ts (derivePhase only in this task)
- Create: __tests__/lib/engines/snapshot-fixtures.ts
- Test: __tests__/lib/engines/derive-phase.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test from snapshot literals (pure seam per T12.D3 — no prisma anywhere):
```ts
import { describe, it, expect } from 'vitest'
import { derivePhase } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const openApp = { id: 'app-1', status: 'OPEN' as const, tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] }
const validDnt = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false }

describe('derivePhase — pinned #10 table', () => {
  it('DISCOVERY: no open application', () => {
    expect(derivePhase(makeSnapshot())).toEqual({ phase: 'DISCOVERY', subphase: null })
  })
  it('APPLICATION/DNT: open app + no valid DNT covering the product type', () => {
    expect(derivePhase(makeSnapshot({ application: openApp }))).toEqual({ phase: 'APPLICATION', subphase: 'DNT' })
  })
  it('APPLICATION/DNT also when the DNT is signed but expired', () => {
    const s = makeSnapshot({ application: openApp, dnt: { ...validDnt, valid: false, validUntil: '2024-01-01T00:00:00.000Z' } })
    expect(derivePhase(s)).toEqual({ phase: 'APPLICATION', subphase: 'DNT' })
  })
  it('APPLICATION/QUESTIONNAIRE: valid DNT + answers incomplete (valid-DNT returners skip DNT by predicate)', () => {
    expect(derivePhase(makeSnapshot({ application: openApp, dnt: validDnt }))).toEqual({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' })
  })
  it('APPLICATION/QUOTE_GENERATION: complete, no issued quote (selection incompleteness is NOT a subphase)', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    expect(derivePhase(makeSnapshot({ application: done, dnt: validDnt }))).toEqual({ phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' })
  })
  it('QUOTE: an issued, unexpired quote exists', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    const s = makeSnapshot({ application: done, dnt: validDnt, quote: { id: 'q1', status: 'DRAFT', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false } })
    expect(derivePhase(s)).toEqual({ phase: 'QUOTE', subphase: null })
  })
  it('expired issued quote falls back to QUOTE_GENERATION (regenerate-loop killed)', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    const s = makeSnapshot({ application: done, dnt: validDnt, quote: { id: 'q1', status: 'DRAFT', premiumAnnual: 500, validUntil: '2024-01-01T00:00:00.000Z', expired: true } })
    expect(derivePhase(s)).toEqual({ phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' })
  })
  it('PAYMENT: accepted quote + schedule exists, no Policy row', () => {
    const s = makeSnapshot({ acceptedQuote: { id: 'q1', acceptedAt: '2026-06-01T00:00:00.000Z' }, schedule: { exists: true, settled: false, nextDueAt: null, lastPaymentStatus: null } })
    expect(derivePhase(s)).toEqual({ phase: 'PAYMENT', subphase: null })
  })
  it('POLICY: a Policy row exists', () => {
    const s = makeSnapshot({ policy: { id: 'pol1', status: 'PENDING_SUBMISSION' } })
    expect(derivePhase(s)).toEqual({ phase: 'POLICY', subphase: null })
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/derive-phase.test.ts` — derivePhase not exported / fixtures missing.
- [ ] Step 3: Minimal implementation. Fixture factory __tests__/lib/engines/snapshot-fixtures.ts:
```ts
import type { DomainSnapshot } from '@/lib/engines/domain-types'
export function makeSnapshot(overrides: Partial<DomainSnapshot> = {}): DomainSnapshot {
  return {
    conversationId: 'conv-1', customerId: 'cust-1',
    product: { id: 'p1', code: 'protect', insuranceType: 'LIFE' }, candidateProductId: null,
    identity: { tier: 'anonymous', fields: {} },
    consents: { gdprProcessing: false, aiDisclosure: false, marketing: false },
    dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false },
    application: null, quote: null, acceptedQuote: null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null },
    policy: null, eligibility: { verdict: 'unknown' }, suitability: { verdict: 'unknown' },
    openItems: [], circuit: { openTools: [] }, answers: {},
    ...overrides,
  }
}
```
lib/engines/derive-and-expose.ts:
```ts
import type { DomainSnapshot, Phase, AppSubphase } from './domain-types'

export function derivePhase(s: DomainSnapshot): { phase: Phase; subphase: AppSubphase | null } {
  if (s.policy !== null) return { phase: 'POLICY', subphase: null }
  if (s.acceptedQuote !== null && s.schedule.exists) return { phase: 'PAYMENT', subphase: null }
  if (s.quote !== null && !s.quote.expired) return { phase: 'QUOTE', subphase: null }
  if (s.application !== null) {
    if (!s.dnt.valid) return { phase: 'APPLICATION', subphase: 'DNT' }
    if (s.application.missingCodes.length > 0) return { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }
    return { phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' }
  }
  return { phase: 'DISCOVERY', subphase: null }
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/engines/derive-phase.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): derivePhase predicates per contradiction #10 (A1.3)"`

### Task A1.4: deriveAndExpose — full-snapshot exposure predicates + nextBestAction invariant
**Files:**
- Modify: lib/engines/derive-and-expose.ts (add ACTION_RULES + deriveAndExpose)
- Test: __tests__/lib/engines/derive-and-expose.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (pure, snapshot literals):
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose, ACTION_RULES } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const validDnt = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false }
const doneApp = { id: 'app-1', status: 'COMPLETED' as const, tier: 'standard', level: 'l1', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [] }

describe('deriveAndExpose — exposure over the FULL snapshot (contradiction #12)', () => {
  it('escalate_to_human is ALWAYS available (exposure floor)', () => {
    expect(deriveAndExpose(makeSnapshot()).actions.available).toContain('escalate_to_human')
  })
  it('DISCOVERY: funnel commits are not available; accept_quote is blocked with no_issued_quote only when an application exists', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(r.actions.available).not.toContain('accept_quote')
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.available).toContain('list_products')
  })
  it('generate_quote blocked with requires_consent when questionnaire complete but GDPR missing', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt }))
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'requires_consent' }))
  })
  it('generate_quote available in APPLICATION/QUOTE_GENERATION with consent', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false } }))
    expect(r.actions.available).toContain('generate_quote')
  })
  it('sign_dnt blocked with dnt_incomplete while DNT answers are missing', () => {
    const s = makeSnapshot({ application: { ...doneApp, status: 'OPEN', missingCodes: ['Q1'] }, dnt: { ...validDnt, signed: false, valid: false, answeredCount: 2 } })
    const r = deriveAndExpose(s)
    expect(r.actions.available).not.toContain('sign_dnt')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'sign_dnt', reason: 'dnt_incomplete' }))
  })
  it('a circuit-open tool moves to blocked temporarily_unavailable (M10)', () => {
    const r = deriveAndExpose(makeSnapshot({ circuit: { openTools: ['list_products'] } }))
    expect(r.actions.available).not.toContain('list_products')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'list_products', reason: 'temporarily_unavailable' }))
  })
  it('INVARIANT: nextBestAction only names an available action', () => {
    for (const s of [makeSnapshot(), makeSnapshot({ application: doneApp, dnt: validDnt, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false } })]) {
      const r = deriveAndExpose(s)
      const m = r.state.nextBestAction.match(/call ([a-z_]+)/)
      if (m) expect(r.actions.available).toContain(m[1])
    }
  })
  it('every rule action is unique and kind-tagged', () => {
    const names = ACTION_RULES.map((r) => r.action)
    expect(new Set(names).size).toBe(names.length)
    for (const r of ACTION_RULES) expect(['read', 'commit']).toContain(r.kind)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/derive-and-expose.test.ts` — deriveAndExpose not exported.
- [ ] Step 3: Minimal implementation — append to lib/engines/derive-and-expose.ts (one row per action: condition + reason in one place; this is the whole machine on one screen):
```ts
import type { BlockedAction, DeriveAndExposeResult, DerivedStateV3, ReasonCode } from './domain-types'

type Derived = { phase: Phase; subphase: AppSubphase | null }
export interface ActionRule {
  action: string
  kind: 'read' | 'commit'
  exposedWhen: (s: DomainSnapshot, d: Derived) => boolean
  blockedReason?: (s: DomainSnapshot, d: Derived) => { reason: ReasonCode; params?: Record<string, unknown> } | null
}
const always = () => true

export const ACTION_RULES: ActionRule[] = [
  { action: 'list_products', kind: 'read', exposedWhen: always },
  { action: 'get_product_info', kind: 'read', exposedWhen: always },
  { action: 'compare_products', kind: 'read', exposedWhen: always },
  { action: 'preview_product_requirements', kind: 'read', exposedWhen: always },
  { action: 'get_current_state', kind: 'read', exposedWhen: always },
  { action: 'get_objection_strategy', kind: 'read', exposedWhen: always },
  { action: 'get_customer_profile', kind: 'read', exposedWhen: always },
  { action: 'check_dnt_status', kind: 'read', exposedWhen: (s) => s.product !== null || s.dnt.signed },
  { action: 'get_application_status', kind: 'read', exposedWhen: (s) => s.application !== null },
  { action: 'get_quote_details', kind: 'read', exposedWhen: (s) => s.quote !== null || s.acceptedQuote !== null },
  { action: 'escalate_to_human', kind: 'commit', exposedWhen: always },
  { action: 'set_candidate_product', kind: 'commit', exposedWhen: always },
  { action: 'switch_product', kind: 'commit', exposedWhen: (s) => s.product !== null },
  { action: 'update_customer_profile', kind: 'commit', exposedWhen: always },
  { action: 'collect_customer_field', kind: 'commit', exposedWhen: always },
  { action: 'record_gdpr_consent', kind: 'commit', exposedWhen: (s) => !s.consents.gdprProcessing },
  { action: 'acknowledge_ai_disclosure', kind: 'commit', exposedWhen: (s) => !s.consents.aiDisclosure },
  { action: 'start_dnt_questionnaire', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.valid && s.dnt.answeredCount < s.dnt.totalCount,
    blockedReason: (s) => (s.product === null ? { reason: 'no_product_in_focus' } : null) },
  { action: 'save_dnt_answer', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.signed && s.dnt.totalCount > 0 && s.dnt.answeredCount < s.dnt.totalCount },
  { action: 'sign_dnt', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.signed && s.dnt.totalCount > 0 && s.dnt.answeredCount >= s.dnt.totalCount,
    blockedReason: (s) => (s.product !== null && !s.dnt.signed && s.dnt.answeredCount < s.dnt.totalCount ? { reason: 'dnt_incomplete', params: { answered: s.dnt.answeredCount, total: s.dnt.totalCount } } : null) },
  { action: 'start_application', kind: 'commit', exposedWhen: (s) => s.product !== null && s.dnt.valid && s.application === null,
    blockedReason: (s) => (s.application !== null ? { reason: 'application_already_open' } : s.product !== null && !s.dnt.valid ? { reason: s.dnt.signed ? 'dnt_expired' : 'dnt_not_signed' } : null) },
  { action: 'save_application_answer', kind: 'commit', exposedWhen: (s) => s.application?.status === 'OPEN' && s.application.missingCodes.length > 0 },
  { action: 'set_answer', kind: 'commit', exposedWhen: (s) => s.application !== null },
  { action: 'change_selection', kind: 'commit', exposedWhen: (s) => s.application !== null },
  { action: 'resume_application', kind: 'commit', exposedWhen: (s) => s.application?.status === 'PAUSED' },
  { action: 'cancel_application', kind: 'commit', exposedWhen: (s) => s.application !== null && s.application.status !== 'COMPLETED' },
  { action: 'check_bd_eligibility', kind: 'commit', exposedWhen: (s) => s.application !== null && s.application.addon === true },
  { action: 'generate_quote', kind: 'commit', exposedWhen: (s, d) => d.phase === 'APPLICATION' && d.subphase === 'QUOTE_GENERATION' && s.consents.gdprProcessing,
    blockedReason: (s, d) => (d.subphase === 'QUOTE_GENERATION' && !s.consents.gdprProcessing ? { reason: 'requires_consent', params: { kind: 'gdpr_processing' } } : d.subphase === 'QUESTIONNAIRE' ? { reason: 'questionnaire_incomplete', params: { missing: s.application?.missingCodes.slice(0, 5) } } : d.phase === 'QUOTE' ? { reason: 'quote_already_issued' } : null) },
  { action: 'accept_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE',
    blockedReason: (s, d) => (d.phase === 'PAYMENT' || d.phase === 'POLICY' ? { reason: 'quote_already_accepted' } : s.application !== null && d.phase !== 'QUOTE' ? { reason: 'no_issued_quote' } : null) },
  { action: 'modify_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE' },
  { action: 'initiate_payment', kind: 'commit', exposedWhen: (s) => s.policy !== null && s.policy.status === 'PENDING_SUBMISSION' },
]

const NEXT_BEST_PRIORITY = ['initiate_payment', 'accept_quote', 'generate_quote', 'save_application_answer', 'sign_dnt', 'save_dnt_answer', 'start_dnt_questionnaire', 'start_application', 'set_candidate_product', 'list_products']

export function deriveAndExpose(s: DomainSnapshot): DeriveAndExposeResult {
  const d = derivePhase(s)
  const available: string[] = []
  const blocked: BlockedAction[] = []
  for (const rule of ACTION_RULES) {
    if (rule.action !== 'escalate_to_human' && s.circuit.openTools.includes(rule.action)) {
      blocked.push({ action: rule.action, reason: 'temporarily_unavailable' }); continue
    }
    if (rule.exposedWhen(s, d)) { available.push(rule.action); continue }
    const why = rule.blockedReason?.(s, d)
    if (why) blocked.push({ action: rule.action, reason: why.reason, params: why.params })
  }
  const availableSet = new Set(available)
  const next = NEXT_BEST_PRIORITY.find((a) => availableSet.has(a))
  const state: DerivedStateV3 = {
    phase: d.phase, subphase: d.subphase, product: s.product,
    selection: { tier: s.application?.tier ?? null, level: s.application?.level ?? null, addon: s.application?.addon ?? null },
    identity: s.identity, consents: s.consents, dnt: s.dnt, application: s.application,
    quote: s.quote, schedule: s.schedule, policy: s.policy,
    eligibility: s.eligibility, suitability: s.suitability, openItems: s.openItems,
    nextBestAction: next ? `call ${next}` : 'continue the conversation (no funnel commit is currently available)',
  }
  return { state, actions: { available, blocked } }
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/engines/derive-phase.test.ts __tests__/lib/engines/derive-and-expose.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): deriveAndExpose with full-snapshot exposure predicates (A1.4)"`

### Task A1.5: Orchestrator + sections map switched to (Phase, AppSubphase) — content-preserving mapping
**Files:**
- Modify: lib/chat/phase-sections-map.ts (re-key to (phase, subphase); briefing renders new state)
- Modify: lib/chat/orchestrator.ts (Step 3 calls loadDomainSnapshot + deriveAndExpose; briefing patch; debug:gate payload carries DerivedStateV3 + actions)
- Test: __tests__/lib/chat/phase-sections-map.test.ts (rewrite)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Rewrite the failing test (old 6-phase assertions deleted; content-preserving mapping pinned — the CONTENT rework is A4):
```ts
import { describe, it, expect } from 'vitest'
import { getRequiredSectionsFor, formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'
import { PHASES, APP_SUBPHASES } from '@/lib/engines/domain-types'

describe('getRequiredSectionsFor (A1 content-preserving mapping)', () => {
  it('DISCOVERY absorbs the old SELECTION extras', () => {
    const s = getRequiredSectionsFor('DISCOVERY', null)
    for (const k of ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing']) expect(s).toContain(k)
  })
  it('APPLICATION/DNT inherits the old CONSENT payload', () => {
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toContain('complianceGuidance')
  })
  it('APPLICATION/QUESTIONNAIRE keeps questionnaireContext + complianceGuidance', () => {
    const s = getRequiredSectionsFor('APPLICATION', 'QUESTIONNAIRE')
    expect(s).toContain('questionnaireContext'); expect(s).toContain('complianceGuidance')
  })
  it('is total over the full phase×subphase matrix (no throw, always includes situationalBriefing)', () => {
    for (const p of PHASES) for (const sub of [...APP_SUBPHASES, null]) {
      expect(getRequiredSectionsFor(p, p === 'APPLICATION' ? sub : null)).toContain('situationalBriefing')
    }
  })
})

describe('formatDerivedBriefing (new vocabulary)', () => {
  it('renders phase, subphase and the engine nextBestAction', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Phase: APPLICATION/DNT')
    expect(text).toContain('Next best action:')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts` — getRequiredSectionsFor not exported.
- [ ] Step 3: Minimal implementation. lib/chat/phase-sections-map.ts:
```ts
import type { Phase, AppSubphase, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'

const ALWAYS = ['agentIdentity', 'constraints', 'stateGrounding', 'catalogOverview', 'situationalBriefing', 'workflowInstructions']
const BY_PHASE: Record<Phase, string[]> = {
  DISCOVERY: ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'], // old DISCOVERY ∪ old SELECTION
  APPLICATION: [], // subphase-driven
  QUOTE: ['productContext', 'coachingBriefing', 'complianceGuidance'], // old QUOTE set
  PAYMENT: ['productContext', 'complianceGuidance'], // old CLOSING set until A4 adds paymentContext
  POLICY: ['productContext', 'complianceGuidance'], // old CLOSING set until A4 adds policyContext
}
const BY_SUBPHASE: Record<AppSubphase, string[]> = {
  DNT: ['complianceGuidance'], // heir of old CONSENT
  QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance'],
  QUOTE_GENERATION: ['productContext', 'coachingBriefing', 'complianceGuidance'], // old QUOTE (ready-to-generate)
}
export function getRequiredSectionsFor(phase: Phase, subphase: AppSubphase | null): string[] {
  const extras = phase === 'APPLICATION' && subphase ? BY_SUBPHASE[subphase] : BY_PHASE[phase]
  return [...new Set([...ALWAYS, ...extras])]
}
export function formatDerivedBriefing(state: DerivedStateV3, actions: ExposedActions): string {
  const lines: string[] = []
  lines.push(`Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`)
  lines.push(`Next best action: ${state.nextBestAction}`)
  if (state.product) lines.push(`Product: ${state.product.code}`)
  if (state.selection.tier) lines.push(`Selection: tier ${state.selection.tier}${state.selection.level ? ', level ' + state.selection.level : ''}${state.selection.addon ? ', add-on included' : ''}`)
  if (state.application && state.application.missingCodes.length > 0) lines.push(`Remaining questions: ${state.application.missingCodes.slice(0, 5).join(', ')}${state.application.missingCodes.length > 5 ? ', …' : ''}`)
  lines.push(`Available actions: ${actions.available.join(', ')}`)
  return lines.join('\n')
}
```
Orchestrator (lib/chat/orchestrator.ts): in the Step 3 gatePromise (:426-450) replace `deriveState(state.conversationId)` with `deriveAndExpose(await loadDomainSnapshot(state.conversationId))`; hold the result as `exposure: DeriveAndExposeResult`; `gateSelection.requiredSections = getRequiredSectionsFor(exposure.state.phase, exposure.state.subphase)`; at :592 `sections.situationalBriefing = exposure ? formatDerivedBriefing(exposure.state, exposure.actions) : null`; debug:gate payload carries `derivedState: exposure.state` and `actions: exposure.actions` (drawer renders raw values, tolerant). Error fallback (:441-446) keeps DISCOVERY sections (A3.2 adds degraded exposure). Imports of deriveState/DerivedState removed.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts` — then the full chat suite to surface compile breaks: `npx vitest run __tests__/lib/chat`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): orchestrator + sections keyed on (Phase, AppSubphase) via deriveAndExpose (A1.5)"`

### Task A1.6: Compliance re-keyed off the pinned Phase; lib/chat/phase.ts deleted
**Files:**
- Modify: lib/chat/compliance-checker.ts (input.phase: Phase; DISCOVERY → narrow PRESENTATION_RULES)
- Modify: lib/chat/orchestrator.ts (:637-651 — typed Record<Phase, boolean> trigger; pass exposure.state.phase to the checker)
- Modify: lib/chat/debug.ts (remove getConversationPhase from the identity payload)
- Delete: lib/chat/phase.ts, __tests__/lib/chat/phase.test.ts, __tests__/integration/phase-transition.test.ts
- Test: __tests__/lib/chat/compliance-phase.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { COMPLIANCE_RELEVANT_BY_PHASE, rulesForPhase } from '@/lib/chat/compliance-checker'
import { PHASES } from '@/lib/engines/domain-types'

describe('compliance keyed on the pinned Phase (kills the dual vocabulary at orchestrator.ts:651)', () => {
  it('is exhaustively defined for every Phase (rename can never silently disable it again)', () => {
    for (const p of PHASES) expect(typeof COMPLIANCE_RELEVANT_BY_PHASE[p]).toBe('boolean')
  })
  it('DISCOVERY is not compliance-relevant and maps to the NARROW rule set (over-flagging pathology stays fixed)', () => {
    expect(COMPLIANCE_RELEVANT_BY_PHASE.DISCOVERY).toBe(false)
    expect(rulesForPhase('DISCOVERY')).toBe(rulesForPhase('DISCOVERY')) // stable
    expect(rulesForPhase('DISCOVERY')).not.toEqual(rulesForPhase('APPLICATION'))
  })
  it('APPLICATION/QUOTE/PAYMENT/POLICY are compliance-relevant', () => {
    for (const p of ['APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const) expect(COMPLIANCE_RELEVANT_BY_PHASE[p]).toBe(true)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/compliance-phase.test.ts` — exports missing.
- [ ] Step 3: Minimal implementation. compliance-checker.ts: replace `import type { ConversationPhase } from './phase'` with `import type { Phase } from '@/lib/engines/domain-types'`; add:
```ts
export const COMPLIANCE_RELEVANT_BY_PHASE: Record<Phase, boolean> = {
  DISCOVERY: false, APPLICATION: true, QUOTE: true, PAYMENT: true, POLICY: true,
}
export function rulesForPhase(phase: Phase): string[] {
  return phase === 'DISCOVERY' ? PRESENTATION_RULES : APPLICATION_RULES
}
```
`executeComplianceCheck` signature takes `phase: Phase` and selects `rulesForPhase(input.phase)`. Orchestrator :637-651: `const complianceRelevant = exposure ? COMPLIANCE_RELEVANT_BY_PHASE[exposure.state.phase] : false` and pass `phase: exposure.state.phase` — the untyped string array and the getConversationPhase call both die. debug.ts: delete the `phase` field from the identity payload (and the import). Delete lib/chat/phase.ts and the two legacy test files (commit-driven transition coverage returns in A2/A3 integration tests).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat` (phase.test.ts/phase-transition.test.ts gone; compliance-phase green).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): compliance re-keyed on pinned Phase; retire 3-value phase.ts (A1.6)"`

### Task A1.7: Retire lib/chat/derive-state.ts; migrate consumers + pinned tests; no-second-vocabulary scan
**Files:**
- Delete: lib/chat/derive-state.ts, __tests__/lib/chat/derive-state.test.ts
- Modify: lib/tools/handlers/state-handlers.ts (get_current_state returns { state: DerivedStateV3, actions: ExposedActions })
- Modify: lib/tools/handlers/set-answer-handlers.ts (embed fresh deriveAndExpose output)
- Modify: lib/debug/state-rows.ts (+ components/debug/sections/state-section.tsx if it pins fields), __tests__/lib/debug/state-rows.test.ts, __tests__/lib/tools/handlers/state-handlers.test.ts, __tests__/lib/tools/handlers/set-answer.test.ts, __tests__/integration/navigation.test.ts (drop the two mocked-prisma deriveState cases — covered by pure tests in A1.3/A1.4)
- Modify: prisma/seeds/seed-agents.ts (prose sweep for retired phase names; reseed)
- Test: __tests__/lib/engines/vocabulary-closure.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing meta-test (the 'no other module may emit a Phase value' guard from contradiction #6 / T12.D5 seed):
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'

const LIB = path.resolve(__dirname, '../../../lib')
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) { if (!p.includes('generated')) out.push(...tsFiles(p)); continue }
    if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('vocabulary closure (taxonomy-closure seed; full gherkin meta-test is Block F)', () => {
  it('both old vocabulary modules are gone', () => {
    expect(existsSync(path.join(LIB, 'chat/derive-state.ts'))).toBe(false)
    expect(existsSync(path.join(LIB, 'chat/phase.ts'))).toBe(false)
  })
  it('no module under lib/ outside engines/domain-types.ts declares a Phase union or ConversationPhase', () => {
    const offenders = tsFiles(LIB)
      .filter((p) => !p.endsWith(path.join('engines', 'domain-types.ts')))
      .filter((p) => { const src = readFileSync(p, 'utf8'); return /type\s+Phase\s*=/.test(src) || /ConversationPhase/.test(src) })
    expect(offenders).toEqual([])
  })
  it('retired phase literals no longer appear as phase values in lib/', () => {
    const offenders = tsFiles(LIB).filter((p) => /'(SELECTION|CONSENT|CLOSING)'/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/vocabulary-closure.test.ts` — derive-state.ts still exists.
- [ ] Step 3: Minimal implementation. state-handlers.ts:
```ts
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { ToolHandler } from '../types'

export const getStateHandler: ToolHandler = async (_args, context) => {
  const { state, actions } = deriveAndExpose(await loadDomainSnapshot(context.conversationId))
  return { success: true, data: { state, actions }, message: `Phase ${state.phase}${state.subphase ? '/' + state.subphase : ''}. ${state.nextBestAction}` }
}
```
set-answer-handlers.ts: same two-liner replaces the deriveState call (return `data: { state, actions }`). state-rows.ts: render `phase` as `state.phase + (state.subphase ? '/' + state.subphase : '')`, keep raw-string tolerance for historical payloads. Migrate the listed test files to the new shapes (assert on `DISCOVERY`/`APPLICATION` etc., never old names). Delete lib/chat/derive-state.ts + its test. Sweep prisma/seeds/seed-agents.ts prose for retired phase labels; run `npx tsx scripts/reseed-agents.ts`.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run` (full suite — the instrumentation flake at __tests__/lib/events/instrumentation.test.ts is a known PASS-equivalent when it is the sole failure).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines)!: retire 6-phase derive-state; single deriveAndExpose vocabulary (A1.7)"`

### Task A1.8: Package verification — suite + live funnel sim
**Files:**
- Test: full suite + scripts/verify-advance-flow.ts (existing live sim)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Run the full suite: `npx vitest run` — expect green (instrumentation flake rule applies).
- [ ] Step 2: Reseed the dev DB so prose sweeps are live: `npx prisma migrate deploy && npx tsx prisma/seeds/index.ts`.
- [ ] Step 3: Runtime verification (unit-green ≠ working — project history): `npx tsx scripts/verify-advance-flow.ts 2` — expect 2/2 trials reach signature + application without stalling; inspect the printed briefing lines for `Phase: APPLICATION/...` strings.
- [ ] Step 4: Run `npx tsx scripts/verify-pathology1.ts 2` — expect CLEAN (baseline that A1's briefing change did not regress narration).
- [ ] Step 5: Commit (docs of the run go in the PR description, not files): `git commit --allow-empty -m "chore(A1): runtime verification green — advance-flow 2/2, pathology1 clean"`

### ⚠ Binding errata for A1 (fidelity verifier — apply OVER the task text above)

1. **[A1.2 steps 1-4 (and every real-DB task in A2/A3)]** vitest does not load .env into process.env (vitest.config.ts has no setupFiles/env config; dotenv is only imported by scripts/). Under `npx vitest run`, process.env.DATABASE_URL is unset, so every describe.skipIf(!process.env.DATABASE_URL) suite silently SKIPS: all 'run it, expect FAIL' and 'expect PASS' steps are vacuous, and 'full suite green' (A1.8/A2.10/A3.7/A5.5) certifies nothing about the loader/gateway ring.
   **Fix:** In A1.2, add `test.setupFiles: ['dotenv/config']` (or an explicit setup file importing dotenv/config) to vitest.config.ts as part of the harness task, and change step 2's expectation to 'fails with Cannot find module' — explicitly assert the suite RUNS (not skips) by checking the vitest summary line in the step.
2. **[A1.2 (test harness) — missing serialization for the real-DB ring]** Vitest runs test files in parallel by default; the plan adds seven+ real-DB suites (snapshot-loader, commit-ledger-schema, handler-tx, gateway, gateway-idempotency, consent-truth, executor-gateway-routing) that all TRUNCATE the same tables via resetFunnelTables — concurrent file execution makes them interfere nondeterministically. T12.D3 (binding) explicitly notes 'real-DB tests need a managed test database and serialized access'.
   **Fix:** In A1.2, configure serialized execution for the integration ring: either a vitest projects split where __tests__/integration runs with fileParallelism:false (or poolOptions.threads.singleThread:true), or a dedicated vitest.integration.config.ts and an npm script; document the exact command used by all later 'Run tests' steps.
3. **[A1.2 step 3 (ensureTestProduct)]** The product create branch fails at runtime: Product (prisma/schema.prisma:104-129) has required columns the helper omits — subType, eligibility (Json), defaultPlaybook, pricingExplanation, targetCustomer, targetAgeRange, contractTerm, gracePeriod, territoryCoverage. The `as never` cast silences TypeScript but Prisma client validation throws 'Argument `subType` is missing' on any DB where the seeded 'protect' row is absent.
   **Fix:** Fill in all required Product fields with concrete literals in ensureTestProduct (subType:'TERM', eligibility:{}, defaultPlaybook:'-', pricingExplanation:'-', targetCustomer:'-', targetAgeRange:'18-65', contractTerm:'-', gracePeriod:'-', territoryCoverage:'RO') and remove the `as never` cast so the compiler verifies the shape.
4. **[A1.6 Files list]** Two codebase-reality misses: (1) __tests__/lib/chat/compliance-phase.test.ts ALREADY EXISTS and pins the OLD contract (executeComplianceCheck with phase:'presentation'); the task lists it as the new test to 'write', not as a rewrite — the existing cases break compilation once ConversationPhase dies. (2) __tests__/lib/chat/debug-identity.test.ts pins phase:'presentation'/'application' in the identity payload (lines 85, 117) that A1.6 deletes from lib/chat/debug.ts — not in the file list, so step 4's suite run fails.
   **Fix:** Mark compliance-phase.test.ts as Modify (delete the 'presentation'/'application' rule-selection cases, keep the new Phase-keyed tests), and add __tests__/lib/chat/debug-identity.test.ts to Modify (drop the phase-field assertions from the identity payload expectations).
5. **[A1.7 Files list]** lib/chat/debug.ts:16 imports `type { DerivedState } from './derive-state'` and uses it at :48 (gateDebug.derivedState). Deleting lib/chat/derive-state.ts breaks debug.ts, which appears in no A1 task's modify list (A1.6 touches debug.ts only for getConversationPhase).
   **Fix:** Add lib/chat/debug.ts to A1.7's Modify list: re-type derivedState as `DerivedStateV3 | null` imported from '@/lib/engines/domain-types' (and rename the field or keep it, matching what A1.5 writes into the debug:gate payload).
6. **[A1.6/A1.7 (deleted tests) vs T10.D5 rationale (ratified)]** T10.D5's ✅ rationale (ratified by the log) requires the change to include commit-driven transition tests (start_application → APPLICATION/DNT, sign_dnt → QUESTIONNAIRE, last answer → QUOTE_GENERATION, generate_quote → QUOTE...). The draft deletes phase-transition.test.ts and the two navigation deriveState cases with the note 'coverage returns in A2/A3 integration tests', but the only transition assertion anywhere is one phaseFrom check on sign_dnt in A2.5. The reachable transition chain is never tested end-to-end.
   **Fix:** Add an explicit integration test task (end of A2 or A3): drive executeCommit on the real DB through start_application → save_dnt answers → sign_dnt → save_application_answer (last) → generate_quote, asserting each envelope's phaseDelta matches the pinned predicate table (accept_quote→PAYMENT and payment→POLICY stay out until their blocks land — note that explicitly).
7. **[A1.2 step 3 (loader db seam)]** loadDomainSnapshot claims to accept an injectable client 'so the A2 gateway can pass a transaction handle', but it calls resolveGroupCodes (lib/engines/question-groups.ts:10) which uses the GLOBAL prisma internally — inside the gateway's locked transaction, question-group reads escape the tx on a separate connection. Benign for static reference data, but the stated seam contract is false as written.
   **Fix:** Either thread the db handle through resolveGroupCodes (add an optional `db: Db = prisma` param in the same task) or replace the call with an inline groupCodes query on `db` inside the loader; alternatively document the static-reference-data exception in a code comment plus the task text.
8. **[A1.5 step 3 (debug:gate payload) vs T14.D2 (accepted as recommended)]** T14.D2 pins the per-turn legality snapshot as DerivedState + available/blocked actions + an ENGINE VERSION STAMP (for recompute-and-diff replay). A1.5 writes derivedState + actions into the debug:gate payload but no engine version, and no other Block A task adds it — if the observability block owns it, that ownership is nowhere stated.
   **Fix:** Add a one-line `engineVersion` constant (exported from lib/engines/derive-and-expose.ts, bumped on rule changes) to the debug:gate payload in A1.5, or add an explicit note that T14.D2's version stamp lands with the observability block.

## Package A2: A2 — CommitResult envelope, commit gateway (#8 order), CommitLedger, confirm tokens, idempotent replay, M10 outcomes (consent-truth flip moved to B1 per ruling 7)

**Execution slot:** 2 | **Depends on:** A1

**Goal:** Every commit flows through one gateway implementing the pinned order: actor → replay detection FIRST → legality (deriveAndExpose) → confirm token (re-issue on stale) → validation → transactional apply under a per-conversation advisory lock with a CommitLedger row in the same transaction → deriveAndExpose post-state whose pre/post delta IS the advance_phase effect (contradiction #6). Replay returns the ORIGINAL envelope; conflicting resubmits reject with already_applied; circuit/timeout map to 'unavailable' (state unchanged) and 'pending' exists for recorded-but-unknown outcomes; commits are never auto-retried. ConsentEvent becomes the single consent truth (capture ≠ storage, contradiction #2) with the Customer consent columns dropped in the same package.

**Migrations / seeds:**
- New model CommitLedger { id, conversationId, customerId, actor String, tool String, targetRef String?, argsHash String, outcome String, effects String[], reasonCode String?, phaseFrom String?, phaseTo String?, idempotencyDisposition String @default("fresh"), contentVersions Json?, envelope Json, createdAt } with @@index([conversationId, tool, argsHash]) and @@index([customerId, createdAt]) — migration add_commit_ledger.
- New model ConsentEvent { id, customerId, kind String, action String, scope String?, sourceCommitId String?, createdAt } with @@index([customerId, kind, createdAt]) + relation to Customer — same migration.
- Migration consent_truth_flip (destructive, demo data): drop Customer.gdprConsentAt, Customer.gdprConsentScope, Customer.aiDisclosureAcknowledgedAt; update prisma/seeds/* and __tests__ fixtures that referenced those columns to create ConsentEvent rows instead; reseed (npx prisma migrate dev + npx tsx prisma/seeds/index.ts).
- __tests__/integration/helpers/test-db.ts truncate list gains "CommitLedger","ConsentEvent".

### Task A2.1: CommitLedger + ConsentEvent prisma models
**Files:**
- Modify: prisma/schema.prisma (two models + Customer relation), __tests__/integration/helpers/test-db.ts (truncate list)
- Test: __tests__/integration/commit-ledger-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from './helpers/test-db'

describe.skipIf(!process.env.DATABASE_URL)('CommitLedger + ConsentEvent schema', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('persists a ledger row with the pinned columns and reads it back', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const row = await prisma.commitLedger.create({ data: { conversationId: conv.id, customerId: customer.id, actor: 'agent', tool: 'sign_dnt', targetRef: `conversation:${conv.id}`, argsHash: 'abc', outcome: 'applied', effects: ['advance_phase'], phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', envelope: { outcome: 'applied', effects: ['advance_phase'] } } })
    expect(row.idempotencyDisposition).toBe('fresh')
    const found = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'sign_dnt', argsHash: 'abc' } })
    expect(found?.outcome).toBe('applied')
  })
  it('appends ConsentEvent rows (append-only ledger, never updated)', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    await prisma.consentEvent.create({ data: { customerId: customer.id, kind: 'gdpr_processing', action: 'granted', scope: 'data_processing' } })
    await prisma.consentEvent.create({ data: { customerId: customer.id, kind: 'gdpr_processing', action: 'withdrawn' } })
    const events = await prisma.consentEvent.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' } })
    expect(events.map((e) => e.action)).toEqual(['granted', 'withdrawn'])
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/commit-ledger-schema.test.ts` — prisma.commitLedger undefined.
- [ ] Step 3: Minimal implementation — schema.prisma additions:
```prisma
model CommitLedger {
  id                     String   @id @default(cuid())
  conversationId         String
  customerId             String
  actor                  String
  tool                   String
  targetRef              String?
  argsHash               String
  outcome                String
  effects                String[]
  reasonCode             String?
  phaseFrom              String?
  phaseTo                String?
  idempotencyDisposition String   @default("fresh")
  contentVersions        Json?
  envelope               Json
  createdAt              DateTime @default(now())
  @@index([conversationId, tool, argsHash])
  @@index([customerId, createdAt])
}

model ConsentEvent {
  id             String   @id @default(cuid())
  customerId     String
  kind           String
  action         String
  scope          String?
  sourceCommitId String?
  createdAt      DateTime @default(now())
  customer Customer @relation(fields: [customerId], references: [id])
  @@index([customerId, kind, createdAt])
}
```
Add `consentEvents ConsentEvent[]` to Customer. Run `npx prisma migrate dev --name add_commit_ledger` then `npx prisma generate`. Extend the truncate list in test-db.ts with `"CommitLedger","ConsentEvent"`.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/commit-ledger-schema.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(db): CommitLedger + ConsentEvent ledgers (A2.1)"`

### Task A2.2: Registry kind classification (read | commit | internal) + requiresConfirmation flags
**Files:**
- Modify: lib/tools/types.ts (ToolDefinition gains kind + requiresConfirmation), lib/tools/registry.ts (all 33 registrations tagged; banner untouched until A5)
- Test: __tests__/lib/tools/registry-kind.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { getRegisteredToolNames, getToolDefinition } from '@/lib/tools/registry'

const COMMITS = ['set_candidate_product', 'switch_product', 'update_customer_profile', 'record_gdpr_consent', 'acknowledge_ai_disclosure', 'start_dnt_questionnaire', 'save_dnt_answer', 'sign_dnt', 'start_application', 'save_application_answer', 'set_answer', 'resume_application', 'cancel_application', 'change_selection', 'generate_quote', 'accept_quote', 'modify_quote', 'check_bd_eligibility', 'initiate_payment', 'collect_customer_field', 'escalate_to_human']
const INTERNAL = ['profile_extractor', 'summarizer']

describe('tool kind classification', () => {
  it('every registered tool carries a kind', () => {
    for (const name of getRegisteredToolNames()) expect(['read', 'commit', 'internal']).toContain(getToolDefinition(name)?.kind)
  })
  it('the 21 committing tools are kind=commit (check_bd_eligibility included — it mutates includesAddon)', () => {
    for (const name of COMMITS) expect(getToolDefinition(name)?.kind, name).toBe('commit')
  })
  it('background internals are kind=internal and never gateway-routed', () => {
    for (const name of INTERNAL) expect(getToolDefinition(name)?.kind, name).toBe('internal')
  })
  it('accept_quote and sign_dnt require confirmation (gateway-owned two-step)', () => {
    expect(getToolDefinition('accept_quote')?.requiresConfirmation).toBe(true)
    expect(getToolDefinition('sign_dnt')?.requiresConfirmation).toBe(true)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/tools/registry-kind.test.ts` — kind undefined.
- [ ] Step 3: Minimal implementation. types.ts ToolDefinition gains:
```ts
  kind: 'read' | 'commit' | 'internal'
  requiresConfirmation?: boolean // gateway-enforced two-step (#8 step 4); replaces handler-supplied confirm flags
```
Tag every registerTool() call in registry.ts: the 21 names above kind:'commit' (accept_quote and sign_dnt additionally requiresConfirmation:true), profile_extractor/summarizer kind:'internal', the remaining 10 kind:'read'.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/tools/registry-kind.test.ts && npx vitest run __tests__/lib/tools`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): read/commit/internal kind classification + requiresConfirmation flags (A2.2)"`

### Task A2.3: materialArgsHash + signed state-fingerprint confirm tokens (pure modules)
**Files:**
- Create: lib/tools/args-hash.ts, lib/tools/confirm-token.ts
- Test: __tests__/lib/tools/args-hash.test.ts, __tests__/lib/tools/confirm-token.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests:
```ts
// __tests__/lib/tools/args-hash.test.ts
import { describe, it, expect } from 'vitest'
import { materialArgsHash } from '@/lib/tools/args-hash'

describe('materialArgsHash', () => {
  it('is stable under key order and strips confirm-class args', () => {
    const a = materialArgsHash('accept_quote', 'quote:q1', { paymentFrequency: 'monthly', confirmAcceptance: true })
    const b = materialArgsHash('accept_quote', 'quote:q1', { confirmToken: 'x', paymentFrequency: 'monthly' })
    expect(a).toBe(b)
  })
  it('differs by targetRef (same verb on a different entity is NOT a replay)', () => {
    expect(materialArgsHash('save_dnt_answer', 'dnt_answer:Q1', { answer: 'da' }))
      .not.toBe(materialArgsHash('save_dnt_answer', 'dnt_answer:Q2', { answer: 'da' }))
  })
})
```
```ts
// __tests__/lib/tools/confirm-token.test.ts
import { describe, it, expect } from 'vitest'
import { issueConfirmToken, verifyConfirmToken } from '@/lib/tools/confirm-token'

const SECRET = 'test-secret'
describe('signed state-fingerprint confirm token (T2.D3)', () => {
  it('round-trips for identical conversation/tool/args/fingerprint', () => {
    const t = issueConfirmToken(SECRET, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, t, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')).toBe(true)
  })
  it('rejects when the state fingerprint changed (TOCTOU: terms changed between preview and confirm)', () => {
    const t = issueConfirmToken(SECRET, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, t, 'conv-1', 'accept_quote', 'hash-1', 'fp-CHANGED')).toBe(false)
  })
  it('cannot be minted without the secret (LLM cannot self-confirm)', () => {
    const forged = issueConfirmToken('guess', 'conv-1', 'accept_quote', 'hash-1', 'fp-1')
    expect(verifyConfirmToken(SECRET, forged, 'conv-1', 'accept_quote', 'hash-1', 'fp-1')).toBe(false)
  })
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/tools/args-hash.test.ts __tests__/lib/tools/confirm-token.test.ts` — modules missing.
- [ ] Step 3: Minimal implementation:
```ts
// lib/tools/args-hash.ts
import { createHash } from 'crypto'
const NON_MATERIAL = new Set(['confirm', 'confirmAcceptance', 'confirmSignature', 'confirmToken'])
export function materialArgsHash(tool: string, targetRef: string, args: Record<string, unknown>): string {
  const material = Object.fromEntries(Object.entries(args).filter(([k]) => !NON_MATERIAL.has(k)).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify({ tool, targetRef, material })).digest('hex')
}
```
```ts
// lib/tools/confirm-token.ts
import { createHmac, timingSafeEqual } from 'crypto'
function sign(secret: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): string {
  return createHmac('sha256', secret).update([conversationId, tool, argsHash, fingerprint].join('|')).digest('hex')
}
export function issueConfirmToken(secret: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): string {
  return sign(secret, conversationId, tool, argsHash, fingerprint)
}
export function verifyConfirmToken(secret: string, token: string, conversationId: string, tool: string, argsHash: string, fingerprint: string): boolean {
  const expected = sign(secret, conversationId, tool, argsHash, fingerprint)
  if (token.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))
}
export function confirmSecret(): string {
  return process.env.CONFIRM_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-confirm-secret'
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/tools/args-hash.test.ts __tests__/lib/tools/confirm-token.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): material args hash + HMAC state-fingerprint confirm tokens (A2.3)"`

### Task A2.4: ToolContext.db plumbing — commit handlers run on an injectable client
**Files:**
- Modify: lib/tools/types.ts (ToolContext gains db), lib/chat/context-builder.ts (buildToolContext sets db: prisma)
- Modify (mechanical `prisma.` → `context.db.` in commit paths): lib/tools/handlers/dnt-handlers.ts, application-handlers.ts, change-selection-handlers.ts, set-answer-handlers.ts, quote-handlers.ts, candidate-handlers.ts, product-switch-handler.ts, profile-handlers.ts, bd-handlers.ts, payment-handlers.ts, data-handlers.ts, utility-handlers.ts, and the two inline consent handlers in lib/tools/registry.ts
- Test: __tests__/integration/handler-tx.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (atomicity is the observable contract):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { setCandidateProduct } from '@/lib/tools/handlers/candidate-handlers'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('handlers write through context.db', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('a handler running inside a rolled-back transaction leaves NO rows behind', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await expect(prisma.$transaction(async (tx) => {
      const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: tx } as unknown as ToolContext
      const r = await setCandidateProduct({ product: product.code }, ctx)
      expect(r.success).toBe(true)
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')
    const after = await prisma.conversation.findUnique({ where: { id: conv.id } })
    expect(after?.candidateProductId).toBeNull() // write rolled back with the tx → handler used ctx.db, not global prisma
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/handler-tx.test.ts` — candidateProductId survives the rollback (handler wrote via global prisma).
- [ ] Step 3: Minimal implementation. types.ts:
```ts
import type { prisma as PrismaSingleton } from '@/lib/db'
export type DbClient = typeof PrismaSingleton | Parameters<Parameters<typeof PrismaSingleton.$transaction>[0]>[0]
export interface ToolContext {
  customerId: string
  conversationId: string
  language: 'en' | 'ro'
  db: DbClient // defaults to the global client; the gateway injects the transaction handle
  /* …existing optional fields unchanged… */
}
```
buildToolContext (lib/chat/context-builder.ts) sets `db: prisma`. In each listed handler file replace every `prisma.` call inside handler bodies with `context.db.` (keep the module import only where read-only helpers outside handlers need it). The two inline registry consent handlers switch the same way.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/handler-tx.test.ts && npx vitest run __tests__/lib/tools` (existing mocked tests updated to pass db in CTX fixtures where they construct contexts).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): injectable ToolContext.db so commits can run inside the gateway transaction (A2.4)"`

### Task A2.5: Commit gateway core — pinned #8 order, advisory lock, ledger row in-tx, advance_phase = derive delta
**Files:**
- Create: lib/tools/gateway.ts
- Test: __tests__/integration/gateway.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (real DB; sign_dnt is the canonical confirmable commit):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

async function fixture() {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { product, customer, conv, ctx }
}

describe.skipIf(!process.env.DATABASE_URL)('commit gateway — pinned #8 order', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('rejects a non-exposed commit with the engine reason and writes a ledger row', async () => {
    const { conv, customer, ctx } = await fixture()
    const r = await executeCommit({ tool: 'accept_quote', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r.outcome).toBe('rejected')
    const row = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'accept_quote' } })
    expect(row?.outcome).toBe('rejected')
    expect(row?.actor).toBe('agent')
  })

  it('requires_confirmation on first sign_dnt call, applies with the returned token, and reports advance_phase as the derive delta', async () => {
    const { conv, customer, ctx } = await fixture()
    // make sign_dnt legal: complete the DNT answers via real questions if seeded; otherwise the engine blocks and this asserts the blocked path
    const first = await executeCommit({ tool: 'sign_dnt', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    if (first.outcome === 'requires_confirmation') {
      expect(first.confirmToken).toBeTruthy()
      const second = await executeCommit({ tool: 'sign_dnt', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, confirmToken: first.confirmToken, toolContext: ctx })
      expect(second.outcome).toBe('applied')
      const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'sign_dnt' }, orderBy: { createdAt: 'asc' } })
      expect(rows.at(-1)?.outcome).toBe('applied')
      expect(rows.at(-1)?.phaseFrom).toBeTruthy()
    } else {
      expect(['rejected']).toContain(first.outcome) // engine-blocked: dnt_incomplete — still ledgered
    }
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/gateway.test.ts` — gateway module missing.
- [ ] Step 3: Minimal implementation — lib/tools/gateway.ts:
```ts
import { prisma } from '@/lib/db'
import { getToolDefinition, getToolHandler } from './registry'
import { validateToolArgs } from './validation'
import { materialArgsHash } from './args-hash'
import { issueConfirmToken, verifyConfirmToken, confirmSecret } from './confirm-token'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { CommitActor, CommitEffect, CommitResult, DerivedStateV3 } from '@/lib/engines/domain-types'
import type { ToolContext, ToolResult } from './types'

export interface CommitRequest {
  tool: string; args: Record<string, unknown>; actor: CommitActor
  conversationId: string; customerId: string; confirmToken?: string; toolContext: ToolContext
}

function resolveTargetRef(tool: string, state: DerivedStateV3, conversationId: string): string {
  // natural key per commit — the (entity, from-state) pair (T2.D4); answer tools key on the pending question
  if (tool === 'accept_quote' || tool === 'modify_quote') return `quote:${state.quote?.id ?? state.acceptedQuote?.id ?? 'none'}`
  if (tool === 'generate_quote') return `application:${state.application?.id ?? 'none'}`
  if (tool === 'save_application_answer' || tool === 'set_answer') return `app_answer:${state.application?.missingCodes[0] ?? 'none'}`
  if (tool === 'save_dnt_answer') return `dnt_answer:${state.dnt.answeredCount}`
  if (tool === 'initiate_payment') return `policy:${state.policy?.id ?? 'none'}`
  return `conversation:${conversationId}`
}

function outcomeForBlocked(reason: string): CommitResult['outcome'] {
  if (reason === 'requires_consent') return 'requires_consent'
  if (reason === 'requires_identity') return 'requires_identity'
  if (reason === 'requires_disclosures') return 'requires_disclosures'
  if (reason === 'temporarily_unavailable') return 'unavailable'
  return 'rejected'
}

function stateFingerprint(state: DerivedStateV3): string {
  return [state.phase, state.subphase ?? '-', state.quote?.id ?? '-', state.quote?.validUntil ?? '-', state.application?.id ?? '-', state.dnt.answeredCount].join('|')
}

export async function executeCommit(req: CommitRequest): Promise<CommitResult> {
  const def = getToolDefinition(req.tool)
  const handler = getToolHandler(req.tool)
  if (!def || !handler || def.kind !== 'commit') return { outcome: 'rejected', reason: 'not_exposed', effects: [] }
  // (1) actor: server-resolved by the caller, recorded below
  const pre = deriveAndExpose(await loadDomainSnapshot(req.conversationId))
  const targetRef = resolveTargetRef(req.tool, pre.state, req.conversationId)
  const argsHash = materialArgsHash(req.tool, targetRef, req.args)
  // (2) idempotency replay detection FIRST — replay even if the action is now blocked (#8)
  const prior = await prisma.commitLedger.findFirst({ where: { conversationId: req.conversationId, tool: req.tool, outcome: 'applied', idempotencyDisposition: 'fresh' }, orderBy: { createdAt: 'desc' } })
  if (prior && prior.argsHash === argsHash) {
    await prisma.commitLedger.create({ data: { conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool, targetRef, argsHash, outcome: prior.outcome, effects: prior.effects, reasonCode: prior.reasonCode, phaseFrom: prior.phaseFrom, phaseTo: prior.phaseTo, idempotencyDisposition: 'replay', envelope: prior.envelope as object } })
    return prior.envelope as CommitResult
  }
  if (prior && prior.targetRef === targetRef && prior.argsHash !== argsHash) {
    return ledgeredReject(req, targetRef, argsHash, 'already_applied', pre.state.phase)
  }
  // (3) legality
  if (!pre.actions.available.includes(req.tool)) {
    const blocked = pre.actions.blocked.find((b) => b.action === req.tool)
    const reason = blocked?.reason ?? 'not_exposed'
    const envelope: CommitResult = { outcome: outcomeForBlocked(reason), reason, effects: [], needs: blocked?.params?.needs as string[] | undefined }
    await writeLedger(prisma, req, targetRef, argsHash, envelope, pre.state.phase, pre.state.phase)
    return envelope
  }
  // (4) confirm token — stale/missing → (re-)issue with fresh fingerprint, never hard-reject
  if (def.requiresConfirmation) {
    const fp = stateFingerprint(pre.state)
    if (!req.confirmToken || !verifyConfirmToken(confirmSecret(), req.confirmToken, req.conversationId, req.tool, argsHash, fp)) {
      return { outcome: 'requires_confirmation', effects: [], confirmToken: issueConfirmToken(confirmSecret(), req.conversationId, req.tool, argsHash, fp), data: { preview: { phase: pre.state.phase, quote: pre.state.quote } } }
    }
  }
  // (5) domain validation
  const validation = validateToolArgs(req.tool, req.args)
  if (!validation.valid) return ledgeredReject(req, targetRef, argsHash, 'invalid_args', pre.state.phase)
  // (6+7) transactional apply under the per-conversation advisory lock + ledger row + post-derive
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.conversationId}))`
    const lockedPre = deriveAndExpose(await loadDomainSnapshot(req.conversationId, tx as never))
    if (!lockedPre.actions.available.includes(req.tool)) {
      const blocked = lockedPre.actions.blocked.find((b) => b.action === req.tool)
      const envelope: CommitResult = { outcome: outcomeForBlocked(blocked?.reason ?? 'not_exposed'), reason: blocked?.reason ?? 'not_exposed', effects: [] }
      await writeLedger(tx as never, req, targetRef, argsHash, envelope, lockedPre.state.phase, lockedPre.state.phase)
      return envelope
    }
    const effectiveArgs = def.requiresConfirmation ? { ...(validation.data ?? {}), confirmAcceptance: true, confirmSignature: true } : (validation.data ?? {})
    const handlerResult: ToolResult = await handler(effectiveArgs, { ...req.toolContext, db: tx as never })
    const post = deriveAndExpose(await loadDomainSnapshot(req.conversationId, tx as never))
    const effects: CommitEffect[] = []
    let phaseDelta: CommitResult['phaseDelta']
    if (lockedPre.state.phase !== post.state.phase || lockedPre.state.subphase !== post.state.subphase) {
      effects.push('advance_phase')
      phaseDelta = { from: lockedPre.state.phase, to: post.state.phase }
    }
    const envelope: CommitResult = handlerResult.success
      ? { outcome: 'applied', effects, phaseDelta, data: { ...handlerResult.data, _uiAction: handlerResult.uiAction, _confirmation: handlerResult.confirmation, _message: handlerResult.message } }
      : { outcome: 'rejected', reason: 'handler_rejected', effects: [], data: { error: handlerResult.error } }
    await writeLedger(tx as never, req, targetRef, argsHash, envelope, lockedPre.state.phase, post.state.phase)
    return envelope
  })
}

async function writeLedger(db: typeof prisma, req: CommitRequest, targetRef: string, argsHash: string, envelope: CommitResult, phaseFrom: string, phaseTo: string): Promise<void> {
  await db.commitLedger.create({ data: { conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool, targetRef, argsHash, outcome: envelope.outcome, effects: envelope.effects, reasonCode: envelope.reason ?? null, phaseFrom, phaseTo, idempotencyDisposition: 'fresh', envelope: envelope as object } })
}
async function ledgeredReject(req: CommitRequest, targetRef: string, argsHash: string, reason: CommitResult['reason'], phase: string): Promise<CommitResult> {
  const envelope: CommitResult = { outcome: 'rejected', reason, effects: [] }
  await writeLedger(prisma, req, targetRef, argsHash, envelope, phase, phase)
  return envelope
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/gateway.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): commit gateway with pinned #8 order, advisory lock, in-tx ledger (A2.5)"`

### Task A2.6: Idempotent replay returns the ORIGINAL envelope; conflicting resubmit rejects already_applied
**Files:**
- Modify: lib/tools/gateway.ts (already structured in A2.5 — this task pins the semantics with tests and fixes anything the tests flush out)
- Test: __tests__/integration/gateway-idempotency.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('gateway idempotency (#8 replay-first)', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('double-submit of the same commit applies once and replays the ORIGINAL outcome', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    const r1 = await executeCommit({ tool: 'set_candidate_product', args: { product: product.code }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    const r2 = await executeCommit({ tool: 'set_candidate_product', args: { product: product.code }, actor: 'gui', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r1.outcome).toBe('applied')
    expect(r2).toEqual(r1) // original envelope, verbatim
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'set_candidate_product' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.idempotencyDisposition)).toEqual(['fresh', 'replay'])
  })
  it('conflicting resubmit (same target, different material args after success) is rejected(already_applied), never a second effect', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'a@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    const r = await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'else@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    // NOTE: collect_customer_field legitimately re-collects fields; the conflict rule keys on targetRef —
    // assert the rule on a one-shot commit instead:
    expect(['applied', 'rejected']).toContain(r.outcome)
  })
})
```
Adjust the second case during implementation: the binding assertion is on a one-shot targetRef (e.g. `conversation:<id>`-keyed sign_dnt after success with different args → rejected already_applied). Add targetRef rows for field-level commits (`field:<name>`) so re-collection of a DIFFERENT value for the SAME field is a fresh commit while the SAME value replays.
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/gateway-idempotency.test.ts` — replay row missing / envelope differs.
- [ ] Step 3: Minimal implementation: extend resolveTargetRef in gateway.ts with `if (tool === 'collect_customer_field') return \`field:${String((pre-resolved args).field ?? 'unknown')}\`` (pass args into resolveTargetRef: signature `resolveTargetRef(tool, args, state, conversationId)`), and include the field VALUE in material args (it already is). Fix any envelope-equality drift the test flushes out (replay must return the stored envelope object verbatim).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/gateway-idempotency.test.ts __tests__/integration/gateway.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): ledger-backed idempotent replay + already_applied conflict rule (A2.6)"`

### Task A2.7: M10 — unavailable/pending outcomes + circuit state as deriveAndExpose input
**Files:**
- Modify: lib/tools/executor.ts (export getOpenCircuitTools(); timeout/circuit-open on commits → CommitResult 'unavailable'), lib/engines/snapshot-loader.ts (circuit.openTools wired), lib/tools/gateway.ts (handler throw of TimeoutError → 'unavailable' {retryable:true}, state unchanged — tx rolls back)
- Test: __tests__/lib/engines/circuit-exposure.test.ts (pure) + __tests__/lib/tools/unavailable-outcome.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests:
```ts
// __tests__/lib/engines/circuit-exposure.test.ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

describe('M10 degraded-mode exposure', () => {
  it('a circuit-open tool is blocked temporarily_unavailable; escalate_to_human stays as the floor', () => {
    const r = deriveAndExpose(makeSnapshot({ circuit: { openTools: ['generate_quote', 'escalate_to_human'] } }))
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'temporarily_unavailable' }))
    expect(r.actions.available).toContain('escalate_to_human')
  })
})
```
```ts
// __tests__/lib/tools/unavailable-outcome.test.ts
import { describe, it, expect } from 'vitest'
import { toUnavailable } from '@/lib/tools/gateway'
import { TimeoutError } from '@/lib/errors/types'

describe('unavailable ≠ rejected (M10 invariant)', () => {
  it('maps TimeoutError to outcome unavailable with retryable=true and NO effects', () => {
    const env = toUnavailable(new TimeoutError('tool:generate_quote', 15000))
    expect(env.outcome).toBe('unavailable')
    expect(env.effects).toEqual([])
    expect((env.data as { retryable: boolean }).retryable).toBe(true)
  })
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/engines/circuit-exposure.test.ts __tests__/lib/tools/unavailable-outcome.test.ts` — toUnavailable missing (circuit-exposure may already pass from A1.4; keep as regression pin).
- [ ] Step 3: Minimal implementation. executor.ts: `export function getOpenCircuitTools(): string[] { return [...toolCircuits.entries()].filter(([, cb]) => cb.state === 'open').map(([n]) => n) }`. snapshot-loader.ts: `circuit: { openTools: getOpenCircuitTools() }`. gateway.ts: wrap the `$transaction` call in try/catch and add:
```ts
export function toUnavailable(err: unknown): CommitResult {
  return { outcome: 'unavailable', reason: 'temporarily_unavailable', effects: [], data: { retryable: true, retryAfterMs: 20_000, error: err instanceof Error ? err.name : 'unknown' } }
}
```
catch: if `err instanceof TimeoutError || err instanceof CircuitOpenError` return `toUnavailable(err)` (tx rolled back ⇒ state unchanged ⇒ the invariant holds); rethrow otherwise. Policy pin in code comment: reads may be retried by the executor; commits are NEVER auto-retried — customer-driven resubmission replays via the ledger (#8); 'pending' is reserved for commits whose handlers record an external check (consumed by later blocks; the outcome value already exists in the envelope).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/engines/circuit-exposure.test.ts __tests__/lib/tools/unavailable-outcome.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): M10 unavailable/pending semantics + circuit-aware exposure (A2.7)"`

### Task A2.8: Consent-truth flip — ConsentEvent is the only consent storage (contradiction #2, capture ≠ storage)
**Files:**
- Modify: lib/tools/registry.ts (recordGdprConsentHandler / acknowledgeAiDisclosureHandler append ConsentEvent rows via context.db), lib/engines/snapshot-loader.ts (consents derived from ConsentEvent: latest grant not superseded by withdrawal), prisma/schema.prisma (drop Customer.gdprConsentAt/gdprConsentScope/aiDisclosureAcknowledgedAt), lib/chat/turn-context.ts + any reader of the dropped columns (grep gdprConsentAt), prisma/seeds/* fixtures
- Test: __tests__/integration/consent-truth.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('consent SSOT = ConsentEvent ledger', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('record_gdpr_consent appends a granted event and the derived snapshot flips', async () => {
    await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    expect((await loadDomainSnapshot(conv.id)).consents.gdprProcessing).toBe(false)
    const r = await executeCommit({ tool: 'record_gdpr_consent', args: { scope: 'data_processing' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r.outcome).toBe('applied')
    const events = await prisma.consentEvent.findMany({ where: { customerId: customer.id, kind: 'gdpr_processing' } })
    expect(events).toHaveLength(1)
    expect((await loadDomainSnapshot(conv.id)).consents.gdprProcessing).toBe(true)
  })
  it('a later withdrawal event supersedes the grant in derived state', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await prisma.consentEvent.create({ data: { customerId: customer.id, kind: 'gdpr_processing', action: 'granted' } })
    await prisma.consentEvent.create({ data: { customerId: customer.id, kind: 'gdpr_processing', action: 'withdrawn' } })
    expect((await loadDomainSnapshot(conv.id)).consents.gdprProcessing).toBe(false)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/consent-truth.test.ts` — handler still writes Customer columns; snapshot reads them.
- [ ] Step 3: Minimal implementation. Handlers (registry.ts) replace the customer.update with `await context.db.consentEvent.create({ data: { customerId: context.customerId, kind: 'gdpr_processing', action: 'granted', scope } })` (and kind 'ai_disclosure' for the second), keeping the confirmation payloads. snapshot-loader.ts consents:
```ts
const consentEvents = await db.consentEvent.findMany({ where: { customerId: conversation.customerId }, orderBy: { createdAt: 'asc' } })
const latest: Record<string, string> = {}
for (const e of consentEvents) latest[e.kind] = e.action
const consents = { gdprProcessing: latest['gdpr_processing'] === 'granted', aiDisclosure: latest['ai_disclosure'] === 'granted', marketing: latest['marketing'] === 'granted' }
```
Drop the three Customer columns (migration `consent_truth_flip`), fix every compile error the drop produces (turn-context select list, debug payloads, fixtures), update seeds. Run `npx prisma migrate dev --name consent_truth_flip && npx prisma generate && npx tsx prisma/seeds/index.ts`.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/consent-truth.test.ts` then full suite `npx vitest run`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(consent)!: ConsentEvent ledger is the single consent truth; Customer columns dropped (A2.8)"`

### Task A2.9: Route every commit through the gateway at the executor boundary; serializer emits the envelope verbatim
**Files:**
- Modify: lib/tools/executor.ts (kind==='commit' → gateway; gateway result adapted to ToolResult with envelope attached), lib/tools/types.ts (ToolResult gains envelope?: CommitResult), lib/chat/tool-result-serializer.ts (envelope serialized verbatim for the LLM), lib/chat/orchestrator.ts (synthetic path passes actor='gui'; agent path actor='agent'; uiAction/confirmation read from envelope passthrough fields)
- Test: __tests__/integration/executor-gateway-routing.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from './helpers/test-db'
import { executeTool } from '@/lib/tools/executor'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('executor routes commits through the gateway', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('a commit executed via executeTool produces a CommitLedger row and an envelope on the ToolResult', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    const r = await executeTool('set_candidate_product', { product: product.code }, ctx, 'CUSTOMER')
    expect(r.success).toBe(true)
    expect(r.envelope?.outcome).toBe('applied')
    expect(await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'set_candidate_product' } })).toBe(1)
  })
  it('reads do NOT write ledger rows', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    await executeTool('get_current_state', {}, ctx, 'CUSTOMER')
    expect(await prisma.commitLedger.count({ where: { conversationId: conv.id } })).toBe(0)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/integration/executor-gateway-routing.test.ts` — no envelope / no ledger row.
- [ ] Step 3: Minimal implementation. executor.ts after the permission check: if `definition.kind === 'commit'`:
```ts
const actor = context.actor ?? 'agent' // ToolContext gains optional actor: CommitActor; orchestrator synthetic path sets 'gui'
const envelope = await executeCommit({ tool: name, args: (validation.data ?? {}) as Record<string, unknown>, actor, conversationId: context.conversationId, customerId: context.customerId, confirmToken: (args as Record<string, unknown>)?.confirmToken as string | undefined, toolContext: context })
const d = (envelope.data ?? {}) as Record<string, unknown>
return {
  success: envelope.outcome === 'applied',
  envelope,
  data: d,
  error: envelope.outcome === 'rejected' ? String(d.error ?? envelope.reason) : undefined,
  uiAction: d._uiAction as ToolResult['uiAction'],
  confirmation: d._confirmation as ToolResult['confirmation'],
  message: d._message as string | undefined,
}
```
(cache/circuit/timeout handling stays for reads; the gateway owns commit execution). tool-result-serializer.ts: when `result.envelope` exists, serialize `{ envelope: result.envelope, data: result.data }` so the model reads outcome/effects/reason codes — never prose-only errors. Orchestrator: set `toolContext.actor = 'gui'` on the syntheticToolCall branch (:798) and 'agent' otherwise.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/integration/executor-gateway-routing.test.ts` then `npx vitest run`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): all commits gateway-routed; envelope serialized verbatim to the model (A2.9)"`

### Task A2.10: Package verification — suite, concurrency probe, live sim
**Files:**
- Create: scripts/verify-gateway-concurrency.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the concurrency probe (two genuinely concurrent commits serialize via the advisory lock):
```ts
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  const mk = (actor: 'agent' | 'gui') => executeCommit({ tool: 'set_candidate_product', args: { product: product.code }, actor, conversationId: conv.id, customerId: customer.id, toolContext: ctx })
  const [a, b] = await Promise.all([mk('agent'), mk('gui')])
  const fresh = await prisma.commitLedger.count({ where: { conversationId: conv.id, idempotencyDisposition: 'fresh', outcome: 'applied' } })
  console.log({ a: a.outcome, b: b.outcome, freshApplied: fresh })
  if (fresh !== 1) throw new Error(`expected exactly 1 fresh applied row, got ${fresh}`)
  console.log('OK: concurrent GUI+agent commit applied once')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```
- [ ] Step 2: Run `npx vitest run` — full suite green (instrumentation-flake rule).
- [ ] Step 3: Run `npx tsx scripts/verify-gateway-concurrency.ts` — expect 'OK: concurrent GUI+agent commit applied once'.
- [ ] Step 4: Live sim (LLM reads envelopes now — T2 risk: unit-green ≠ agent-working): `npx tsx scripts/verify-advance-flow.ts 2` — expect 2/2; check the transcript shows no narrated raw envelope JSON.
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(A2): verification — suite green, concurrency probe 1-fresh-row, advance-flow 2/2"`

### ⚠ Binding errata for A2 (fidelity verifier — apply OVER the task text above)

0. **[A2.8 — RULING 7 VOID]** Task A2.8 (Consent-truth flip) is VOID in this package — the entire flip (ConsentEvent model, sign_dnt capture fold, capture-tool retirement, snapshot-loader switch, Customer consent-column drops) is owned by **B1** as one coupled package. A2 must only define/import the ConsentEvent *contract type* for ledger references; it creates no consent model and drops no columns.


1. **[A2.5 step 3 (lib/tools/gateway.ts) + A3.5]** The gateway confirm flow is broken against the real zod schemas. lib/tools/validation.ts:67-74 signDntSchema requires confirmSignature:z.literal(true) AND gdprConsent:z.literal(true) with .strict(); :106-111 acceptQuoteSchema requires confirmAcceptance:z.literal(true) with .strict(). The gateway runs validateToolArgs(req.tool, req.args) on RAW args at step (5): a confirmed call carrying {confirmToken} fails twice — the literal-true confirm flags are absent AND .strict() rejects the unknown confirmToken key — so every confirmed sign_dnt/accept_quote returns rejected(invalid_args). The draft injects confirmAcceptance/confirmSignature into effectiveArgs only AFTER validation. A3.5's adapter payloads ({confirmToken:'tok-1'}) hit the same wall.
   **Fix:** Add an explicit step in A2.5: (a) strip confirm-class args (confirmToken/confirm/confirmAcceptance/confirmSignature) before validateToolArgs; (b) rewrite signDntSchema and acceptQuoteSchema in lib/tools/validation.ts to drop the literal-true confirm flags (the gateway now owns two-step confirmation); (c) decide sign_dnt's gdprConsent arg explicitly — either inject gdprConsent:true alongside confirmSignature in effectiveArgs or remove it from the schema with a note that consent capture moves per contradiction #2. Add a test asserting a confirmed call with only {confirmToken} validates.
2. **[A2.5 step 3 / A2.10 steps 1-3]** Replay detection is not re-checked inside the advisory-lock transaction, so the A2.10 concurrency probe fails by construction. Two genuinely concurrent identical commits both pass the pre-lock replay check (no prior row yet); the in-lock re-check covers legality only; for an always-exposed commit like set_candidate_product both handlers apply and TWO idempotencyDisposition:'fresh' applied rows are written. scripts/verify-gateway-concurrency.ts demands exactly 1 fresh row and will throw.
   **Fix:** Inside the $transaction, after acquiring pg_advisory_xact_lock, re-run the replay lookup (same tool+argsHash query) as the first read; if a fresh applied row now exists, write a 'replay' disposition row and return the stored envelope. Add a unit-level note that the pinned #8 'replay-first' ordering applies both outside (fast path) and inside (correctness path) the lock.
3. **[A2.5 step 3 (replay/conflict lookup)]** The prior-commit lookup is findFirst({conversationId, tool, outcome:'applied', disposition:'fresh'}, orderBy createdAt desc) — it only ever compares against the LATEST applied row for the tool. Interleaved commits of the same tool (collect email → collect phone → resubmit email) defeat both replay and the already_applied conflict rule, despite the schema having @@index([conversationId, tool, argsHash]) for exactly this query.
   **Fix:** Query replay candidates by {conversationId, tool, argsHash, outcome:'applied'} directly, and the conflict rule by {conversationId, tool, targetRef, outcome:'applied'} — two indexed lookups instead of latest-row comparison.
4. **[A2.5 step 3 vs A2.6 steps 1/3]** Internal contradiction: A2.5's gateway rejects already_applied on (same targetRef, different material args), but A2.6 step 3 instructs that re-collection of a DIFFERENT value for the SAME field (targetRef field:email) must be a FRESH commit. Both cannot hold as written. The binding #8 rule keys conflict on the (entity, from-state) natural key (T2.D4/T2 risk: 'replay detection must key on the full natural key'), which the draft's static targetRefs don't encode — note also that targetRef for save_dnt_answer (dnt_answer:<answeredCount>) and save_application_answer (app_answer:<missingCodes[0]>) shifts after every apply, so a true double-submit of the same answer computes a DIFFERENT targetRef and silently re-applies to the next question.
   **Fix:** Add an explicit per-tool replay-scope table to A2.5: one-shot commits (sign_dnt, accept_quote, generate_quote, start_application) use the strict conflict rule on a stable targetRef; repeatable commits (collect_customer_field, save_dnt_answer, save_application_answer, set_answer) key targetRef on the addressed entity from ARGS (field name, question code/id), with the value in material args, so same-value resubmits replay and new-value writes are fresh. Key answer tools on args.questionId/args.field, never on positional state (answeredCount/missingCodes[0]).
5. **[A2.6 step 1 (second test case)]** Placeholder violation: the second test asserts expect(['applied','rejected']).toContain(r.outcome) — vacuously true — and the step text says 'Adjust the second case during implementation'. This is a test-step-without-real-assertion, banned by the briefing's TDD/no-placeholder rules.
   **Fix:** Write the binding tests now: (1) sign_dnt resubmit with different material args after success → rejected(already_applied) with no second ledger 'fresh' row; (2) collect_customer_field same field + same value → replay returning the original envelope; (3) same field + different value → applied fresh. All three with concrete code in step 1.
6. **[A2.5 step 3 (requires_confirmation path)]** requires_confirmation responses (token issuance and re-issue) are returned without writing a CommitLedger row, violating T14.D1 (binding): 'one row per commit attempt — ... confirm-token lifecycle'. The pinned CommitOutcome even includes requires_confirmation as a ledgerable outcome.
   **Fix:** In the confirm-token branch, writeLedger an outcome:'requires_confirmation' row (reason requires_confirmation, effects [], disposition 'fresh') before returning the token envelope; extend the A2.5 test to assert it.
7. **[A2.5 step 1 (gateway integration test)]** The headline confirm-flow test never exercises the confirm path in practice: with the seeded protect product the conversation has zero DNT answers, so sign_dnt is engine-blocked (dnt_incomplete/not_exposed) and the test always takes the else-branch ('engine blocked — still ledgered'); the requires_confirmation→token→applied path ships untested at the integration level (the else-branch comment also mis-names the reason: with totalCount>0 and answeredCount 0 the blockedReason yields dnt_incomplete, with totalCount 0 it is not_exposed).
   **Fix:** Make sign_dnt legal in the fixture with real code: query the dnt-phase questions via resolveGroupCodes(product.id,'dnt') + prisma.question.findMany, prisma.answer.createMany rows for the conversation, then assert first call → requires_confirmation with token, second call with token → applied, ledger rows [requires_confirmation, applied]. Keep the dnt_incomplete blocked case as a separate explicit test.
8. **[A1.2 steps 1-4 (and every real-DB task in A2/A3)]** vitest does not load .env into process.env (vitest.config.ts has no setupFiles/env config; dotenv is only imported by scripts/). Under `npx vitest run`, process.env.DATABASE_URL is unset, so every describe.skipIf(!process.env.DATABASE_URL) suite silently SKIPS: all 'run it, expect FAIL' and 'expect PASS' steps are vacuous, and 'full suite green' (A1.8/A2.10/A3.7/A5.5) certifies nothing about the loader/gateway ring.
   **Fix:** In A1.2, add `test.setupFiles: ['dotenv/config']` (or an explicit setup file importing dotenv/config) to vitest.config.ts as part of the harness task, and change step 2's expectation to 'fails with Cannot find module' — explicitly assert the suite RUNS (not skips) by checking the vitest summary line in the step.
9. **[A2.8 (package placement) vs resolved-log contradiction #2]** Fidelity deviation: the binding log says the engine's switch to ConsentEvent-derived state happens 'in the SAME coordinated change as the sign_dnt fold (no period with two truths)'. A2.8 executes the storage+engine flip in Block A while sign_dnt remains a non-consent-capturing commit until the DNT block — record_gdpr_consent/acknowledge_ai_disclosure stay the capture surface in the interim. The single-truth intent is arguably preserved (columns dropped in the same migration), but the explicit sequencing instruction is not followed.
   **Fix:** Either move the consent-truth flip into the DNT-block package that folds capture into sign_dnt, or add an explicit deviation note to A2.8's goal (one truth is preserved because the Customer columns are dropped in the same migration; the later sign_dnt fold changes only the capture point, not the storage) and have the deviation ratified in the running log before execution.
10. **[A2.7 step 3 (snapshot-loader imports executor)]** Wiring circuit state into the loader creates an import cycle: lib/engines/snapshot-loader → lib/tools/executor → lib/tools/registry → lib/tools/handlers/state-handlers → lib/engines/snapshot-loader. Function-level usage defers evaluation so it may work, but ESM cycles plus vi.mock are a known flake source, and it also violates the lib/engines purity convention (an engine-layer module importing the tool executor).
   **Fix:** Extract the circuit registry into its own leaf module (e.g. lib/tools/circuit-state.ts exporting toolCircuits + getOpenCircuitTools), imported by both executor.ts and snapshot-loader.ts — no cycle, and the loader's dependency is a pure state read.

### ➕ Addendum tasks for A2 (binding — coverage-critic gaps)

### Task A2.ADD-1: Real-DB integration test harness (canonical — closes critic G9/X8)
**Files:**
- Create: `__tests__/helpers/test-db.ts`
- Modify: `vitest.config.ts` (add an `integration` project or env wiring so DATABASE_URL=TEST_DATABASE_URL for `__tests__/integration/**`)
- Test: `__tests__/integration/test-db-harness.test.ts`
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, DOMAIN_TABLES } from '@/__tests__/helpers/test-db'

describe('test-db harness', () => {
  it('resetDb truncates domain tables and reseeds', async () => {
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL) // single-client rule: no split brain
    const c = await prisma.customer.create({ data: { isAnonymous: true } })
    await resetDb()
    expect(await prisma.customer.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await prisma.product.count()).toBeGreaterThan(0) // reseed ran (protect exists)
  })
  it('DOMAIN_TABLES is the single truncate list other packages extend', () => {
    expect(DOMAIN_TABLES).toContain('Answer')
    expect(new Set(DOMAIN_TABLES).size).toBe(DOMAIN_TABLES.length)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/test-db-harness.test.ts` — FAIL (module not found).
- [ ] Step 3: Implement `__tests__/helpers/test-db.ts`: export `DOMAIN_TABLES: string[]` (initial: Conversation, Message, Customer, Application, Answer, Quote, Policy, Payment, TurnTrace, TurnDebug — later packages APPEND here, one list only); `resetDb()` runs `TRUNCATE TABLE "x","y" RESTART IDENTITY CASCADE` via `prisma.$executeRawUnsafe` then invokes the seed entrypoints (`prisma/seeds`) for catalog data. Reuse the `@/lib/db` client — the PrismaPg adapter is already configured there; NEVER instantiate a second client with the `datasources` option. Wire vitest so integration tests load env with DATABASE_URL=TEST_DATABASE_URL before `@/lib/db` is imported.
- [ ] Step 4: Run the test — PASS. Run the full suite — no regressions.
- [ ] Step 5: Commit: `git commit -m "test: add canonical real-DB integration harness (truncate+seed, single client)"`

## Package A3: A3 — Orchestrator exposure integration, executor hard-reject, GUI gateway parity (M4), identity-requirements mechanism, DEFAULT_DISCOVERY_TOOLS retired

**Execution slot:** 3 | **Depends on:** A1, A2

**Goal:** The per-turn LLM tool list IS deriveAndExpose.available (the static 10-tool list and the dead workflow/pack inputs die — fixing the live funnel regression); the executor hard-rejects non-exposed tools as defense in depth; blocked_actions are injected into the situational briefing so blocks are explained, not worked around; exposure is re-derived after every commit round so a same-turn sign_dnt → start_application chain is legal end-to-end; UI synthetic actions get full gateway parity with actor='gui' including the confirm-token round-trip; and the identity-requirements table mechanism (contradiction #1) is consumed by legality with requires_identity needs payloads (rows land in Block B).

**Migrations / seeds:**
- No schema migration. Deletes lib/chat/default-tools.ts (pure code).

### Task A3.1: Tool list = available actions; DEFAULT_DISCOVERY_TOOLS dies
**Files:**
- Create: lib/chat/turn-tools.ts
- Modify: lib/chat/orchestrator.ts (:413-419 stepAllowedTools deleted; :789-794 tools from exposure; `const tools` → `let tools`), lib/chat/context-loaders.ts (loadCapabilityManifest fed actions.available)
- Delete: lib/chat/default-tools.ts, __tests__/lib/chat/default-tools.test.ts, __tests__/lib/chat/orchestrator-discovery-tools.test.ts, __tests__/lib/chat/discovery-empty-catalog.test.ts (rewritten below)
- Test: __tests__/lib/chat/turn-tools.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { buildTurnTools } from '@/lib/chat/turn-tools'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('buildTurnTools — the LLM tool list IS the exposure set', () => {
  it('returns exactly the available actions as LLM tool definitions (registered ones)', () => {
    const { actions } = deriveAndExpose(makeSnapshot())
    const tools = buildTurnTools(actions)
    const names = tools.map((t) => t.function.name)
    for (const n of names) expect(actions.available).toContain(n)
    expect(names).toContain('escalate_to_human') // funnel-regression fix: commits reachable, floor always present
    expect(names).toContain('list_products')
  })
  it('never returns internal tools', () => {
    const { actions } = deriveAndExpose(makeSnapshot())
    const names = buildTurnTools(actions).map((t) => t.function.name)
    expect(names).not.toContain('profile_extractor')
    expect(names).not.toContain('summarizer')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/turn-tools.test.ts` — module missing.
- [ ] Step 3: Minimal implementation:
```ts
// lib/chat/turn-tools.ts
import { getToolsForLLM, getToolDefinition } from '@/lib/tools/registry'
import type { ExposedActions } from '@/lib/engines/domain-types'
import type { LLMToolDefinition } from '@/lib/llm/providers/types'

export function buildTurnTools(actions: ExposedActions): LLMToolDefinition[] {
  const names = actions.available.filter((n) => { const d = getToolDefinition(n); return d !== undefined && d.kind !== 'internal' })
  return getToolsForLLM(names)
}
```
Orchestrator: delete the stepAllowedTools block (:413-419) and the withDefaultDiscoveryTools import; at :789-794 replace the effectiveTools/computeAllowedTools chain with `let tools: LLMToolDefinition[] = exposure ? buildTurnTools(exposure.actions) : getToolsForLLM(['escalate_to_human', 'get_current_state'])` (degraded floor when derivation failed). loadCapabilityManifest call site receives `exposure?.actions.available ?? []`. Delete lib/chat/default-tools.ts and the three listed test files; rewrite discovery-empty-catalog coverage as a deriveAndExpose assertion (list_products available on an empty snapshot).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/turn-tools.test.ts && npx vitest run`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat)!: per-turn tool list = engine exposure; DEFAULT_DISCOVERY_TOOLS retired (A3.1)"`

### Task A3.2: Executor hard-reject of non-exposed tools (defense in depth) + degraded mode
**Files:**
- Modify: lib/tools/types.ts (ToolContext gains exposedTools?: string[]), lib/tools/executor.ts (reject calls not in exposedTools), lib/chat/orchestrator.ts (populate toolContext.exposedTools from the current round's exposure)
- Test: __tests__/lib/tools/executor-exposure.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (pure executor seam — no DB writes happen because rejection precedes the handler):
```ts
import { describe, it, expect } from 'vitest'
import { executeTool } from '@/lib/tools/executor'
import type { ToolContext } from '@/lib/tools/types'

const ctx = { customerId: 'c1', conversationId: 'cv1', language: 'ro', exposedTools: ['list_products', 'escalate_to_human'] } as unknown as ToolContext

describe('executor defense-in-depth', () => {
  it('hard-rejects a registered but non-exposed tool with a not_exposed envelope', async () => {
    const r = await executeTool('accept_quote', {}, ctx, 'CUSTOMER')
    expect(r.success).toBe(false)
    expect(r.envelope?.outcome).toBe('rejected')
    expect(r.envelope?.reason).toBe('not_exposed')
  })
  it('escalate_to_human is never rejected by the exposure check', async () => {
    const r = await executeTool('escalate_to_human', { reason: 'test' }, { ...ctx, exposedTools: [] } as unknown as ToolContext, 'CUSTOMER')
    expect(r.envelope?.reason).not.toBe('not_exposed')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/tools/executor-exposure.test.ts` — accept_quote reaches the gateway/handler instead.
- [ ] Step 3: Minimal implementation. executor.ts after the permission check:
```ts
if (context.exposedTools && name !== 'escalate_to_human' && !context.exposedTools.includes(name)) {
  const envelope: CommitResult = { outcome: 'rejected', reason: 'not_exposed', effects: [] }
  return { success: false, envelope, error: 'not_exposed' }
}
```
Orchestrator sets `toolContext.exposedTools = exposure.actions.available` right after Step 3 (and refreshes it in A3.4's re-derive). On derive failure leave `exposedTools = ['get_current_state', 'list_products', 'get_product_info', 'escalate_to_human']` — explicit degraded mode (reads + escape hatch), not phase impersonation.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/tools/executor-exposure.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): executor hard-rejects non-exposed tools; degraded-mode floor (A3.2)"`

### Task A3.3: blocked_actions injected into the prompt — blocks are explained, never worked around
**Files:**
- Modify: lib/chat/phase-sections-map.ts (formatDerivedBriefing renders blocked actions with reason codes + params)
- Test: __tests__/lib/chat/phase-sections-map.test.ts (extend)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Add the failing test:
```ts
it('renders blocked actions with machine reason codes so the agent can explain a block', () => {
  const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'COMPLETED', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [] }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false } }))
  const text = formatDerivedBriefing(r.state, r.actions)
  expect(text).toContain('Blocked actions:')
  expect(text).toContain('generate_quote (requires_consent')
  expect(text).toContain('NEVER work around a blocked action')
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts`.
- [ ] Step 3: Minimal implementation — append to formatDerivedBriefing:
```ts
if (actions.blocked.length > 0) {
  lines.push('Blocked actions:')
  for (const b of actions.blocked) lines.push(`- ${b.action} (${b.reason}${b.params ? ' ' + JSON.stringify(b.params) : ''})`)
  lines.push('If the customer asks for a blocked action, explain WHY using the reason above. NEVER work around a blocked action or invent an alternative path.')
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): blocked_actions with reason codes injected into the briefing (A3.3)"`

### Task A3.4: Re-derive exposure after every commit round (T1.D5)
**Files:**
- Modify: lib/chat/orchestrator.ts (end of the tool-round loop ~:1296-1305: replace the dead transitionOccurred refresh; track roundHadAppliedCommit from envelopes; re-run loadDomainSnapshot+deriveAndExpose; reassign tools via buildTurnTools; refresh toolContext.exposedTools; append a compact system message)
- Test: __tests__/lib/chat/round-refresh.test.ts (pure helper) — the orchestrator change itself is verified by the A3.7 live sim
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Extract the refresh decision + message as pure helpers and write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { shouldRefreshExposure, formatRoundRefreshMessage } from '@/lib/chat/round-refresh'

describe('per-round exposure refresh', () => {
  it('refreshes when at least one envelope outcome is applied (NOT only on advance_phase — cascades change legality too)', () => {
    expect(shouldRefreshExposure([{ outcome: 'applied', effects: [] }])).toBe(true)
    expect(shouldRefreshExposure([{ outcome: 'rejected', effects: [] }, { outcome: 'requires_confirmation', effects: [] }])).toBe(false)
  })
  it('renders a compact actions message (phase + available + blocked, no full state dump)', () => {
    const msg = formatRoundRefreshMessage({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' } as never, { available: ['save_application_answer', 'escalate_to_human'], blocked: [{ action: 'generate_quote', reason: 'questionnaire_incomplete' }] })
    expect(msg).toContain('[State update]')
    expect(msg).toContain('APPLICATION/QUESTIONNAIRE')
    expect(msg).toContain('save_application_answer')
    expect(msg).toContain('generate_quote (questionnaire_incomplete)')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/round-refresh.test.ts` — module missing.
- [ ] Step 3: Minimal implementation:
```ts
// lib/chat/round-refresh.ts
import type { CommitResult, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'
export function shouldRefreshExposure(envelopes: Pick<CommitResult, 'outcome' | 'effects'>[]): boolean {
  return envelopes.some((e) => e.outcome === 'applied')
}
export function formatRoundRefreshMessage(state: Pick<DerivedStateV3, 'phase' | 'subphase'>, actions: ExposedActions): string {
  return [
    `[State update] Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`,
    `Available actions: ${actions.available.join(', ')}`,
    actions.blocked.length > 0 ? `Blocked: ${actions.blocked.map((b) => `${b.action} (${b.reason})`).join(', ')}` : '',
  ].filter(Boolean).join('\n')
}
```
Orchestrator loop end: collect this round's envelopes from resultMap (`entry.pipelineResult.toolResult.envelope`), and when shouldRefreshExposure(...) → `const refreshed = deriveAndExpose(await loadDomainSnapshot(state.conversationId)); tools = buildTurnTools(refreshed.actions); toolContext.exposedTools = refreshed.actions.available; messages.push({ role: 'system', content: formatRoundRefreshMessage(refreshed.state, refreshed.actions) })`. Delete the dead `if (transitionOccurred)` block (:1298-1302).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/round-refresh.test.ts && npx vitest run`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): re-derive exposure + tools after every applied commit round (A3.4)"`

### Task A3.5: Action-adapter full gateway parity — actor='gui', confirm-token round-trip, no self-confirmed buttons (M4)
**Files:**
- Modify: lib/chat/action-adapter.ts (accept_quote no longer injects confirmAcceptance:true; passes payload.confirmToken through; same for sign_dnt), lib/chat/orchestrator.ts (synthetic branch sets toolContext.actor='gui' and exposedTools before executing; requires_confirmation envelope emitted as SSE ui_action confirm_required carrying the token)
- Test: __tests__/lib/chat/action-adapter.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('GUI actions are gateway-equal clients (M4)', () => {
  it('accept_quote button does NOT self-confirm — first click carries no confirm flag', () => {
    const tc = adaptAction({ type: 'accept_quote', payload: {} })
    expect(tc?.name).toBe('accept_quote')
    expect(tc?.arguments).not.toHaveProperty('confirmAcceptance')
  })
  it('confirm click round-trips the gateway-issued token', () => {
    const tc = adaptAction({ type: 'accept_quote', payload: { confirmToken: 'tok-1' } })
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-1' })
  })
  it('sign_dnt passes the token through identically', () => {
    const tc = adaptAction({ type: 'sign_dnt', payload: { confirmToken: 'tok-2' } })
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-2' })
  })
  it('unknown actions still return null (route 400s them)', () => {
    expect(adaptAction({ type: 'nope', payload: {} })).toBeNull()
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/action-adapter.test.ts` — accept_quote case still injects confirmAcceptance:true.
- [ ] Step 3: Minimal implementation. action-adapter.ts:
```ts
case 'accept_quote':
  return { id: `action_${Date.now()}`, name: 'accept_quote', arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {} }
case 'sign_dnt':
  return { id: `action_${Date.now()}`, name: 'sign_dnt', arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {} }
```
Orchestrator synthetic branch (:798): before executing set `toolContext.actor = 'gui'` and `toolContext.exposedTools = exposure?.actions.available` (synthetic calls hit the same executor wall); after execution, if `pipelineResult.toolResult.envelope?.outcome === 'requires_confirmation'` yield `{ event: 'ui_action', data: { type: 'confirm_required', payload: { tool: tc.name, confirmToken: envelope.confirmToken, preview: envelope.data } } }` so the GUI renders the confirm dialog that round-trips the SAME commit + token the agent would.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/action-adapter.test.ts && npx vitest run`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): GUI synthetic actions get full gateway parity with confirm-token round-trip (A3.5)"`

### Task A3.6: Identity-requirements table mechanism (contradiction #1; rows land in Block B)
**Files:**
- Create: lib/engines/identity-requirements.ts
- Modify: lib/engines/derive-and-expose.ts (deriveAndExpose accepts optional config { identityRequirements }; unmet requirement → blocked requires_identity with needs)
- Test: __tests__/lib/engines/identity-requirements.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (rows injected as literals — the production table ships EMPTY; Block B populates it):
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-requirements'
import { makeSnapshot } from './snapshot-fixtures'

describe('identity-requirements mechanism (contradiction #1)', () => {
  it('the shipped table is empty — rows are Block B data', () => {
    expect(Object.keys(IDENTITY_REQUIREMENTS)).toEqual([])
  })
  it('checkIdentityRequirement reports the missing needs payload', () => {
    const r = checkIdentityRequirement({ accept_quote: { minTier: 'verified_channel', requiredFields: ['cnp'] } }, 'accept_quote', { tier: 'declared', fields: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['tier:verified_channel', 'declared:cnp'])
  })
  it('an unmet requirement turns an otherwise-exposed action into blocked requires_identity with needs', () => {
    const s = makeSnapshot() // set_candidate_product is normally always exposed
    const r = deriveAndExpose(s, { identityRequirements: { set_candidate_product: { minTier: 'declared', requiredFields: [] } } })
    expect(r.actions.available).not.toContain('set_candidate_product')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'set_candidate_product', reason: 'requires_identity', params: { needs: ['tier:declared'] } }))
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/identity-requirements.test.ts` — module missing.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/identity-requirements.ts
import type { IdentityTier, DomainSnapshot } from './domain-types'
export interface IdentityRequirement { minTier: IdentityTier; requiredFields: string[] }
export type IdentityRequirementsTable = Record<string, IdentityRequirement>
export const IDENTITY_REQUIREMENTS: IdentityRequirementsTable = {} // one row per commit; Block B lands the rows (e.g. accept_quote → verified_channel per T4-R6)
const TIER_ORDER: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }
export function checkIdentityRequirement(table: IdentityRequirementsTable, tool: string, identity: DomainSnapshot['identity']): { ok: true } | { ok: false; needs: string[] } {
  const req = table[tool]
  if (!req) return { ok: true }
  const needs: string[] = []
  if (TIER_ORDER[identity.tier] < TIER_ORDER[req.minTier]) needs.push(`tier:${req.minTier}`)
  for (const f of req.requiredFields) if (!identity.fields[f]) needs.push(`declared:${f}`)
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}
```
deriveAndExpose: signature `deriveAndExpose(s: DomainSnapshot, config?: { identityRequirements?: IdentityRequirementsTable })`; inside the rule loop, for kind==='commit' rules that pass exposedWhen, run `checkIdentityRequirement(config?.identityRequirements ?? IDENTITY_REQUIREMENTS, rule.action, s.identity)` — on failure push `{ action, reason: 'requires_identity', params: { needs } }` instead of adding to available.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/engines/identity-requirements.test.ts __tests__/lib/engines/derive-and-expose.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): identity-requirements table mechanism consumed by legality (A3.6)"`

### Task A3.7: Package verification — the live regression is dead
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx vitest run` — full suite green (instrumentation-flake rule).
- [ ] Step 2: `npx tsx scripts/verify-advance-flow.ts 2` — expect 2/2: the agent reaches sign_dnt → start_application → questionnaire in the standard chat path (no synthetic calls), proving the static-10-tool regression is fixed by construction.
- [ ] Step 3: `npx tsx scripts/verify-gateway-concurrency.ts` — still OK after orchestrator changes.
- [ ] Step 4: Manual SSE probe of GUI parity: `npx tsx scripts/simulate.ts` (or curl POST /api/chat with action accept_quote on a prepared conversation) — confirm the first click yields a confirm_required ui_action with a token, the second click with the token applies.
- [ ] Step 5: Commit: `git commit --allow-empty -m "chore(A3): runtime verification — funnel tools exposed, advance-flow 2/2, GUI confirm round-trip OK"`

### ⚠ Binding errata for A3 (fidelity verifier — apply OVER the task text above)

1. **[A2.5 step 3 (lib/tools/gateway.ts) + A3.5]** The gateway confirm flow is broken against the real zod schemas. lib/tools/validation.ts:67-74 signDntSchema requires confirmSignature:z.literal(true) AND gdprConsent:z.literal(true) with .strict(); :106-111 acceptQuoteSchema requires confirmAcceptance:z.literal(true) with .strict(). The gateway runs validateToolArgs(req.tool, req.args) on RAW args at step (5): a confirmed call carrying {confirmToken} fails twice — the literal-true confirm flags are absent AND .strict() rejects the unknown confirmToken key — so every confirmed sign_dnt/accept_quote returns rejected(invalid_args). The draft injects confirmAcceptance/confirmSignature into effectiveArgs only AFTER validation. A3.5's adapter payloads ({confirmToken:'tok-1'}) hit the same wall.
   **Fix:** Add an explicit step in A2.5: (a) strip confirm-class args (confirmToken/confirm/confirmAcceptance/confirmSignature) before validateToolArgs; (b) rewrite signDntSchema and acceptQuoteSchema in lib/tools/validation.ts to drop the literal-true confirm flags (the gateway now owns two-step confirmation); (c) decide sign_dnt's gdprConsent arg explicitly — either inject gdprConsent:true alongside confirmSignature in effectiveArgs or remove it from the schema with a note that consent capture moves per contradiction #2. Add a test asserting a confirmed call with only {confirmToken} validates.
2. **[A1.2 steps 1-4 (and every real-DB task in A2/A3)]** vitest does not load .env into process.env (vitest.config.ts has no setupFiles/env config; dotenv is only imported by scripts/). Under `npx vitest run`, process.env.DATABASE_URL is unset, so every describe.skipIf(!process.env.DATABASE_URL) suite silently SKIPS: all 'run it, expect FAIL' and 'expect PASS' steps are vacuous, and 'full suite green' (A1.8/A2.10/A3.7/A5.5) certifies nothing about the loader/gateway ring.
   **Fix:** In A1.2, add `test.setupFiles: ['dotenv/config']` (or an explicit setup file importing dotenv/config) to vitest.config.ts as part of the harness task, and change step 2's expectation to 'fails with Cannot find module' — explicitly assert the suite RUNS (not skips) by checking the vitest summary line in the step.
3. **[A3.1 step 3 (loadCapabilityManifest wiring)]** Feeding exposure.actions.available to loadCapabilityManifest conflicts with the orchestrator's parallel design: capabilityManifest is built synchronously inside loadAllSections (lib/chat/context-loaders.ts:950) during contextPromise (Step 4), which deliberately runs IN PARALLEL with the gate (Step 3) that computes exposure — exposure does not exist yet at that point. __tests__/performance/bench-pipeline.test.ts also asserts the gate/context overlap (≥50ms), so naively awaiting the gate inside context assembly regresses a pinned perf budget.
   **Fix:** Specify the patch-after-gate pattern (same as sections.situationalBriefing at orchestrator.ts:592): after gateResult resolves, recompute sections.capabilityManifest = loadCapabilityManifest(exposure?.actions.available ?? []) before prompt build; leave loadAllSections' parallel shape untouched.
4. **[A3.1 step 3 vs A3.2 step 3 (degraded mode)]** The two degraded-mode floors disagree: A3.1 gives the LLM ['escalate_to_human','get_current_state'] on derive failure; A3.2 sets exposedTools to ['get_current_state','list_products','get_product_info','escalate_to_human']. The model would see 2 tools while the executor permits 4 — harmless but incoherent, and the T1 risk pins 'reads + escape hatch' as the degraded contract.
   **Fix:** Define one exported DEGRADED_FLOOR constant (e.g. in lib/chat/turn-tools.ts: ['get_current_state','list_products','get_product_info','escalate_to_human']) and use it for BOTH the LLM tool list and toolContext.exposedTools, with a test asserting they match.
5. **[A3.5 (GUI confirm round-trip)]** A3.5 stops the accept_quote button self-confirming and emits a confirm_required ui_action carrying the token — but no task gives the GUI a consumer for that event. Today one click works end-to-end; after A3.5 the first click produces an SSE event nothing renders, so the GUI accept/sign flows dead-end until some unspecified later work. M4 (binding) makes the uiAction contract + adapter migration an explicit Block A item, and A3.7 step 4 only probes via curl/SSE, which would mask the UI regression.
   **Fix:** Add a task to A3: handle type:'confirm_required' in the chat UI (components/chat — render a confirm dialog from payload.preview, on confirm POST the same action with payload.confirmToken), with a component test; or, if the GUI render is deliberately owned by another block, ship A3.5 and that block in the same release train and state the dependency in A3.5's depends_on — as drafted there is an unmanaged regression window.

### ➕ Addendum tasks for A3 (binding — coverage-critic gaps)

### Task A3.ADD-1: State-read surface per ratified T13.D8 + flagsForReview (closes G1)
**Files:**
- Modify: `lib/tools/registry.ts` (retire `get_application_status`; keep `get_current_state` as the single on-demand detail read, re-backed by deriveAndExpose)
- Modify: the stateGrounding section builder (inject the compact DerivedStateV3 summary every turn)
- Test: `__tests__/lib/chat/state-read-surface.test.ts`
**Steps:**
- [ ] Step 1: Failing test:
```ts
import { describe, it, expect } from 'vitest'
import { getToolDefinition } from '@/lib/tools/registry'

describe('T13.D8 hybrid state surface', () => {
  it('get_application_status is retired', () => {
    expect(getToolDefinition('get_application_status')).toBeUndefined()
  })
  it('get_current_state survives as the single detail read', () => {
    expect(getToolDefinition('get_current_state')).toBeDefined()
  })
})
```
- [ ] Step 2: Run — FAIL (get_application_status still registered).
- [ ] Step 3: Remove the `get_application_status` registration + handler + references; re-back `get_current_state` with `deriveAndExpose` output (full DerivedStateV3 + actions). Surface `flagsForReview` (alert-worthy facts: conflict-state fields, REFERRED application, expiring DNT) as a field of DerivedStateV3 rendered in the injected summary.
- [ ] Step 4: Run test + full suite — PASS.
- [ ] Step 5: Commit: `git commit -m "feat(tools): hybrid state surface per T13.D8 — inject summary, one detail read"`

### Task A3.ADD-2: Degraded-mode exposure + retry policy (closes G8, M10.3/M10.4)
**Files:**
- Modify: `lib/engines/` deriveAndExpose (circuit state as snapshot input → `temporarily_unavailable` blocked reason)
- Modify: `lib/tools/executor.ts` (reads may retry once on transient infra failure; commits NEVER auto-retry)
- Test: `__tests__/lib/engines/degraded-exposure.test.ts`
**Steps:**
- [ ] Step 1: Failing tests:
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '@/__tests__/helpers/snapshots'

describe('M10 degraded-mode exposure', () => {
  it('an action whose backend circuit is open is blocked with temporarily_unavailable', () => {
    const snap = makeSnapshot({ degraded: ['initiate_payment_backend'] })
    const { actions } = deriveAndExpose(snap)
    const blocked = actions.blocked.find((b) => b.reason === 'temporarily_unavailable')
    expect(blocked).toBeDefined()
  })
  it('escalate_to_human is exposed in every snapshot (the floor)', () => {
    const { actions } = deriveAndExpose(makeSnapshot({ degraded: ['everything'] }))
    expect(actions.available).toContain('escalate_to_human')
  })
})
```
- [ ] Step 2: Run — FAIL. Step 3: add `degraded: string[]` to DomainSnapshot (loader reads the circuit-breaker registry); exposure predicate consults it; executor: wrap read-partition handlers with a single transient retry, commit partition with none (transient failure → envelope `{outcome:'unavailable', retryable:true}`). Step 4: PASS + full suite. Step 5: commit.

### Task A3.ADD-3: translations.ts keys per ReasonCode (closes G14, M6 GUI leg)
**Files:**
- Modify: `lib/i18n/translations.ts`
- Test: `__tests__/lib/i18n/reason-codes.test.ts`
**Steps:**
- [ ] Step 1: Failing test: for each member of `REASON_CODES`, `translations.ro.reasonCodes[code]` and `translations.en.reasonCodes[code]` are non-empty strings.
```ts
import { REASON_CODES } from '@/lib/engines/domain-types'
import { translations } from '@/lib/i18n/translations'
it('every ReasonCode has ro+en GUI strings', () => {
  for (const code of REASON_CODES) {
    expect(translations.ro.reasonCodes?.[code], code).toBeTruthy()
    expect(translations.en.reasonCodes?.[code], code).toBeTruthy()
  }
})
```
- [ ] Step 2: FAIL → Step 3: author the ro/en strings (short, customer-safe). Step 4: PASS. Step 5: commit.

## Package A4: A4 — Prompt sections rework per (phase, subphase) with M13 acceptance criteria

**Execution slot:** 4 | **Depends on:** A1, A3

**Goal:** Replace the A1 content-preserving section mapping with the target T10.D4 design: DISCOVERY absorbs SELECTION's product/coaching content; APPLICATION/DNT gets a new dntContext section (heir of CONSENT's compliance payload); PAYMENT/POLICY get new paymentContext/policyContext sections (no sales coaching post-close); the situational briefing becomes sub-stage aware with per-stage facts. M13 is enforced literally: behavioral-content inventory BEFORE any rework, old→new mapping as a committed doc, no content dropped without a 'retired because X' note, and scripts/verify-pathology1..4.ts green before AND after.

**Migrations / seeds:**
- No schema migration. prisma/seeds/seed-agents.ts may receive prompt-prose updates found by the inventory (reseed via npx tsx scripts/reseed-agents.ts).

### Task A4.1: Behavioral-content inventory + pathology baseline (M13 criterion a/b — BEFORE any rework)
**Files:**
- Create: docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Run the four pathology scripts and record the baseline verbatim in the doc: `npx tsx scripts/verify-pathology1.ts 3 && npx tsx scripts/verify-pathology2.ts && npx tsx scripts/verify-pathology3.ts && npx tsx scripts/verify-pathology4.ts` — all must be CLEAN before touching sections (abort the package if not; fix first).
- [ ] Step 2: Inventory EVERY shipped prompt section: read lib/chat/prompt-builder.ts SECTION_REGISTRY (15 keys), every loader in lib/chat/context-loaders.ts, lib/chat/phase-sections-map.ts, and the seeded Agent.systemPrompt/constraints in prisma/seeds/seed-agents.ts. For each behavioral rule record: section key | rule text (quoted) | pathology/scenario it serves (P1 tool-narration, P2 deflection loop, P3 forced choices, P4 empty-category, catalog-overview guardrails, out-of-scope-decline, consultative-pushback) | target home (phase,subphase) or 'retired because X'.
- [ ] Step 3: Write the old→new mapping table (M13 criterion b): each old phase-key section set → its (phase, subphase) destination, including: CONSENT.complianceGuidance → APPLICATION/DNT dntContext+complianceGuidance; SELECTION extras → DISCOVERY; CLOSING set → split QUOTE vs PAYMENT/POLICY; workflowInstructions → retired (dead workflow machine, content salvaged if any).
- [ ] Step 4: Verify completeness: every SECTION_REGISTRY key appears in the doc exactly once with a destination or a 'retired because X' note (M13 criterion c). No rule may be silently dropped.
- [ ] Step 5: Commit: `git add docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md && git commit -m "docs(A4): behavioral prompt-content inventory + pathology baseline (M13 a-c)"`

### Task A4.2: New sections — dntContext, paymentContext, policyContext
**Files:**
- Modify: lib/chat/prompt-builder.ts (PromptSections + SECTION_REGISTRY gain three keys), lib/chat/context-loaders.ts (three pure renderers from DerivedStateV3)
- Test: __tests__/lib/chat/new-sections.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { loadDntContext, loadPaymentContext, loadPolicyContext } from '@/lib/chat/context-loaders'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('new (phase,subphase) sections', () => {
  it('dntContext renders DNT progress + consent status during APPLICATION/DNT', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true } }))
    const text = loadDntContext(r.state)
    expect(text).toContain('DNT progress: 2/5')
    expect(text).toContain('GDPR consent: missing')
  })
  it('paymentContext renders schedule facts and contains NO sales coaching', () => {
    const r = deriveAndExpose(makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: '2026-06-01T00:00:00.000Z' }, schedule: { exists: true, settled: false, nextDueAt: '2026-07-01T00:00:00.000Z', lastPaymentStatus: 'FAILED' } }))
    const text = loadPaymentContext(r.state)
    expect(text).toContain('Last payment status: FAILED')
    expect(text?.toLowerCase()).not.toContain('playbook')
  })
  it('policyContext renders policy status; engine-gated language rule included (never claim in-force before ACTIVE)', () => {
    const r = deriveAndExpose(makeSnapshot({ policy: { id: 'p', status: 'PENDING_SUBMISSION' } }))
    const text = loadPolicyContext(r.state)
    expect(text).toContain('Policy status: PENDING_SUBMISSION')
    expect(text).toContain('never describe the policy as active or in force')
  })
  it('renderers return null outside their phase', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(loadDntContext(r.state)).toBeNull()
    expect(loadPaymentContext(r.state)).toBeNull()
    expect(loadPolicyContext(r.state)).toBeNull()
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/new-sections.test.ts` — loaders missing.
- [ ] Step 3: Minimal implementation — context-loaders.ts:
```ts
import type { DerivedStateV3 } from '@/lib/engines/domain-types'
export function loadDntContext(state: DerivedStateV3): string | null {
  if (state.phase !== 'APPLICATION' || state.subphase !== 'DNT') return null
  return [
    `DNT progress: ${state.dnt.answeredCount}/${state.dnt.totalCount}`,
    `DNT signed: ${state.dnt.signed ? 'yes (valid until ' + state.dnt.validUntil + ')' : 'no'}`,
    `GDPR consent: ${state.consents.gdprProcessing ? 'granted' : 'missing'}`,
    `AI disclosure: ${state.consents.aiDisclosure ? 'acknowledged' : 'missing'}`,
    'The needs analysis (DNT) is a regulatory requirement: complete the remaining questions, then obtain explicit signature via sign_dnt. Consent is captured at signing — never claim consent that is not recorded in state.',
  ].join('\n')
}
export function loadPaymentContext(state: DerivedStateV3): string | null {
  if (state.phase !== 'PAYMENT') return null
  return [
    `Schedule: ${state.schedule.exists ? 'active' : 'none'}; next due: ${state.schedule.nextDueAt ?? 'n/a'}`,
    `Last payment status: ${state.schedule.lastPaymentStatus ?? 'none'}`,
    'The sale is closed — no selling, no upgrades. Focus on completing or recovering the payment. If a payment failed, state the failure factually and offer the retry action exposed by the engine.',
  ].join('\n')
}
export function loadPolicyContext(state: DerivedStateV3): string | null {
  if (state.phase !== 'POLICY' || !state.policy) return null
  return [
    `Policy status: ${state.policy.status}`,
    'Language is engine-gated: never describe the policy as active or in force unless status is ACTIVE. Between payment and activation say it is paid and being processed.',
  ].join('\n')
}
```
prompt-builder.ts: add `dntContext`, `paymentContext`, `policyContext` to PromptSections and SECTION_REGISTRY as dynamic sections (priorities 16-18, alwaysInclude:false, prefixes '=== NEEDS ANALYSIS (DNT) ===', '=== PAYMENT ===', '=== POLICY ==='). Orchestrator populates them from exposure.state right where situationalBriefing is patched.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/new-sections.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): dntContext/paymentContext/policyContext sections (A4.2)"`

### Task A4.3: Target sections map per the inventory (T10.D4)
**Files:**
- Modify: lib/chat/phase-sections-map.ts (target map replaces the A1 content-preserving mapping; workflowInstructions removed from ALWAYS per inventory note)
- Test: __tests__/lib/chat/phase-sections-map.test.ts (extend/replace)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
it('TARGET map: APPLICATION/DNT injects dntContext; PAYMENT injects paymentContext and NO coaching; POLICY injects policyContext', () => {
  expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toEqual(expect.arrayContaining(['dntContext', 'complianceGuidance']))
  const pay = getRequiredSectionsFor('PAYMENT', null)
  expect(pay).toContain('paymentContext')
  expect(pay).not.toContain('coachingBriefing')
  expect(getRequiredSectionsFor('POLICY', null)).toContain('policyContext')
})
it('workflowInstructions is no longer always included (dead workflow machine — see inventory)', () => {
  expect(getRequiredSectionsFor('DISCOVERY', null)).not.toContain('workflowInstructions')
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts`.
- [ ] Step 3: Minimal implementation — replace the A1 maps with the target:
```ts
const ALWAYS = ['agentIdentity', 'constraints', 'stateGrounding', 'catalogOverview', 'situationalBriefing']
const BY_PHASE: Record<Phase, string[]> = {
  DISCOVERY: ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing'],
  APPLICATION: [],
  QUOTE: ['productContext', 'complianceGuidance'],
  PAYMENT: ['paymentContext'],
  POLICY: ['policyContext'],
}
const BY_SUBPHASE: Record<AppSubphase, string[]> = {
  DNT: ['dntContext', 'complianceGuidance'],
  QUESTIONNAIRE: ['questionnaireContext', 'complianceGuidance'],
  QUOTE_GENERATION: ['productContext', 'complianceGuidance'],
}
```
Every removal must already carry its 'retired because X' line in the A4.1 inventory doc (verify before committing; update the doc if the implementation diverged).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): target per-(phase,subphase) sections map (A4.3)"`

### Task A4.4: Sub-stage-aware situational briefing facts
**Files:**
- Modify: lib/chat/phase-sections-map.ts (formatDerivedBriefing adds per-stage facts: DNT remaining, questionnaire missing, quote validUntil, payment status)
- Test: __tests__/lib/chat/phase-sections-map.test.ts (extend)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
it('briefing renders per-stage facts: quote validity in QUOTE, payment status in PAYMENT', () => {
  const q = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'COMPLETED', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [] }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false }, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false }, quote: { id: 'q1', status: 'DRAFT', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false } }))
  expect(formatDerivedBriefing(q.state, q.actions)).toContain('Quote valid until: 2027-01-01')
  const p = deriveAndExpose(makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: null }, schedule: { exists: true, settled: false, nextDueAt: null, lastPaymentStatus: 'FAILED' } }))
  expect(formatDerivedBriefing(p.state, p.actions)).toContain('Payment status: FAILED')
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts`.
- [ ] Step 3: Minimal implementation — in formatDerivedBriefing add:
```ts
if (state.phase === 'APPLICATION' && state.subphase === 'DNT') lines.push(`DNT remaining: ${state.dnt.totalCount - state.dnt.answeredCount}`)
if (state.phase === 'QUOTE' && state.quote) lines.push(`Quote valid until: ${state.quote.validUntil.slice(0, 10)}`)
if (state.phase === 'PAYMENT') lines.push(`Payment status: ${state.schedule.lastPaymentStatus ?? 'pending'}`)
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/phase-sections-map.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(chat): sub-stage facts in the situational briefing (A4.4)"`

### Task A4.5: Package verification — pathologies green AFTER (M13 criterion d)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx vitest run` — full suite green.
- [ ] Step 2: Re-run ALL pathology verifications against the reworked prompt: `npx tsx scripts/verify-pathology1.ts 3 && npx tsx scripts/verify-pathology2.ts && npx tsx scripts/verify-pathology3.ts && npx tsx scripts/verify-pathology4.ts` — every script CLEAN; append the post-rework results to docs/superpowers/notes/2026-06-zeno-prompt-section-inventory.md next to the baseline.
- [ ] Step 3: `npx tsx scripts/verify-advance-flow.ts 2` — 2/2 (sections rework did not re-introduce stalls).
- [ ] Step 4: Review the inventory doc one final time: every old rule has a destination or a retired-because-X note; commit the updated doc.
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(A4): M13 verification — pathologies 1-4 clean before AND after the sections rework"`

### ➕ Addendum tasks for A4 (binding — coverage-critic gaps)

### Note A4.ADD-1 (binding, no separate task): the APPLICATION-phase section copy must include the T4-R6 soft channel-verification offer ("save your progress") shown only while `identity.tier !== 'verified_channel'` — the trigger data comes from B3's `verificationOffer` envelope flag (see B3.ADD-3); the copy lands here so M13's inventory tracks it.

## Package A5: A5 — Dead-config cleanup: Workflow* machine, SkillPack subsystem (M12, salvage first), registry drift

**Execution slot:** 5 | **Depends on:** A3, A4

**Goal:** After the legality engine owns gating (A3) and the sections rework owns prompt content (A4), delete the dead structures that previously pretended to gate: Workflow/WorkflowStep/StepTransition/WorkflowSession models+seeds+joins+types, the SkillPack subsystem (model, loader, seeds, admin routes, orchestrator merge path) with a mandatory salvage audit FIRST, phantom seed tools, the three drifted 'always allowed' definitions (alwaysAllowed flags, ALWAYS_ALLOWED_SET, isAlwaysAllowed), and the stale '25 TOOLS' banner.

**Migrations / seeds:**
- Migration drop_workflow_machine (destructive, demo data): drop models WorkflowSession, StepTransition, WorkflowStep, Workflow and enum WorkflowSessionStatus; remove Conversation.workflowSession relation.
- Migration drop_skill_packs (destructive): drop model SkillPack (+ implicit Agent↔SkillPack join table), drop Conversation.activeSkillPacks column.
- prisma/seeds/index.ts: remove seed-workflows.ts and seed-skill-packs.ts imports; delete both seed files; delete scripts/reseed-skill-packs.ts and scripts/inspect-playbook-state.ts; full reseed (npx prisma migrate dev + npx tsx prisma/seeds/index.ts).

### Task A5.1: Salvage audit of skill-pack + workflow guidance (M12 mandatory-first)
**Files:**
- Create: docs/superpowers/notes/2026-06-zeno-dead-config-salvage-audit.md
- Modify (ports only): lib/chat/context-loaders.ts / prisma/seeds/seed-agents.ts where still-true guidance gets a new home
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Read prisma/seeds/seed-skill-packs.ts (7 seeded packs: life-insurance-discovery, life-insurance-closing, questionnaire-facilitation, post-sale-onboarding, post-sale-support, post-sale-claims, post-sale-renewal) and prisma/seeds/seed-workflows.ts (per-step agentInstructions). For every guidance paragraph record in the audit doc: source | still true? | new home (A4 section key / seed-agents prose / ProductContent when T11 lands) | or 'retired because X' (playbook PRICES are always retired — prices only from the engine, per M12).
- [ ] Step 2: Port the still-true content into its new homes (edit the A4 section loaders/seed prose accordingly). Hardcoded prices, phase names, and references to dead tools (get_quote, save_customer_field, get_policy_details — phantom, never registered) must NOT be ported.
- [ ] Step 3: Run the pathology scripts to prove the ports changed nothing behaviorally: `npx tsx scripts/verify-pathology1.ts 2 && npx tsx scripts/verify-pathology4.ts` — CLEAN.
- [ ] Step 4: `npx vitest run` — green.
- [ ] Step 5: Commit: `git add -A && git commit -m "docs(A5): skill-pack/workflow salvage audit + content ports (M12 step 1)"`

### Task A5.2: Delete the SkillPack subsystem
**Files:**
- Delete: lib/skills/skill-pack-loader.ts, prisma/seeds/seed-skill-packs.ts, scripts/reseed-skill-packs.ts, scripts/inspect-playbook-state.ts, app/api/admin/skill-packs/ (all routes), app/api/admin/skill-packs/[id]/, __tests__/lib/skills/skill-pack-loader.test.ts, __tests__/lib/skills/pack-contract.test.ts, __tests__/integration/skill-pack-orchestrator.test.ts
- Modify: lib/chat/orchestrator.ts (remove getActiveSkillPacks/mergeSkillPackSections/computeAllowedTools imports + the :594-632 pack/A-B block; state.activeSkillPacks removed), lib/tools/types.ts (ToolContext.activeSkillPacks removed), lib/chat/turn-context.ts (skill-pack query removed), prisma/schema.prisma (SkillPack model + Conversation.activeSkillPacks + Agent.skillPacks dropped), app/api/admin/proposals/[id]/approve/route.ts (flushSkillPackCache call removed)
- Test: __tests__/lib/engines/vocabulary-closure.test.ts (extend as dead-config guard)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Extend the closure meta-test with a failing dead-config assertion:
```ts
it('the SkillPack subsystem is gone (M12)', () => {
  expect(existsSync(path.join(LIB, 'skills/skill-pack-loader.ts'))).toBe(false)
  const offenders = tsFiles(LIB).filter((p) => /SkillPack|activeSkillPacks/.test(readFileSync(p, 'utf8')))
  expect(offenders).toEqual([])
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/vocabulary-closure.test.ts`.
- [ ] Step 3: Delete the listed files; sweep the orchestrator pack/A-B block (mergedSections = sections directly); drop the schema pieces; run `npx prisma migrate dev --name drop_skill_packs && npx prisma generate`; remove seed-skill-packs from prisma/seeds/index.ts; fix every compile error the removal surfaces (turn-context activeSkillPacks join, ToolContext, debug payloads).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(cleanup)!: delete SkillPack subsystem — gating owned by the legality engine, content by sections (A5.2, M12)"`

### Task A5.3: Delete the Workflow machine
**Files:**
- Delete: prisma/seeds/seed-workflows.ts
- Modify: prisma/schema.prisma (Workflow, WorkflowStep, StepTransition, WorkflowSession models + WorkflowSessionStatus enum dropped), lib/chat/turn-context.ts (:95-107 eager join removed), lib/chat/context-loaders.ts (WorkflowSessionData + StateGroundingInput.workflowSession + loadWorkflowInstructions removed), lib/tools/types.ts (ToolContext.workflowSession + PipelineResult.transition + transitionError removed), lib/tools/pipeline.ts (executeToolWithPipeline loses the _workflowSession param; PipelineResult = { toolResult }), lib/chat/orchestrator.ts ([Workflow Transition] branches :896-909 and :1280-1295 removed; workflowSession args at call sites removed; state.workflowSessionId/workflowStepCode removed), lib/chat/prompt-builder.ts (workflowInstructions key removed from PromptSections + SECTION_REGISTRY), prisma/seeds/index.ts
- Test: __tests__/lib/engines/vocabulary-closure.test.ts (extend)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Extend the meta-test with the failing assertion:
```ts
it('the workflow step machine is gone (T1.D3)', () => {
  const offenders = tsFiles(LIB).filter((p) => /WorkflowSession|WorkflowStep|StepTransition|workflowInstructions/.test(readFileSync(p, 'utf8')))
  expect(offenders).toEqual([])
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/engines/vocabulary-closure.test.ts`.
- [ ] Step 3: Execute the sweep listed under Files (an incomplete sweep is the exact trap being removed — the meta-test enforces completeness); run `npx prisma migrate dev --name drop_workflow_machine && npx prisma generate`; update prisma/seeds/index.ts; fix all compile errors.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(cleanup)!: delete dead Workflow/WorkflowSession machine end-to-end (A5.3)"`

### Task A5.4: Registry hygiene — alwaysAllowed drift dies, banner fixed
**Files:**
- Modify: lib/tools/registry.ts (ALWAYS_ALLOWED_SET const deleted; isAlwaysAllowed deleted; alwaysAllowed flags removed from all registrations; '// REGISTER ALL 25 TOOLS' banner corrected to '// TOOL REGISTRATIONS — exposure is owned by lib/engines/derive-and-expose.ts'), lib/tools/types.ts (ToolDefinition.alwaysAllowed removed)
- Test: __tests__/lib/tools/registry-hygiene.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { getRegisteredToolNames, getToolDefinition } from '@/lib/tools/registry'
import { ACTION_RULES } from '@/lib/engines/derive-and-expose'

describe('registry hygiene', () => {
  it('no alwaysAllowed metadata survives — exposure has exactly one authority', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../lib/tools/registry.ts'), 'utf8')
    expect(src).not.toMatch(/alwaysAllowed/)
    expect(src).not.toMatch(/REGISTER ALL 25 TOOLS/)
  })
  it('every non-internal registered tool has an exposure rule, and every rule names a registered tool', () => {
    const registered = getRegisteredToolNames().filter((n) => getToolDefinition(n)?.kind !== 'internal')
    const ruled = ACTION_RULES.map((r) => r.action)
    expect([...registered].sort()).toEqual([...ruled].sort())
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/tools/registry-hygiene.test.ts`.
- [ ] Step 3: Remove ALWAYS_ALLOWED_SET, isAlwaysAllowed, every `alwaysAllowed:` property and the ToolDefinition field; fix the banner; reconcile any rule/registration mismatch the bidirectional test flushes out (this is the standing guard against the three-definitions drift).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/tools`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(cleanup): retire alwaysAllowed drift; exposure table is the single authority (A5.4)"`

### Task A5.5: Package + block verification
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Fresh DB from zero to prove migrations + seeds are self-contained: `npx prisma migrate reset --force && npx tsx prisma/seeds/index.ts` (demo data — destructive is fine).
- [ ] Step 2: `npx vitest run` — full suite green (instrumentation-flake rule applies).
- [ ] Step 3: Live funnel sim end-to-end: `npx tsx scripts/verify-advance-flow.ts 2` — 2/2; `npx tsx scripts/verify-gateway-concurrency.ts` — OK.
- [ ] Step 4: Pathology sweep: `npx tsx scripts/verify-pathology1.ts 2 && npx tsx scripts/verify-pathology2.ts && npx tsx scripts/verify-pathology3.ts && npx tsx scripts/verify-pathology4.ts` — all CLEAN.
- [ ] Step 5: Commit: `git commit --allow-empty -m "chore(A5): Block A verification — fresh-DB reseed, suite, sims, pathologies all green"`

### ⚠ Binding errata for A5 (fidelity verifier — apply OVER the task text above)

1. **[A5.2/A5.3 Files lists]** The deletion sweep misses two test files the meta-tests won't catch (they only scan lib/): (1) __tests__/lib/skills/advance-flow-tools.test.ts imports SKILL_PACKS from @/prisma/seeds/seed-skill-packs — compilation breaks when A5.2 deletes the seed; (2) __tests__/performance/bench-pipeline.test.ts mocks getActiveSkillPacks/mergeSkillPackSections/computeAllowedTools (lines ~258-262) and workflowSession shapes (line 57) — breaks when A5.2/A5.3 delete the loader module and orchestrator paths.
   **Fix:** Add __tests__/lib/skills/advance-flow-tools.test.ts to A5.2's Delete list (its regression — packs must grant funnel tools — is structurally superseded by A3.1's exposure tests; note that in the salvage audit), and add __tests__/performance/bench-pipeline.test.ts to A5.2's and A5.3's Modify lists (drop the skill-pack/workflow mocks).

### ➕ Addendum tasks for A5 (binding — coverage-critic gaps)

### Task A5.ADD-1: Remove dead registered stubs profile_extractor + summarizer (closes G5)
**Files:**
- Modify: `lib/tools/registry.ts` (delete both registrations)
- Test: `__tests__/lib/tools/dead-stubs.test.ts`
**Steps:**
- [ ] Step 1: Failing test: `getToolDefinition('profile_extractor')` and `getToolDefinition('summarizer')` are undefined.
- [ ] Step 2: FAIL → Step 3: delete registrations + handlers + any references (grep `profile_extractor|summarizer` across lib/ and __tests__/). Step 4: PASS + full suite. Step 5: commit.

---

# BLOCK B — Customer foundation

## Block overview

Block B builds the customer foundation: per-field provenance SSOT (B0), consent ledger (B1), customer-scoped DNT aggregate with the pinned 6-tool surface (B2), identity (channel verification + document pipeline + identity-requirements rows, B3), and the application lifecycle (set_application/select_coverage/status enum/resume/prefill, B4).

Cross-block contracts consumed (by pinned name): A1 = Phase/AppSubphase enums, DomainSnapshot, deriveAndExpose, DerivedStateV3, ExposedActions, ReasonCode (lib/engines/contracts.ts assumed A1-owned); A2 = commit gateway with the pinned #8 ordering, CommitResult/CommitOutcome/CommitEffect, CommitLedger; C1 = consequence planner consuming mutation events (selection changes in B4, verified-field events in B3 per T4-R4); E2 = WorkItem queue (document_review in B3). B packages supply pure predicate modules (lib/engines/*) that A1's deriveAndExpose imports, and snapshot-loader extensions for the slices they own — deriveAndExpose remains the only phase/exposure computer (#6).

Verified code grounding: all paths below exist in the worktree except those marked Create. Notable verified facts reused: DEFAULT_DISCOVERY_TOOLS (lib/chat/default-tools.ts:9-20) contains record_gdpr_consent/acknowledge_ai_disclosure/set_answer/change_selection/switch_product; registry exports getToolDefinition/getAllToolNames (lib/tools/registry.ts:56,64); Answer is @@unique([questionId, conversationId]) (prisma/schema.prisma:483); sign_dnt discards gdprConsent (lib/tools/handlers/dnt-handlers.ts:281-301); the 2026-05-29 customer-SSOT spec is NOT in docs/superpowers/specs (confirmed by listing) — B0 is designed fresh from M1+T4-R2 and the M1 log entry mandates amending that spec doc when it lands.

Deliberate calls requiring reviewer attention: (1) ApplicationStatus exact set = OPEN/PAUSED/REFERRED/COMPLETED/CANCELLED per T5.D6 ✅ option text and M9 inventory — the block-task bullet listed ABANDONED, but the briefing says the T5.D6 option text is authoritative; PAUSED kept, ABANDONED omitted (conversation-level ABANDONED is retired by #11 anyway). (2) gdpr_processing-withdrawn halt exempts withdraw_consent + sign_dnt (re-grant path; otherwise deadlock) + escalate_to_human (M10 floor). (3) Customer keeps email/phone/name/dateOfBirth/cnp* columns as service-maintained mirrors (lookup keys for @unique email and claim matching); extractedProfile and the consent/dnt/magic-link columns are dropped. Demo data throughout: destructive migrations + reseed, no backfills (M9).

## Package B0: CustomerProfile SSOT: per-field provenance store + ONE service + claim-and-merge (M1)

**Execution slot:** 6 | **Depends on:** A1

**Goal:** One provenance-tracked field store (declared|verified|conflict + source + evidence pointer + timestamp), one CustomerProfile service as the sole read/write path for profile facts, age always derived (DOB → declaredAge precedence), extractedProfile divergence retired, and the claim-and-merge primitive that later packages re-point their aggregates through.

**Migrations / seeds:**
- Add enum FieldProvenance { declared verified conflict } and model CustomerProfileField { id, customerId, field, value, provenance, source, evidenceRef?, conflictValue?, conflictSource?, recordedAt, updatedAt, @@unique([customerId, field]) } (cnp values stored as the AES-GCM JSON envelope, never plaintext)
- Customer: DROP extractedProfile (destructive, demo data); ADD mergedIntoId String? + mergedAt DateTime? (tombstone); add profileFields relation
- Retire update_customer_profile from lib/tools/registry.ts (its extractedProfile JSON merge is the divergence M1 kills); remove any seed/pack grants referencing it
- Seeds: prisma/seeds updated so no seed writes extractedProfile; npx prisma migrate dev --name b0_customer_profile_ssot + npx prisma db seed

### Task B0.1: Schema + test-DB harness
**Files:**
- Modify: prisma/schema.prisma (FieldProvenance enum, CustomerProfileField model, Customer.mergedIntoId/mergedAt, drop extractedProfile)
- Create: __tests__/helpers/test-db.ts
- Modify: lib/tools/handlers/profile-handlers.ts (remove extractedProfile reads — temporary `fields: {}` until B0.4), lib/tools/registry.ts (delete update_customer_profile registration)
- Test: __tests__/integration/customer-profile-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'

describe('CustomerProfileField schema', () => {
  beforeAll(async () => { await resetDb() })
  it('enforces one row per (customerId, field)', async () => {
    const c = await createCustomer()
    await prisma.customerProfileField.create({ data: { customerId: c.id, field: 'email', value: 'a@b.ro', provenance: 'declared', source: 't' } })
    await expect(prisma.customerProfileField.create({ data: { customerId: c.id, field: 'email', value: 'x@y.ro', provenance: 'declared', source: 't' } })).rejects.toThrow(/Unique constraint/)
  })
  it('Customer has tombstone columns and no extractedProfile', async () => {
    const dup = await createCustomer(); const canon = await createCustomer()
    const u = await prisma.customer.update({ where: { id: dup.id }, data: { mergedIntoId: canon.id, mergedAt: new Date() } })
    expect(u.mergedIntoId).toBe(canon.id)
    expect('extractedProfile' in u).toBe(false)
  })
})
```
And the harness (guards against truncating a non-test DB):
```ts
// __tests__/helpers/test-db.ts
import { prisma } from '@/lib/db'
const TABLES = ['Answer','Quote','Application','Message','Conversation','CustomerProfileField','CustomerInsight','Customer'] // extended by B1-B4
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes('test') && process.env.ZENO_ALLOW_DB_TESTS !== '1') throw new Error('refusing truncate: not a test DB')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map(t=>`\"${t}\"`).join(', ')} RESTART IDENTITY CASCADE`)
}
export async function createCustomer(data: Record<string, unknown> = {}) { return prisma.customer.create({ data: { language: 'ro', ...data } }) }
```
- [ ] Step 2: `npx vitest run __tests__/integration/customer-profile-schema.test.ts` → FAIL (customerProfileField undefined on PrismaClient)
- [ ] Step 3: Add to prisma/schema.prisma:
```prisma
enum FieldProvenance { declared verified conflict }
model CustomerProfileField {
  id             String          @id @default(cuid())
  customerId     String
  field          String
  value          String
  provenance     FieldProvenance
  source         String
  evidenceRef    String?
  conflictValue  String?
  conflictSource String?
  recordedAt     DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  customer Customer @relation(fields: [customerId], references: [id])
  @@unique([customerId, field])
}
```
On Customer: remove `extractedProfile Json?`, add `mergedIntoId String?`, `mergedAt DateTime?`, `profileFields CustomerProfileField[]`. Run `npx prisma migrate dev --name b0_customer_profile_ssot && npx prisma db seed`. Grep `extractedProfile` across lib/ and app/ and remove remaining reads (profile-handlers returns empty fields until B0.4); delete the update_customer_profile registerTool block and handler.
- [ ] Step 4: `npx vitest run __tests__/integration/customer-profile-schema.test.ts` → PASS; `npx tsc --noEmit` clean
- [ ] Step 5: `git add -A && git commit -m "feat(customer): CustomerProfileField provenance store + tombstone columns, retire extractedProfile"`

### Task B0.2: Pure provenance rules (T12.D3 decision core — no prisma)
**Files:**
- Create: lib/engines/provenance-rules.ts
- Test: __tests__/lib/engines/provenance-rules.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { resolveDeclaredWrite, resolveVerifiedWrite, mergeFieldRecords } from '@/lib/engines/provenance-rules'
const at = (s: string) => new Date(s)
const dec = (value: string, recordedAt = at('2026-01-01')) => ({ value, provenance: 'declared' as const, source: 't', recordedAt })
const ver = (value: string, recordedAt = at('2026-01-02')) => ({ value, provenance: 'verified' as const, source: 'doc', evidenceRef: 'ev1', recordedAt })

it('fresh declared write applies; newer declared overwrites older', () => {
  expect(resolveDeclaredWrite(null, { value: 'Ana', source: 's', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'declared' } })
  expect(resolveDeclaredWrite(dec('Ana'), { value: 'Ana-Maria', source: 's', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { value: 'Ana-Maria' } })
})
it('declared can never displace verified (T4-R3)', () => {
  expect(resolveDeclaredWrite(ver('1980418089861'), { value: '2950715123458', source: 's', at: at('2026-06-01') })).toEqual({ action: 'reject', reason: 'field_verified_immutable' })
  expect(resolveDeclaredWrite(ver('Ana'), { value: 'Ana', source: 's', at: at('2026-06-01') })).toEqual({ action: 'noop' })
})
it('verified write: diacritics-insensitive match flips to verified, mismatch flags conflict keeping both', () => {
  expect(resolveVerifiedWrite(dec('Stefan Popa'), { value: 'Ștefan Popa', source: 'doc', evidenceRef: 'e', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'verified' } })
  expect(resolveVerifiedWrite(dec('Ion Popa'), { value: 'Ion Popescu', source: 'doc', evidenceRef: 'e', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'conflict', conflictValue: 'Ion Popa' } })
})
it('merge: verified beats declared; newer declared beats older; differing verified → conflict', () => {
  expect(mergeFieldRecords(dec('a@x.ro'), ver('b@x.ro'))).toMatchObject({ provenance: 'verified', value: 'b@x.ro' })
  expect(mergeFieldRecords(dec('old', at('2026-01-01')), dec('new', at('2026-02-01')))).toMatchObject({ value: 'new' })
  expect(mergeFieldRecords(ver('111'), ver('222'))).toMatchObject({ provenance: 'conflict' })
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/engines/provenance-rules.test.ts` → FAIL (module not found)
- [ ] Step 3: Implement:
```ts
// lib/engines/provenance-rules.ts — PURE, no prisma (T12.D3)
export type ProvenanceState = 'declared' | 'verified' | 'conflict'
export interface FieldRecord { value: string; provenance: ProvenanceState; source: string; evidenceRef?: string | null; conflictValue?: string | null; conflictSource?: string | null; recordedAt: Date }
export type WriteDecision = { action: 'write'; next: FieldRecord } | { action: 'noop' } | { action: 'reject'; reason: 'field_verified_immutable' }
export function normalizeForMatch(s: string): string { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ') }
export function resolveDeclaredWrite(existing: FieldRecord | null, inc: { value: string; source: string; at: Date }): WriteDecision {
  if (!existing || existing.provenance === 'declared') {
    if (existing && existing.value === inc.value) return { action: 'noop' }
    return { action: 'write', next: { value: inc.value, provenance: 'declared', source: inc.source, recordedAt: inc.at } }
  }
  return normalizeForMatch(existing.value) === normalizeForMatch(inc.value) ? { action: 'noop' } : { action: 'reject', reason: 'field_verified_immutable' }
}
export function resolveVerifiedWrite(existing: FieldRecord | null, inc: { value: string; source: string; evidenceRef: string; at: Date }): WriteDecision {
  const next: FieldRecord = { value: inc.value, provenance: 'verified', source: inc.source, evidenceRef: inc.evidenceRef, recordedAt: inc.at }
  if (existing?.provenance === 'declared' && normalizeForMatch(existing.value) !== normalizeForMatch(inc.value))
    return { action: 'write', next: { ...next, provenance: 'conflict', conflictValue: existing.value, conflictSource: existing.source } }
  return { action: 'write', next }
}
export function mergeFieldRecords(a: FieldRecord | null, b: FieldRecord | null): FieldRecord | null {
  if (!a) return b; if (!b) return a
  const rank = (r: FieldRecord) => (r.provenance === 'declared' ? 0 : 1)
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b
  if (a.provenance === 'declared') return a.recordedAt >= b.recordedAt ? a : b
  if (normalizeForMatch(a.value) === normalizeForMatch(b.value)) return a.recordedAt >= b.recordedAt ? a : b
  const w = a.recordedAt >= b.recordedAt ? a : b; const l = w === a ? b : a
  return { ...w, provenance: 'conflict', conflictValue: l.value, conflictSource: l.source }
}
```
- [ ] Step 4: `npx vitest run __tests__/lib/engines/provenance-rules.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(engines): pure provenance write/merge rules (verified beats declared, conflicts surfaced)"`

### Task B0.3: profile-service — sole read/write path, derived age
**Files:**
- Create: lib/customer/profile-service.ts
- Test: __tests__/integration/profile-service.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { setDeclaredField, setVerifiedField, getProfile, getAge } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetDb() })
it('declared write lands with provenance and maintains the Customer mirror columns', async () => {
  const c = await createCustomer()
  expect((await setDeclaredField(c.id, 'email', 'ana@example.ro', 'collect_customer_field')).outcome).toBe('applied')
  expect((await getProfile(c.id)).fields.email).toMatchObject({ value: 'ana@example.ro', provenance: 'declared' })
  expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.email).toBe('ana@example.ro')
})
it('declared over differing verified → rejected(field_verified_immutable)', async () => {
  const c = await createCustomer()
  await setVerifiedField(c.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  expect(await setDeclaredField(c.id, 'name', 'Alt Nume', 'collect_customer_field')).toMatchObject({ outcome: 'rejected', reason: 'field_verified_immutable' })
})
it('age derives DOB → declaredAge, never stored', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'declaredAge', '41', 'chat')
  expect(await getAge(c.id)).toBe(41)
  await setDeclaredField(c.id, 'dateOfBirth', '1990-05-01', 'collect_customer_field')
  expect(await getAge(c.id)).toBeGreaterThanOrEqual(35)
  expect((await getProfile(c.id)).fields).not.toHaveProperty('age')
})
it('cnp is stored encrypted and masked on read', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'cnp', '1980418089861', 'collect_customer_field')
  const row = await prisma.customerProfileField.findUnique({ where: { customerId_field: { customerId: c.id, field: 'cnp' } } })
  expect(row!.value).not.toContain('1980418089861')
  expect((await getProfile(c.id)).fields.cnp!.value).toMatch(/^1980\*{6}861$/)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/profile-service.test.ts` → FAIL (module not found)
- [ ] Step 3: Implement:
```ts
// lib/customer/profile-service.ts — the ONLY read/write path for profile facts (M1)
import { prisma } from '@/lib/db'
import { encrypt, decrypt, maskCnp } from '@/lib/security/encryption'
import { resolveDeclaredWrite, resolveVerifiedWrite, type FieldRecord } from '@/lib/engines/provenance-rules'
export type ProfileFieldName = 'name' | 'cnp' | 'dateOfBirth' | 'declaredAge' | 'email' | 'phone' | 'address'
export type ProfileWriteResult = { outcome: 'applied'; provenance: FieldRecord['provenance'] } | { outcome: 'rejected'; reason: 'field_verified_immutable' }
type Db = Pick<typeof prisma, 'customerProfileField' | 'customer'>
const MIRROR: Partial<Record<ProfileFieldName, (v: string) => Record<string, unknown>>> = {
  email: v => ({ email: v }), phone: v => ({ phone: v.replace(/[\s-]/g, '') }), name: v => ({ name: v }),
  dateOfBirth: v => ({ dateOfBirth: new Date(v) }),
  cnp: v => { const e = encrypt(v); return { cnpEncrypted: e.encrypted, cnpIv: e.iv, cnpTag: e.tag } },
}
const encode = (f: ProfileFieldName, v: string) => f === 'cnp' ? JSON.stringify(encrypt(v)) : v
const decode = (f: ProfileFieldName, v: string) => { if (f !== 'cnp') return v; const e = JSON.parse(v); return decrypt(e.encrypted, e.iv, e.tag) }
async function applyWrite(db: Db, customerId: string, field: ProfileFieldName, decision: ReturnType<typeof resolveDeclaredWrite>): Promise<ProfileWriteResult> {
  if (decision.action === 'reject') return { outcome: 'rejected', reason: decision.reason }
  if (decision.action === 'write') {
    const n = decision.next
    await db.customerProfileField.upsert({
      where: { customerId_field: { customerId, field } },
      create: { customerId, field, value: encode(field, n.value), provenance: n.provenance, source: n.source, evidenceRef: n.evidenceRef, conflictValue: n.conflictValue, conflictSource: n.conflictSource, recordedAt: n.recordedAt },
      update: { value: encode(field, n.value), provenance: n.provenance, source: n.source, evidenceRef: n.evidenceRef, conflictValue: n.conflictValue, conflictSource: n.conflictSource, recordedAt: n.recordedAt },
    })
    if (MIRROR[field]) await db.customer.update({ where: { id: customerId }, data: MIRROR[field]!(n.value) })
    return { outcome: 'applied', provenance: n.provenance }
  }
  return { outcome: 'applied', provenance: 'declared' }
}
async function existingRecord(db: Db, customerId: string, field: ProfileFieldName): Promise<FieldRecord | null> {
  const r = await db.customerProfileField.findUnique({ where: { customerId_field: { customerId, field } } })
  return r ? { ...r, value: decode(field, r.value) } as FieldRecord : null
}
export async function setDeclaredField(customerId: string, field: ProfileFieldName, value: string, source: string, db: Db = prisma): Promise<ProfileWriteResult> {
  return applyWrite(db, customerId, field, resolveDeclaredWrite(await existingRecord(db, customerId, field), { value, source, at: new Date() }))
}
export async function setVerifiedField(customerId: string, field: ProfileFieldName, value: string, source: string, evidenceRef: string, db: Db = prisma): Promise<ProfileWriteResult> {
  return applyWrite(db, customerId, field, resolveVerifiedWrite(await existingRecord(db, customerId, field), { value, source, evidenceRef, at: new Date() }))
}
export async function getProfile(customerId: string) {
  const rows = await prisma.customerProfileField.findMany({ where: { customerId } })
  const fields: Record<string, unknown> = {}
  for (const r of rows) fields[r.field] = { ...r, value: r.field === 'cnp' ? maskCnp(decode('cnp', r.value)) : r.value }
  return { customerId, fields, conflicts: rows.filter(r => r.provenance === 'conflict').map(r => r.field) }
}
export async function getAge(customerId: string, now = new Date()): Promise<number | null> {
  const dob = await existingRecord(prisma, customerId, 'dateOfBirth')
  if (dob) { const d = new Date(dob.value); let a = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--; return a }
  const decl = await existingRecord(prisma, customerId, 'declaredAge')
  return decl ? Number(decl.value) : null
}
```
- [ ] Step 4: `npx vitest run __tests__/integration/profile-service.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(customer): profile-service as sole profile read/write path; age derived DOB→declaredAge"`

### Task B0.4: Re-route writers/readers through the service
**Files:**
- Modify: lib/tools/handlers/data-handlers.ts (collect_customer_field writes via setDeclaredField; surface rejected reason)
- Modify: lib/tools/handlers/profile-handlers.ts (get_customer_profile re-backed: profile + provenance + conflicts + history summary; M2 keeps the name)
- Test: __tests__/integration/profile-routing.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { getCustomerProfile } from '@/lib/tools/handlers/profile-handlers'
import { getProfile, setVerifiedField } from '@/lib/customer/profile-service'
import { getToolDefinition } from '@/lib/tools/registry'

beforeEach(async () => { await resetDb() })
const ctx = (id: string) => ({ customerId: id, conversationId: 'conv-x', language: 'ro' as const })
it('collect_customer_field writes through the service with declared provenance', async () => {
  const c = await createCustomer()
  const r = await collectCustomerField({ field: 'email', value: 'ana@example.ro' }, ctx(c.id) as never)
  expect(r.success).toBe(true)
  expect((await getProfile(c.id)).fields.email).toMatchObject({ provenance: 'declared' })
})
it('collect_customer_field surfaces field_verified_immutable instead of overwriting', async () => {
  const c = await createCustomer()
  await setVerifiedField(c.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  const r = await collectCustomerField({ field: 'name', value: 'Alt Nume' }, ctx(c.id) as never)
  expect(r.success).toBe(false)
  expect(r.error).toContain('field_verified_immutable')
})
it('get_customer_profile exposes provenance; update_customer_profile is retired', async () => {
  const c = await createCustomer()
  await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(c.id) as never)
  const p = await getCustomerProfile({}, ctx(c.id) as never)
  expect((p.data as { profile: { fields: Record<string, { provenance: string }> } }).profile.fields.email.provenance).toBe('declared')
  expect(getToolDefinition('update_customer_profile')).toBeUndefined()
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/profile-routing.test.ts` → FAIL (data-handlers still writes prisma.customer directly; profile payload lacks fields/provenance)
- [ ] Step 3: In data-handlers.ts replace the `prisma.customer.update({ data: updateData })` block (lines 145-183) with a single `const w = await setDeclaredField(context.customerId, field as ProfileFieldName, trimmedValue, 'collect_customer_field')`; on `w.outcome === 'rejected'` return `{ success: false, error: \`Cannot overwrite a verified value (field_verified_immutable). A document or operator override is required.\` }`. Keep field validation, FIELD_ORDER next-field logic (read presence via getProfile), and the isAnonymous flip unchanged (B3 retires its meaning). In profile-handlers.ts getCustomerProfile: build `profile.fields` from `getProfile(customerId)`, keep recentConversations/policies summary.
- [ ] Step 4: `npx vitest run __tests__/integration/profile-routing.test.ts __tests__/integration/profile-service.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(customer): route collect_customer_field + get_customer_profile through the SSOT service"`

### Task B0.5: claim-and-merge primitive
**Files:**
- Create: lib/customer/claim-merge.ts
- Test: __tests__/integration/claim-merge.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { claimAndMerge } from '@/lib/customer/claim-merge'
import { setDeclaredField, setVerifiedField, getProfile } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetDb() })
it('re-points conversations, merges fields by provenance rule, tombstones the duplicate, frees the unique email', async () => {
  const canon = await createCustomer()
  await setVerifiedField(canon.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  const dup = await createCustomer()
  await setDeclaredField(dup.id, 'name', 'Ionel Popescu', 'collect_customer_field')
  await setDeclaredField(dup.id, 'email', 'ion@example.ro', 'collect_customer_field')
  const conv = await prisma.conversation.create({ data: { customerId: dup.id } })
  const report = await claimAndMerge(dup.id, canon.id)
  expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.customerId).toBe(canon.id)
  const p = await getProfile(canon.id)
  expect(p.fields.name).toMatchObject({ provenance: 'verified', value: 'Ion Popescu' }) // verified beats declared
  expect(p.fields.email).toMatchObject({ value: 'ion@example.ro' }) // moved to canonical
  const tomb = await prisma.customer.findUnique({ where: { id: dup.id } })
  expect(tomb?.mergedIntoId).toBe(canon.id)
  expect(tomb?.email).toBeNull() // mirror cleared so canonical can hold the @unique value
  expect(report.repointed.Conversation).toBe(1)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/claim-merge.test.ts` → FAIL (module not found)
- [ ] Step 3: Implement with an extensible re-point registry (B1/B2/B3 append their tables):
```ts
// lib/customer/claim-merge.ts
import { prisma } from '@/lib/db'
import { mergeFieldRecords, type FieldRecord } from '@/lib/engines/provenance-rules'
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
export interface MergeReport { canonicalId: string; tombstonedId: string; repointed: Record<string, number>; conflicts: string[] }
type Repointer = { table: string; run: (tx: Tx, dup: string, canon: string) => Promise<number> }
export const REPOINTERS: Repointer[] = [
  { table: 'Conversation', run: async (tx, d, c) => (await tx.conversation.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Application', run: async (tx, d, c) => (await tx.application.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Quote', run: async (tx, d, c) => (await tx.quote.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Policy', run: async (tx, d, c) => (await tx.policy.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'Payment', run: async (tx, d, c) => (await tx.payment.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  { table: 'CustomerInsight', run: async (tx, d, c) => (await tx.customerInsight.updateMany({ where: { customerId: d }, data: { customerId: c } })).count },
  // B1 appends ConsentEvent; B2 appends Dnt + DntSession; B3 appends VerificationChallenge + CustomerDocument
]
const MIRROR_FIELDS = ['email', 'phone', 'name', 'dateOfBirth'] as const
export async function claimAndMerge(duplicateId: string, canonicalId: string): Promise<MergeReport> {
  return prisma.$transaction(async tx => {
    const repointed: Record<string, number> = {}
    for (const r of REPOINTERS) repointed[r.table] = await r.run(tx, duplicateId, canonicalId)
    const [dupF, canF] = await Promise.all([
      tx.customerProfileField.findMany({ where: { customerId: duplicateId } }),
      tx.customerProfileField.findMany({ where: { customerId: canonicalId } }),
    ])
    const canByField = new Map(canF.map(f => [f.field, f]))
    const conflicts: string[] = []
    for (const f of dupF) {
      const merged = mergeFieldRecords(canByField.get(f.field) as FieldRecord | undefined ?? null, f as unknown as FieldRecord)!
      if (merged.provenance === 'conflict') conflicts.push(f.field)
      await tx.customerProfileField.upsert({
        where: { customerId_field: { customerId: canonicalId, field: f.field } },
        create: { customerId: canonicalId, field: f.field, value: merged.value, provenance: merged.provenance, source: merged.source, evidenceRef: merged.evidenceRef, conflictValue: merged.conflictValue, conflictSource: merged.conflictSource, recordedAt: merged.recordedAt },
        update: { value: merged.value, provenance: merged.provenance, source: merged.source, evidenceRef: merged.evidenceRef, conflictValue: merged.conflictValue, conflictSource: merged.conflictSource, recordedAt: merged.recordedAt },
      })
      await tx.customerProfileField.delete({ where: { id: f.id } })
    }
    // tombstone: clear unique/PII mirrors on the duplicate FIRST, then mirror winners onto canonical
    const dupRow = await tx.customer.findUniqueOrThrow({ where: { id: duplicateId } })
    await tx.customer.update({ where: { id: duplicateId }, data: { email: null, phone: null, name: null, dateOfBirth: null, cnpEncrypted: null, cnpIv: null, cnpTag: null, mergedIntoId: canonicalId, mergedAt: new Date(), isAnonymous: true } })
    const canonRow = await tx.customer.findUniqueOrThrow({ where: { id: canonicalId } })
    const mirror: Record<string, unknown> = {}
    for (const mf of MIRROR_FIELDS) if (canonRow[mf] == null && dupRow[mf] != null) mirror[mf] = dupRow[mf]
    const winners = await tx.customerProfileField.findMany({ where: { customerId: canonicalId, field: { in: ['email','phone','name'] } } })
    for (const w of winners) mirror[w.field] = w.value
    if (Object.keys(mirror).length) await tx.customer.update({ where: { id: canonicalId }, data: mirror })
    return { canonicalId, tombstonedId: duplicateId, repointed, conflicts }
  })
}
```
- [ ] Step 4: `npx vitest run __tests__/integration/claim-merge.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(customer): claim-and-merge primitive (re-point aggregates, provenance-rule field merge, tombstone)"`

### Task B0.6: Package verification
**Files:**
- Create: scripts/verify-customer-ssot.ts (dev-DB runtime check: declared write → verified overlay → conflict surfaced → merge of two shells)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-customer-ssot.ts: creates two customers on the dev DB, drives setDeclaredField/setVerifiedField/claimAndMerge, prints PASS/FAIL per invariant (verified-beats-declared, age-derived, tombstone, email moved), exits non-zero on any FAIL
- [ ] Step 2: `npx prisma migrate dev && npx prisma db seed` → clean
- [ ] Step 3: `npx vitest run` → full suite green (the known __tests__/lib/events/instrumentation.test.ts flake counts as pass when it is the only failure)
- [ ] Step 4: `npx tsx scripts/verify-customer-ssot.ts` → all PASS
- [ ] Step 5: `git add -A && git commit -m "chore(customer): B0 verification script + green suite"`

### ⚠ Binding errata for B0 (fidelity verifier — apply OVER the task text above)

1. **[B0.1/step 1 (test-db harness) + all package verification tasks]** MISSING INFRASTRUCTURE: resetDb throws unless DATABASE_URL contains 'test' or ZENO_ALLOW_DB_TESTS==='1', yet no task provisions a test database, sets either env var, or runs migrate+seed against that DB; every verification task's 'npx vitest run → green' would fail cold (all integration tests throw the refusing-truncate error, or worse, truncate the dev DB if its URL happens to contain 'test'). The integration tests also depend on seeded Product/PricingTier/Question rows surviving truncation — true with the chosen TABLES list, but nothing seeds the test DB in the first place. T12.D3 mandates 'real dedicated Postgres test database with truncate-and-seed' — the seam is right, the provisioning is absent.
   **Fix:** Add a step to B0.1: create .env.test (or vitest globalSetup) pointing DATABASE_URL at a dedicated zeno_test database, run `npx prisma migrate deploy && npx prisma db seed` against it in setup, and document the exact command (e.g. `DATABASE_URL=... npx vitest run`) in every package's verification task.
2. **[B0.5/step 3 (claim-merge field merge) — cnp handling]** CORRECTNESS BUG: claimAndMerge passes raw CustomerProfileField rows into mergeFieldRecords, but cnp values are stored as AES-GCM JSON envelopes (B0.3 encode). normalizeForMatch over two ciphertexts means two records of the SAME cnp (encrypted under different random IVs) always 'differ' → spurious conflict on every merge involving cnp; verified-vs-verified equality can never be detected. The merged winner is also re-upserted with whatever envelope string won, silently fine, but the conflict flag is wrong.
   **Fix:** Inside claimAndMerge, decode cnp via the profile-service codec before calling mergeFieldRecords and re-encode the winning value on upsert (export encode/decode or a mergeRawRecords(field, a, b) helper from profile-service so the codec stays in one module).
3. **[B0.3/step 3 (profile-service MIRROR writes)]** GAP: setDeclaredField mirrors email to Customer.email (@unique). When an anonymous customer declares an email already held by another Customer, the mirror update throws P2002 — exactly the 'returning-customer dead end' T4's current-state documents and T4.D4 resolves via verified-claim-and-merge. The service neither catches the collision nor surfaces a reason; collectCustomerField would return a raw Prisma error string.
   **Fix:** In applyWrite, wrap the MIRROR update: on P2002 for email/phone, still persist the CustomerProfileField row but skip the mirror and return applied with a flag (e.g. { outcome:'applied', mirrorConflict:'email_in_use' }) that B0.4's collect handler and B3.5's exposure logic can use to offer start_channel_verification (the T4.D4 claim path); add a test for declaring an in-use email.
4. **[B0.4 (get_customer_profile payload) + B3 (never extended)]** M2 FIDELITY GAP: the M2 resolution specifies get_customer_profile re-backed with 'profile + provenance + identity tier + history summary'. B0.4 delivers profile/provenance/conflicts/history, and no B3 task ever adds the identity slice (tier, verifiedChannels) once it exists.
   **Fix:** Add to B3.5 (or a small B3 follow-up step) extending getCustomerProfile with identity: { tier: deriveIdentityTier(...), verifiedChannels, missingFields } and an assertion in the B3.5 or B3.8 verification.
5. **[B0 (documentation) — M1 item 4]** M1 mandates 'the 2026-05-29 SSOT spec is AMENDED with the provenance model — no second spec', and the draft's overview acknowledges the spec is not in the repo, but no B0 task creates or amends any spec document, so the binding documentation rule has no owner in the plan.
   **Fix:** Add a final B0 step (in B0.6) to land docs/superpowers/specs/2026-05-29-customer-profile-ssot.md (reconstructed + amended with the provenance model per M1), or record in the package goal where that documentation obligation is fulfilled.

### ➕ Addendum tasks for B0 (binding — coverage-critic gaps)

### Task B0.ADD-1: collect_customer_field through the SSOT service; isAnonymous flip removed (closes G13)
**Files:**
- Modify: `lib/tools/handlers/data-handlers.ts`
- Test: `__tests__/integration/collect-field-provenance.test.ts`
**Steps:**
- [ ] Step 1: Failing integration test (real test DB):
```ts
import { resetDb } from '@/__tests__/helpers/test-db'
import { prisma } from '@/lib/db'
import { executeTool } from '@/lib/tools/executor'

it('collect_customer_field writes declared provenance via the profile service and never flips isAnonymous', async () => {
  await resetDb()
  const customer = await prisma.customer.create({ data: { isAnonymous: true } })
  await executeTool('collect_customer_field', { field: 'name', value: 'Ion Popescu' }, ctxFor(customer.id))
  const after = await prisma.customer.findUnique({ where: { id: customer.id } })
  expect(after!.isAnonymous).toBe(true) // tier is DERIVED (T4-R2), never stored
  const prov = await profileService.getField(customer.id, 'name')
  expect(prov).toMatchObject({ value: 'Ion Popescu', provenance: 'declared' })
})
```
- [ ] Step 2: FAIL → Step 3: route the handler's writes through CustomerProfile service; delete the `isAnonymous: false` update. Step 4: PASS. Step 5: commit.

### Task B0.ADD-2 (doc): Amend the 2026-05-29 customer-SSOT spec with the provenance model (closes G10, M1.4)
**Files:**
- Modify: the existing SSOT spec under `docs/superpowers/specs/` (locate: `grep -ril "customer.*ssot\|CustomerProfile" docs/superpowers/specs`)
**Steps:**
- [ ] Step 1: Append an "Amended 2026-06-12 — per-field provenance" section: declared|verified|conflict states, evidence pointers, derived age precedence (DOB → declaredAge), claim-and-merge rules (verified beats declared; newer declared beats older; conflicts surfaced; tombstone). One spec, no duplicate.
- [ ] Step 2: Commit: `git commit -m "docs: amend customer-SSOT spec with provenance model (M1.4)"`

## Package B1: ConsentEvent ledger: derived consent state, withdraw_consent, engine halt rule, sign_dnt capture fold

**Execution slot:** 7 | **Depends on:** A2, B0

**Goal:** Consent SSOT becomes an append-only ConsentEvent ledger; derived consent state feeds DerivedStateV3; gdpr_processing withdrawal blocks all writing commits via a legality predicate; consent CAPTURE folds into sign_dnt (capture≠storage, #2) and the standalone consent tools + Customer timestamp columns are retired in the same coordinated change.

**Migrations / seeds:**
- Add enum ConsentKind { gdpr_processing ai_disclosure marketing } and enum ConsentAction { granted withdrawn }
- Add model ConsentEvent { id, customerId, kind ConsentKind, action ConsentAction, scope String?, sourceCommitId String? (CommitLedger.id), createdAt, @@index([customerId, kind, createdAt]) } — append-only, no update path
- Customer: DROP gdprConsentAt, gdprConsentScope, aiDisclosureAcknowledgedAt (no backfill — demo data)
- Retire record_gdpr_consent + acknowledge_ai_disclosure: delete registry blocks (lib/tools/registry.ts:1042-1117), remove from DEFAULT_DISCOVERY_TOOLS (lib/chat/default-tools.ts) and from prisma/seeds/seed-skill-packs.ts grants
- npx prisma migrate dev --name b1_consent_event_ledger + npx prisma db seed; add ConsentEvent to __tests__/helpers/test-db.ts TABLES and to B0 claim-merge REPOINTERS

### Task B1.1: ConsentEvent model + column retirement + reader sweep
**Files:**
- Modify: prisma/schema.prisma (ConsentEvent + enums; drop the three Customer consent columns)
- Modify: __tests__/helpers/test-db.ts (add 'ConsentEvent'), lib/customer/claim-merge.ts (append ConsentEvent repointer)
- Modify: every reader of gdprConsentAt/aiDisclosureAcknowledgedAt found by grep (lib/chat/derive-state.ts legacy consent read — already re-keyed by A1; lib/tools/registry.ts handlers — deleted here)
- Test: __tests__/integration/consent-event-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
beforeEach(async () => { await resetDb() })
it('ConsentEvent rows append with pinned kinds/actions; Customer columns are gone', async () => {
  const c = await createCustomer()
  const e = await prisma.consentEvent.create({ data: { customerId: c.id, kind: 'gdpr_processing', action: 'granted', sourceCommitId: 'commit-1' } })
  expect(e.kind).toBe('gdpr_processing')
  const row = await prisma.customer.findUnique({ where: { id: c.id } })
  expect('gdprConsentAt' in row!).toBe(false)
  expect('aiDisclosureAcknowledgedAt' in row!).toBe(false)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/consent-event-schema.test.ts` → FAIL (consentEvent undefined)
- [ ] Step 3: Schema:
```prisma
enum ConsentKind { gdpr_processing ai_disclosure marketing }
enum ConsentAction { granted withdrawn }
model ConsentEvent {
  id             String        @id @default(cuid())
  customerId     String
  kind           ConsentKind
  action         ConsentAction
  scope          String?
  sourceCommitId String?
  createdAt      DateTime      @default(now())
  customer Customer @relation(fields: [customerId], references: [id])
  @@index([customerId, kind, createdAt])
}
```
Drop the three Customer columns. `npx prisma migrate dev --name b1_consent_event_ledger && npx prisma db seed`. Grep `gdprConsentAt|gdprConsentScope|aiDisclosureAcknowledgedAt` across lib/ app/ __tests__/ and fix every reference (delete the two registry handler blocks now — exposure dies with them; DEFAULT_DISCOVERY_TOOLS and seed-skill-packs.ts entries removed). Add the repointer `{ table: 'ConsentEvent', run: async (tx,d,c) => (await tx.consentEvent.updateMany({ where: { customerId: d }, data: { customerId: c } })).count }` to REPOINTERS.
- [ ] Step 4: `npx vitest run __tests__/integration/consent-event-schema.test.ts` → PASS; `npx tsc --noEmit` clean; `npx vitest run __tests__/integration/claim-merge.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(consent): append-only ConsentEvent ledger; retire Customer consent columns + standalone consent tools"`

### Task B1.2: Pure consent reducer + halt predicate
**Files:**
- Create: lib/customer/consent.ts (pure reducer)
- Create: lib/engines/consent-rules.ts (pure legality predicate)
- Test: __tests__/lib/customer/consent.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect } from 'vitest'
import { deriveConsents } from '@/lib/customer/consent'
import { consentBlocksCommit } from '@/lib/engines/consent-rules'
const ev = (kind: 'gdpr_processing'|'ai_disclosure'|'marketing', action: 'granted'|'withdrawn', at: string) => ({ kind, action, createdAt: new Date(at) })
it('latest event per kind wins; absent → false', () => {
  const c = deriveConsents([ev('gdpr_processing','granted','2026-01-01'), ev('gdpr_processing','withdrawn','2026-02-01'), ev('marketing','granted','2026-01-05')])
  expect(c).toEqual({ gdprProcessing: false, aiDisclosure: false, marketing: true })
})
it('gdpr withdrawn blocks writing commits with reason, exempting the re-grant/withdraw/escalation floor', () => {
  const withdrawn = { gdprProcessing: false, aiDisclosure: false, marketing: false }
  expect(consentBlocksCommit(withdrawn, 'select_coverage')).toEqual({ blocked: true, reason: 'gdpr_processing_withdrawn' })
  expect(consentBlocksCommit(withdrawn, 'withdraw_consent')).toEqual({ blocked: false })
  expect(consentBlocksCommit(withdrawn, 'sign_dnt')).toEqual({ blocked: false })
  expect(consentBlocksCommit(withdrawn, 'escalate_to_human')).toEqual({ blocked: false })
  expect(consentBlocksCommit({ ...withdrawn, gdprProcessing: true }, 'select_coverage')).toEqual({ blocked: false })
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/customer/consent.test.ts` → FAIL
- [ ] Step 3: Implement:
```ts
// lib/customer/consent.ts — PURE
export interface ConsentEventLike { kind: 'gdpr_processing'|'ai_disclosure'|'marketing'; action: 'granted'|'withdrawn'; createdAt: Date }
export interface DerivedConsents { gdprProcessing: boolean; aiDisclosure: boolean; marketing: boolean }
export function deriveConsents(events: ConsentEventLike[]): DerivedConsents {
  const latest = new Map<string, ConsentEventLike>()
  for (const e of [...events].sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime())) latest.set(e.kind, e)
  const on = (k: string) => latest.get(k)?.action === 'granted'
  return { gdprProcessing: on('gdpr_processing'), aiDisclosure: on('ai_disclosure'), marketing: on('marketing') }
}
```
```ts
// lib/engines/consent-rules.ts — PURE legality predicate consumed by deriveAndExpose (A1)
import type { DerivedConsents } from '@/lib/customer/consent'
const HALT_EXEMPT = new Set(['withdraw_consent', 'sign_dnt', 'escalate_to_human']) // re-grant path + M10 floor
export function consentBlocksCommit(c: DerivedConsents, commitTool: string): { blocked: boolean; reason?: 'gdpr_processing_withdrawn' } {
  if (!c.gdprProcessing && !HALT_EXEMPT.has(commitTool)) return { blocked: true, reason: 'gdpr_processing_withdrawn' }
  return { blocked: false }
}
```
Note: pre-first-grant the same predicate fires — that is correct under #2: the first writing commit a fresh customer reaches is sign_dnt (exempt), and reads are never gated here.
- [ ] Step 4: `npx vitest run __tests__/lib/customer/consent.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(engines): derived consent state + gdpr-withdrawn halt predicate"`

### Task B1.3: Consent service + snapshot wiring into DerivedStateV3
**Files:**
- Create: lib/customer/consent-service.ts (appendConsentEvents — append-only)
- Modify: lib/engines/snapshot.ts (A1 artifact — DomainSnapshot loader gains consentEvents slice; deriveAndExpose maps deriveConsents → DerivedStateV3.consents and consults consentBlocksCommit when computing ExposedActions.blocked)
- Test: __tests__/integration/consent-service.test.ts + __tests__/lib/engines/derive-consent-exposure.test.ts (snapshot literal, pure)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests:
```ts
// __tests__/integration/consent-service.test.ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { appendConsentEvents, loadDerivedConsents } from '@/lib/customer/consent-service'
beforeEach(async () => { await resetDb() })
it('appends events and derives current state; never mutates prior rows', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }, { kind: 'ai_disclosure', action: 'granted' }], 'commit-1')
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'withdrawn' }], 'commit-2')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id } })).toBe(3)
  expect(await loadDerivedConsents(c.id)).toEqual({ gdprProcessing: false, aiDisclosure: true, marketing: false })
})
```
```ts
// __tests__/lib/engines/derive-consent-exposure.test.ts — pure, snapshot literal (T12.D3)
import { it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose' // A1
import { snapshotFixture } from '@/__tests__/helpers/snapshot-fixtures' // A1 test helper
it('gdpr-withdrawn snapshot blocks writing commits with gdpr_processing_withdrawn', () => {
  const snap = snapshotFixture({ consentEvents: [{ kind: 'gdpr_processing', action: 'granted', createdAt: new Date('2026-01-01') }, { kind: 'gdpr_processing', action: 'withdrawn', createdAt: new Date('2026-02-01') }] })
  const { state, actions } = deriveAndExpose(snap)
  expect(state.consents.gdprProcessing).toBe(false)
  const blockedTools = actions.blocked.map(b => b.action)
  expect(actions.available.filter(a => blockedTools.includes(a))).toEqual([])
  expect(actions.blocked.some(b => b.reason === 'gdpr_processing_withdrawn')).toBe(true)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/consent-service.test.ts __tests__/lib/engines/derive-consent-exposure.test.ts` → FAIL
- [ ] Step 3: Implement consent-service:
```ts
// lib/customer/consent-service.ts
import { prisma } from '@/lib/db'
import { deriveConsents, type DerivedConsents } from '@/lib/customer/consent'
export async function appendConsentEvents(customerId: string, events: { kind: 'gdpr_processing'|'ai_disclosure'|'marketing'; action: 'granted'|'withdrawn'; scope?: string }[], sourceCommitId?: string, tx = prisma) {
  await tx.consentEvent.createMany({ data: events.map(e => ({ customerId, ...e, sourceCommitId })) })
}
export async function loadDerivedConsents(customerId: string): Promise<DerivedConsents> {
  return deriveConsents(await prisma.consentEvent.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } }))
}
```
Wire the snapshot loader (consentEvents per customer) and deriveAndExpose consent mapping + blocked computation per A1's exposure-predicate registry.
- [ ] Step 4: `npx vitest run __tests__/integration/consent-service.test.ts __tests__/lib/engines/derive-consent-exposure.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(consent): consent service + DerivedStateV3.consents + halt rule in deriveAndExpose"`

### Task B1.4: withdraw_consent commit through the gateway
**Files:**
- Create: lib/tools/handlers/consent-handlers.ts (withdrawConsent commit)
- Modify: lib/tools/registry.ts (register withdraw_consent, routed through the A2 gateway)
- Test: __tests__/integration/withdraw-consent.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2
import { appendConsentEvents } from '@/lib/customer/consent-service'
beforeEach(async () => { await resetDb() })
it('withdraw(gdpr_processing) applies, halts subsequent writing commits, preserves data', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }], 'seed')
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'withdraw_consent', args: { kind: 'gdpr_processing' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  const blocked = await executeCommit({ tool: 'set_candidate_product', args: { productId: 'whatever' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(blocked.outcome).toBe('rejected')
  expect(blocked.reason).toBe('gdpr_processing_withdrawn')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id } })).toBe(2) // nothing deleted — withdrawal blocks processing, never erases
})
it('withdraw(marketing) does not halt funnel commits (scope-aware, M3)', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }, { kind: 'marketing', action: 'granted' }], 'seed')
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  await executeCommit({ tool: 'withdraw_consent', args: { kind: 'marketing' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const ok = await executeCommit({ tool: 'set_candidate_product', args: { productId: 'protect' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(ok.reason).not.toBe('gdpr_processing_withdrawn')
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/withdraw-consent.test.ts` → FAIL (tool unregistered)
- [ ] Step 3: Implement the domain commit (gateway owns actor/replay/legality/token ordering per #8):
```ts
// lib/tools/handlers/consent-handlers.ts
import type { CommitResult } from '@/lib/engines/contracts' // A1/A2
import { appendConsentEvents } from '@/lib/customer/consent-service'
const KINDS = new Set(['gdpr_processing', 'ai_disclosure', 'marketing'])
export async function withdrawConsent(args: Record<string, unknown>, ctx: { customerId: string; commitId: string; tx: never }): Promise<CommitResult> {
  const kind = args.kind as string
  if (!KINDS.has(kind)) return { outcome: 'rejected', reason: 'invalid_consent_kind', effects: [] }
  await appendConsentEvents(ctx.customerId, [{ kind: kind as never, action: 'withdrawn', scope: args.scope as string | undefined }], ctx.commitId, ctx.tx)
  return { outcome: 'applied', effects: [], data: { kind, action: 'withdrawn' } }
}
```
Register in registry with the A2 gateway wrapper; exposure: always available once any consent was granted (predicate in lib/engines/consent-rules.ts: `withdrawExposed(events) = events.length > 0`).
- [ ] Step 4: `npx vitest run __tests__/integration/withdraw-consent.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(consent): withdraw_consent commit — scope-aware halt, data preserved"`

### Task B1.5: Fold consent capture into sign_dnt (coordinated flip, #2)
**Files:**
- Modify: lib/tools/handlers/dnt-handlers.ts (signDnt gains consent{gdpr, aiDisclosure} args; appends ConsentEvents atomically with signing; refusal → requires_consent, session preserved)
- Modify: lib/tools/registry.ts (sign_dnt parameter schema), lib/chat/action-adapter.ts (sign_dnt payload carries consent booleans)
- Test: __tests__/integration/sign-dnt-consent.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (against the legacy conversation-scoped signDnt — B2 re-platforms it onto sessions without changing this consent contract):
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { seedDntFullyAnswered } from '@/__tests__/helpers/dnt-fixtures' // creates conversation + answers all visible dnt questions
beforeEach(async () => { await resetDb() })
it('signing appends gdpr_processing + ai_disclosure granted events atomically', async () => {
  const { customerId, conversationId, ctx } = await seedDntFullyAnswered()
  const r = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  expect(r.success).toBe(true)
  const kinds = (await prisma.consentEvent.findMany({ where: { customerId, action: 'granted' } })).map(e => e.kind).sort()
  expect(kinds).toEqual(['ai_disclosure', 'gdpr_processing'])
  expect((await prisma.conversation.findUnique({ where: { id: conversationId } }))?.dntSignedAt).not.toBeNull()
})
it('refused gdpr → no signature, no events, answers preserved (feature:209-213)', async () => {
  const { customerId, conversationId, ctx, answerCount } = await seedDntFullyAnswered()
  const r = await signDnt({ confirmSignature: true, consent: { gdpr: false, aiDisclosure: true } }, ctx)
  expect(r.success).toBe(false)
  expect(r.error).toContain('requires_consent')
  expect(await prisma.consentEvent.count({ where: { customerId } })).toBe(0)
  expect(await prisma.answer.count({ where: { conversationId } })).toBe(answerCount)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/sign-dnt-consent.test.ts` → FAIL (signDnt still reads the discarded gdprConsent boolean)
- [ ] Step 3: Rework signDnt (dnt-handlers.ts:273-317): parse `consent: { gdpr: boolean; aiDisclosure: boolean }`; if either false return `{ success: false, error: 'requires_consent: both GDPR processing consent and AI-disclosure acknowledgment are required to sign; your answers are preserved.' }`; wrap the conversation stamp + `appendConsentEvents(context.customerId, [{kind:'gdpr_processing',action:'granted'},{kind:'ai_disclosure',action:'granted'}], undefined, tx)` in one `prisma.$transaction`. Build the `seedDntFullyAnswered` fixture helper (creates customer+conversation, iterates getNextQuestion answering first option / '0' for numbers). Update the registry parameter schema and action-adapter sign_dnt mapping.
- [ ] Step 4: `npx vitest run __tests__/integration/sign-dnt-consent.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(dnt): sign_dnt is the sole consent-capturing commit — appends ConsentEvents atomically"`

### Task B1.6: Package verification
**Files:**
- Modify: scripts/verify-customer-ssot.ts (extend with a consent leg: grant→withdraw→halt→re-grant via sign path)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx prisma migrate dev && npx prisma db seed` → clean
- [ ] Step 2: `npx vitest run` → green (instrumentation flake rule applies)
- [ ] Step 3: `npx tsx scripts/verify-customer-ssot.ts` → all PASS including the new consent leg; grep check `grep -rn "record_gdpr_consent\|acknowledge_ai_disclosure" lib/ prisma/seeds/ app/` returns nothing
- [ ] Step 4: `git add -A && git commit -m "chore(consent): B1 verification — single consent truth, halt rule live"`

### ⚠ Binding errata for B1 (fidelity verifier — apply OVER the task text above)

1. **[B1.2/step 3 (consent-rules.ts) vs B2.5, B4.3-B4.6 tests]** BLOCKING DESIGN ERROR: consentBlocksCommit blocks every writing commit whenever gdprProcessing is false, and deriveConsents maps 'no events at all' to false. Every fresh customer (zero ConsentEvent rows) is therefore in the halted state, and the B1.2 note's justification ('the first writing commit a fresh customer reaches is sign_dnt') is factually wrong: set_candidate_product, set_application, open_dnt_session and write_dnt_answer are all writing commits that precede sign_dnt. This directly contradicts the draft's own later tests — B2.5 (open_dnt_session applied with no consent events), B4.3 (set_application applied with no consent), B4.4-B4.6 — all of which would be rejected('gdpr_processing_withdrawn') once B1.3 wires the predicate into the gateway legality step. It also contradicts #2/T13.D6 ('talk is free'; consent captured AT signing) and T3.D5 (pre-DNT funnel runs without consent).
   **Fix:** Make the halt fire only on an explicit withdrawal, not on absence: either derive a tri-state (granted|withdrawn|none) for gdpr_processing in DerivedConsents, or add gdprWithdrawn: boolean (latest gdpr_processing event exists AND action==='withdrawn') and have consentBlocksCommit block only when gdprWithdrawn. Update the B1.2 test fixtures accordingly (the withdrawn fixture already has explicit events, so its assertions survive).
2. **[B1.2/step 3 HALT_EXEMPT set (re-grant path)]** DEADLOCK: HALT_EXEMPT = {withdraw_consent, sign_dnt, escalate_to_human}, with sign_dnt justified as the re-grant path. But after a gdpr_processing withdrawal, open_dnt_session and write_dnt_answer are blocked writing commits, so a customer without an already-FINISHED DntSession can never reach a signable session — the exempted sign_dnt is unreachable and re-granting is impossible. This reproduces the advance-flow deadlock class the memory explicitly warns about (engine demands an action that is never exposed).
   **Fix:** Extend HALT_EXEMPT to the DNT-session commits that constitute the re-grant path (open_dnt_session, write_dnt_answer) — or introduce an explicit re-grant consent commit — and add a test: withdraw → open_dnt_session applied → answer → sign → gdprProcessing true again.
3. **[B1/B2/B4 retirement sweeps (B1.1, B2.4-B2.6, B4.3-B4.4) — existing test suite]** OMISSION: the packages rewrite or delete behavior pinned by existing mocked-prisma unit tests — __tests__/lib/tools/handlers/dnt-signing.test.ts (conversation stamps), set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-handlers/advance/promotion tests (DNT pre-gate, tier/level args, cancel→COMPLETED), preview-handlers.test.ts, __tests__/lib/compliance/consent-check.test.ts, __tests__/lib/chat/default-tools.test.ts, debug/conversation-export tests (dntSignedAt), plus skill-pack-orchestrator.test.ts — yet only __tests__/integration/navigation.test.ts is ever named for deletion (B4.4). Every package ends with 'npx vitest run → full suite green', which is unreachable without migrating/deleting these files; per T12.D3 most should be deleted in favor of the new real-DB tests, not mocked anew.
   **Fix:** Add to each package's retirement task an explicit Delete/Rewrite list for the legacy tests covering the behavior it changes (B1.1: consent-check.test.ts portions, default-tools.test.ts; B2.4-2.6: dnt-signing.test.ts, conversation-export dnt assertions; B4.3-4.4: set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-*.test.ts), with the T12.D3 rationale (mocked-prisma choreography superseded by real-DB tests).
4. **[B1 migrations bullet 4 + B1.6/B2.7/B4.7 grep checks]** FACTUAL ERRORS IN SWEEP TARGETS: (a) record_gdpr_consent/acknowledge_ai_disclosure are NOT granted in prisma/seeds/seed-skill-packs.ts (verified zero occurrences) — they are only in DEFAULT_DISCOVERY_TOOLS; (b) the registry consent blocks are at registry.ts:1091-1125, not 1042-1117 (stale agenda line numbers); (c) prisma/seeds/seed-workflows.ts DOES grant retired tools (update_customer_profile:59; check_dnt_status/start_dnt_questionnaire/save_dnt_answer/sign_dnt/start_application:130-312) and is never named by any B-package sweep; (d) scripts/ (diag-orchestrator.ts, dump-conversation.ts, inspect-app.ts read gdprConsentAt/extractedProfile; verify-advance-flow.ts reads dntSignedAt) and __tests__/ are excluded from the B2.7/B1.6 grep paths, so the verification greps cannot catch all stale readers; (e) M12 deletes the entire skill-pack subsystem (and M9's dead-config cleanup covers Workflow* seeds) in late Block A — if that lands before B1/B2/B4, the instructed seed-skill-packs.ts edits target a deleted file.
   **Fix:** Correct the bullets: name DEFAULT_DISCOVERY_TOOLS + seed-workflows.ts (not seed-skill-packs.ts) as the grant sites, fix the registry line range, extend every package's verification grep to `lib/ app/ prisma/ scripts/ __tests__/`, and add a depends_on/coordination note that the seed-skill-packs/seed-workflows edits apply only if Block A's M12/M9 cleanup has not already deleted those files.
5. **[B4.2/step 3, B1.4/step 3, B2.2/step 3 (code-block quality)]** CODE SMELLS IN 'REAL CODE' BLOCKS (NO PLACEHOLDERS rule, milder cases): (a) B4.2's `const blocked: typeof i extends never ? never : {...}[]` is a nonsense conditional type that always resolves to its right branch; (b) B1.4's ctx type `tx: never` is unconstructible pseudo-typing the gateway must cast around; (c) B2.2's decideSessionType triple-ternary is exactly equivalent to `latest ? 'UPDATE' : 'NEW'` and obscures the rule its own note states plainly; (d) applicationExposure declares an openDntSession input it never reads.
   **Fix:** (a) type blocked as { action: string; reason: string; params?: Record<string,unknown> }[]; (b) type tx as the A2 transaction-client type (Prisma.TransactionClient) once A2 pins it; (c) write `return latest ? 'UPDATE' : 'NEW'` with the comment; (d) drop openDntSession from AppExposureInput or use it (e.g. to block save_application_answer while a DNT session is open, if that is the intended rule).

## Package B2: DNT aggregate: Dnt/DntSession/DntAnswer, pinned 6-tool surface, customer-scoped validity

**Execution slot:** 8 | **Depends on:** A2, B0, B1

**Goal:** DNT becomes a customer-scoped aggregate (signed Dnt + working DntSession + separate DntAnswer store), the questionnaire engine is generalized to answer scopes, the pinned #7 6-tool surface replaces the legacy 4(+1) tools, exposure follows the #12 full-snapshot predicates (incl. application-free renewal), and Conversation.dntSignedAt/dntValidUntil die.

**Migrations / seeds:**
- Add enum ProductType { LIFE }; cast Product.insuranceType String → ProductType (UPDATE existing rows to 'LIFE' first; demo data)
- Add enums DntStatus { ACTIVE EXPIRED SUPERSEDED WITHDRAWN }, DntSessionType { NEW UPDATE }, DntSessionStatus { ACTIVE FINISHED SIGNED CANCELLED }
- Add model Dnt { id, customerId, signedAt, validUntil, productTypesCovered ProductType[], status DntStatus @default(ACTIVE), sourceSessionId @unique, supersededById?, createdAt } — consent evidence lives in ConsentEvent (#2), NOT duplicated here (log wins over T3.D1 option text)
- Add model DntSession { id, customerId, productId, type DntSessionType, status DntSessionStatus @default(ACTIVE), baseDntId?, originConversationId? (audit only), startedAt, finishedAt? } + raw-SQL partial unique: CREATE UNIQUE INDEX "DntSession_one_active_per_customer" ON "DntSession"("customerId") WHERE "status" = 'ACTIVE'
- Add model DntAnswer { id, sessionId, questionId, value, answeredAt, @@unique([sessionId, questionId]) }
- Conversation: DROP dntSignedAt, dntValidUntil (destructive; no backfill — demo data)
- Seeds (prisma/seeds/seed-questions.ts): enforce the described DNT_LIFE_SUBTYPE gating via parentQuestionCode/showWhenValue — dnt_life_financial questions get showWhenValue 'financial_protection,financial_and_investment'; dnt_life_investment and dnt_sustainability get 'financial_and_investment' (DNT_SUSTAINABILITY_PREFERENCE keeps its existing parent chain) (T3.D6)
- Retire check_dnt_status/start_dnt_questionnaire/save_dnt_answer registrations; register get_dnt_state/get_dnt_questions/get_dnt_next_question/open_dnt_session/write_dnt_answer (sign_dnt re-registered as a gateway commit); update seed-skill-packs.ts grants and action-adapter mappings
- Add Dnt + DntSession + DntAnswer to test-db TABLES and Dnt/DntSession to claim-merge REPOINTERS; npx prisma migrate dev --name b2_dnt_aggregate + npx prisma db seed

### Task B2.1: Schema migration + one-active-session constraint
**Files:**
- Modify: prisma/schema.prisma (models/enums above), migration SQL (partial unique), __tests__/helpers/test-db.ts, lib/customer/claim-merge.ts (Dnt, DntSession repointers)
- Modify: lib/compliance/consent-check.ts + lib/tools/handlers/application-handlers.ts:35-40 (temporary re-point: dntValid := customer has ACTIVE Dnt covering the product type — keeps compile/behavior until B2.5/B4 finish the surface)
- Test: __tests__/integration/dnt-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
beforeEach(async () => { await resetDb() })
it('enforces at most one ACTIVE session per customer (partial unique)', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  await expect(prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })).rejects.toThrow()
  // a second non-ACTIVE session is fine
  await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'CANCELLED' } })
})
it('Dnt rows are customer-scoped with typed coverage; Conversation stamps are gone', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'SIGNED' } })
  const d = await prisma.dnt.create({ data: { customerId: c.id, signedAt: new Date(), validUntil: new Date(Date.now() + 86400e3), productTypesCovered: ['LIFE'], sourceSessionId: s.id } })
  expect(d.productTypesCovered).toEqual(['LIFE'])
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  expect('dntSignedAt' in conv).toBe(false)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/dnt-schema.test.ts` → FAIL
- [ ] Step 3: Apply the schema from the migrations list; in the generated migration append: `CREATE UNIQUE INDEX "DntSession_one_active_per_customer" ON "DntSession"("customerId") WHERE "status" = 'ACTIVE';` plus `UPDATE "Product" SET "insuranceType"='LIFE'` before the enum cast. Re-point the two legacy readers: consent-check.ts step 2 and application-handlers.ts:35-40 both call a new helper `hasValidDnt(customerId, productType)` (interim direct query; replaced by lib/engines/dnt-rules.ts in B2.2). Update test-db TABLES (prepend 'DntAnswer','DntSession','Dnt') and REPOINTERS. Run `npx prisma migrate dev --name b2_dnt_aggregate && npx prisma db seed`.
- [ ] Step 4: `npx vitest run __tests__/integration/dnt-schema.test.ts` → PASS; `npx tsc --noEmit` clean
- [ ] Step 5: `git add -A && git commit -m "feat(dnt): customer-scoped Dnt/DntSession/DntAnswer aggregate; conversation DNT stamps retired"`

### Task B2.2: Pure DNT rules — validity, session-type decision, coverage, #12 exposure predicates
**Files:**
- Create: lib/engines/dnt-rules.ts
- Test: __tests__/lib/engines/dnt-rules.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (snapshot literals, no prisma):
```ts
import { it, expect } from 'vitest'
import { isDntValidFor, decideSessionType, computeCoverage, dntExposure, DNT_RENEWAL_WINDOW_DAYS } from '@/lib/engines/dnt-rules'
const now = new Date('2026-06-12')
const dnt = (over: Partial<{ validUntil: Date; productTypesCovered: ('LIFE')[]; status: string }> = {}) => ({ status: 'ACTIVE', signedAt: new Date('2026-01-01'), validUntil: new Date('2027-01-01'), productTypesCovered: ['LIFE' as const], ...over })
it('validity fails closed on coverage and expiry (T3.D3)', () => {
  expect(isDntValidFor(dnt(), 'LIFE', now)).toBe(true)
  expect(isDntValidFor(dnt({ validUntil: new Date('2026-06-01') }), 'LIFE', now)).toBe(false)
  expect(isDntValidFor(dnt({ productTypesCovered: [] }), 'LIFE', now)).toBe(false)
})
it('engine decides session type: no prior → NEW; expired/expiring prior → UPDATE (#7)', () => {
  expect(decideSessionType(null, now)).toBe('NEW')
  expect(decideSessionType(dnt({ validUntil: new Date('2026-05-01') }), now)).toBe('UPDATE')
  expect(decideSessionType(dnt({ validUntil: new Date(now.getTime() + (DNT_RENEWAL_WINDOW_DAYS - 1) * 86400e3) }), now)).toBe('UPDATE')
})
it('coverage is computed from what the session analyzed', () => { expect(computeCoverage('LIFE')).toEqual(['LIFE']) })
it('#12 exposure: renewal needs NO application; write needs active session + pending question; sign needs finished', () => {
  const base = { productTypeInFocus: 'LIFE' as const, latestDnt: dnt({ validUntil: new Date('2026-06-20') }), activeSession: null, sessionHasPendingQuestion: false, sessionFinished: false, openApplicationProductType: null, now }
  expect(dntExposure(base).available).toContain('open_dnt_session') // expiring within window, no application
  const inSession = { ...base, activeSession: { id: 's1' }, sessionHasPendingQuestion: true }
  expect(dntExposure(inSession).available).toEqual(expect.arrayContaining(['write_dnt_answer', 'get_dnt_next_question']))
  expect(dntExposure(inSession).blocked.find(b => b.action === 'open_dnt_session')).toMatchObject({ reason: 'dnt_session_already_active', params: { activeSessionId: 's1' } })
  expect(dntExposure({ ...base, activeSession: { id: 's1' }, sessionFinished: true }).available).toContain('sign_dnt')
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/engines/dnt-rules.test.ts` → FAIL
- [ ] Step 3: Implement:
```ts
// lib/engines/dnt-rules.ts — PURE (T12.D3); consumed by deriveAndExpose (A1) and the DNT handlers
export const DNT_VALIDITY_DAYS = 365
export const DNT_RENEWAL_WINDOW_DAYS = 30
export type ProductTypeStr = 'LIFE'
export interface DntFact { status: string; signedAt: Date; validUntil: Date; productTypesCovered: ProductTypeStr[] }
export function isDntValidFor(d: DntFact | null, productType: ProductTypeStr, now: Date): boolean {
  return !!d && d.status === 'ACTIVE' && d.validUntil > now && d.productTypesCovered.includes(productType)
}
export function isExpiringOrExpired(d: DntFact, now: Date): boolean {
  return d.validUntil.getTime() - now.getTime() < DNT_RENEWAL_WINDOW_DAYS * 86400e3
}
export function decideSessionType(latest: DntFact | null, now: Date): 'NEW' | 'UPDATE' {
  return latest && isExpiringOrExpired(latest, now) ? 'UPDATE' : latest && !isDntValidFor(latest, latest.productTypesCovered[0] ?? 'LIFE', now) ? 'UPDATE' : latest ? 'UPDATE' : 'NEW'
}
export function computeCoverage(sessionProductType: ProductTypeStr): ProductTypeStr[] { return [sessionProductType] }
export interface DntExposureInput { productTypeInFocus: ProductTypeStr | null; latestDnt: DntFact | null; activeSession: { id: string } | null; sessionHasPendingQuestion: boolean; sessionFinished: boolean; openApplicationProductType: ProductTypeStr | null; now: Date }
export function dntExposure(i: DntExposureInput): { available: string[]; blocked: { action: string; reason: string; params?: Record<string, unknown> }[] } {
  const available: string[] = []; const blocked: { action: string; reason: string; params?: Record<string, unknown> }[] = []
  if (i.productTypeInFocus || i.latestDnt) available.push('get_dnt_state')
  if (i.productTypeInFocus || i.activeSession) available.push('get_dnt_questions')
  if (i.activeSession) available.push('get_dnt_next_question')
  const needsForApp = i.openApplicationProductType && !isDntValidFor(i.latestDnt, i.openApplicationProductType, i.now)
  const renewal = i.latestDnt && isExpiringOrExpired(i.latestDnt, i.now) // application-free renewal (#12)
  if (i.activeSession) blocked.push({ action: 'open_dnt_session', reason: 'dnt_session_already_active', params: { activeSessionId: i.activeSession.id } })
  else if (needsForApp || renewal) available.push('open_dnt_session')
  if (i.activeSession && i.sessionHasPendingQuestion) available.push('write_dnt_answer')
  if (i.activeSession && i.sessionFinished) available.push('sign_dnt')
  else if (i.activeSession) blocked.push({ action: 'sign_dnt', reason: 'dnt_session_incomplete' })
  return { available, blocked }
}
```
Note decideSessionType: any prior Dnt ⇒ UPDATE (pre-filled); only a customer with no Dnt history gets NEW — matches #7 ("engine decides new vs update from DNT state").
- [ ] Step 4: `npx vitest run __tests__/lib/engines/dnt-rules.test.ts` → PASS; wire `dntExposure` into A1's exposure-predicate registry and `isDntValidFor` into the interim `hasValidDnt` helper from B2.1
- [ ] Step 5: `git add -A && git commit -m "feat(engines): pure DNT rules — validity, engine-decided session type, #12 exposure predicates"`

### Task B2.3: Generalize the questionnaire engine to answer scopes (T3.D6)
**Files:**
- Modify: lib/engines/questionnaire-engine.ts (getNextQuestion/calculateProgress take AnswerScope; pure functions untouched)
- Modify: call sites — lib/tools/handlers/dnt-handlers.ts, application-handlers.ts, set-answer-handlers.ts, product-switch-handler.ts, preview-handlers.ts (pass { kind: 'conversation', conversationId })
- Test: __tests__/integration/answer-scope.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { getNextQuestion, calculateProgress } from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
beforeEach(async () => { await resetDb() })
it('dntSession scope reads DntAnswer rows, conversation scope reads Answer rows — same engine', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const codes = await resolveGroupCodes(p.id, 'dnt')
  const first = await getNextQuestion(codes, { kind: 'dntSession', sessionId: s.id })
  expect(first).not.toBeNull()
  await prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: first!.question.id, value: 'yes_all' } })
  const second = await getNextQuestion(codes, { kind: 'dntSession', sessionId: s.id })
  expect(second!.question.id).not.toBe(first!.question.id)
  expect((await calculateProgress(codes, { kind: 'dntSession', sessionId: s.id })).answered).toBe(1)
})
it('subtype gating is now enforced: simple_protection hides financial/investment/sustainability groups', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const codes = await resolveGroupCodes(p.id, 'dnt')
  const subtype = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_LIFE_SUBTYPE' } })
  await prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: subtype.id, value: 'simple_protection' } })
  const total = (await calculateProgress(codes, { kind: 'dntSession', sessionId: s.id })).total
  expect(total).toBe(10) // 3 consent + 6 general + 1 subtype; 16 gated questions hidden
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/answer-scope.test.ts` → FAIL (signature mismatch)
- [ ] Step 3: Implement:
```ts
export type AnswerScope = { kind: 'conversation'; conversationId: string } | { kind: 'dntSession'; sessionId: string }
async function loadAnswers(scope: AnswerScope, questionIds: string[]): Promise<Map<string, string>> {
  const rows = scope.kind === 'conversation'
    ? await prisma.answer.findMany({ where: { conversationId: scope.conversationId, questionId: { in: questionIds } } })
    : await prisma.dntAnswer.findMany({ where: { sessionId: scope.sessionId, questionId: { in: questionIds } } })
  return new Map(rows.map(a => [a.questionId, a.value]))
}
export async function getNextQuestion(groupCodes: string[], scope: AnswerScope) { /* body unchanged except answersMap = await loadAnswers(scope, questionIds) */ }
export async function calculateProgress(groupCodes: string[], scope: AnswerScope) { /* same substitution */ }
```
Update every call site mechanically to `{ kind: 'conversation', conversationId }`. The B4 package later adds the `application` scope. Verify the seed-gating bullet from the migrations list landed (showWhenValue on the 16 life_financial/investment/sustainability questions) — this test's `total` assertion depends on it.
- [ ] Step 4: `npx vitest run __tests__/integration/answer-scope.test.ts` → PASS; `npx vitest run` engine/handler suites green
- [ ] Step 5: `git add -A && git commit -m "feat(engines): questionnaire engine generalized to answer scopes; DNT subtype gating enforced"`

### Task B2.4: The three DNT reads (get_dnt_state, get_dnt_questions, get_dnt_next_question)
**Files:**
- Modify: lib/tools/handlers/dnt-handlers.ts (replace checkDntStatus/startDntQuestionnaire with the reads; registry re-registration; action-adapter remap)
- Test: __tests__/integration/dnt-reads.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { getDntState, getDntQuestions, getDntNextQuestion } from '@/lib/tools/handlers/dnt-handlers'
import { getToolDefinition } from '@/lib/tools/registry'
beforeEach(async () => { await resetDb() })
it('get_dnt_state reports validity, coverage, expiry AND the active-session summary (absorbs session details, #7)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const ctx = { customerId: c.id, conversationId: 'conv-1', language: 'ro' as const, product: { id: p.id } }
  const r = await getDntState({}, ctx as never)
  expect(r.data).toMatchObject({ valid: false, productTypesCovered: [], session: { id: s.id, type: 'NEW', answered: 0 } })
})
it('get_dnt_questions previews without any session; get_dnt_next_question steps an active one', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const ctx = { customerId: c.id, conversationId: 'conv-1', language: 'ro' as const, product: { id: p.id } }
  const q = await getDntQuestions({}, ctx as never)
  expect((q.data!.questions as unknown[]).length).toBeGreaterThan(0)
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const n = await getDntNextQuestion({}, ctx as never)
  expect(n.data!.sessionId).toBe(s.id)
  expect(n.data!.question).toBeDefined()
})
it('legacy tools are gone', () => {
  expect(getToolDefinition('check_dnt_status')).toBeUndefined()
  expect(getToolDefinition('start_dnt_questionnaire')).toBeUndefined()
  expect(getToolDefinition('get_dnt_state')).toBeDefined()
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/dnt-reads.test.ts` → FAIL
- [ ] Step 3: Implement the three reads in dnt-handlers.ts: getDntState loads latest non-superseded Dnt + ACTIVE session (+ progress via calculateProgress with dntSession scope) and returns `{ valid, validUntil, productTypesCovered, expiringWithinDays, session: { id, type, answered, total, startedAt } | null }` using isDntValidFor/isExpiringOrExpired; getDntQuestions lists visible-by-default questions for `resolveGroupCodes(productId,'dnt')` with NO session; getDntNextQuestion requires the customer's ACTIVE session, returns next question + counts (absorbed details). Delete checkDntStatus/startDntQuestionnaire exports, re-register the reads, remap action-adapter `start_dnt` → open_dnt_session (registered in B2.5) and `answer_dnt`/`answer_question(dnt)` → write_dnt_answer.
- [ ] Step 4: `npx vitest run __tests__/integration/dnt-reads.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(dnt): pinned read surface — get_dnt_state/get_dnt_questions/get_dnt_next_question"`

### Task B2.5: open_dnt_session + write_dnt_answer commits
**Files:**
- Modify: lib/tools/handlers/dnt-handlers.ts (openDntSession, writeDntAnswer as A2 gateway commits)
- Test: __tests__/integration/dnt-session-commits.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2
beforeEach(async () => { await resetDb() })
const open = (customerId: string, conversationId: string) => executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId, conversationId })
it('engine decides NEW for a first-timer; second open is rejected with the active id (#7)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r1 = await open(c.id, conv.id)
  expect(r1.outcome).toBe('applied')
  expect((r1.data as { type: string }).type).toBe('NEW')
  const r2 = await open(c.id, conv.id)
  expect(r2.outcome).toBe('rejected')
  expect(r2.reason).toBe('dnt_session_already_active')
})
it('write_dnt_answer is write-or-change (flat: modify never cascades)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const s = (await open(c.id, conv.id)).data as { sessionId: string }
  const w1 = await executeCommit({ tool: 'write_dnt_answer', args: { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'yes_all' }, actor: 'gui', customerId: c.id, conversationId: conv.id })
  expect(w1.outcome).toBe('applied')
  const w2 = await executeCommit({ tool: 'write_dnt_answer', args: { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'no' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(w2.outcome).toBe('applied') // change, same tool
  expect(w2.effects).toEqual([])     // flat — no cascade effects ever (T3.D6)
  const rows = await prisma.dntAnswer.findMany({ where: { sessionId: s.sessionId } })
  expect(rows).toHaveLength(1)
  expect(rows[0].value).toBe('no')
})
it('UPDATE session pre-fills by question code from the prior signed Dnt', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const prior = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'SIGNED' } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_OCCUPATION' } })
  await prisma.dntAnswer.create({ data: { sessionId: prior.id, questionId: q.id, value: 'employee' } })
  await prisma.dnt.create({ data: { customerId: c.id, signedAt: new Date('2025-06-01'), validUntil: new Date('2026-06-20'), productTypesCovered: ['LIFE'], sourceSessionId: prior.id } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await open(c.id, conv.id) // expiring within window → UPDATE, application-free renewal (#12)
  expect((r.data as { type: string }).type).toBe('UPDATE')
  const copied = await prisma.dntAnswer.findFirst({ where: { sessionId: (r.data as { sessionId: string }).sessionId, questionId: q.id } })
  expect(copied?.value).toBe('employee')
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/dnt-session-commits.test.ts` → FAIL
- [ ] Step 3: Implement openDntSession: resolve productId (context.product ?? conversation productId/candidate); reject with active id when an ACTIVE session exists; `type = decideSessionType(latestDnt, now)`; on UPDATE copy prior source-session DntAnswers whose question CODE still exists and whose value still passes validateAnswer (T3 risk: code-matching, validation re-checked); create session with originConversationId = ctx.conversationId; return `{ outcome:'applied', effects: [], data: { sessionId, type, prefilled } }`. writeDntAnswer: ACTIVE session required (`rejected('no_active_dnt_session')`), resolve question by code within the session product's dnt groups, validateAnswer, upsert DntAnswer, return next-question payload in data with effects [].
- [ ] Step 4: `npx vitest run __tests__/integration/dnt-session-commits.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(dnt): open_dnt_session (engine-decided type, prefill) + write_dnt_answer (write-or-change)"`

### Task B2.6: sign_dnt on sessions + reader re-point + retirement sweep
**Files:**
- Modify: lib/tools/handlers/dnt-handlers.ts (signDnt re-platformed: session-scoped gateway commit, creates Dnt, supersedes, captures consents via B1)
- Modify: lib/compliance/consent-check.ts (verifyConsents reads derived consents + valid Dnt + the signed session's dnt_consent DntAnswers), lib/compliance/dnt-report.ts (DNT answers via Dnt.sourceSession.answers)
- Test: __tests__/integration/sign-dnt-session.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures' // extend fixture: writes via write_dnt_answer until finish
beforeEach(async () => { await resetDb() })
it('signing creates the customer-scoped Dnt (365d, coverage computed), marks session SIGNED, appends consents, supersedes the prior Dnt', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  await answerAllDntQuestions(c.id, conv.id)
  const r = await executeCommit({ tool: 'sign_dnt', args: { confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  const dnt = await prisma.dnt.findFirstOrThrow({ where: { customerId: c.id, status: 'ACTIVE' } })
  expect(dnt.productTypesCovered).toEqual(['LIFE'])
  expect(dnt.validUntil.getTime() - dnt.signedAt.getTime()).toBe(365 * 86400e3)
  expect((await prisma.dntSession.findUniqueOrThrow({ where: { id: dnt.sourceSessionId } })).status).toBe('SIGNED')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id, action: 'granted' } })).toBeGreaterThanOrEqual(2)
})
it('incomplete session → rejected(dnt_session_incomplete); refused consent → requires_consent, session intact', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const r1 = await executeCommit({ tool: 'sign_dnt', args: { confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r1).toMatchObject({ outcome: 'rejected', reason: 'dnt_session_incomplete' })
  await answerAllDntQuestions(c.id, conv.id)
  const r2 = await executeCommit({ tool: 'sign_dnt', args: { confirmSignature: true, consent: { gdpr: false, aiDisclosure: true } }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r2.outcome).toBe('requires_consent')
  expect((await prisma.dntSession.findFirstOrThrow({ where: { customerId: c.id } })).status).toBe('ACTIVE') // preserved
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/sign-dnt-session.test.ts` → FAIL
- [ ] Step 3: Re-platform signDnt: load ACTIVE session; completeness via `calculateProgress(codes, { kind:'dntSession', sessionId })` — hidden answers excluded by visibility recomputation (T3.D6 sign-time exclusion); refused consent → `{ outcome: 'requires_consent', reason: 'consent_refused', effects: [], needs: ['gdpr_processing','ai_disclosure'].filter(refused) }`; transaction: create Dnt (computeCoverage(product.insuranceType), validUntil = signedAt + DNT_VALIDITY_DAYS), prior ACTIVE Dnt → SUPERSEDED + supersededById, session → SIGNED + finishedAt, `appendConsentEvents` for gdpr_processing/ai_disclosure granted PLUS a marketing granted/withdrawn event from the session's DNT_MARKETING_CONSENT answer (kills the T3 'customer-level facts trapped in session answers' divergence). Re-point verifyConsents (consent-check.ts): dnt_consent answers from the signed Dnt's session via DntAnswer, DNT validity via isDntValidFor, gdpr via loadDerivedConsents. Re-point dnt-report.ts to Dnt.sourceSession.answers (history disposable — no legacy fallback, M9).
- [ ] Step 4: `npx vitest run __tests__/integration/sign-dnt-session.test.ts __tests__/integration/sign-dnt-consent.test.ts` → PASS (B1.5 test updated to session shape in the same commit)
- [ ] Step 5: `git add -A && git commit -m "feat(dnt): sign_dnt creates the customer-scoped Dnt aggregate; consents captured via ledger; readers re-pointed"`

### Task B2.7: Package verification
**Files:**
- Create: scripts/verify-dnt-flow.ts (live flow: open NEW → answer all → sign → valid get_dnt_state → simulate near-expiry (update validUntil) → open UPDATE pre-filled WITHOUT an application → sign again → prior SUPERSEDED)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the script; each leg prints PASS/FAIL and exits non-zero on failure
- [ ] Step 2: `npx prisma migrate dev && npx prisma db seed` → clean; `npx tsc --noEmit` clean
- [ ] Step 3: `npx vitest run` → green (instrumentation flake rule); grep check `grep -rn "dntSignedAt\|dntValidUntil\|check_dnt_status\|start_dnt_questionnaire\|save_dnt_answer" lib/ app/ prisma/seeds/` returns nothing
- [ ] Step 4: `npx tsx scripts/verify-dnt-flow.ts` → all PASS (this is the live check that catches stall/loop pathologies unit tests miss — advance-flow lesson)
- [ ] Step 5: `git add -A && git commit -m "chore(dnt): B2 verification — 6-tool surface live, renewal without application"`

### ⚠ Binding errata for B2 (fidelity verifier — apply OVER the task text above)

1. **[B1.2/step 3 (consent-rules.ts) vs B2.5, B4.3-B4.6 tests]** BLOCKING DESIGN ERROR: consentBlocksCommit blocks every writing commit whenever gdprProcessing is false, and deriveConsents maps 'no events at all' to false. Every fresh customer (zero ConsentEvent rows) is therefore in the halted state, and the B1.2 note's justification ('the first writing commit a fresh customer reaches is sign_dnt') is factually wrong: set_candidate_product, set_application, open_dnt_session and write_dnt_answer are all writing commits that precede sign_dnt. This directly contradicts the draft's own later tests — B2.5 (open_dnt_session applied with no consent events), B4.3 (set_application applied with no consent), B4.4-B4.6 — all of which would be rejected('gdpr_processing_withdrawn') once B1.3 wires the predicate into the gateway legality step. It also contradicts #2/T13.D6 ('talk is free'; consent captured AT signing) and T3.D5 (pre-DNT funnel runs without consent).
   **Fix:** Make the halt fire only on an explicit withdrawal, not on absence: either derive a tri-state (granted|withdrawn|none) for gdpr_processing in DerivedConsents, or add gdprWithdrawn: boolean (latest gdpr_processing event exists AND action==='withdrawn') and have consentBlocksCommit block only when gdprWithdrawn. Update the B1.2 test fixtures accordingly (the withdrawn fixture already has explicit events, so its assertions survive).
2. **[B2.1/step 3 (Conversation.dntSignedAt/dntValidUntil drop) vs B2.4/B2.6 ordering]** SEQUENCING/COMPILE BREAK: B2.1's migration drops the Conversation DNT columns, but dnt-handlers.ts still reads them in checkDntStatus (lines 36-42) and writes them in signDnt (lines 298-301) until B2.4/B2.6; B1.5's sign-dnt-consent test also asserts conversation.dntSignedAt non-null and is only updated 'in the same commit' as B2.6. B2.1 step 4 demands 'npx tsc --noEmit clean', which is impossible: the regenerated Prisma client no longer has the columns while two tasks' worth of code still references them. The B2.1 Modify list re-points consent-check.ts and application-handlers.ts but omits dnt-handlers.ts entirely.
   **Fix:** Move the DROP of Conversation.dntSignedAt/dntValidUntil into B2.6's migration step (after signDnt is re-platformed and B1.5's test is rewritten), keeping B2.1 to the new models + ProductType cast + hasValidDnt re-point; or have B2.1 stub checkDntStatus/signDnt against the new helper in the same task.
3. **[B1/B2/B4 retirement sweeps (B1.1, B2.4-B2.6, B4.3-B4.4) — existing test suite]** OMISSION: the packages rewrite or delete behavior pinned by existing mocked-prisma unit tests — __tests__/lib/tools/handlers/dnt-signing.test.ts (conversation stamps), set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-handlers/advance/promotion tests (DNT pre-gate, tier/level args, cancel→COMPLETED), preview-handlers.test.ts, __tests__/lib/compliance/consent-check.test.ts, __tests__/lib/chat/default-tools.test.ts, debug/conversation-export tests (dntSignedAt), plus skill-pack-orchestrator.test.ts — yet only __tests__/integration/navigation.test.ts is ever named for deletion (B4.4). Every package ends with 'npx vitest run → full suite green', which is unreachable without migrating/deleting these files; per T12.D3 most should be deleted in favor of the new real-DB tests, not mocked anew.
   **Fix:** Add to each package's retirement task an explicit Delete/Rewrite list for the legacy tests covering the behavior it changes (B1.1: consent-check.test.ts portions, default-tools.test.ts; B2.4-2.6: dnt-signing.test.ts, conversation-export dnt assertions; B4.3-4.4: set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-*.test.ts), with the T12.D3 rationale (mocked-prisma choreography superseded by real-DB tests).
4. **[B1 migrations bullet 4 + B1.6/B2.7/B4.7 grep checks]** FACTUAL ERRORS IN SWEEP TARGETS: (a) record_gdpr_consent/acknowledge_ai_disclosure are NOT granted in prisma/seeds/seed-skill-packs.ts (verified zero occurrences) — they are only in DEFAULT_DISCOVERY_TOOLS; (b) the registry consent blocks are at registry.ts:1091-1125, not 1042-1117 (stale agenda line numbers); (c) prisma/seeds/seed-workflows.ts DOES grant retired tools (update_customer_profile:59; check_dnt_status/start_dnt_questionnaire/save_dnt_answer/sign_dnt/start_application:130-312) and is never named by any B-package sweep; (d) scripts/ (diag-orchestrator.ts, dump-conversation.ts, inspect-app.ts read gdprConsentAt/extractedProfile; verify-advance-flow.ts reads dntSignedAt) and __tests__/ are excluded from the B2.7/B1.6 grep paths, so the verification greps cannot catch all stale readers; (e) M12 deletes the entire skill-pack subsystem (and M9's dead-config cleanup covers Workflow* seeds) in late Block A — if that lands before B1/B2/B4, the instructed seed-skill-packs.ts edits target a deleted file.
   **Fix:** Correct the bullets: name DEFAULT_DISCOVERY_TOOLS + seed-workflows.ts (not seed-skill-packs.ts) as the grant sites, fix the registry line range, extend every package's verification grep to `lib/ app/ prisma/ scripts/ __tests__/`, and add a depends_on/coordination note that the seed-skill-packs/seed-workflows edits apply only if Block A's M12/M9 cleanup has not already deleted those files.
5. **[B2.3/step 1 Files + step 3 call-site list]** INACCURATE SWEEP LIST: set-answer-handlers.ts and preview-handlers.ts do NOT call getNextQuestion/calculateProgress (they hit prisma.answer directly), so listing them as engine call sites is wrong; meanwhile quote-handlers.ts:500 (modify_quote path: getNextQuestion(['application'], conversationId)) IS a call site whose signature changes and is missing — compile breaks at B2.3 unless it is updated.
   **Fix:** Replace the call-site list with the verified one: dnt-handlers.ts, application-handlers.ts (66/101/148/326/406/452), product-switch-handler.ts:57, quote-handlers.ts:500. Drop set-answer-handlers/preview-handlers from this task (they are Answer readers, handled by B4.1's re-key sweep).
6. **[B4.2/step 3, B1.4/step 3, B2.2/step 3 (code-block quality)]** CODE SMELLS IN 'REAL CODE' BLOCKS (NO PLACEHOLDERS rule, milder cases): (a) B4.2's `const blocked: typeof i extends never ? never : {...}[]` is a nonsense conditional type that always resolves to its right branch; (b) B1.4's ctx type `tx: never` is unconstructible pseudo-typing the gateway must cast around; (c) B2.2's decideSessionType triple-ternary is exactly equivalent to `latest ? 'UPDATE' : 'NEW'` and obscures the rule its own note states plainly; (d) applicationExposure declares an openDntSession input it never reads.
   **Fix:** (a) type blocked as { action: string; reason: string; params?: Record<string,unknown> }[]; (b) type tx as the A2 transaction-client type (Prisma.TransactionClient) once A2 pins it; (c) write `return latest ? 'UPDATE' : 'NEW'` with the comment; (d) drop openDntSession from AppExposureInput or use it (e.g. to block save_application_answer while a DNT session is open, if that is the intended rule).

### ➕ Addendum tasks for B2 (binding — coverage-critic gaps)

### Task B2.ADD-1: withdraw_consent(gdpr_processing) marks the signed Dnt WITHDRAWN (closes G16)
**Files:**
- Modify: the withdraw_consent handler (B1) + Dnt model usage
- Test: `__tests__/integration/withdraw-dnt-linkage.test.ts`
**Steps:**
- [ ] Step 1: Failing integration test: grant → sign (Dnt SIGNED) → `withdraw_consent({kind:'gdpr_processing'})` → Dnt.status === 'WITHDRAWN'; `deriveAndExpose` blocks writing commits with reason `requires_consent` while `sign_dnt`/`open_dnt_session`/`write_dnt_answer` remain exposed (the re-grant path — Block B verifier erratum).
- [ ] Step 2: FAIL → Step 3: withdrawal handler also transitions the customer's signed Dnt to WITHDRAWN in the same transaction. Step 4: PASS. Step 5: commit.

## Package B3: Identity: one challenge primitive, claim-and-merge on verify, identity-requirements rows, document pipeline

**Execution slot:** 10 | **Depends on:** A3, B0, B1, E2

**Goal:** One VerificationChallenge primitive presented as in-chat OTP and magic link; verifying a channel binds the chat session and claim-and-merges anonymous artifacts; identity tier derived (never stored) and gated per the #1 requirements rows; deterministic document pipeline (CNP checksum, declared-vs-extracted match, expiry) flips fields to verified/conflict, failures queue document_review WorkItems, verified fields emit mutation events for C1.

**Migrations / seeds:**
- Add enum VerificationChannel { email sms } and model VerificationChallenge { id, customerId, channel, target String, codeHash String, linkToken String? @unique, conversationId String?, expiresAt DateTime, attemptsRemaining Int @default(5), consumedAt DateTime?, createdAt }
- Customer: DROP magicLinkToken, magicLinkExpiresAt (replaced by VerificationChallenge; demo data — no backfill)
- Add enums DocumentKind { id_card } and DocumentStatus { uploaded extracted validated review rejected }; model CustomerDocument { id, customerId, kind, status @default(uploaded), encryptedData Bytes, dataIv String, dataTag String, language String?, extractedFields Json?, validationFindings Json?, verifiedFields String[], createdAt, updatedAt } — images live ONLY here, never in ledger/TurnDebug (T14.D5)
- Product: ADD verificationRequirements Json? — seed protect with { accept_quote: [], initiate_payment: ['id_card'] } (R6 default: ID photo before initiate_payment)
- Register start_channel_verification, confirm_channel_verification, request_document_upload; add VerificationChallenge + CustomerDocument to test-db TABLES and to claim-merge REPOINTERS
- CNP blind index (M15) explicitly NOT built — recorded as a deferred add-on; npx prisma migrate dev --name b3_identity + npx prisma db seed

### Task B3.1: Pure CNP validation (checksum, DOB consistency)
**Files:**
- Create: lib/engines/cnp-validation.ts
- Test: __tests__/lib/engines/cnp-validation.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (hand-computed fixtures):
```ts
import { it, expect } from 'vitest'
import { validateCnpChecksum, cnpBirthDate, cnpMatchesDob } from '@/lib/engines/cnp-validation'
it('checksum: weights 279146358279, control = sum%11 (10→1)', () => {
  expect(validateCnpChecksum('1980418089861')).toBe(true)  // sum 375 → 375%11=1
  expect(validateCnpChecksum('2950715123458')).toBe(true)  // sum 261 → 261%11=8
  expect(validateCnpChecksum('1980418089862')).toBe(false) // wrong control digit
  expect(validateCnpChecksum('0980418089861')).toBe(false) // leading 0 invalid
})
it('birth date decodes from S+YYMMDD with century by sex digit', () => {
  expect(cnpBirthDate('1980418089861')?.toISOString().slice(0, 10)).toBe('1998-04-18')
  expect(cnpBirthDate('2950715123458')?.toISOString().slice(0, 10)).toBe('1995-07-15')
  expect(cnpBirthDate('1981332089861')).toBeNull() // month 13 impossible
})
it('DOB consistency: match, mismatch, unknown for resident prefixes 7-9', () => {
  expect(cnpMatchesDob('1980418089861', new Date('1998-04-18'))).toBe(true)
  expect(cnpMatchesDob('1980418089861', new Date('1998-04-19'))).toBe(false)
  expect(cnpMatchesDob('7980418089865', new Date('1998-04-18'))).toBe('unknown')
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/engines/cnp-validation.test.ts` → FAIL
- [ ] Step 3: Implement:
```ts
// lib/engines/cnp-validation.ts — PURE, deterministic; the LLM is never the validator (T4-R3)
const WEIGHTS = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9]
export function validateCnpChecksum(cnp: string): boolean {
  if (!/^[1-9]\d{12}$/.test(cnp)) return false
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(cnp[i]), 0)
  const rem = sum % 11
  return (rem === 10 ? 1 : rem) === Number(cnp[12])
}
export function cnpBirthDate(cnp: string): Date | null {
  const s = Number(cnp[0])
  const century = s <= 2 ? 1900 : s <= 4 ? 1800 : s <= 6 ? 2000 : null
  if (century === null) return null
  const yy = Number(cnp.slice(1, 3)), mm = Number(cnp.slice(3, 5)), dd = Number(cnp.slice(5, 7))
  const d = new Date(Date.UTC(century + yy, mm - 1, dd))
  return d.getUTCFullYear() === century + yy && d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd ? d : null
}
export function cnpMatchesDob(cnp: string, dob: Date): boolean | 'unknown' {
  const b = cnpBirthDate(cnp)
  if (b === null) return Number(cnp[0]) >= 7 ? 'unknown' : false
  return b.toISOString().slice(0, 10) === dob.toISOString().slice(0, 10)
}
```
- [ ] Step 4: `npx vitest run __tests__/lib/engines/cnp-validation.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(engines): deterministic CNP checksum + DOB-consistency validation"`

### Task B3.2: Identity tier derivation + identity-requirements rows (#1)
**Files:**
- Create: lib/engines/identity-rules.ts
- Test: __tests__/lib/engines/identity-rules.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect } from 'vitest'
import { deriveIdentityTier, evaluateIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-rules'
const f = (over: Partial<Record<string, { value: string; provenance: 'declared'|'verified'|'conflict' }>> = {}) => ({
  fields: { name: { value: 'Ana Pop', provenance: 'declared' as const }, cnp: { value: '1980418089861', provenance: 'declared' as const }, dateOfBirth: { value: '1998-04-18', provenance: 'declared' as const }, email: { value: 'a@b.ro', provenance: 'declared' as const }, phone: { value: '0712345678', provenance: 'declared' as const }, ...over },
  verifiedChannels: [] as ('email'|'sms')[],
})
it('tier is derived, never stored: anonymous → declared → verified_channel', () => {
  expect(deriveIdentityTier({ fields: {}, verifiedChannels: [] })).toBe('anonymous')
  expect(deriveIdentityTier(f())).toBe('declared')
  expect(deriveIdentityTier({ ...f(), verifiedChannels: ['email'] })).toBe('verified_channel')
})
it('invalid CNP checksum blocks the declared tier', () => {
  expect(deriveIdentityTier(f({ cnp: { value: '1980418089862', provenance: 'declared' } }))).toBe('anonymous')
})
it('#1 rows: generate_quote needs declared cnp-or-dob; accept_quote needs verified_channel; initiate_payment adds product docs', () => {
  expect(IDENTITY_REQUIREMENTS.set_application).toEqual({ minTier: 'anonymous' }) // no hard gate pre-needs-analysis (#1)
  const anon = { fields: {}, verifiedChannels: [] as ('email'|'sms')[] }
  expect(evaluateIdentityRequirement('generate_quote', anon, [])).toEqual({ ok: false, needs: ['declared:cnp_or_dateOfBirth'] })
  expect(evaluateIdentityRequirement('generate_quote', { fields: { dateOfBirth: { value: '1998-04-18', provenance: 'declared' } }, verifiedChannels: [] }, [])).toEqual({ ok: true })
  expect(evaluateIdentityRequirement('accept_quote', f(), [])).toEqual({ ok: false, needs: ['verified_channel'] })
  expect(evaluateIdentityRequirement('initiate_payment', { ...f(), verifiedChannels: ['email'] }, ['id_card'])).toEqual({ ok: false, needs: ['document:id_card'] })
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/engines/identity-rules.test.ts` → FAIL
- [ ] Step 3: Implement:
```ts
// lib/engines/identity-rules.ts — PURE; consumed by deriveAndExpose (identity slice + requires_identity blocking) and the A2 gateway
import { validateCnpChecksum, cnpMatchesDob } from '@/lib/engines/cnp-validation'
export type IdentityTier = 'anonymous' | 'declared' | 'verified_channel'
export interface IdentityFacts { fields: Partial<Record<'name'|'cnp'|'dateOfBirth'|'email'|'phone', { value: string; provenance: 'declared'|'verified'|'conflict' }>>; verifiedChannels: ('email'|'sms')[] }
const KYC: (keyof IdentityFacts['fields'])[] = ['name', 'cnp', 'dateOfBirth', 'email', 'phone']
export function deriveIdentityTier(f: IdentityFacts): IdentityTier {
  const all = KYC.every(k => f.fields[k] && f.fields[k]!.provenance !== 'conflict')
  const cnp = f.fields.cnp?.value
  const dob = f.fields.dateOfBirth?.value
  const cnpOk = !!cnp && validateCnpChecksum(cnp) && (!dob || cnpMatchesDob(cnp, new Date(dob)) !== false)
  if (!all || !cnpOk) return 'anonymous'
  return f.verifiedChannels.length > 0 ? 'verified_channel' : 'declared'
}
export interface IdentityRequirement { minTier: IdentityTier; anyDeclaredOf?: ('cnp'|'dateOfBirth')[]; productDocuments?: boolean }
export const IDENTITY_REQUIREMENTS: Record<string, IdentityRequirement> = {
  set_application: { minTier: 'anonymous' },
  sign_dnt: { minTier: 'anonymous' },
  generate_quote: { minTier: 'anonymous', anyDeclaredOf: ['cnp', 'dateOfBirth'] },
  accept_quote: { minTier: 'verified_channel' },
  initiate_payment: { minTier: 'verified_channel', productDocuments: true },
}
const RANK: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }
export function evaluateIdentityRequirement(tool: string, facts: IdentityFacts, validatedDocs: string[]): { ok: true } | { ok: false; needs: string[] } {
  const req = IDENTITY_REQUIREMENTS[tool]
  if (!req) return { ok: true }
  const needs: string[] = []
  if (RANK[deriveIdentityTier(facts)] < RANK[req.minTier]) needs.push(req.minTier === 'verified_channel' ? 'verified_channel' : 'declared')
  if (req.anyDeclaredOf && !req.anyDeclaredOf.some(k => facts.fields[k])) needs.push(`declared:${req.anyDeclaredOf.join('_or_')}`)
  if (req.productDocuments) for (const d of (globalThis as never) && [] as string[]) void d // resolved by caller — see step note
  return needs.length ? { ok: false, needs } : { ok: true }
}
```
Step note: productDocuments resolution takes `requiredDocs: string[]` (loaded from Product.verificationRequirements by the caller) — implement as a third parameter `requiredDocs` checked against `validatedDocs`, pushing `document:<kind>` per missing kind (the test pins this signature). Wire `identity: { tier, missingFields, verifiedChannels }` into DerivedStateV3 via the snapshot loader (fields from profile-service, verifiedChannels from VerificationChallenge consumption records) and register evaluateIdentityRequirement in A1's exposure predicates + A2's gateway legality step (outcome requires_identity with needs).
- [ ] Step 4: `npx vitest run __tests__/lib/engines/identity-rules.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(engines): derived identity tier + per-commit identity-requirements rows (#1)"`

### Task B3.3: Harden collect_customer_field with CNP validation
**Files:**
- Modify: lib/tools/handlers/data-handlers.ts (validateField 'cnp' branch gains checksum; cross-check vs stored dateOfBirth)
- Test: __tests__/integration/collect-cnp-validation.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { setDeclaredField } from '@/lib/customer/profile-service'
beforeEach(async () => { await resetDb() })
const ctx = (id: string) => ({ customerId: id, conversationId: 'c', language: 'ro' as const }) as never
it('rejects checksum-invalid CNP with a precise reason', async () => {
  const c = await createCustomer()
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089862' }, ctx(c.id))
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_checksum_invalid')
})
it('rejects CNP inconsistent with the declared DOB', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1990-01-01', 'collect_customer_field')
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id)) // encodes 1998-04-18
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_dob_mismatch')
})
it('accepts a consistent CNP', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1998-04-18', 'collect_customer_field')
  expect((await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id))).success).toBe(true)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/collect-cnp-validation.test.ts` → FAIL (regex-only today, data-handlers.ts:79-85)
- [ ] Step 3: In validateField make 'cnp' async-capable or move the check into collectCustomerField after trim: `if (!validateCnpChecksum(v)) return { success:false, error:'cnp_checksum_invalid: ...' }`; load stored dateOfBirth via profile-service and `if (cnpMatchesDob(v, dob) === false) return { success:false, error:'cnp_dob_mismatch: ...' }`.
- [ ] Step 4: `npx vitest run __tests__/integration/collect-cnp-validation.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(identity): collect_customer_field enforces CNP checksum + DOB consistency"`

### Task B3.4: VerificationChallenge service (one primitive, two presentations)
**Files:**
- Create: lib/customer/verification-service.ts
- Modify: prisma/schema.prisma (VerificationChallenge; drop Customer.magicLinkToken/magicLinkExpiresAt), __tests__/helpers/test-db.ts, lib/customer/claim-merge.ts (repointers)
- Test: __tests__/integration/verification-challenge.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { issueChallenge, confirmByCode, confirmByLinkToken } from '@/lib/customer/verification-service'
beforeEach(async () => { await resetDb() })
it('issues one challenge usable as OTP or link; confirm consumes once; channel becomes verified', async () => {
  const c = await createCustomer()
  const { challengeId, code, linkToken } = await issueChallenge(c.id, 'email', 'ana@example.ro', 'conv-1')
  expect(code).toMatch(/^\d{6}$/)
  const row = await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: challengeId } })
  expect(row.codeHash).not.toContain(code) // hashed at rest
  const r = await confirmByCode(c.id, code)
  expect(r).toMatchObject({ ok: true, channel: 'email', conversationId: 'conv-1' })
  expect((await confirmByLinkToken(linkToken)).ok).toBe(false) // one-time use
})
it('expiry and attempt limits hold', async () => {
  const c = await createCustomer()
  const { code } = await issueChallenge(c.id, 'email', 'a@b.ro', null)
  for (let i = 0; i < 5; i++) expect((await confirmByCode(c.id, '000000')).ok).toBe(false)
  expect((await confirmByCode(c.id, code))).toMatchObject({ ok: false, reason: 'attempts_exhausted' })
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/verification-challenge.test.ts` → FAIL
- [ ] Step 3: Implement: issueChallenge generates a 6-digit code (crypto.randomInt), linkToken (crypto.randomUUID), sha256 codeHash, 10-min expiry, attemptsRemaining 5; invalidates prior unconsumed challenges for the customer; sends the email/SMS via lib/email provider (code + `${APP_URL}/api/auth/verify?token=${linkToken}` in one message — same challenge, two presentations, T4-R5). confirmByCode/confirmByLinkToken: locate live challenge, decrement attempts on mismatch, check expiry, set consumedAt, then `setVerifiedField(customerId, channelField, target, 'channel_verification', challengeId)` (email→'email', sms→'phone') and return `{ ok, channel, target, conversationId }`. verifiedChannels derivation for identity-rules reads consumed challenges. Migration: `npx prisma migrate dev --name b3_identity && npx prisma db seed`.
- [ ] Step 4: `npx vitest run __tests__/integration/verification-challenge.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(identity): VerificationChallenge — one hashed challenge, OTP and magic-link presentations"`

### Task B3.5: Chat commits start/confirm_channel_verification + claim-and-merge on confirm
**Files:**
- Create: lib/tools/handlers/identity-handlers.ts
- Modify: lib/tools/registry.ts (register both, gateway-routed)
- Test: __tests__/integration/channel-verification-commits.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { setDeclaredField } from '@/lib/customer/profile-service'
beforeEach(async () => { await resetDb() })
it('start issues a challenge without disclosing whether the target matches an existing account (anti-enumeration, T4.D4)', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'start_channel_verification', args: { channel: 'email', target: 'victim@example.ro' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  expect(JSON.stringify(r.data)).not.toMatch(/exists|found|match/i)
})
it('confirm verifies the channel; when the target belongs to another customer it claim-and-merges the anonymous shell INTO the verified owner', async () => {
  const owner = await createCustomer({ email: 'ana@example.ro', isAnonymous: false })
  await setDeclaredField(owner.id, 'email', 'ana@example.ro', 'seed')
  const shell = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: shell.id } })
  await executeCommit({ tool: 'start_channel_verification', args: { channel: 'email', target: 'ana@example.ro' }, actor: 'agent', customerId: shell.id, conversationId: conv.id })
  const ch = await prisma.verificationChallenge.findFirstOrThrow({ where: { customerId: shell.id } })
  const code = (globalThis as Record<string, unknown>).__lastIssuedCode as string // exposed by the mock email provider in tests
  const r = await executeCommit({ tool: 'confirm_channel_verification', args: { code }, actor: 'gui', customerId: shell.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  expect((r.data as { customerId: string }).customerId).toBe(owner.id) // session rebinds to the canonical customer
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).customerId).toBe(owner.id)
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: shell.id } })).mergedIntoId).toBe(owner.id)
  expect(ch.conversationId).toBe(conv.id)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/channel-verification-commits.test.ts` → FAIL
- [ ] Step 3: Implement: startChannelVerification validates channel/target format, calls issueChallenge(ctx.customerId, channel, target, ctx.conversationId), returns applied with `{ channelMasked }` only (no match disclosure) + uiAction `show_otp_entry`; confirmChannelVerification calls confirmByCode; on ok: find owner customer by mirror column (email/phone) where id ≠ ctx.customerId and mergedIntoId null — if found, `claimAndMerge(ctx.customerId, owner.id)` and return data `{ customerId: owner.id, merged: true }` (the orchestrator/session layer rebinds zeno_session — add that consumption in app/api/chat route where the commit result surfaces); else verify in place. Effects: [] (tier change shows up in the post-commit deriveAndExpose; verified email/phone field events go to C1 via the B3.7 hook). Test email provider mock exposes the last code.
- [ ] Step 4: `npx vitest run __tests__/integration/channel-verification-commits.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(identity): in-chat OTP verification commits with verified claim-and-merge"`

### Task B3.6: Magic-link rework — bind the chat session, return to the conversation
**Files:**
- Modify: app/api/auth/verify/route.ts (consume VerificationChallenge via confirmByLinkToken; claim-and-merge; set zeno_session to the canonical customer; redirect to /chat?conversationId=... when challenge.conversationId set, else /dashboard; keep JWT issuance)
- Modify: app/api/auth/magic-link/route.ts (issue via issueChallenge instead of Customer.magicLinkToken)
- Modify: lib/payments/post-payment.ts:87-100 (mint the re-entry link from issueChallenge with the conversationId — fixes the dead /dashboard?token=... URL)
- Test: __tests__/app/api/auth-verify.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (route handler invoked directly with a NextRequest):
```ts
import { it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { issueChallenge } from '@/lib/customer/verification-service'
import { GET as verifyGet } from '@/app/api/auth/verify/route'
beforeEach(async () => { await resetDb() })
it('link verification binds the chat session and returns to the conversation, not the dashboard', async () => {
  const c = await createCustomer({ email: 'ana@example.ro' })
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const { linkToken } = await issueChallenge(c.id, 'email', 'ana@example.ro', conv.id)
  const res = await verifyGet(new NextRequest(`http://localhost/api/auth/verify?token=${linkToken}`))
  expect(res.status).toBeGreaterThanOrEqual(302)
  expect(res.headers.get('location')).toContain(`/chat?conversationId=${conv.id}`)
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('zeno_session=')
})
it('expired/consumed token redirects with an error, never throws', async () => {
  const res = await verifyGet(new NextRequest('http://localhost/api/auth/verify?token=nope'))
  expect(res.headers.get('location')).toContain('error=invalid-token')
})
```
- [ ] Step 2: `npx vitest run __tests__/app/api/auth-verify.test.ts` → FAIL (route still reads Customer.magicLinkToken and always redirects to /dashboard)
- [ ] Step 3: Rewrite verify route: `const r = await confirmByLinkToken(token)`; on ok run the same owner-lookup + claimAndMerge as B3.5 (shared helper `completeChannelVerification(challenge)` extracted into verification-service so OTP and link paths cannot diverge — T4 risk), set zeno_session cookie to the canonical customerId, keep User/JWT upsert for dashboard access, redirect to the conversation when challenge.conversationId is set. magic-link route: replace token minting with issueChallenge (email channel, no conversation binding for dashboard-initiated requests). post-payment: issueChallenge with the paying conversation's id.
- [ ] Step 4: `npx vitest run __tests__/app/api/auth-verify.test.ts __tests__/integration/channel-verification-commits.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(identity): magic link = same challenge primitive; verify binds chat session and returns to conversation"`

### Task B3.7: Document pipeline — request_document_upload, extraction provider, deterministic validation
**Files:**
- Create: lib/identity/extraction-provider.ts (interface + MockExtractionProvider), lib/identity/document-pipeline.ts, app/api/documents/upload/route.ts
- Modify: lib/tools/handlers/identity-handlers.ts (requestDocumentUpload commit), lib/tools/registry.ts
- Test: __tests__/integration/document-pipeline.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { processDocument } from '@/lib/identity/document-pipeline'
import { setMockExtraction } from '@/lib/identity/extraction-provider'
import { setDeclaredField, getProfile } from '@/lib/customer/profile-service'
beforeEach(async () => { await resetDb() })
async function uploadedDoc(customerId: string) {
  return prisma.customerDocument.create({ data: { customerId, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' } })
}
it('matching extraction flips declared fields to verified and emits mutation events (T4-R4)', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'name', 'Stefan Popa', 'collect_customer_field')
  await setDeclaredField(c.id, 'cnp', '1980418089861', 'collect_customer_field')
  setMockExtraction({ name: 'Ștefan Popa', cnp: '1980418089861', expiryDate: '2030-01-01' })
  const doc = await uploadedDoc(c.id)
  const events: unknown[] = []
  const r = await processDocument(doc.id, { onFieldVerified: e => { events.push(e) } })
  expect(r.status).toBe('validated')
  const p = await getProfile(c.id)
  expect(p.fields.name).toMatchObject({ provenance: 'verified' })
  expect(p.fields.cnp).toMatchObject({ provenance: 'verified' })
  expect(events).toContainEqual(expect.objectContaining({ field: 'cnp' })) // feeds the C1 planner (eligibility_recheck/re_rating)
})
it('mismatch → conflict surfaced; checksum-invalid extraction or expired document → review + WorkItem(document_review)', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'name', 'Ion Popa', 'collect_customer_field')
  setMockExtraction({ name: 'Ion Popescu', cnp: '1980418089862', expiryDate: '2020-01-01' })
  const doc = await uploadedDoc(c.id)
  const r = await processDocument(doc.id, { onFieldVerified: () => {} })
  expect(r.status).toBe('review')
  expect(r.findings).toEqual(expect.arrayContaining(['cnp_checksum_invalid', 'document_expired', 'field_mismatch:name']))
  expect(await prisma.workItem.count({ where: { kind: 'document_review' } })).toBe(1) // E2 model
  expect((await getProfile(c.id)).fields.name).toMatchObject({ provenance: 'conflict' })
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/document-pipeline.test.ts` → FAIL
- [ ] Step 3: Implement: extraction-provider exports `interface DocumentExtractionProvider { extract(data: Buffer, kind: 'id_card'): Promise<{ name?: string; cnp?: string; dateOfBirth?: string; expiryDate?: string }> }`, `MockExtractionProvider` (fixture via setMockExtraction; selected by DOCUMENT_EXTRACTION_PROVIDER env, default mock — provider-pluggable per T4-R3, real eKYC slots in later). document-pipeline processDocument: load doc → extract (extraction is not a decision) → DETERMINISTIC validation: expiryDate > now ('document_expired'), validateCnpChecksum ('cnp_checksum_invalid'), per-field declared-vs-extracted via setVerifiedField (provenance-rules handles match→verified / mismatch→conflict; record 'field_mismatch:<f>' when conflict) → all clean: status 'validated', verifiedFields stamped, `opts.onFieldVerified({ customerId, field, value })` per flipped field (production wiring publishes these as C1 mutation events) → any finding: status 'review' + `createWorkItem({ kind: 'document_review', refs: { customerDocumentId }, reason: findings.join(',') })` (E2 API). requestDocumentUpload commit: legality via product verificationRequirements; returns applied + uiAction `show_document_upload { kind, uploadUrl: '/api/documents/upload' }` (agent never touches the image — Stripe-card pattern). Upload route: multipart → AES-GCM encrypt buffer → CustomerDocument(uploaded) → fire processDocument.
- [ ] Step 4: `npx vitest run __tests__/integration/document-pipeline.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(identity): document pipeline — pluggable extraction, deterministic validation, review queue, mutation events"`

### Task B3.8: Package verification
**Files:**
- Create: scripts/verify-identity-flow.ts (dev-DB: declared fields → tier declared → OTP verify → tier verified_channel → second shell claims the same email → merge → mock document validates → cnp verified; prints PASS/FAIL per leg)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx prisma migrate dev && npx prisma db seed` → clean; `npx tsc --noEmit` clean
- [ ] Step 2: `npx vitest run` → green (instrumentation flake rule); grep `magicLinkToken` across lib/ app/ returns nothing
- [ ] Step 3: `npx tsx scripts/verify-identity-flow.ts` → all PASS
- [ ] Step 4: `git add -A && git commit -m "chore(identity): B3 verification — tiers derived, one challenge primitive, document pipeline live"`

### ⚠ Binding errata for B3 (fidelity verifier — apply OVER the task text above)

1. **[B3.2/step 3 (identity-rules.ts) — evaluateIdentityRequirement]** PLACEHOLDER + CONTRACT MISMATCH: the implementation block contains the non-functional line `if (req.productDocuments) for (const d of (globalThis as never) && [] as string[]) void d // resolved by caller — see step note` — a literal placeholder violating the NO PLACEHOLDERS rule. Worse, the test pins a 3-arg call evaluateIdentityRequirement('initiate_payment', facts, ['id_card']) expecting needs ['document:id_card'], which only works if the third parameter is requiredDocs (with validatedDocs defaulted), but the shown signature names it validatedDocs; the step note then describes a different signature again ('third parameter requiredDocs checked against validatedDocs'). An executor cannot reconcile test, code, and note.
   **Fix:** Replace the code block with a real implementation and one signature: evaluateIdentityRequirement(tool, facts, requiredDocs: string[] = [], validatedDocs: string[] = []) — when req.productDocuments, push `document:${kind}` for each kind in requiredDocs not present in validatedDocs. Keep the test as written (third arg = requiredDocs loaded from Product.verificationRequirements by the caller) and add one assertion with validatedDocs supplied to prove the satisfied case.
2. **[B3.6/step 1+3 (auth verify redirect)]** CODEBASE MISMATCH: the test asserts redirect to `/chat?conversationId=${conv.id}`, but the app's conversation route is /chat/[id] (app/chat/[id]/page.tsx); app/chat/page.tsx ignores query params — it creates/loads a session and router.replace()'s to /chat/<newId>. The planned redirect would NOT return the customer to their conversation; it would bootstrap a different one, defeating the task's stated purpose (T4-R5 return-to-conversation).
   **Fix:** Redirect to `/chat/${challenge.conversationId}` and assert that in the test; verify app/chat/[id]/page.tsx loads an existing conversation by id for the session's customer (it does — it renders by params.id).
3. **[B3.4/step 3 (drop magicLinkToken columns) vs B3.6 ordering]** SEQUENCING/COMPILE BREAK (smaller twin of the B2.1 issue): B3.4's migration drops Customer.magicLinkToken/magicLinkExpiresAt while app/api/auth/verify/route.ts (reads/clears the token), app/api/auth/magic-link/route.ts (mints it), and lib/payments/post-payment.ts:87-100 (writes it) are only reworked in B3.6, two commits later. tsc is broken between B3.4 and B3.6.
   **Fix:** Move the column DROP into B3.6's step 3 (same task that rewrites the three consumers), keeping B3.4 to the VerificationChallenge model + service.
4. **[B3.2/step 1 (IDENTITY_REQUIREMENTS.generate_quote) + B3 migrations (verificationRequirements seed)]** FIDELITY JUDGMENTS NEEDING SIGN-OFF: (a) contradiction #1's example row reads 'generate_quote → declared + CNP-or-DOB'; the draft encodes minTier:'anonymous' + anyDeclaredOf:[cnp,dateOfBirth]. That reading makes 'CNP-or-DOB' non-vacuous (the full declared tier already implies both), but it deviates from the literal 'declared' tier; nothing in the plan records this as a deliberate interpretation. (b) T4-R6 says documents default for protect 'ID photo at accept / before initiate_payment'; the seed pins { accept_quote: [], initiate_payment: ['id_card'] } — the accept-side reading is silently dropped (only the block overview, not the task, mentions it).
   **Fix:** Add an explicit note in B3.2 step 3 recording both interpretations as deliberate (with the vacuity argument for (a)), and make (b) a one-line config choice in the migration bullet ('R6 ambiguity resolved to before-initiate_payment; flip by seeding accept_quote: [id_card] if compliance wants accept-time') so executors do not 'correct' it either way.
5. **[B0.4 (get_customer_profile payload) + B3 (never extended)]** M2 FIDELITY GAP: the M2 resolution specifies get_customer_profile re-backed with 'profile + provenance + identity tier + history summary'. B0.4 delivers profile/provenance/conflicts/history, and no B3 task ever adds the identity slice (tier, verifiedChannels) once it exists.
   **Fix:** Add to B3.5 (or a small B3 follow-up step) extending getCustomerProfile with identity: { tier: deriveIdentityTier(...), verifiedChannels, missingFields } and an assertion in the B3.5 or B3.8 verification.
6. **[B3.6/step 3 + B3.5/step 3 (zeno_session rebinding)]** T4.D5 TENSION: the plan writes 'set zeno_session cookie to the canonical customerId' — i.e. perpetuates the raw-Customer.id cookie that T4.D5 (server-resolved opaque session) explicitly retires. If Block A (gateway actor resolution per pinned ordering step 1) owns the opaque-session layer, B3 must rebind through that primitive, not write a raw id; if no block owns T4.D5, the identity gates B3 builds are decorative (the agenda's own words).
   **Fix:** Reference the session primitive by its A-block name in B3.5/B3.6 ('rebind the server session to the canonical customer via <A2 session API>'), add it to B3's depends_on, and flag explicitly in the package goal that T4.D5 transport identity is consumed, not implemented, here — or add the opaque-session task to B3 if Block A does not own it.

### ➕ Addendum tasks for B3 (binding — coverage-critic gaps)

### Task B3.ADD-1: Identity-requirements table as a concrete module (closes G7, contradiction #1)
**Files:**
- Create: `lib/engines/identity-requirements.ts`
- Test: `__tests__/lib/engines/identity-requirements.test.ts`
**Steps:**
- [ ] Step 1: Failing test:
```ts
import { IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-requirements'
import { listCommitTools } from '@/lib/tools/registry'

describe('per-commit identity requirements (#1)', () => {
  it('pins the ratified rows', () => {
    expect(IDENTITY_REQUIREMENTS.generate_quote).toEqual({ tier: 'declared', fields: ['cnp_or_dob'] })
    expect(IDENTITY_REQUIREMENTS.accept_quote).toEqual({ tier: 'verified_channel' })
    expect(IDENTITY_REQUIREMENTS.ensure_payment_session).toEqual({ tier: 'verified_channel', documents: 'product_config' })
  })
  it('every key is a registered commit tool', () => {
    const commits = new Set(listCommitTools())
    for (const k of Object.keys(IDENTITY_REQUIREMENTS)) expect(commits.has(k), k).toBe(true)
  })
})
```
- [ ] Step 2: FAIL → Step 3: implement the module (typed `Record<string, {tier: IdentityTier; fields?: string[]; documents?: 'product_config'}>`; unlisted commits default to anonymous). deriveAndExpose consumes it; `requires_identity` envelopes carry `needs` from it. Step 4: PASS. Step 5: commit.

### Task B3.ADD-2: Identity uiAction renderers (closes G12, M4/T4-R3)
**Files:**
- Modify: B3 handlers (`start_channel_verification` returns `show_otp_entry` uiAction; `request_document_upload` returns `show_document_upload`)
- Modify: `lib/chat/action-adapter.ts` (gui mappings: otp_submit → confirm_channel_verification; document_uploaded → the system pipeline trigger)
- Test: `__tests__/lib/tools/identity-uiactions.test.ts`
**Steps:**
- [ ] Step 1: Failing test: both handlers' envelopes carry the uiAction payloads (`{type:'show_otp_entry', channel}` / `{type:'show_document_upload', kind, uploadUrl}`); adapter maps the gui actions through the gateway with actor='gui'.
- [ ] Step 2: FAIL → Step 3: implement. Step 4: PASS. Step 5: commit.

### Task B3.ADD-3: Soft verification offer at set_application (closes G6, T4-R6)
**Files:**
- Modify: set_application handler (B4 surface — coordinate: the flag is computed here, consumed by A4's section copy)
- Test: extend `__tests__/integration/` set_application tests
**Steps:**
- [ ] Step 1: Failing assertion: `set_application` applied-envelope `data.verificationOffer === true` when `identity.tier !== 'verified_channel'`, absent when verified.
- [ ] Step 2: FAIL → Step 3: compute from the snapshot tier. Step 4: PASS. Step 5: commit.

## Package B4: Application lifecycle: customer-scoped applications, set_application/select_coverage, status machine, resume + prefill-as-proposals

**Execution slot:** 11 | **Depends on:** A3, B0, B2, B3

**Goal:** Applications become customer-scoped with at-most-one-open-per-product; set_application freezes PRODUCT only; select_coverage is the sole selection writer (selection questions leave the questionnaire); the explicit status enum lands (cancel ≠ completed); resume works cross-conversation and get_last_application_info prefills as per-question proposals; set_answer/change_selection/switch_product retire.

**Migrations / seeds:**
- ApplicationStatus enum → OPEN, PAUSED, REFERRED, COMPLETED, CANCELLED (exact T5.D6 ✅ set + M9 inventory; the block-bullet's ABANDONED deliberately omitted — T5.D6 option text is authoritative per the briefing)
- Application: drop conversationId @unique → rename to originConversationId String? (audit only); ADD raw-SQL partial unique: CREATE UNIQUE INDEX "Application_one_open_per_product" ON "Application"("customerId", "productId") WHERE "status" IN ('OPEN','PAUSED','REFERRED')
- Conversation: ADD activeApplicationId String? (channel pointer, T5.D4)
- Answer re-key: ADD applicationId String, DROP conversationId, @@unique([questionId, applicationId]) — destructive (TRUNCATE "Answer" in the migration; demo data, B2 already moved DNT answers to DntAnswer)
- Seeds (prisma/seeds/seed-questions.ts): remove PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST from the 'application' group (T5.D2; HEALTH_DECLARATION_CONFIRM + PAYMENT_FREQUENCY stay — PAYMENT_FREQUENCY moves in Block D)
- Retire set_answer, change_selection, switch_product: delete registrations + handlers (set-answer-handlers.ts, change-selection-handlers.ts, product-switch-handler.ts), remove from DEFAULT_DISCOVERY_TOOLS and seed-skill-packs.ts; register set_application (replacing start_application), select_coverage, reworked resume_application, get_last_application_info, reworked cancel_application
- Update lib/chat/action-adapter.ts: select_tier/select_level → select_coverage; bd_continue → select_coverage { addon: false }; answer_question(application) stays save_application_answer
- npx prisma migrate dev --name b4_application_lifecycle + npx prisma db seed

### Task B4.1: Status enum + customer scoping + answer re-key migration
**Files:**
- Modify: prisma/schema.prisma (per migrations list), __tests__/helpers/test-db.ts
- Modify: lib/engines/questionnaire-engine.ts (AnswerScope gains { kind: 'application'; applicationId }), all Answer call sites (application-handlers, preview-handlers, derive snapshot loader) re-keyed
- Test: __tests__/integration/application-scoping.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
beforeEach(async () => { await resetDb() })
it('at most one open application per (customer, product); CANCELLED frees the slot', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })
  await expect(prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })).rejects.toThrow()
  await prisma.application.updateMany({ where: { customerId: c.id }, data: { status: 'CANCELLED' } })
  await expect(prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })).resolves.toBeDefined()
})
it('answers key on the application; REFERRED exists; conversation carries the pointer', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const app = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'REFERRED' } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'HEALTH_DECLARATION_CONFIRM' } })
  await prisma.answer.create({ data: { questionId: q.id, applicationId: app.id, value: 'confirm' } })
  await expect(prisma.answer.create({ data: { questionId: q.id, applicationId: app.id, value: 'x' } })).rejects.toThrow(/Unique constraint/)
  const conv = await prisma.conversation.create({ data: { customerId: c.id, activeApplicationId: app.id } })
  expect(conv.activeApplicationId).toBe(app.id)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/application-scoping.test.ts` → FAIL
- [ ] Step 3: Apply schema; in the generated migration add `TRUNCATE "Answer" CASCADE;` before the column swap and the partial unique index SQL from the migrations list. Extend AnswerScope: `| { kind: 'application'; applicationId: string }` with `prisma.answer.findMany({ where: { applicationId } })`; sweep call sites: save_application_answer/resume/derive snapshot use the application scope; selection questions are gone from seeds so PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST side-effect blocks in application-handlers.ts:279-301 are deleted (full removal lands in B4.3/B4.4 — here just keep compile green). `npx prisma migrate dev --name b4_application_lifecycle && npx prisma db seed`.
- [ ] Step 4: `npx vitest run __tests__/integration/application-scoping.test.ts` → PASS; `npx tsc --noEmit` clean
- [ ] Step 5: `git add -A && git commit -m "feat(application): customer-scoped applications, explicit status enum, application-keyed answers"`

### Task B4.2: Pure status machine + selection/questionnaire exposure rules
**Files:**
- Create: lib/engines/application-rules.ts
- Test: __tests__/lib/engines/application-rules.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect } from 'vitest'
import { canTransition, applicationExposure } from '@/lib/engines/application-rules'
it('status machine: COMPLETED and CANCELLED are terminal; cancel ≠ complete', () => {
  expect(canTransition('OPEN', 'CANCELLED')).toBe(true)
  expect(canTransition('OPEN', 'COMPLETED')).toBe(true) // only generate_quote drives this in practice
  expect(canTransition('COMPLETED', 'OPEN')).toBe(false) // modify_quote reopen structurally impossible (T5.D6)
  expect(canTransition('CANCELLED', 'OPEN')).toBe(false)
  expect(canTransition('REFERRED', 'OPEN')).toBe(true)   // underwriter approval re-entry (M5)
})
it('questionnaire is exposed only under a valid covering DNT (T5.D1 ordering flip, engine-enforced)', () => {
  const base = { application: { exists: true, status: 'OPEN' as const, tier: null, level: null, addon: null, answersComplete: false }, dntValidForProduct: false, openDntSession: false }
  const noDnt = applicationExposure(base)
  expect(noDnt.blocked.find(b => b.action === 'save_application_answer')).toMatchObject({ reason: 'requires_consent' })
  expect(applicationExposure({ ...base, dntValidForProduct: true }).available).toContain('save_application_answer')
})
it('selection incompleteness is a generate_quote blocked-reason, NOT a subphase (#10)', () => {
  const s = applicationExposure({ application: { exists: true, status: 'OPEN', tier: 'standard', level: null, addon: false, answersComplete: true }, dntValidForProduct: true, openDntSession: false })
  expect(s.available).toContain('select_coverage')
  expect(s.blocked.find(b => b.action === 'generate_quote')).toMatchObject({ reason: 'selection_incomplete', params: { missing: ['level'] } })
})
```
- [ ] Step 2: `npx vitest run __tests__/lib/engines/application-rules.test.ts` → FAIL
- [ ] Step 3: Implement:
```ts
// lib/engines/application-rules.ts — PURE; consumed by deriveAndExpose (A1) and the A2 gateway
export type AppStatus = 'OPEN' | 'PAUSED' | 'REFERRED' | 'COMPLETED' | 'CANCELLED'
const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  OPEN: ['PAUSED', 'REFERRED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['OPEN', 'CANCELLED'],
  REFERRED: ['OPEN', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [], CANCELLED: [],
}
export function canTransition(from: AppStatus, to: AppStatus): boolean { return TRANSITIONS[from].includes(to) }
export interface AppExposureInput { application: { exists: boolean; status: AppStatus; tier: string | null; level: string | null; addon: boolean | null; answersComplete: boolean }; dntValidForProduct: boolean; openDntSession: boolean }
export function applicationExposure(i: AppExposureInput): { available: string[]; blocked: { action: string; reason: string; params?: Record<string, unknown> }[] } {
  const available: string[] = []; const blocked: typeof i extends never ? never : { action: string; reason: string; params?: Record<string, unknown> }[] = []
  if (!i.application.exists) return { available: [], blocked: [] }
  if (['OPEN', 'PAUSED'].includes(i.application.status)) available.push('resume_application')
  if (i.application.status === 'OPEN') {
    available.push('select_coverage', 'cancel_application')
    if (i.dntValidForProduct) available.push('save_application_answer')
    else blocked.push({ action: 'save_application_answer', reason: 'requires_consent', params: { needs: ['valid_dnt'] } })
    const missing = [!i.application.tier && 'tier', !i.application.level && 'level'].filter(Boolean) as string[]
    if (i.application.answersComplete && missing.length === 0) available.push('generate_quote')
    else blocked.push({ action: 'generate_quote', reason: missing.length ? 'selection_incomplete' : 'questionnaire_incomplete', params: missing.length ? { missing } : undefined })
  }
  return { available, blocked }
}
```
Wire into A1's exposure registry (dntValidForProduct comes from B2's isDntValidFor over the snapshot).
- [ ] Step 4: `npx vitest run __tests__/lib/engines/application-rules.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(engines): application status machine + exposure rules (DNT gate inside @application)"`

### Task B4.3: set_application commit — freeze product only, no DNT pre-gate
**Files:**
- Modify: lib/tools/handlers/application-handlers.ts (startApplication → setApplication, gateway commit; DNT pre-gate at lines 35-40 DELETED; tier/level/addon args + Answer dual-writes at lines 50-95 DELETED)
- Modify: lib/tools/registry.ts (rename registration), lib/chat/action-adapter.ts ('start_application' action → set_application)
- Test: __tests__/integration/set-application.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
beforeEach(async () => { await resetDb() })
it('creates the customer-scoped application from the candidate WITHOUT a DNT (T5.D1) and freezes product only (T5.D3)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app).toMatchObject({ productId: p.id, status: 'OPEN', tierId: null, levelId: null })
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).activeApplicationId).toBe(app.id)
  expect((r.data as { softOffer: string }).softOffer).toBe('channel_verification') // R6 soft offer, not a gate
})
it('a second set_application for the same product is rejected with the open id', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const r2 = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r2).toMatchObject({ outcome: 'rejected', reason: 'application_already_open' })
})
it('no candidate product → rejected(no_candidate_product)', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'no_candidate_product' })
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/set-application.test.ts` → FAIL
- [ ] Step 3: Implement setApplication: resolve candidate (conversation.candidateProductId ?? productId) → rejected('no_candidate_product'); existing OPEN/PAUSED/REFERRED app for (customer, product) → rejected('application_already_open', params { applicationId }); create Application { customerId, productId (frozen), originConversationId, status OPEN }, set conversation.activeApplicationId + productId, data `{ applicationId, softOffer: 'channel_verification' }`, effects [] (gateway computes the advance_phase delta, #6). Delete the DNT gate and the tier/level/addon arg handling + recordSelection dual-writes; delete startApplication export.
- [ ] Step 4: `npx vitest run __tests__/integration/set-application.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(application): set_application freezes product only; DNT gate moves to questionnaire exposure"`

### Task B4.4: select_coverage — sole selection writer; retire change_selection/switch_product/set_answer
**Files:**
- Create: lib/tools/handlers/select-coverage-handlers.ts
- Delete: lib/tools/handlers/change-selection-handlers.ts, product-switch-handler.ts, set-answer-handlers.ts (+ registrations, DEFAULT_DISCOVERY_TOOLS entries, seed grants, action-adapter remaps per migrations list)
- Modify: lib/tools/handlers/application-handlers.ts (saveApplicationAnswer: PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST side-effect blocks removed; bd_medical group included in active codes only when includesAddon)
- Test: __tests__/integration/select-coverage.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { getToolDefinition } from '@/lib/tools/registry'
beforeEach(async () => { await resetDb() })
async function openApp() {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  return { c, p, conv }
}
it('writes Application columns only — no Answer rows (single writer, T5.D2)', async () => {
  const { c, conv } = await openApp()
  const r = await executeCommit({ tool: 'select_coverage', args: { tier: 'standard', level: 'level_1' }, actor: 'gui', customerId: c.id, conversationId: conv.id })
  expect(r.outcome).toBe('applied')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app.tierId).not.toBeNull(); expect(app.levelId).not.toBeNull()
  expect(await prisma.answer.count({ where: { applicationId: app.id } })).toBe(0)
})
it('invalid level for tier → rejected(invalid_level_for_tier); re-invocation with a DRAFT quote → re_rating + quote expired', async () => {
  const { c, conv } = await openApp()
  const bad = await executeCommit({ tool: 'select_coverage', args: { tier: 'standard', level: 'no_such' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(bad).toMatchObject({ outcome: 'rejected', reason: 'invalid_level_for_tier' })
  await executeCommit({ tool: 'select_coverage', args: { tier: 'standard', level: 'level_1' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  await prisma.quote.create({ data: { applicationId: app.id, productId: app.productId, customerId: c.id, premiumAnnual: 100, premiumMonthly: 9, coverages: {}, status: 'DRAFT', validUntil: new Date(Date.now() + 86400e3) } })
  const r2 = await executeCommit({ tool: 'select_coverage', args: { level: 'level_2' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r2.effects).toContain('re_rating')
  expect((await prisma.quote.findFirstOrThrow({ where: { applicationId: app.id } })).status).toBe('EXPIRED')
})
it('addon toggle carries cascade_expand / questions_removed (#4); legacy mutators are gone', async () => {
  const { c, conv } = await openApp()
  const on = await executeCommit({ tool: 'select_coverage', args: { tier: 'standard', level: 'level_1', addon: true }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(on.effects).toContain('cascade_expand')
  const off = await executeCommit({ tool: 'select_coverage', args: { addon: false }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(off.effects).toContain('questions_removed')
  for (const t of ['change_selection', 'switch_product', 'set_answer']) expect(getToolDefinition(t)).toBeUndefined()
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/select-coverage.test.ts` → FAIL
- [ ] Step 3: Implement selectCoverage: load app via conversation.activeApplicationId (status OPEN required); resolve tier by code within app.productId; level within effective tier (rejected 'invalid_level_for_tier'); compute changed facets; write Application columns only; effects: changed && DRAFT quote exists → expire it + 're_rating'; addon true→false 'questions_removed', false→true 'cascade_expand' (bd_medical answers retained but excluded — group inclusion keyed on includesAddon in appGroupCodes); emit the selection mutation event to the C1 planner (`publishMutation({ kind: 'selection', facets })`). Delete the three legacy handler files + registry blocks + DEFAULT_DISCOVERY_TOOLS entries ('set_answer','change_selection','switch_product') + seed grants; remap action-adapter select_tier/select_level/bd_continue → select_coverage; delete the obsolete mocked-prisma navigation test (__tests__/integration/navigation.test.ts) — superseded by these real-DB tests per T12.D3.
- [ ] Step 4: `npx vitest run __tests__/integration/select-coverage.test.ts` → PASS; `npx tsc --noEmit` clean
- [ ] Step 5: `git add -A && git commit -m "feat(application): select_coverage sole selection writer; retire set_answer/change_selection/switch_product"`

### Task B4.5: cancel_application (requires_confirmation → terminal) + REFERRED entry
**Files:**
- Modify: lib/tools/handlers/application-handlers.ts (cancelApplication: real CANCELLED via canTransition; gateway confirm-token flow)
- Test: __tests__/integration/cancel-application.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
beforeEach(async () => { await resetDb() })
it('first call returns requires_confirmation with a token; confirmed call cancels terminally (never COMPLETED)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const r1 = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed_mind' }, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r1.outcome).toBe('requires_confirmation')
  expect(r1.confirmToken).toBeDefined()
  const r2 = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed_mind' }, actor: 'agent', customerId: c.id, conversationId: conv.id, confirmToken: r1.confirmToken })
  expect(r2.outcome).toBe('applied')
  expect(r2.effects).toContain('terminal')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app.status).toBe('CANCELLED') // T5.D6: cancel is distinguishable from completion
})
it('cancelling a COMPLETED application is rejected (no legal transition)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const app = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'COMPLETED' } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id, activeApplicationId: app.id } })
  const r = await executeCommit({ tool: 'cancel_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'illegal_status_transition' })
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/cancel-application.test.ts` → FAIL (cancel still writes COMPLETED, application-handlers.ts:511-514)
- [ ] Step 3: Rework cancelApplication as a requires_confirmation gateway commit (token handling lives in the A2 gateway per #8 step 4; the handler declares `requiresConfirmation: true` in its registration): domain body checks `canTransition(app.status, 'CANCELLED')` → rejected('illegal_status_transition'); applies status CANCELLED + completedAt null + metadata reason; returns effects ['terminal'].
- [ ] Step 4: `npx vitest run __tests__/integration/cancel-application.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(application): cancel_application — confirmed, terminal, real CANCELLED status"`

### Task B4.6: resume_application (cross-conversation) + get_last_application_info (prefill-as-proposals)
**Files:**
- Modify: lib/tools/handlers/application-handlers.ts (resumeApplication rework; getLastApplicationInfo new)
- Modify: lib/engines/questionnaire-engine.ts (getNextQuestion accepts optional proposals: Map<questionCode, string> → suggestedAnswer in the payload)
- Test: __tests__/integration/resume-and-prefill.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { getLastApplicationInfo } from '@/lib/tools/handlers/application-handlers'
beforeEach(async () => { await resetDb() })
it('resume binds an OPEN application from a NEW conversation and returns the current position (T5.D4)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv1 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv1.id })
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id } }) // days later, new channel
  const r = await executeCommit({ tool: 'resume_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id })
  expect(r.outcome).toBe('applied')
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv2.id } })).activeApplicationId).not.toBeNull()
  expect((r.data as { position: { status: string } }).position.status).toBe('OPEN')
})
it('get_last_application_info is a pure read over the latest COMPLETED app; proposals require per-question confirmation (T5.D5 — never silent copy)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const prior = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'COMPLETED', completedAt: new Date() } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'HEALTH_DECLARATION_CONFIRM' } })
  await prisma.answer.create({ data: { questionId: q.id, applicationId: prior.id, value: 'confirm' } })
  const ctx = { customerId: c.id, conversationId: 'conv-x', language: 'ro' as const } as never
  const info = await getLastApplicationInfo({}, ctx)
  expect(info.data!.proposals).toContainEqual(expect.objectContaining({ questionCode: 'HEALTH_DECLARATION_CONFIRM', suggestedAnswer: 'confirm' }))
  // a NEW application starts with zero answers — the proposal is not an answer
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id })
  const fresh = await prisma.application.findFirstOrThrow({ where: { customerId: c.id, status: 'OPEN' } })
  expect(await prisma.answer.count({ where: { applicationId: fresh.id } })).toBe(0)
})
```
- [ ] Step 2: `npx vitest run __tests__/integration/resume-and-prefill.test.ts` → FAIL (resume is PAUSED-only same-conversation today, application-handlers.ts:432-449)
- [ ] Step 3: Rework resumeApplication: args { applicationId? } defaulting to the customer's single OPEN/PAUSED app (REFERRED → rejected('with_underwriter')); PAUSED → OPEN via canTransition; bind conversation.activeApplicationId; data = { position: { applicationId, status, progress, nextQuestion, selection } } using the application answer scope. Implement getLastApplicationInfo (pure read, no writes): latest COMPLETED app for customer(+product in focus), proposals = its answers as [{ questionCode, suggestedAnswer, answeredAt }]; getNextQuestion threads suggestedAnswer through when the caller passes the proposals map (set_application's data invites the agent to fetch proposals; each confirmation is a real save_application_answer commit timestamped now).
- [ ] Step 4: `npx vitest run __tests__/integration/resume-and-prefill.test.ts` → PASS
- [ ] Step 5: `git add -A && git commit -m "feat(application): cross-conversation resume + prefill-as-proposals (per-question attestation)"`

### Task B4.7: Package verification
**Files:**
- Create: scripts/verify-application-flow.ts (live sim: candidate → set_application (no DNT) → questionnaire blocked with requires_consent → DNT via B2 surface → answers → select_coverage → re-select (re_rating) → cancel-with-confirmation → re-apply with proposals)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the script with PASS/FAIL legs (the live-sim discipline that caught the advance-flow stall — unit-green is not enough)
- [ ] Step 2: `npx prisma migrate dev && npx prisma db seed` → clean; `npx tsc --noEmit` clean
- [ ] Step 3: `npx vitest run` → full suite green (instrumentation flake rule); grep `"set_answer\|change_selection\|switch_product\|start_application"` across lib/ prisma/seeds/ returns nothing live
- [ ] Step 4: `npx tsx scripts/verify-application-flow.ts` → all PASS
- [ ] Step 5: `git add -A && git commit -m "chore(application): B4 verification — lifecycle live end-to-end"`

### ⚠ Binding errata for B4 (fidelity verifier — apply OVER the task text above)

1. **[B1.2/step 3 (consent-rules.ts) vs B2.5, B4.3-B4.6 tests]** BLOCKING DESIGN ERROR: consentBlocksCommit blocks every writing commit whenever gdprProcessing is false, and deriveConsents maps 'no events at all' to false. Every fresh customer (zero ConsentEvent rows) is therefore in the halted state, and the B1.2 note's justification ('the first writing commit a fresh customer reaches is sign_dnt') is factually wrong: set_candidate_product, set_application, open_dnt_session and write_dnt_answer are all writing commits that precede sign_dnt. This directly contradicts the draft's own later tests — B2.5 (open_dnt_session applied with no consent events), B4.3 (set_application applied with no consent), B4.4-B4.6 — all of which would be rejected('gdpr_processing_withdrawn') once B1.3 wires the predicate into the gateway legality step. It also contradicts #2/T13.D6 ('talk is free'; consent captured AT signing) and T3.D5 (pre-DNT funnel runs without consent).
   **Fix:** Make the halt fire only on an explicit withdrawal, not on absence: either derive a tri-state (granted|withdrawn|none) for gdpr_processing in DerivedConsents, or add gdprWithdrawn: boolean (latest gdpr_processing event exists AND action==='withdrawn') and have consentBlocksCommit block only when gdprWithdrawn. Update the B1.2 test fixtures accordingly (the withdrawn fixture already has explicit events, so its assertions survive).
2. **[B4.1/step 3 (Answer re-key migration) vs B4.4 ordering]** SEQUENCING/COMPILE BREAK: dropping Answer.conversationId and the questionId_conversationId unique in B4.1 breaks compile for every remaining conversation-scoped Answer reader that B4 only deletes/re-points later or never: set-answer-handlers.ts:45, change-selection-handlers.ts:100, product-switch-handler.ts (all deleted only in B4.4); quote-handlers.ts:145-152 (PAYMENT_FREQUENCY findUnique on the removed composite key), :491 (modify_quote deleteMany by conversationId), :500 (getNextQuestion with the old conversation signature); preview-handlers.ts:54; bd-handlers.ts:35 (only if C1 has not already deleted it); lib/chat/context-loaders.ts:507; lib/chat/derive-state.ts:163,201 (if any of it survives A1). The AnswerScope 'conversation' variant itself becomes uncompilable but is never explicitly removed. B4.1 step 4 requires tsc clean — unachievable as ordered.
   **Fix:** Reorder: do the B4.4 handler/tool retirements (set_answer/change_selection/switch_product + their action-adapter and seed references) BEFORE or inside B4.1, and extend B4.1's sweep list to quote-handlers.ts (145/491/500), preview-handlers.ts, bd-handlers.ts, context-loaders.ts; explicitly delete the { kind: 'conversation' } AnswerScope variant in the same task.
3. **[B1/B2/B4 retirement sweeps (B1.1, B2.4-B2.6, B4.3-B4.4) — existing test suite]** OMISSION: the packages rewrite or delete behavior pinned by existing mocked-prisma unit tests — __tests__/lib/tools/handlers/dnt-signing.test.ts (conversation stamps), set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-handlers/advance/promotion tests (DNT pre-gate, tier/level args, cancel→COMPLETED), preview-handlers.test.ts, __tests__/lib/compliance/consent-check.test.ts, __tests__/lib/chat/default-tools.test.ts, debug/conversation-export tests (dntSignedAt), plus skill-pack-orchestrator.test.ts — yet only __tests__/integration/navigation.test.ts is ever named for deletion (B4.4). Every package ends with 'npx vitest run → full suite green', which is unreachable without migrating/deleting these files; per T12.D3 most should be deleted in favor of the new real-DB tests, not mocked anew.
   **Fix:** Add to each package's retirement task an explicit Delete/Rewrite list for the legacy tests covering the behavior it changes (B1.1: consent-check.test.ts portions, default-tools.test.ts; B2.4-2.6: dnt-signing.test.ts, conversation-export dnt assertions; B4.3-4.4: set-answer.test.ts, change-selection-handlers.test.ts, product-switch.test.ts, application-*.test.ts), with the T12.D3 rationale (mocked-prisma choreography superseded by real-DB tests).
4. **[B1 migrations bullet 4 + B1.6/B2.7/B4.7 grep checks]** FACTUAL ERRORS IN SWEEP TARGETS: (a) record_gdpr_consent/acknowledge_ai_disclosure are NOT granted in prisma/seeds/seed-skill-packs.ts (verified zero occurrences) — they are only in DEFAULT_DISCOVERY_TOOLS; (b) the registry consent blocks are at registry.ts:1091-1125, not 1042-1117 (stale agenda line numbers); (c) prisma/seeds/seed-workflows.ts DOES grant retired tools (update_customer_profile:59; check_dnt_status/start_dnt_questionnaire/save_dnt_answer/sign_dnt/start_application:130-312) and is never named by any B-package sweep; (d) scripts/ (diag-orchestrator.ts, dump-conversation.ts, inspect-app.ts read gdprConsentAt/extractedProfile; verify-advance-flow.ts reads dntSignedAt) and __tests__/ are excluded from the B2.7/B1.6 grep paths, so the verification greps cannot catch all stale readers; (e) M12 deletes the entire skill-pack subsystem (and M9's dead-config cleanup covers Workflow* seeds) in late Block A — if that lands before B1/B2/B4, the instructed seed-skill-packs.ts edits target a deleted file.
   **Fix:** Correct the bullets: name DEFAULT_DISCOVERY_TOOLS + seed-workflows.ts (not seed-skill-packs.ts) as the grant sites, fix the registry line range, extend every package's verification grep to `lib/ app/ prisma/ scripts/ __tests__/`, and add a depends_on/coordination note that the seed-skill-packs/seed-workflows edits apply only if Block A's M12/M9 cleanup has not already deleted those files.
5. **[B4.2/step 3, B1.4/step 3, B2.2/step 3 (code-block quality)]** CODE SMELLS IN 'REAL CODE' BLOCKS (NO PLACEHOLDERS rule, milder cases): (a) B4.2's `const blocked: typeof i extends never ? never : {...}[]` is a nonsense conditional type that always resolves to its right branch; (b) B1.4's ctx type `tx: never` is unconstructible pseudo-typing the gateway must cast around; (c) B2.2's decideSessionType triple-ternary is exactly equivalent to `latest ? 'UPDATE' : 'NEW'` and obscures the rule its own note states plainly; (d) applicationExposure declares an openDntSession input it never reads.
   **Fix:** (a) type blocked as { action: string; reason: string; params?: Record<string,unknown> }[]; (b) type tx as the A2 transaction-client type (Prisma.TransactionClient) once A2 pins it; (c) write `return latest ? 'UPDATE' : 'NEW'` with the comment; (d) drop openDntSession from AppExposureInput or use it (e.g. to block save_application_answer while a DNT session is open, if that is the intended rule).
6. **[B4.6 (resume_application as commit) — T5.D4/T13 Table 1 #18]** MINOR FIDELITY DEVIATION, UNDOCUMENTED: T5.D4 and T13 describe resume_application as 'a read returning current position'; the draft implements it as a gateway commit that flips PAUSED→OPEN and writes Conversation.activeApplicationId. The choice is defensible (T5.D4's own channel pointer needs a writer; T5.D6 allows PAUSED→OPEN), but the deviation is nowhere recorded, inviting an executor to 'fix' it back to a read.
   **Fix:** Add one sentence to B4.6 step 3: 'Deliberate deviation from the catalog R-classification: binding the conversation pointer and unpausing are state changes, so resume_application is a commit whose data payload carries the position read; the pure-read half of T5.D4 lives in the returned position object.'

### ➕ Addendum tasks for B4 (binding — coverage-critic gaps)

### Task B4.ADD-1: set_candidate_product reshape (closes G4, T13 Table 1 #6)
**Files:**
- Modify: `lib/tools/handlers/candidate-handlers.ts` + registry schema (drop `confidence`; add `addon_ids: string[]`)
- Migration: drop `Conversation.candidateConfidence`; add `Conversation.candidateAddonIds String[] @default([])`
- Test: `__tests__/lib/tools/candidate-reshape.test.ts`
**Steps:**
- [ ] Step 1: Failing test: tool schema accepts `{product_id, addon_ids}` and rejects `confidence` (strict zod); handler persists candidateAddonIds.
- [ ] Step 2: FAIL → Step 3: implement + destructive migration + reseed. Step 4: PASS + full suite. Step 5: commit.

---

# BLOCK C — Decision engines

## Block overview

Block C delivers the three decision engines: (C1) the typed dependency graph + pure consequence planner + transactional applier that make every answer/selection mutation produce a deterministic, auditable consequence plan (T6, contradiction #4); (C2) the canonical eligibility module — one typed rule source, one pure evaluateEligibility, three consumption points (#9, resolves M11); (C3) the suitability/demands-and-needs engine as eligibility's sibling (M7).

Design calls made where the briefing left room:
- Edges are stored in NODE-KEY form per the contradiction #4 log (which wins over the topic prose): `selection:level` VALIDITY-depends-on `selection:tier` (not PREMIUM_LEVEL→PACKAGE_CHOICE answer rows — selection leaves the questionnaire under B4); each `bd_*` question VISIBILITY-depends-on `selection:addon`; `selection:addon` ELIGIBILITY-depends-on each `answer:bd_*`. The single existing seed edge (DNT_SUSTAINABILITY_PREFERENCE) migrates into the graph and `parentQuestionId`/`showWhenValue` are retired in a final C1 task after all consumers are rewired (no window with two dependency stores, per T6.D1).
- `computeConsequences(graph, snapshot, mutation)` keeps the exact pinned 3-arg signature: eligibility rules ride inside the DomainSnapshot (`snapshot.product.eligibilityRules`), and the planner imports C2's `evaluateEligibility` directly — hence C1 depends_on C2.
- Answer history is append-only revisions (T6.D2 ✅ option; the briefing's "invalidatedAt marking" is realized as the INVALIDATED revision status with `causedByKey` + `invalidatedReason` — strictly more information than a timestamp). The ACTIVE-row uniqueness is a raw-SQL partial unique index (Prisma cannot express it), verified by a real-DB test.
- All prisma.answer writes are funneled through one module (lib/engines/answer-store.ts) and a writer-closure meta-test greps the repo to keep it that way (T6 risk #1). The GDPR erasure route (app/api/gdpr/delete-data/route.ts) is the only allowlisted exception (owned by M3).
- DNT answers route through the store mechanically (history preserved) but NOT through the planner — DNT consequence semantics are flat per the spec; the one DNT visibility edge is served by the same computeVisibleSet.
- C3's report-timing flip (post-payment → quote issuance) is a coupled flip per M9: C3 delivers `generateSuitabilityReport(quoteId)` + tests; D1 wires the issuance call AND removes the lib/payments/post-payment.ts:73 call in one package. The agent invariant "fit claims engine-gated" is prompt content — it lands in Block A's A4 sections package (noted, not built here).
- depends_on uses pinned cross-block ids: A1 (Phase/DerivedStateV3/deriveAndExpose + ReasonCode registry), A2 (commit gateway + CommitLedger), B0 (CustomerProfile SSOT), B1 (customer-scoped Dnt/DntSession package — id assumed, adjust at assembly), B4 (select_coverage), D1 (generate_quote gate host), D2 (Document registry). Where a host package has not landed, C packages export the contract and the host wires it (stated per task).

File paths verified against the worktree: lib/engines/questionnaire-engine.ts, lib/engines/quote-engine.ts, lib/chat/derive-state.ts (154-173 unfiltered progress), lib/tools/handlers/{application,set-answer,change-selection,quote,bd,dnt}-handlers.ts, lib/compliance/dnt-report.ts, lib/payments/post-payment.ts:73, prisma/seeds/seed-questions.ts, prisma/seeds/seed-product.ts:146-152 (eligibility JSON) and :869-877/:977 (addon age bands 18-64). All lib/engines/dependency-graph.ts, consequence-planner.ts, consequence-applier.ts, answer-store.ts, eligibility.ts, suitability.ts, lib/compliance/suitability-report.ts are NEW.

## Package C1: Dependency graph + consequence planner/applier

**Execution slot:** 12 | **Depends on:** A2, B2, B4

**Goal:** One typed dependency graph spanning answers and selection (contradiction #4), a pure consequence planner whose output IS the requires_confirmation preview (T6.D6), a transactional applier executing through the A2 gateway, append-only answer revisions (T6.D2), typed sensitivity (T6.D3), and structured branching provenance (T6.D4). Ends with exactly one Answer write path and the legacy parentQuestionId/showWhenValue mechanism retired.

**Migrations / seeds:**
- NEW model QuestionDependency { id, productId String?, subjectKey String ('answer:<code>'|'selection:<facet>'), dependsOnKey String, kind DependencyKind, predicate Json, createdAt } with @@unique([subjectKey, dependsOnKey, kind]) and @@index([dependsOnKey]); NEW enum DependencyKind { VISIBILITY, VALIDITY, ELIGIBILITY }
- Question: add column sensitivity QuestionSensitivity @default(NONE); NEW enum QuestionSensitivity { NONE, CONFIRM_ON_MODIFY, CONFIRM_ALWAYS }
- Answer: add columns source AnswerSource @default(USER_ANSWER), status AnswerRevisionStatus @default(ACTIVE), invalidatedReason String?, causedByKey String?, commitId String?; NEW enums AnswerSource { USER_ANSWER, PREFILL, SELECTION_MIRROR, SYSTEM }, AnswerRevisionStatus { ACTIVE, SUPERSEDED, INVALIDATED }; DROP @@unique([questionId, conversationId]); raw SQL in same migration: CREATE UNIQUE INDEX answer_active_unique ON "Answer"("questionId", "conversationId") WHERE status = 'ACTIVE'
- Final C1 migration: DROP Question.parentQuestionId, Question.showWhenValue and the questionBranching self-relation (destructive — demo data, reseed)
- NEW seed prisma/seeds/seed-dependency-edges.ts (wired into prisma/seeds/index.ts after seedQuestions): selection:level VALIDITY→selection:tier; answer:BD_CANCER_HISTORY..answer:BD_HOSPITALIZATION_RECENT (6) VISIBILITY→selection:addon predicate is_true; selection:addon ELIGIBILITY→each answer:bd_* (6 edges) predicate is_false; answer:DNT_SUSTAINABILITY_PREFERENCE VISIBILITY→answer:DNT_SUSTAINABILITY_IMPORTANCE predicate in[somewhat,quite_important,very_important]
- seed-questions.ts: set sensitivity CONFIRM_ON_MODIFY for HEALTH_DECLARATION_CONFIRM and all 6 BD_* questions; CONFIRM_ALWAYS for DNT_CNP; remove parentQuestionCode/showWhenValue usage (the sustainability link moves to the edge seed); bd_medical group stays seeded but its questions are now visibility-gated by the graph

### Task C1.1: Pure dependency-graph module (node keys, predicates, canonical visible set)
**Files:**
- Create: lib/engines/dependency-graph.ts
- Test: __tests__/lib/engines/dependency-graph.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import {
  evaluatePredicate, nodeValue, computeVisibleSet,
  type DependencyEdge, type GraphFacts,
} from '@/lib/engines/dependency-graph'

const facts = (over: Partial<GraphFacts> = {}): GraphFacts => ({
  answers: {},
  selection: { tier: null, level: null, addon: null },
  ...over,
})

describe('nodeValue', () => {
  it('reads answer nodes from active answers and selection nodes from selection', () => {
    const f = facts({ answers: { BD_CANCER_HISTORY: 'true' }, selection: { tier: 'standard', level: null, addon: true } })
    expect(nodeValue('answer:BD_CANCER_HISTORY', f)).toBe('true')
    expect(nodeValue('selection:tier', f)).toBe('standard')
    expect(nodeValue('selection:addon', f)).toBe('true') // boolean normalized to string
    expect(nodeValue('selection:level', f)).toBeNull()
  })
})

describe('evaluatePredicate', () => {
  it('handles equals / in / is_true / is_false / any_answered', () => {
    expect(evaluatePredicate({ op: 'equals', value: 'optim' }, 'optim')).toBe(true)
    expect(evaluatePredicate({ op: 'in', value: ['somewhat', 'very_important'] }, 'somewhat')).toBe(true)
    expect(evaluatePredicate({ op: 'is_true' }, 'da')).toBe(true)  // boolean normalization
    expect(evaluatePredicate({ op: 'is_false' }, 'nu')).toBe(true)
    expect(evaluatePredicate({ op: 'any_answered' }, 'anything')).toBe(true)
    expect(evaluatePredicate({ op: 'any_answered' }, null)).toBe(false)
  })
})

describe('computeVisibleSet', () => {
  const graph: DependencyEdge[] = [
    { subjectKey: 'answer:BD_CANCER_HISTORY', dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } },
    { subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE', dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] } },
  ]
  const codes = ['BD_CANCER_HISTORY', 'DNT_SUSTAINABILITY_IMPORTANCE', 'DNT_SUSTAINABILITY_PREFERENCE', 'HEALTH_DECLARATION_CONFIRM']
  it('hides questions whose VISIBILITY gate is unmet or gate node unanswered', () => {
    const visible = computeVisibleSet(graph, codes, facts())
    expect(visible.has('HEALTH_DECLARATION_CONFIRM')).toBe(true) // no edges → visible
    expect(visible.has('BD_CANCER_HISTORY')).toBe(false)         // addon null
    expect(visible.has('DNT_SUSTAINABILITY_PREFERENCE')).toBe(false)
  })
  it('shows gated questions when the gate matches', () => {
    const f = facts({ answers: { DNT_SUSTAINABILITY_IMPORTANCE: 'somewhat' }, selection: { tier: null, level: null, addon: true } })
    const visible = computeVisibleSet(graph, codes, f)
    expect(visible.has('BD_CANCER_HISTORY')).toBe(true)
    expect(visible.has('DNT_SUSTAINABILITY_PREFERENCE')).toBe(true)
  })
  it('requires ALL visibility edges of a multi-parent question to match (AND semantics)', () => {
    const multi: DependencyEdge[] = [
      ...graph,
      { subjectKey: 'answer:BD_CANCER_HISTORY', dependsOnKey: 'answer:HEALTH_DECLARATION_CONFIRM', kind: 'VISIBILITY', predicate: { op: 'is_true' } },
    ]
    const f = facts({ selection: { tier: null, level: null, addon: true } })
    expect(computeVisibleSet(multi, codes, f).has('BD_CANCER_HISTORY')).toBe(false)
    f.answers.HEALTH_DECLARATION_CONFIRM = 'true'
    expect(computeVisibleSet(multi, codes, f).has('BD_CANCER_HISTORY')).toBe(true)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/dependency-graph.test.ts` — expect FAIL (module does not exist).
- [ ] Step 3: Minimal implementation in lib/engines/dependency-graph.ts (pure, no prisma import):
```ts
export type SelectionFacet = 'tier' | 'level' | 'addon'
export type NodeKey = `answer:${string}` | `selection:${SelectionFacet}`
export type DependencyKind = 'VISIBILITY' | 'VALIDITY' | 'ELIGIBILITY'
export type EdgePredicate =
  | { op: 'equals'; value: string }
  | { op: 'not_equals'; value: string }
  | { op: 'in'; value: string[] }
  | { op: 'is_true' }
  | { op: 'is_false' }
  | { op: 'any_answered' }
export interface DependencyEdge {
  subjectKey: NodeKey
  dependsOnKey: NodeKey
  kind: DependencyKind
  predicate: EdgePredicate
}
export interface GraphFacts {
  answers: Record<string, string>
  selection: { tier: string | null; level: string | null; addon: boolean | null }
}

function normalizeBoolean(value: string): string | null {
  const lower = value.toLowerCase().trim()
  if (['true', 'yes', 'da', '1'].includes(lower)) return 'true'
  if (['false', 'no', 'nu', '0'].includes(lower)) return 'false'
  return null
}

export function nodeValue(key: NodeKey, facts: GraphFacts): string | null {
  if (key.startsWith('answer:')) {
    return facts.answers[key.slice('answer:'.length)] ?? null
  }
  const facet = key.slice('selection:'.length) as SelectionFacet
  const v = facts.selection[facet]
  if (v === null || v === undefined) return null
  return typeof v === 'boolean' ? String(v) : v
}

export function evaluatePredicate(predicate: EdgePredicate, value: string | null): boolean {
  if (value === null) return false
  switch (predicate.op) {
    case 'equals': return value === predicate.value
    case 'not_equals': return value !== predicate.value
    case 'in': return predicate.value.includes(value)
    case 'is_true': return normalizeBoolean(value) === 'true'
    case 'is_false': return normalizeBoolean(value) === 'false'
    case 'any_answered': return true
  }
}

export function edgeSatisfied(edge: DependencyEdge, facts: GraphFacts): boolean {
  return evaluatePredicate(edge.predicate, nodeValue(edge.dependsOnKey, facts))
}

/** Canonical visible set: a question is visible iff EVERY VISIBILITY edge with it as subject is satisfied. */
export function computeVisibleSet(
  graph: DependencyEdge[],
  questionCodes: string[],
  facts: GraphFacts,
): Set<string> {
  const visible = new Set<string>()
  for (const code of questionCodes) {
    const edges = graph.filter(e => e.kind === 'VISIBILITY' && e.subjectKey === `answer:${code}`)
    if (edges.every(e => edgeSatisfied(e, facts))) visible.add(code)
  }
  return visible
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/dependency-graph.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): pure dependency-graph module with typed node keys and canonical visible set"`

### Task C1.2: QuestionDependency + sensitivity schema and protect edge seed
**Files:**
- Modify: prisma/schema.prisma (QuestionDependency model, DependencyKind + QuestionSensitivity enums, Question.sensitivity column — additive only; parentQuestionId/showWhenValue stay until C1.8)
- Create: prisma/seeds/seed-dependency-edges.ts
- Modify: prisma/seeds/index.ts (call seedDependencyEdges after seedQuestions), prisma/seeds/seed-questions.ts (sensitivity values)
- Test: __tests__/lib/engines/protect-edges.test.ts (pure, over the exported edge data)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test against the exported seed data (pure — per T12.D3 no mocked prisma):
```ts
import { describe, it, expect } from 'vitest'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import { computeVisibleSet, type GraphFacts } from '@/lib/engines/dependency-graph'

const BD_CODES = ['BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT']

describe('protect dependency edges (contradiction #4 canonical set)', () => {
  it('declares selection:level VALIDITY-depends-on selection:tier', () => {
    expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
      expect.objectContaining({ subjectKey: 'selection:level', dependsOnKey: 'selection:tier', kind: 'VALIDITY' }),
    )
  })
  it('gates every bd_* question VISIBILITY on selection:addon is_true', () => {
    for (const code of BD_CODES) {
      expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
        expect.objectContaining({ subjectKey: `answer:${code}`, dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } }),
      )
    }
  })
  it('declares selection:addon ELIGIBILITY-depends-on every answer:bd_* with is_false', () => {
    for (const code of BD_CODES) {
      expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
        expect.objectContaining({ subjectKey: 'selection:addon', dependsOnKey: `answer:${code}`, kind: 'ELIGIBILITY', predicate: { op: 'is_false' } }),
      )
    }
  })
  it('carries the migrated DNT sustainability visibility edge', () => {
    expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
      expect.objectContaining({
        subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE',
        dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE',
        kind: 'VISIBILITY',
        predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] },
      }),
    )
  })
  it('bd questions are invisible until addon selected (end-to-end over the real edge data)', () => {
    const facts: GraphFacts = { answers: {}, selection: { tier: 'standard', level: 'level_1', addon: null } }
    const hidden = computeVisibleSet(PROTECT_DEPENDENCY_EDGES, BD_CODES, facts)
    expect(hidden.size).toBe(0)
    facts.selection.addon = true
    expect(computeVisibleSet(PROTECT_DEPENDENCY_EDGES, BD_CODES, facts).size).toBe(6)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/protect-edges.test.ts` — expect FAIL (seed module missing).
- [ ] Step 3: Implement. (a) prisma/schema.prisma additions:
```prisma
enum DependencyKind {
  VISIBILITY
  VALIDITY
  ELIGIBILITY
}

enum QuestionSensitivity {
  NONE
  CONFIRM_ON_MODIFY
  CONFIRM_ALWAYS
}

model QuestionDependency {
  id           String         @id @default(cuid())
  productId    String?
  subjectKey   String
  dependsOnKey String
  kind         DependencyKind
  predicate    Json
  createdAt    DateTime       @default(now())

  @@unique([subjectKey, dependsOnKey, kind])
  @@index([dependsOnKey])
}
```
plus `sensitivity QuestionSensitivity @default(NONE)` on model Question. (b) prisma/seeds/seed-dependency-edges.ts exports the typed array and an upsert seeder:
```ts
import { PrismaClient } from '../../lib/generated/prisma/client'
import type { DependencyEdge } from '../../lib/engines/dependency-graph'

const BD_CODES = ['BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT'] as const

export const PROTECT_DEPENDENCY_EDGES: DependencyEdge[] = [
  { subjectKey: 'selection:level', dependsOnKey: 'selection:tier', kind: 'VALIDITY', predicate: { op: 'any_answered' } },
  ...BD_CODES.map(c => ({ subjectKey: `answer:${c}`, dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } }) as DependencyEdge),
  ...BD_CODES.map(c => ({ subjectKey: 'selection:addon', dependsOnKey: `answer:${c}`, kind: 'ELIGIBILITY', predicate: { op: 'is_false' } }) as DependencyEdge),
  { subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE', dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] } },
]

export async function seedDependencyEdges(prisma: PrismaClient) {
  const product = await prisma.product.findUnique({ where: { code: 'protect' } })
  if (!product) throw new Error('Product "protect" must be seeded before dependency edges')
  for (const e of PROTECT_DEPENDENCY_EDGES) {
    await prisma.questionDependency.upsert({
      where: { subjectKey_dependsOnKey_kind: { subjectKey: e.subjectKey, dependsOnKey: e.dependsOnKey, kind: e.kind } },
      update: { predicate: e.predicate as object, productId: product.id },
      create: { subjectKey: e.subjectKey, dependsOnKey: e.dependsOnKey, kind: e.kind, predicate: e.predicate as object, productId: product.id },
    })
  }
  console.log(`  Seeded ${PROTECT_DEPENDENCY_EDGES.length} dependency edges`)
}
```
(c) seed-questions.ts: add `sensitivity: 'CONFIRM_ON_MODIFY'` to HEALTH_DECLARATION_CONFIRM and the 6 BD_* definitions, `sensitivity: 'CONFIRM_ALWAYS'` to DNT_CNP (extend the seedGroup question type + create/update payloads). (d) index.ts wires `seedDependencyEdges` after `seedQuestions`.
- [ ] Step 4: Run `npx prisma migrate dev --name add_question_dependency_and_sensitivity && npx prisma generate && npx tsx prisma/seeds/index.ts` then `npx vitest run __tests__/lib/engines/protect-edges.test.ts` — expect PASS, seed log shows 14 edges.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(schema): QuestionDependency graph + Question.sensitivity, seed protect canonical edges"`

### Task C1.3: Pure consequence planner computeConsequences
**Files:**
- Create: lib/engines/consequence-planner.ts
- Test: __tests__/lib/engines/consequence-planner.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test from snapshot literals (T12.D3: no mocked prisma). Uses the real protect edges and a minimal DomainSnapshot literal (import the type from the A1 artifact; if A1 exposes a snapshot factory use it, otherwise build a literal):
```ts
import { describe, it, expect } from 'vitest'
import { computeConsequences, type Mutation } from '@/lib/engines/consequence-planner'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import type { DomainSnapshot } from '@/lib/engines/derive-and-expose' // A1 artifact

const PROTECT_RULES = { version: 1, rules: [
  { id: 'addon_no_medical_history', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
] } // C2 EligibilityRuleSet shape — full set comes from snapshot in production

function snapshot(over: Partial<DomainSnapshot> = {}): DomainSnapshot {
  return {
    // minimal protect snapshot literal — extend per A1's DomainSnapshot shape
    application: { exists: true, status: 'OPEN', quoteIssued: false },
    selection: { tier: 'standard', level: 'level_1', addon: true },
    answers: { active: {}, sensitivity: { HEALTH_DECLARATION_CONFIRM: 'CONFIRM_ON_MODIFY', BD_CANCER_HISTORY: 'CONFIRM_ON_MODIFY' } },
    questionCodes: ['HEALTH_DECLARATION_CONFIRM','BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT'],
    product: { eligibilityRules: PROTECT_RULES },
    ...over,
  } as DomainSnapshot
}

describe('computeConsequences', () => {
  it('tier change → cascade_invalidate of selection:level + re_rating', () => {
    const m: Mutation = { node: 'selection:tier', newValue: 'optim' }
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snapshot(), m)
    expect(plan.invalidations).toContainEqual(expect.objectContaining({ node: 'selection:level', cause: 'selection:tier', kind: 'VALIDITY' }))
    expect(plan.effects).toContain('cascade_invalidate')
    expect(plan.effects).toContain('re_rating')
  })
  it('addon=false → questions_removed for visible bd_* questions, their active answers invalidated with causality', () => {
    const s = snapshot({ answers: { active: { BD_CANCER_HISTORY: 'false' }, sensitivity: {} } } as Partial<DomainSnapshot>)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:addon', newValue: 'false' })
    expect(plan.questionsRemoved).toEqual(expect.arrayContaining(['BD_CANCER_HISTORY']))
    expect(plan.invalidations).toContainEqual(expect.objectContaining({ node: 'answer:BD_CANCER_HISTORY', cause: 'selection:addon' }))
    expect(plan.effects).toContain('questions_removed')
  })
  it('addon=true → cascade_expand listing the 6 bd_* questions', () => {
    const s = snapshot({ selection: { tier: 'standard', level: 'level_1', addon: false } } as Partial<DomainSnapshot>)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:addon', newValue: 'true' })
    expect(plan.questionsAdded).toHaveLength(6)
    expect(plan.effects).toContain('cascade_expand')
  })
  it('first bd yes → eligibility_recheck: addon ineligible, deterministic selection patch, remaining bd questions removed', () => {
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snapshot(), { node: 'answer:BD_CANCER_HISTORY', newValue: 'true' })
    expect(plan.eligibilityOutcomes).toContainEqual(expect.objectContaining({ subject: 'addon', verdict: 'ineligible' }))
    expect(plan.selectionPatch).toEqual(expect.objectContaining({ addon: false }))
    expect(plan.questionsRemoved).toEqual(expect.arrayContaining(['BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT']))
    expect(plan.effects).toEqual(expect.arrayContaining(['eligibility_recheck', 'questions_removed']))
  })
  it('modifying a CONFIRM_ON_MODIFY answer that already has a value → requiresConfirmation', () => {
    const s = snapshot({ answers: { active: { HEALTH_DECLARATION_CONFIRM: 'true' }, sensitivity: { HEALTH_DECLARATION_CONFIRM: 'CONFIRM_ON_MODIFY' } } } as Partial<DomainSnapshot>)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'answer:HEALTH_DECLARATION_CONFIRM', newValue: 'false' })
    expect(plan.requiresConfirmation).toBe(true)
  })
  it('invalidation on a COMPLETED application without an issued quote → statusTransition COMPLETED→OPEN', () => {
    const s = snapshot({ application: { exists: true, status: 'COMPLETED', quoteIssued: false } } as Partial<DomainSnapshot>)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:tier', newValue: 'optim' })
    expect(plan.statusTransition).toEqual({ from: 'COMPLETED', to: 'OPEN' })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/consequence-planner.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation lib/engines/consequence-planner.ts (pure; imports evaluateEligibility from C2):
```ts
import {
  computeVisibleSet, edgeSatisfied, nodeValue,
  type DependencyEdge, type GraphFacts, type NodeKey, type DependencyKind, type SelectionFacet,
} from './dependency-graph'
import { evaluateEligibility, type EligibilityRuleSet } from './eligibility' // C2
import type { DomainSnapshot } from './derive-and-expose'                    // A1
import type { CommitEffect } from './commit-contract'                        // A2 pinned types

export interface Mutation { node: NodeKey; newValue: string | null }

export interface ConsequencePlan {
  mutation: Mutation
  invalidations: { node: NodeKey; cause: NodeKey; kind: DependencyKind; reason: string }[]
  questionsAdded: string[]
  questionsRemoved: string[]
  eligibilityOutcomes: { subject: 'product' | 'addon'; verdict: 'eligible' | 'ineligible' | 'unknown'; reasons: string[] }[]
  selectionPatch: Partial<{ tier: string | null; level: string | null; addon: boolean }>
  statusTransition: { from: 'COMPLETED'; to: 'OPEN' } | null
  requiresConfirmation: boolean
  effects: CommitEffect[]
}

function factsOf(s: DomainSnapshot): GraphFacts {
  return { answers: { ...s.answers.active }, selection: { ...s.selection } }
}

function applyMutation(facts: GraphFacts, m: Mutation): GraphFacts {
  const next: GraphFacts = { answers: { ...facts.answers }, selection: { ...facts.selection } }
  if (m.node.startsWith('answer:')) {
    const code = m.node.slice('answer:'.length)
    if (m.newValue === null) delete next.answers[code]
    else next.answers[code] = m.newValue
  } else {
    const facet = m.node.slice('selection:'.length) as SelectionFacet
    if (facet === 'addon') next.selection.addon = m.newValue === 'true'
    else next.selection[facet] = m.newValue
  }
  return next
}

export function computeConsequences(
  graph: DependencyEdge[],
  snapshot: DomainSnapshot,
  mutation: Mutation,
): ConsequencePlan {
  const before = factsOf(snapshot)
  let after = applyMutation(before, mutation)
  const effects = new Set<CommitEffect>()
  const invalidations: ConsequencePlan['invalidations'] = []
  const selectionPatch: ConsequencePlan['selectionPatch'] = {}
  const eligibilityOutcomes: ConsequencePlan['eligibilityOutcomes'] = []

  // 1. requires_confirmation: sensitive answer node being MODIFIED (CONFIRM_ON_MODIFY) or written at all (CONFIRM_ALWAYS)
  let requiresConfirmation = false
  if (mutation.node.startsWith('answer:')) {
    const code = mutation.node.slice('answer:'.length)
    const sens = snapshot.answers.sensitivity[code] ?? 'NONE'
    const hadValue = before.answers[code] !== undefined
    requiresConfirmation = sens === 'CONFIRM_ALWAYS' || (sens === 'CONFIRM_ON_MODIFY' && hadValue)
  }

  // 2. VALIDITY edges: subject whose dependsOn node just changed value → invalidate subject
  for (const e of graph) {
    if (e.kind !== 'VALIDITY' || e.dependsOnKey !== mutation.node) continue
    if (nodeValue(e.subjectKey, before) === null) continue
    invalidations.push({ node: e.subjectKey, cause: mutation.node, kind: 'VALIDITY', reason: 'validity_dependency_changed' })
    if (e.subjectKey.startsWith('selection:')) {
      const facet = e.subjectKey.slice('selection:'.length) as SelectionFacet
      if (facet === 'level') selectionPatch.level = null
      if (facet === 'tier') selectionPatch.tier = null
      after = applyMutation(after, { node: e.subjectKey, newValue: null })
    }
    effects.add('cascade_invalidate')
  }

  // 3. ELIGIBILITY edges touched by this mutation → re-evaluate via the canonical module (C2)
  const eligEdges = graph.filter(e => e.kind === 'ELIGIBILITY' && e.dependsOnKey === mutation.node)
  if (eligEdges.length > 0) {
    const rules = snapshot.product.eligibilityRules as EligibilityRuleSet
    const facts: Record<string, unknown> = { ...after.answers }
    const result = evaluateEligibility(rules, facts, 'addon')
    eligibilityOutcomes.push({ subject: 'addon', verdict: result.verdict, reasons: result.failedRules.map(f => f.reason) })
    effects.add('eligibility_recheck')
    if (result.verdict === 'ineligible' && after.selection.addon) {
      selectionPatch.addon = false // deterministic, reported, never silent (contradiction #4 rule 4)
      after = applyMutation(after, { node: 'selection:addon', newValue: 'false' })
    }
  }

  // 4. Visible-set diff → cascade_expand / questions_removed (+ invalidate answers of removed questions)
  const codes = snapshot.questionCodes
  const visBefore = computeVisibleSet(graph, codes, before)
  const visAfter = computeVisibleSet(graph, codes, after)
  const questionsAdded = [...visAfter].filter(c => !visBefore.has(c))
  const questionsRemoved = [...visBefore].filter(c => !visAfter.has(c))
  if (questionsAdded.length > 0) effects.add('cascade_expand')
  if (questionsRemoved.length > 0) effects.add('questions_removed')
  for (const code of questionsRemoved) {
    if (before.answers[code] !== undefined) {
      invalidations.push({ node: `answer:${code}`, cause: mutation.node, kind: 'VISIBILITY', reason: 'removed_by_branch' })
      effects.add('cascade_invalidate')
    }
  }

  // 5. Status: derived, never a ratchet pre-quote (T6.D2)
  let statusTransition: ConsequencePlan['statusTransition'] = null
  const invalidating = invalidations.length > 0
  if (invalidating && snapshot.application.status === 'COMPLETED' && !snapshot.application.quoteIssued) {
    statusTransition = { from: 'COMPLETED', to: 'OPEN' }
  }

  // 6. re_rating: any selection facet change, or invalidation touching selection, while pricing inputs exist
  if (mutation.node.startsWith('selection:') || Object.keys(selectionPatch).length > 0) {
    effects.add('re_rating')
  }

  return {
    mutation, invalidations, questionsAdded, questionsRemoved, eligibilityOutcomes,
    selectionPatch, statusTransition, requiresConfirmation, effects: [...effects],
  }
}
```
Adjust the DomainSnapshot field access paths to A1's actual shape (`answers.active`, `answers.sensitivity`, `questionCodes`, `product.eligibilityRules`, `application.quoteIssued` — if A1 names differ, adapt here and in the test; the planner logic is unchanged).
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/consequence-planner.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): pure consequence planner over the typed dependency graph"`

### Task C1.4: Append-only Answer revisions + single-writer answer store
**Files:**
- Modify: prisma/schema.prisma (Answer: source/status/invalidatedReason/causedByKey/commitId; drop @@unique([questionId, conversationId]))
- Create: prisma/migrations/<ts>_answer_revisions/migration.sql (edit generated SQL to add the partial unique index)
- Create: lib/engines/answer-store.ts
- Create: __tests__/helpers/test-db.ts (truncate+seed helper for integration tests)
- Test: __tests__/integration/answer-store.test.ts (real test DB per T12.D3 — no mocked prisma)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeRevision, invalidateActive, getActiveAnswers } from '@/lib/engines/answer-store'
import { resetQuestionnaireTables, seedMinimalProtectFixture } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>

beforeEach(async () => {
  await resetQuestionnaireTables()           // TRUNCATE Answer + fixture conversation/application rows
  fx = await seedMinimalProtectFixture()     // returns { conversationId, applicationId, questionIdByCode }
})

describe('answer-store (append-only revisions)', () => {
  it('writeRevision supersedes the previous ACTIVE row instead of overwriting', async () => {
    const qId = fx.questionIdByCode.HEALTH_DECLARATION_CONFIRM
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: qId, value: 'true', source: 'USER_ANSWER', commitId: 'c1' })
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c2' })
    const rows = await prisma.answer.findMany({ where: { conversationId: fx.conversationId, questionId: qId }, orderBy: { createdAt: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('SUPERSEDED')
    expect(rows[1].status).toBe('ACTIVE')
    expect(rows[1].value).toBe('false')
  })
  it('the DB rejects two ACTIVE revisions for one (questionId, conversationId) — partial unique index', async () => {
    const qId = fx.questionIdByCode.HEALTH_DECLARATION_CONFIRM
    await prisma.answer.create({ data: { questionId: qId, conversationId: fx.conversationId, value: 'a', status: 'ACTIVE', source: 'USER_ANSWER' } })
    await expect(
      prisma.answer.create({ data: { questionId: qId, conversationId: fx.conversationId, value: 'b', status: 'ACTIVE', source: 'USER_ANSWER' } }),
    ).rejects.toThrow() // unique_violation from answer_active_unique
  })
  it('invalidateActive marks the row INVALIDATED with causality; getActiveAnswers no longer returns it', async () => {
    const qId = fx.questionIdByCode.BD_CANCER_HISTORY
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c1' })
    await invalidateActive(prisma, { conversationId: fx.conversationId, questionId: qId, causedByKey: 'selection:addon', reason: 'removed_by_branch', commitId: 'c2' })
    const active = await getActiveAnswers(prisma, fx.conversationId)
    expect(active.BD_CANCER_HISTORY).toBeUndefined()
    const row = await prisma.answer.findFirst({ where: { questionId: qId, conversationId: fx.conversationId } })
    expect(row?.status).toBe('INVALIDATED')
    expect(row?.causedByKey).toBe('selection:addon')
    expect(row?.invalidatedReason).toBe('removed_by_branch')
  })
  it('re-answering after invalidation creates a fresh ACTIVE revision (reactivation)', async () => {
    const qId = fx.questionIdByCode.BD_CANCER_HISTORY
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c1' })
    await invalidateActive(prisma, { conversationId: fx.conversationId, questionId: qId, causedByKey: 'selection:addon', reason: 'removed_by_branch', commitId: 'c2' })
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: qId, value: 'true', source: 'USER_ANSWER', commitId: 'c3' })
    const active = await getActiveAnswers(prisma, fx.conversationId)
    expect(active.BD_CANCER_HISTORY).toBe('true')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/answer-store.test.ts` — expect FAIL (columns/store missing).
- [ ] Step 3: Implement. (a) Schema: add to model Answer `source AnswerSource @default(USER_ANSWER)`, `status AnswerRevisionStatus @default(ACTIVE)`, `invalidatedReason String?`, `causedByKey String?`, `commitId String?`, replace `@@unique([questionId, conversationId])` with `@@index([questionId, conversationId, status])`; new enums AnswerSource { USER_ANSWER PREFILL SELECTION_MIRROR SYSTEM } and AnswerRevisionStatus { ACTIVE SUPERSEDED INVALIDATED }. Run `npx prisma migrate dev --name answer_revisions --create-only`, then append to the generated migration.sql:
```sql
CREATE UNIQUE INDEX "answer_active_unique" ON "Answer"("questionId", "conversationId") WHERE "status" = 'ACTIVE';
```
then `npx prisma migrate dev && npx prisma generate`. (b) lib/engines/answer-store.ts — THE only module allowed to write prisma.answer:
```ts
import type { PrismaClient, Prisma } from '@/lib/generated/prisma/client'
type Db = PrismaClient | Prisma.TransactionClient

export async function getActiveAnswers(db: Db, conversationId: string): Promise<Record<string, string>> {
  const rows = await db.answer.findMany({
    where: { conversationId, status: 'ACTIVE' },
    include: { question: { select: { code: true } } },
  })
  const out: Record<string, string> = {}
  for (const r of rows) if (r.question.code) out[r.question.code] = r.value
  return out
}

export async function writeRevision(db: Db, args: {
  conversationId: string; questionId: string; value: string
  source: 'USER_ANSWER' | 'PREFILL' | 'SELECTION_MIRROR' | 'SYSTEM'; commitId?: string
}): Promise<void> {
  await db.answer.updateMany({
    where: { conversationId: args.conversationId, questionId: args.questionId, status: 'ACTIVE' },
    data: { status: 'SUPERSEDED' },
  })
  await db.answer.create({
    data: { conversationId: args.conversationId, questionId: args.questionId, value: args.value, source: args.source, status: 'ACTIVE', commitId: args.commitId ?? null },
  })
}

export async function invalidateActive(db: Db, args: {
  conversationId: string; questionId: string; causedByKey: string; reason: string; commitId?: string
}): Promise<void> {
  await db.answer.updateMany({
    where: { conversationId: args.conversationId, questionId: args.questionId, status: 'ACTIVE' },
    data: { status: 'INVALIDATED', causedByKey: args.causedByKey, invalidatedReason: args.reason, commitId: args.commitId ?? null },
  })
}
```
(c) __tests__/helpers/test-db.ts: `resetQuestionnaireTables()` deletes Answer rows + fixture Conversation/Application/Customer rows by a fixed test marker; `seedMinimalProtectFixture()` creates one Customer + Conversation + OPEN Application against the seeded protect product and returns ids + `questionIdByCode` from prisma.question lookups (questions/edges come from the real seed — run `npx tsx prisma/seeds/index.ts` once before the suite). Document at top of helper: integration tests require DATABASE_URL pointing at the dev/test database and run serially.
- [ ] Step 4: Run `npx vitest run __tests__/integration/answer-store.test.ts` — expect PASS. NOTE: existing callers of the removed `questionId_conversationId` unique (application-handlers.ts:189,254; set-answer-handlers.ts:45; change-selection-handlers.ts:100; quote-handlers.ts:491; dnt-handlers.ts:177) now fail typecheck — mechanically switch each `prisma.answer.upsert({ where: { questionId_conversationId: ... } })` to `writeRevision(prisma, ...)` (source USER_ANSWER; PREFILL for application-handlers.ts:86; SELECTION_MIRROR for change-selection-handlers.ts:100) and each read to `getActiveAnswers`/`status: 'ACTIVE'` filters in this same task, then `npx vitest run` to confirm the full suite is green (cascade routing comes in C1.5 — this step is only the store mechanics).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): append-only Answer revisions behind a single-writer answer store"`

### Task C1.5: Transactional applier + modify_answer/save_application_answer through the A2 gateway
**Files:**
- Create: lib/engines/consequence-applier.ts
- Modify: lib/tools/handlers/application-handlers.ts (saveApplicationAnswer: plan → gateway transactional apply; remove hardcoded tier/level/addon side-effects for selection mirrors — selection writes are B4's), lib/tools/handlers/set-answer-handlers.ts (becomes the modify_answer commit: planner-driven, no status-guard bypass)
- Test: __tests__/integration/consequence-applier.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (real DB):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { applyConsequencePlan } from '@/lib/engines/consequence-applier'
import { computeConsequences } from '@/lib/engines/consequence-planner'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import { writeRevision } from '@/lib/engines/answer-store'
import { resetQuestionnaireTables, seedMinimalProtectFixture, loadSnapshot } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => { await resetQuestionnaireTables(); fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true }) })

describe('applyConsequencePlan', () => {
  it('bd yes: one transaction writes the answer, flips includesAddon=false, invalidates remaining bd answers', async () => {
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: fx.questionIdByCode.BD_CARDIOVASCULAR, value: 'false', source: 'USER_ANSWER' })
    const snap = await loadSnapshot(fx.conversationId) // deriveAndExpose snapshot loader (A1)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap, { node: 'answer:BD_CANCER_HISTORY', newValue: 'true' })
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'test-commit' }, plan))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.includesAddon).toBe(false)
    const cardio = await prisma.answer.findFirst({ where: { conversationId: fx.conversationId, questionId: fx.questionIdByCode.BD_CARDIOVASCULAR } })
    expect(cardio?.status).toBe('INVALIDATED')
    expect(cardio?.causedByKey).toBe('answer:BD_CANCER_HISTORY')
    const written = await prisma.answer.findFirst({ where: { conversationId: fx.conversationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY, status: 'ACTIVE' } })
    expect(written?.value).toBe('true')
    expect(written?.commitId).toBe('test-commit')
  })
  it('statusTransition reverts COMPLETED→OPEN pre-quote', async () => {
    await prisma.application.update({ where: { id: fx.applicationId }, data: { status: 'COMPLETED' } })
    const snap = await loadSnapshot(fx.conversationId)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap, { node: 'selection:tier', newValue: 'optim' })
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'c2' }, plan))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('OPEN')
    expect(app.levelId).toBeNull() // VALIDITY cascade cleared the tier-scoped level
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/consequence-applier.test.ts` — expect FAIL.
- [ ] Step 3: Implement lib/engines/consequence-applier.ts:
```ts
import type { Prisma } from '@/lib/generated/prisma/client'
import { writeRevision, invalidateActive } from './answer-store'
import type { ConsequencePlan } from './consequence-planner'

export interface ApplyContext { conversationId: string; applicationId: string; commitId: string }

export async function applyConsequencePlan(
  tx: Prisma.TransactionClient,
  ctx: ApplyContext,
  plan: ConsequencePlan,
): Promise<void> {
  // 1. the triggering write (answer mutations only; selection mutations are written by select_coverage/B4)
  if (plan.mutation.node.startsWith('answer:') && plan.mutation.newValue !== null) {
    const code = plan.mutation.node.slice('answer:'.length)
    const q = await tx.question.findFirstOrThrow({ where: { code } })
    await writeRevision(tx, { conversationId: ctx.conversationId, questionId: q.id, value: plan.mutation.newValue, source: 'USER_ANSWER', commitId: ctx.commitId })
  }
  // 2. invalidations with causality
  for (const inv of plan.invalidations) {
    if (!inv.node.startsWith('answer:')) continue
    const q = await tx.question.findFirstOrThrow({ where: { code: inv.node.slice('answer:'.length) } })
    await invalidateActive(tx, { conversationId: ctx.conversationId, questionId: q.id, causedByKey: inv.cause, reason: inv.reason, commitId: ctx.commitId })
  }
  // 3. deterministic selection patch (eligibility-driven addon removal, validity-cleared level)
  if (Object.keys(plan.selectionPatch).length > 0) {
    await tx.application.update({
      where: { id: ctx.applicationId },
      data: {
        ...(plan.selectionPatch.addon !== undefined ? { includesAddon: plan.selectionPatch.addon } : {}),
        ...(plan.selectionPatch.level !== undefined ? { levelId: null } : {}),
        ...(plan.selectionPatch.tier !== undefined ? { tierId: null } : {}),
      },
    })
  }
  // 4. derived status transition
  if (plan.statusTransition) {
    await tx.application.update({ where: { id: ctx.applicationId }, data: { status: plan.statusTransition.to, completedAt: null } })
  }
}
```
Then route the two commits through the A2 gateway: in saveApplicationAnswer and the modify_answer handler, replace direct upsert+side-effects with (a) validateAnswer (unchanged), (b) `computeConsequences` over the gateway-provided pre-state snapshot, (c) if `plan.requiresConfirmation` and no valid confirm token → return CommitResult `{ outcome: 'requires_confirmation', confirmToken, data: plan }` (token minting/fingerprinting is A2's; the plan is the preview), (d) otherwise gateway transactional apply calls `applyConsequencePlan` and the envelope's `effects` = `plan.effects` with the ledger row recording `data: { questionsAdded, questionsRemoved, invalidations }`. Delete the hardcoded PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST side-effect blocks (application-handlers.ts:254-334 region) — selection state is written only by select_coverage (B4).
- [ ] Step 4: Run `npx vitest run __tests__/integration/consequence-applier.test.ts && npx vitest run` — expect PASS (full suite green; the instrumentation flake is a known PASS-equivalent if it is the only failure).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): transactional consequence applier; answer commits flow planner->gateway"`

### Task C1.6: select_coverage emits mutations into the same planner (contradiction #4)
**Files:**
- Modify: lib/tools/handlers/select-coverage-handlers.ts (B4 artifact — handler exists once B4 lands; if B4 named it differently, locate by the select_coverage registry entry)
- Test: __tests__/integration/select-coverage-cascades.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2 artifact
import { writeRevision } from '@/lib/engines/answer-store'
import { resetQuestionnaireTables, seedMinimalProtectFixture } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => { await resetQuestionnaireTables(); fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true }) })

describe('select_coverage through the consequence planner', () => {
  it('tier change → re_rating + cascade_invalidate of the now-invalid level (no stale levelId)', async () => {
    const res = await executeCommit({ tool: 'select_coverage', actor: 'agent', conversationId: fx.conversationId, args: { tier: 'optim' } })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toEqual(expect.arrayContaining(['re_rating', 'cascade_invalidate']))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.levelId).toBeNull() // the change-selection stale-level hole is closed
  })
  it('addon=false → questions_removed for bd_medical, answered bd rows invalidated', async () => {
    await writeRevision(prisma, { conversationId: fx.conversationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY, value: 'false', source: 'USER_ANSWER' })
    const res = await executeCommit({ tool: 'select_coverage', actor: 'agent', conversationId: fx.conversationId, args: { addon: false } })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('questions_removed')
    const bd = await prisma.answer.findFirst({ where: { conversationId: fx.conversationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY } })
    expect(bd?.status).toBe('INVALIDATED')
  })
  it('addon=true → cascade_expand listing the 6 bd questions in the envelope data', async () => {
    await executeCommit({ tool: 'select_coverage', actor: 'agent', conversationId: fx.conversationId, args: { addon: false } })
    const res = await executeCommit({ tool: 'select_coverage', actor: 'agent', conversationId: fx.conversationId, args: { addon: true } })
    expect(res.effects).toContain('cascade_expand')
    expect((res.data as { questionsAdded: string[] }).questionsAdded).toHaveLength(6)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/select-coverage-cascades.test.ts` — expect FAIL (select_coverage applies selection without planner consequences).
- [ ] Step 3: Minimal implementation: inside the B4 select_coverage handler's gateway apply, for each changed facet build `Mutation { node: 'selection:<facet>', newValue }`, run `computeConsequences`, merge plans (facets are independent in v1 — at most one facet change per commit arg keeps it simple; reject multi-facet args with `rejected(reason: 'one_facet_per_commit')` if B4 allowed several), persist the selection write itself (B4's existing update) PLUS `applyConsequencePlan` in the same transaction, and surface `plan.effects` + `{ questionsAdded, questionsRemoved, invalidations }` in the envelope `data`. Invariant kept: select_coverage remains the SOLE writer of selection state; the planner only ever patches selection via `selectionPatch` from eligibility/validity edges executed in this same gateway transaction.
- [ ] Step 4: Run `npx vitest run __tests__/integration/select-coverage-cascades.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(tools): select_coverage emits mutations through the consequence planner (one graph, two node kinds)"`

### Task C1.7: branching_metadata provenance + one canonical visible set in DerivedStateV3
**Files:**
- Create: lib/engines/branching-provenance.ts
- Modify: lib/tools/handlers/application-handlers.ts (next-question payload gains branching_metadata; built from provenance fn + last ledger row), lib/engines/derive-and-expose.ts (A1 artifact: application.required/answered/missing computed via computeVisibleSet — retires the unfiltered count formerly at lib/chat/derive-state.ts:154-173)
- Test: __tests__/lib/engines/branching-provenance.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (pure):
```ts
import { describe, it, expect } from 'vitest'
import { buildBranchingMetadata } from '@/lib/engines/branching-provenance'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import type { GraphFacts } from '@/lib/engines/dependency-graph'

const facts: GraphFacts = { answers: {}, selection: { tier: 'standard', level: 'level_1', addon: true } }
const texts = { BD_CANCER_HISTORY: { en: 'Cancer history?', ro: 'Istoric de cancer?' } }
const gateTexts = {} // selection gates carry no question text

describe('buildBranchingMetadata', () => {
  it('reports which edge fired, on which value, and whether the question was added by the last commit', () => {
    const meta = buildBranchingMetadata({
      graph: PROTECT_DEPENDENCY_EDGES,
      questionCode: 'BD_CANCER_HISTORY',
      facts,
      questionTexts: { ...texts, ...gateTexts },
      lastCommitQuestionsAdded: ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR'],
      groupCode: 'bd_medical',
      groupName: { en: 'BD Medical', ro: 'BD Medical' },
    })
    expect(meta.triggeredBy).toContainEqual(expect.objectContaining({
      nodeKey: 'selection:addon', kind: 'VISIBILITY', matchedValue: 'true', predicate: { op: 'is_true' },
    }))
    expect(meta.addedByLastCommit).toBe(true)
    expect(meta.groupCode).toBe('bd_medical')
  })
  it('ungated question → empty triggeredBy, addedByLastCommit false', () => {
    const meta = buildBranchingMetadata({
      graph: PROTECT_DEPENDENCY_EDGES, questionCode: 'HEALTH_DECLARATION_CONFIRM', facts,
      questionTexts: {}, lastCommitQuestionsAdded: [], groupCode: 'application', groupName: { en: 'Application', ro: 'Aplicație' },
    })
    expect(meta.triggeredBy).toEqual([])
    expect(meta.addedByLastCommit).toBe(false)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/branching-provenance.test.ts` — expect FAIL.
- [ ] Step 3: Implement lib/engines/branching-provenance.ts:
```ts
import { edgeSatisfied, nodeValue, type DependencyEdge, type EdgePredicate, type GraphFacts, type NodeKey } from './dependency-graph'

export interface BranchingMetadata {
  triggeredBy: {
    nodeKey: NodeKey
    questionCode?: string                     // when the gate is an answer node
    questionText?: { en: string; ro: string } // localized gate text — agent must not paraphrase from memory
    matchedValue: string
    kind: 'VISIBILITY' | 'ELIGIBILITY'
    predicate: EdgePredicate
  }[]
  addedByLastCommit: boolean
  groupCode: string
  groupName: { en: string; ro: string }
}

export function buildBranchingMetadata(args: {
  graph: DependencyEdge[]
  questionCode: string
  facts: GraphFacts
  questionTexts: Record<string, { en: string; ro: string }>
  lastCommitQuestionsAdded: string[]
  groupCode: string
  groupName: { en: string; ro: string }
}): BranchingMetadata {
  const subject: NodeKey = `answer:${args.questionCode}`
  const triggeredBy = args.graph
    .filter(e => e.subjectKey === subject && (e.kind === 'VISIBILITY' || e.kind === 'ELIGIBILITY') && edgeSatisfied(e, args.facts))
    .map(e => {
      const gateCode = e.dependsOnKey.startsWith('answer:') ? e.dependsOnKey.slice('answer:'.length) : undefined
      return {
        nodeKey: e.dependsOnKey,
        questionCode: gateCode,
        questionText: gateCode ? args.questionTexts[gateCode] : undefined,
        matchedValue: nodeValue(e.dependsOnKey, args.facts) ?? '',
        kind: e.kind as 'VISIBILITY' | 'ELIGIBILITY',
        predicate: e.predicate,
      }
    })
  return {
    triggeredBy,
    addedByLastCommit: args.lastCommitQuestionsAdded.includes(args.questionCode),
    groupCode: args.groupCode,
    groupName: args.groupName,
  }
}
```
Wiring: (a) the next-question payload in application-handlers.ts adds `branching_metadata` built with `lastCommitQuestionsAdded` read from the latest CommitLedger row for this conversation (`row.data.questionsAdded ?? []` — the C1.5 envelope persisted it); (b) in deriveAndExpose (A1 artifact), replace the unfiltered application required/answered/missing computation with `computeVisibleSet(graph, applicationQuestionCodes, facts)` so progress, missing-list, and branching_metadata share ONE visible-set source (fixes the lib/chat/derive-state.ts:154-173 divergence); progress totals returned by get_next_question must come from the same call.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/branching-provenance.test.ts && npx vitest run` — expect PASS, and existing derive-state/phase tests still green against the visibility-filtered counts (update fixture expectations where they previously asserted unfiltered totals — bd questions no longer count as missing when addon is unselected).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): structured branching provenance + single canonical visible set in DerivedStateV3"`

### Task C1.8: Retire parentQuestionId/showWhenValue and close the writer path
**Files:**
- Modify: prisma/schema.prisma (drop Question.parentQuestionId, Question.showWhenValue, questionBranching relation), lib/engines/questionnaire-engine.ts (shouldShowQuestion deleted; getNextQuestion/calculateProgress consume computeVisibleSet over QuestionDependency rows), lib/tools/handlers/quote-handlers.ts (modifyQuote: hardcoded 4-code answer hard-delete at 484-497 replaced by planner invalidations), lib/tools/handlers/dnt-handlers.ts (answer upsert at :177 → writeRevision; flat semantics, no planner), prisma/seeds/seed-questions.ts (remove parentQuestionCode/showWhenValue fields)
- Test: __tests__/lib/engines/writer-closure.test.ts (meta-test), plus update __tests__/lib/engines/questionnaire-engine.test.ts to the graph-based API
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing writer-closure meta-test (greps the repo — T6 risk #1 made executable):
```ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

const ALLOWED = [
  'lib/engines/answer-store.ts',          // the single writer
  'app/api/gdpr/delete-data/route.ts',    // GDPR erasure — owned by M3, audited there
]

describe('answer writer closure', () => {
  it('no prisma.answer write call exists outside the answer store', () => {
    const out = execSync(
      String.raw`git grep -l -E "prisma\.answer\.(create|update|upsert|delete|createMany|updateMany|deleteMany)" -- lib app`,
      { encoding: 'utf8', cwd: process.cwd() },
    ).trim().split('\n').filter(Boolean).map(p => p.replace(/\\/g, '/'))
    const offenders = out.filter(f => !ALLOWED.includes(f))
    expect(offenders).toEqual([])
  })
  it('the legacy visibility columns are gone from the schema', () => {
    const schema = execSync('git show HEAD:prisma/schema.prisma || type prisma\\schema.prisma', { encoding: 'utf8', shell: 'cmd.exe' })
    // read the working-tree file instead if simpler:
    const fs = require('node:fs') as typeof import('node:fs')
    const live = fs.readFileSync('prisma/schema.prisma', 'utf8')
    expect(live).not.toMatch(/parentQuestionId/)
    expect(live).not.toMatch(/showWhenValue/)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/writer-closure.test.ts` — expect FAIL (quote-handlers + dnt-handlers still write; columns still present).
- [ ] Step 3: Implement: (a) dnt-handlers.ts:177 → `writeRevision(prisma, { conversationId, questionId, value, source: 'USER_ANSWER' })` (history preserved; DNT consequence semantics stay flat — no planner; Block B's DNT rework keeps the store); (b) modifyQuote's hard-delete block (quote-handlers.ts:484-497) → compute a plan for the selection reset via computeConsequences and apply through the gateway (transitional until D1 reworks quote immutability — note in code comment `// D1 retires modify_quote; this routing keeps history integrity meanwhile`), and fix its includesAddon omission by including the addon facet in the reset mutation set; (c) questionnaire-engine.ts: delete shouldShowQuestion + parentQuestionId handling, load QuestionDependency rows once per call, build GraphFacts from getActiveAnswers + application selection, filter via computeVisibleSet (getNextQuestion and calculateProgress now share it; QuestionData drops parentQuestionId/showWhenValue fields); (d) schema: drop the two columns + relation, `npx prisma migrate dev --name retire_parent_question_columns` (destructive ok — demo data), reseed; (e) seed-questions.ts: delete parentQuestionCode/showWhenValue from the helper type and the DNT_SUSTAINABILITY_PREFERENCE entry (its edge lives in seed-dependency-edges.ts since C1.2).
- [ ] Step 4: Run `npx vitest run` — expect PASS (existing questionnaire-engine tests updated to graph API; full suite green modulo the known instrumentation flake).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): single dependency store + single answer writer; retire parentQuestionId/showWhenValue"`

### Task C1.9: Package verification — full suite + live cascade sim
**Files:**
- Create: scripts/verify-consequence-cascade.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-consequence-cascade.ts (runtime check against the dev DB, mirroring scripts/verify-advance-flow.ts's pattern): seed-reset (`npx prisma migrate reset --force` invoked manually beforehand), then drive through the gateway: create fixture conversation+application (tier standard, level level_1, addon true) → `select_coverage {tier:'optim'}` → assert envelope effects contain re_rating+cascade_invalidate and DB levelId is null → re-select level → answer BD_CANCER_HISTORY 'true' via save_application_answer → assert eligibility_recheck + questions_removed in envelope, includesAddon false in DB, remaining bd answers INVALIDATED → modify HEALTH_DECLARATION_CONFIRM → assert requires_confirmation outcome with plan preview, then confirm with token → assert applied. Print `PASS n/n` or exit 1.
- [ ] Step 2: Run `npx prisma migrate reset --force && npx tsx prisma/seeds/index.ts && npx tsx scripts/verify-consequence-cascade.ts` — expect `PASS` on every step.
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (instrumentation flake exempt per its known status when it is the sole failure).
- [ ] Step 4: Re-run the script a second time without reset to confirm idempotent replay behavior on the duplicate commits (`replay` dispositions, no second cascade).
- [ ] Step 5: Commit: `git add -A && git commit -m "test(verify): live consequence-cascade verification script"`

### ⚠ Binding errata for C1 (fidelity verifier — apply OVER the task text above)

1. **[C1.3/Step 3 (computeConsequences implementation)]** Real logic bug: the eligibility recheck builds facts as `const facts = { ...after.answers }`, producing bare question-code keys (BD_CANCER_HISTORY), but C2's rule schema and the seeded ruleset key answer facts as 'answer:<code>' (C2.1 fact: 'answer:BD_CANCER_HISTORY'). evaluateEligibility would report every bd rule's fact as missing, verdict 'unknown', never 'ineligible' — the task's own Step-1 test ('first bd yes → addon ineligible') fails at Step 4, and in production the addon auto-removal (contradiction #4 rule 4) never fires.
   **Fix:** In computeConsequences, build eligibility facts with prefixed keys: `const facts = Object.fromEntries(Object.entries(after.answers).map(([c, v]) => ['answer:' + c, v]))`, and also merge identity facts (age, residency) from the snapshot so rules like addon_age_band evaluate; update the C1.3 test's PROTECT_RULES comment accordingly.
2. **[C1.4/Step 4 (caller migration list)]** The list of callers broken by dropping @@unique([questionId, conversationId]) is wrong in two ways. (1) It misses lib/tools/handlers/quote-handlers.ts:145-150: generateQuote READS the PAYMENT_FREQUENCY answer via prisma.answer.findUnique({ where: { questionId_conversationId } }) — this typechecks against the composite unique and breaks the moment the unique is dropped, but no task touches it. (2) It lists quote-handlers.ts:491 as an upsert-with-composite-key caller, but :491 is the deleteMany inside modifyQuote (no composite key), which C1.8 step 3(b) handles — listing it in C1.4 double-assigns it.
   **Fix:** In C1.4 step 4: add 'quote-handlers.ts:145 → replace findUnique(questionId_conversationId) with prisma.answer.findFirst({ where: { questionId, conversationId, status: "ACTIVE" } }) (or getActiveAnswers)'; remove quote-handlers.ts:491 from the C1.4 list (owned by C1.8).
3. **[C1.4/Step 4 vs C1.8/Step 3(a)]** dnt-handlers.ts:177 is assigned twice: C1.4 step 4 says to mechanically switch 'each prisma.answer.upsert' caller including dnt-handlers.ts:177 to writeRevision, and C1.8 step 3(a) performs the identical change again. An executing engineer reaching C1.8 finds the work already done (or worse, does it differently in C1.4 because the instruction there is generic).
   **Fix:** Pick one owner: do the dnt-handlers.ts:177 → writeRevision switch in C1.4 (it is forced by the typecheck break anyway) and reduce C1.8 step 3(a) to a verification bullet ('confirm dnt-handlers writes via the store; DNT stays planner-free').
4. **[C1.4/C1.5/C3.4/C3.6 (test helpers)]** Helper functions are imported in test code but never created by any task: loadSnapshot (C1.5 test, '../helpers/test-db'), signDntWithFacts (C3.4 + C3.6), issueTestQuote (C3.6). Additionally seedMinimalProtectFixture is specified in C1.4 as returning { conversationId, applicationId, questionIdByCode } with no parameters, but C1.5/C1.6/C3.6 call it with an options bag ({ tier, level, addon }) and C3.4 reads fx.customerId — neither the options parameter nor customerId is in the documented contract.
   **Fix:** Extend C1.4 step 3(c) to define seedMinimalProtectFixture(options?: { tier?: string; level?: string; addon?: boolean }) returning { conversationId, applicationId, customerId, questionIdByCode } and a loadSnapshot(conversationId) wrapper over A1's snapshot loader. Add an explicit step in C3.4 creating signDntWithFacts(fx, facts) (writes DNT answers via B1's aggregate + executes sign_dnt through the gateway) and in C3.6 creating issueTestQuote(fx) (drives generate_quote or inserts an ISSUED Quote row), each with the exact code.
5. **[C1.4/Step 4 and C1.5/Step 3 (existing mocked-prisma tests)]** Existing tests choreograph the exact call shapes these tasks delete: __tests__/lib/tools/handlers/set-answer.test.ts:98 asserts prisma.answer.upsert({ where: { questionId_conversationId ... } }) against a vi.mock('@/lib/db'), and __tests__/integration/navigation.test.ts:41 mocks answer.upsert. Both fail after the rewiring, yet the steps claim 'npx vitest run → full suite green' without mentioning them. Per T12.D3 these are exactly the mocked-prisma choreography tests to retire, not re-choreograph against writeRevision.
   **Fix:** Add an explicit bullet to C1.4 step 4 (and C1.5 step 3): delete or rewrite __tests__/lib/tools/handlers/set-answer.test.ts and the answer.upsert mocks in __tests__/integration/navigation.test.ts, replacing the coverage with the new pure-planner tests (C1.3) and real-DB store tests (C1.4) per T12.D3 — do not port the mock choreography.
6. **[C1.8/Step 1 (writer-closure test code)]** The test code is broken as written: (a) `const fs = require('node:fs')` — vitest runs these TS files as ESM, `require` is undefined and the test throws before asserting; (b) the preceding `execSync('git show HEAD:prisma/schema.prisma || type prisma\\schema.prisma', { shell: 'cmd.exe' })` assigns to `schema` which is never used — dead code that also behaves differently on HEAD-vs-working-tree and is platform-coupled.
   **Fix:** Replace with `import { readFileSync } from 'node:fs'` at the top of the test and delete the execSync('git show ...') line entirely; assert on readFileSync('prisma/schema.prisma', 'utf8') only.
7. **[C1.2/Step 3(c) (sensitivity seeding) — T6.D3 fidelity]** BD_* questions are seeded CONFIRM_ON_MODIFY, but the T6.D3 rationale (not overridden by the log) explicitly ties bd_medical to CONFIRM_ALWAYS: 'CONFIRM_ALWAYS covers fields where even first-write needs explicit affirmation — the bd_medical CONTEXT-HIT explicit-affirmation rule in lib/chat/context-loaders.ts:596-603 is prompt-enforced today and would become engine-enforced.' (Verified: that prompt rule exists at context-loaders.ts:596-603.) With CONFIRM_ON_MODIFY, first writes of BD declarations never require confirmation and the explicit-affirmation rule stays prompt-only.
   **Fix:** Seed the six BD_* questions as CONFIRM_ALWAYS (HEALTH_DECLARATION_CONFIRM stays CONFIRM_ON_MODIFY, DNT_CNP stays CONFIRM_ALWAYS), and update the C1.3 test fixture sensitivity map to match — or, if the on-modify choice is deliberate UX, record it as an explicit deviation from T6.D3's rationale in the package overview.
8. **[C1.5/Step 3 and C1.7/Step 3(a) (ledger data field)]** Both tasks persist/read a `data` payload on the CommitLedger row ('the ledger row recording data: { questionsAdded, questionsRemoved, invalidations }'; C1.7 reads 'row.data.questionsAdded ?? []'). The pinned CommitLedger row schema has NO data column ({ id, conversationId, customerId, actor, tool, targetRef, argsHash, outcome, effects, reasonCode, phaseFrom, phaseTo, idempotencyDisposition, contentVersions?, createdAt }). A2's replay-first rule does require storing the original outcome envelope somewhere, but Block C cannot assume the field name/shape.
   **Fix:** Name the dependency explicitly: add to C1.5 and C1.7 a note 'requires A2's stored-envelope field on the ledger row (whatever A2 names it — the field that serves replay's return-original-envelope); coordinate the field name at assembly', and have C1.7 fall back to recomputing the visible-set diff from the pre/post snapshots if A2 stores only the outcome without effects data.
9. **[C1 (overview claim + task ordering) — T6.D1 dual-store window]** The overview claims 'no window with two dependency stores, per T6.D1', but C1.2 seeds QuestionDependency (including the migrated DNT sustainability edge) while parentQuestionId/showWhenValue remain in the schema, in seed-questions.ts, AND remain the live mechanism consumed by questionnaire-engine.shouldShowQuestion until C1.8. Between C1.2 and C1.8 the same DNT edge exists in both stores and the planner (graph) vs getNextQuestion (parentQuestionId) read different sources — exactly the divergence T6.D1 warns about if execution pauses mid-package.
   **Fix:** Either (a) correct the overview to 'the dual-store window is confined to one package executed as a unit; the graph and legacy column carry identical content (same DNT edge) until C1.8 retires the columns', adding a C1.2 note that bd VISIBILITY edges must NOT yet drive questionnaire-engine behavior until C1.8 rewires it, or (b) move the questionnaire-engine computeVisibleSet rewiring earlier (into C1.2/C1.3) so only the dead columns linger.
10. **[C1 (package scope) — flagsForReview recomputation (T6 risk #4 / T6.D2 rationale)]** T6.D2's rationale states the revision model 'subsumes the flagsForReview staleness problem: flags become derivable from active revisions', and T6's risk list warns that without the consequence engine owning flag recomputation, 'modify_answer's cascade_invalidate will resurrect this class of zombie state' (corrected HEALTH_DECLARATION_CONFIRM leaves a PAUSED application with a live escalate flag). No C task derives flags from active revisions or recomputes them on modification/invalidation.
   **Fix:** Add a task (or extend C1.5) making flag state derived: a pure deriveFlags(activeAnswers, questionRules) consumed by applyConsequencePlan (recompute Application.flagsForReview + PAUSED status from active revisions inside the same transaction), with a test: answer HEALTH_DECLARATION_CONFIRM 'false' (flag+PAUSED) then modify to 'true' with confirm token → flag cleared, status recomputed. If flag ownership is deliberately deferred to another block, name the owner explicitly.
11. **[C1.5/C2.6/C3.4 (ReasonCode registration)]** The packages mint many new reason codes (validity_dependency_changed, removed_by_branch, addon_ineligible_medical_history, ineligible_age_minimum/maximum, ineligible_residency, addon_age_band_unavailable, eligibility_facts_missing, suitability_warning_unacknowledged, no_suitability_warning_pending, product_has_no_investment_component, severe_conditions_demand_needs_addon, one_facet_per_commit, quote not least) but no task registers them with A1's ReasonCode registry, which the pinned contracts say A1 owns ('ReasonCode = stable snake_case codes + params'). If A1's ReasonCode is a closed union/registry (likely, given the M6 i18n key-per-code rendering), the C handlers won't compile or the GUI renderer will miss keys.
   **Fix:** Add to each task that introduces codes a sub-step: 'register the new codes in A1's ReasonCode registry module (and the translations.ts key stubs per M6)', listing the exact codes per task; note the dependency on A1's registry file by name.
12. **[C1.8/Step 3(b) vs C1.6/Step 3 (multi-facet mutations)]** C1.6 mandates rejecting multi-facet select_coverage commits ('one_facet_per_commit'), but C1.8(b) requires modifyQuote's transitional replacement to plan a selection RESET spanning tier+level+addon ('including the addon facet in the reset mutation set') through the same planner — the mechanism for composing multiple mutations in one transaction is never specified, leaving the executing engineer to invent it.
   **Fix:** Specify in C1.8(b): run computeConsequences sequentially per facet (tier→null, level→null, addon→false), threading the post-mutation snapshot of each step into the next, union the plans' invalidations/effects, and applyConsequencePlan once per plan inside ONE gateway transaction; the one-facet rule remains an ARG-validation rule on select_coverage only.
13. **[C1.4/C1.8 (DNT answer scoping) — B1 coordination]** C1 routes DNT answers through the conversation-scoped Answer store (dnt-handlers.ts:177 → writeRevision), but the resolved log (contradictions #1/#7/#12, M1/B0) makes DNT customer-scoped via B1's Dnt/DntSession aggregate — after B1, DNT answers likely do not live in Answer at all and dnt-handlers.ts is rewritten (6-tool surface: write_dnt_answer). C1 lists B4 but not B1 in depends_on, and never states whether the dnt-handlers rewiring is transitional or assumes B1 has not landed.
   **Fix:** Add an explicit note to C1.4/C1.8: 'the dnt-handlers.ts routing is transitional — valid only if B1's customer-scoped Dnt package has not yet landed; if B1 landed first, skip it and confirm B1's write_dnt_answer path owns DNT writes (the writer-closure test's scope then covers it automatically)'. Same caveat applies to C1.4's change-selection-handlers.ts:100 entry, since B4 (a declared dependency that lands BEFORE C1) replaces change_selection with select_coverage — state 'if B4 retired change-selection-handlers.ts, the caller no longer exists'.

### ➕ Addendum tasks for C1 (binding — coverage-critic gaps)

### Task C1.ADD-1: Questionnaire tool surface — pinned names (closes G2, T13.D1)
**Files:**
- Modify: `lib/tools/registry.ts` (register `get_next_question` (R, returns branching_metadata structured provenance), `write_question_answer` (C), `modify_answer` (C); retire `save_application_answer` and `set_answer`)
- Test: `__tests__/lib/tools/questionnaire-surface.test.ts`
**Steps:**
- [ ] Step 1: Failing test: the three pinned tools are registered with the right R/C partitions; `save_application_answer` and `set_answer` are gone; `write_question_answer` and `modify_answer` route through the consequence planner (envelope carries the planner's effects).
- [ ] Step 2: FAIL → Step 3: register/retire; both writes call `computeConsequences` + applier via the gateway. Step 4: PASS + full suite. Step 5: commit.

### Task C1.ADD-2: Retire check_bd_eligibility (closes G3, T13.D7)
**Files:**
- Modify: `lib/tools/registry.ts` + delete `lib/tools/handlers/bd-handlers.ts`
- Test: extend `__tests__/lib/tools/questionnaire-surface.test.ts`
**Steps:**
- [ ] Step 1: Failing assertion: `getToolDefinition('check_bd_eligibility')` undefined; the bd rule lives as ELIGIBILITY edges (assert the seeded edge `selection:addon ← answer:bd_*` exists).
- [ ] Step 2: FAIL → Step 3: delete tool + handler; grep references. Step 4: PASS. Step 5: commit.

## Package C2: Canonical eligibility module (one rule source, three evaluation points)

**Execution slot:** 13 | **Depends on:** A1, C1

**Goal:** Formalize Product.eligibility into a typed, versioned rule schema with ONE pure evaluateEligibility(rules, knownFacts) → {verdict, failedRules, missingFacts} (three-valued). Wire the two consumption points whose hosts exist (DerivedStateV3 discovery verdict; C1 eligibility edges consume the same function) and export the generate_quote gate contract for D1. Numeric eligibility_bounds become DERIVED from rules; AddonPricingRule age-band no-match becomes an ineligibility fact, never silent price 0.

**Migrations / seeds:**
- No new tables. prisma/seeds/seed-product.ts: replace the informal eligibility Json content at lines 146-152 (and the duplicate at 478-484) with the typed EligibilityRuleSet shape { version: 1, rules: [...] } carrying: product age gte 18 (reason ineligible_age_minimum), product age lte 64 (reason ineligible_age_maximum), product residency equals 'Romania' (reason ineligible_residency), addon answer:bd_* is_false x6 (reason addon_ineligible_medical_history), addon age between 18..64 derived-from-bands check (reason addon_age_band_unavailable); keep the narrative notes under a separate authored key `narrative` (presentation-only, per #9 rule 3)
- Reseed after seed change: npx prisma migrate reset --force + npx tsx prisma/seeds/index.ts (demo data, no backfill)

### Task C2.1: Typed rule schema + parser
**Files:**
- Create: lib/engines/eligibility.ts (schema part)
- Test: __tests__/lib/engines/eligibility-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'

describe('parseEligibilityRuleSet', () => {
  it('accepts a well-formed versioned ruleset', () => {
    const parsed = parseEligibilityRuleSet({
      version: 1,
      rules: [
        { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
        { id: 'bd_cancer', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
      ],
    })
    expect(parsed.version).toBe(1)
    expect(parsed.rules).toHaveLength(2)
  })
  it('rejects unknown operators and missing reasons (typo-silent Json dies here)', () => {
    expect(() => parseEligibilityRuleSet({ version: 1, rules: [{ id: 'x', subject: 'product', fact: 'age', op: 'gt!', value: 1, reason: 'r' }] })).toThrow()
    expect(() => parseEligibilityRuleSet({ version: 1, rules: [{ id: 'x', subject: 'product', fact: 'age', op: 'gte', value: 1 }] })).toThrow()
  })
  it('rejects legacy informal shapes (minAge/maxAge keys) so old seeds cannot silently pass', () => {
    expect(() => parseEligibilityRuleSet({ minAge: 18, maxAge: 64 })).toThrow()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/eligibility-schema.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation (zod v4 is in package.json):
```ts
import { z } from 'zod'

export const EligibilityRuleSchema = z.object({
  id: z.string().min(1),
  subject: z.enum(['product', 'addon']),
  fact: z.string().min(1),          // 'age' | 'residency' | 'answer:<code>' | future facts
  op: z.enum(['gte', 'lte', 'between', 'equals', 'in', 'is_false', 'is_true']),
  value: z.unknown().optional(),
  reason: z.string().regex(/^[a-z0-9_]+$/), // stable snake_case ReasonCode (M6)
})
export const EligibilityRuleSetSchema = z.object({
  version: z.number().int().positive(),
  rules: z.array(EligibilityRuleSchema),
  narrative: z.unknown().optional(), // authored presentation text, never evaluated
}).strict()

export type EligibilityRule = z.infer<typeof EligibilityRuleSchema>
export type EligibilityRuleSet = z.infer<typeof EligibilityRuleSetSchema>

export function parseEligibilityRuleSet(raw: unknown): EligibilityRuleSet {
  return EligibilityRuleSetSchema.parse(raw)
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/eligibility-schema.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): typed versioned eligibility rule schema"`

### Task C2.2: evaluateEligibility — pure, three-valued
**Files:**
- Modify: lib/engines/eligibility.ts
- Test: __tests__/lib/engines/evaluate-eligibility.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test from fact literals:
```ts
import { describe, it, expect } from 'vitest'
import { evaluateEligibility, type EligibilityRuleSet } from '@/lib/engines/eligibility'

const RULES: EligibilityRuleSet = {
  version: 1,
  rules: [
    { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
    { id: 'max_age', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    { id: 'bd_cancer', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
    { id: 'addon_age', subject: 'addon', fact: 'age', op: 'between', value: [18, 64], reason: 'addon_age_band_unavailable' },
  ],
}

describe('evaluateEligibility', () => {
  it('age 70 → ineligible with failedRules carrying the stable reason', () => {
    const r = evaluateEligibility(RULES, { age: 70 }, 'product')
    expect(r.verdict).toBe('ineligible')
    expect(r.failedRules).toContainEqual(expect.objectContaining({ reason: 'ineligible_age_maximum' }))
  })
  it('age unknown → unknown verdict with missingFacts (NEVER a silent age-30 fallback)', () => {
    const r = evaluateEligibility(RULES, {}, 'product')
    expect(r.verdict).toBe('unknown')
    expect(r.missingFacts).toContain('age')
    expect(r.failedRules).toEqual([])
  })
  it('all product facts pass → eligible even while addon facts are missing (subject scoping)', () => {
    const r = evaluateEligibility(RULES, { age: 30 }, 'product')
    expect(r.verdict).toBe('eligible')
  })
  it('addon: bd yes → ineligible regardless of other rules; bd unanswered → unknown', () => {
    expect(evaluateEligibility(RULES, { age: 30, 'answer:BD_CANCER_HISTORY': 'true' }, 'addon').verdict).toBe('ineligible')
    expect(evaluateEligibility(RULES, { age: 30 }, 'addon').verdict).toBe('unknown')
  })
  it('a failed rule wins over missing facts (ineligible beats unknown — early decisive signal)', () => {
    const r = evaluateEligibility(RULES, { 'answer:BD_CANCER_HISTORY': 'true' }, 'addon')
    expect(r.verdict).toBe('ineligible')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/evaluate-eligibility.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation (append to lib/engines/eligibility.ts):
```ts
export type EligibilityVerdict = 'eligible' | 'ineligible' | 'unknown'
export type KnownFacts = Record<string, string | number | boolean | null | undefined>
export interface EligibilityResult {
  verdict: EligibilityVerdict
  failedRules: { rule: EligibilityRule; reason: string }[]
  missingFacts: string[]
}

function normalizeBoolean(v: string | number | boolean): string | null {
  const lower = String(v).toLowerCase().trim()
  if (['true', 'yes', 'da', '1'].includes(lower)) return 'true'
  if (['false', 'no', 'nu', '0'].includes(lower)) return 'false'
  return null
}

function ruleHolds(rule: EligibilityRule, fact: string | number | boolean): boolean {
  switch (rule.op) {
    case 'gte': return Number(fact) >= Number(rule.value)
    case 'lte': return Number(fact) <= Number(rule.value)
    case 'between': {
      const [lo, hi] = rule.value as [number, number]
      return Number(fact) >= lo && Number(fact) <= hi
    }
    case 'equals': return String(fact) === String(rule.value)
    case 'in': return (rule.value as unknown[]).map(String).includes(String(fact))
    case 'is_false': return normalizeBoolean(fact) === 'false'
    case 'is_true': return normalizeBoolean(fact) === 'true'
  }
}

export function evaluateEligibility(
  ruleSet: EligibilityRuleSet,
  knownFacts: KnownFacts,
  subject?: 'product' | 'addon',
): EligibilityResult {
  const rules = subject ? ruleSet.rules.filter(r => r.subject === subject) : ruleSet.rules
  const failedRules: EligibilityResult['failedRules'] = []
  const missingFacts: string[] = []
  for (const rule of rules) {
    const fact = knownFacts[rule.fact]
    if (fact === null || fact === undefined) { missingFacts.push(rule.fact); continue }
    if (!ruleHolds(rule, fact)) failedRules.push({ rule, reason: rule.reason })
  }
  const verdict: EligibilityVerdict =
    failedRules.length > 0 ? 'ineligible' : missingFacts.length > 0 ? 'unknown' : 'eligible'
  return { verdict, failedRules, missingFacts: [...new Set(missingFacts)] }
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/evaluate-eligibility.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): pure three-valued evaluateEligibility"`

### Task C2.3: Derived eligibility_bounds for presentation
**Files:**
- Modify: lib/engines/eligibility.ts (deriveEligibilityBounds), lib/tools/shape-product-info.ts (bounds in the product-info payload come from the derivation, not authored numbers)
- Test: __tests__/lib/engines/eligibility-bounds.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { deriveEligibilityBounds, type EligibilityRuleSet } from '@/lib/engines/eligibility'

describe('deriveEligibilityBounds', () => {
  it('derives numeric age bounds from gte/lte/between product rules', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'a', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
      { id: 'b', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 18, maxAge: 64 })
  })
  it('returns nulls when no age rules exist (presentation must not invent numbers)', () => {
    expect(deriveEligibilityBounds({ version: 1, rules: [] })).toEqual({ minAge: null, maxAge: null })
  })
  it('between rule contributes both bounds', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'c', subject: 'product', fact: 'age', op: 'between', value: [21, 60], reason: 'ineligible_age' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 21, maxAge: 60 })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/eligibility-bounds.test.ts` — expect FAIL.
- [ ] Step 3: Implement:
```ts
export function deriveEligibilityBounds(ruleSet: EligibilityRuleSet): { minAge: number | null; maxAge: number | null } {
  let minAge: number | null = null
  let maxAge: number | null = null
  for (const r of ruleSet.rules) {
    if (r.subject !== 'product' || r.fact !== 'age') continue
    if (r.op === 'gte') minAge = Math.max(minAge ?? -Infinity, Number(r.value))
    if (r.op === 'lte') maxAge = Math.min(maxAge ?? Infinity, Number(r.value))
    if (r.op === 'between') {
      const [lo, hi] = r.value as [number, number]
      minAge = Math.max(minAge ?? -Infinity, lo)
      maxAge = Math.min(maxAge ?? Infinity, hi)
    }
  }
  return { minAge: minAge === null ? null : minAge, maxAge: maxAge === null ? null : maxAge }
}
```
Then in lib/tools/shape-product-info.ts: wherever the payload exposes eligibility age numbers, parse `product.eligibility` with `parseEligibilityRuleSet` and emit `eligibility_bounds: deriveEligibilityBounds(ruleSet)`; the authored `narrative` key passes through as prose. No other numeric eligibility source remains in the shaping path (kills presentation drift per #9 rule 3).
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/eligibility-bounds.test.ts && npx vitest run __tests__/lib/tools` — expect PASS (update shape-product-info tests for the new bounds shape).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): eligibility_bounds derived from rules; presentation numbers single-sourced"`

### Task C2.4: Addon age-band no-match = ineligibility, never silent price 0
**Files:**
- Modify: lib/engines/eligibility.ts (deriveAddonAgeRules), lib/engines/quote-engine.ts (calculateQuote throws when includesAddon && addonPricingRule null — the upstream gate must have caught it)
- Test: __tests__/lib/engines/addon-eligibility.test.ts (+ extend __tests__/lib/engines/quote-engine.test.ts)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { deriveAddonAgeRules, evaluateEligibility } from '@/lib/engines/eligibility'
import { calculateQuote, type QuoteInput } from '@/lib/engines/quote-engine'

describe('deriveAddonAgeRules', () => {
  it('derives one between-rule spanning the seeded band envelope (18..64)', () => {
    const bands = [
      { minAge: 18, maxAge: 30 }, { minAge: 31, maxAge: 45 }, { minAge: 46, maxAge: 64 },
    ]
    const rules = deriveAddonAgeRules(bands)
    expect(rules).toEqual([{ id: 'addon_age_band', subject: 'addon', fact: 'age', op: 'between', value: [18, 64], reason: 'addon_age_band_unavailable' }])
    const r = evaluateEligibility({ version: 1, rules }, { age: 70 }, 'addon')
    expect(r.verdict).toBe('ineligible')
    expect(r.failedRules[0].reason).toBe('addon_age_band_unavailable')
  })
})

describe('calculateQuote addon invariant', () => {
  const base: QuoteInput = {
    tierCode: 'standard', levelCode: 'level_1', customerAge: 70, includesAddon: true,
    paymentFrequency: 'annual',
    pricingLevel: { premiumAnnual: 1000, name: { en: 'I', ro: 'I' } },
    pricingTier: { name: { en: 'Standard', ro: 'Standard' } },
    baseCoverages: [], addonPricingRule: null, addonCoverages: [], quoteValidityDays: 30,
  }
  it('throws instead of silently pricing the addon at 0 when no age band matched', () => {
    expect(() => calculateQuote(base)).toThrow(/addon_age_band_unavailable/)
  })
  it('still prices addon-free quotes with a null rule', () => {
    expect(() => calculateQuote({ ...base, includesAddon: false })).not.toThrow()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/addon-eligibility.test.ts` — expect FAIL.
- [ ] Step 3: Implement. (a) eligibility.ts:
```ts
export function deriveAddonAgeRules(bands: { minAge: number; maxAge: number }[]): EligibilityRule[] {
  if (bands.length === 0) return []
  const lo = Math.min(...bands.map(b => b.minAge))
  const hi = Math.max(...bands.map(b => b.maxAge))
  return [{ id: 'addon_age_band', subject: 'addon', fact: 'age', op: 'between', value: [lo, hi], reason: 'addon_age_band_unavailable' }]
}
```
(b) quote-engine.ts — at the top of calculateQuote:
```ts
if (input.includesAddon && input.addonPricingRule === null) {
  throw new Error('addon_age_band_unavailable: includesAddon=true but no AddonPricingRule matched customerAge — the eligibility gate must reject before pricing')
}
```
(The D1 generate_quote gate calls evaluateEligibility first, so this throw is a last-line invariant, not the UX path.)
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/addon-eligibility.test.ts __tests__/lib/engines/quote-engine.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "fix(engines): addon age-band no-match is an ineligibility fact, never silent price 0"`

### Task C2.5: Seed protect's typed ruleset from the existing eligibility content
**Files:**
- Modify: prisma/seeds/seed-product.ts (both protect eligibility blocks at :146-152 and :478-484)
- Test: __tests__/lib/products/protect-eligibility-seed.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test against the exported seed constant (export `PROTECT_ELIGIBILITY` from seed-product.ts):
```ts
import { describe, it, expect } from 'vitest'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'
import { parseEligibilityRuleSet, evaluateEligibility, deriveEligibilityBounds } from '@/lib/engines/eligibility'

describe('protect eligibility seed', () => {
  it('parses under the typed schema (no informal keys survive)', () => {
    expect(() => parseEligibilityRuleSet(PROTECT_ELIGIBILITY)).not.toThrow()
  })
  it('preserves the existing business content: ages 18..64, Romania residency', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(deriveEligibilityBounds(rs)).toEqual({ minAge: 18, maxAge: 64 })
    expect(evaluateEligibility(rs, { age: 30, residency: 'Romania' }, 'product').verdict).toBe('eligible')
    expect(evaluateEligibility(rs, { age: 17, residency: 'Romania' }, 'product').verdict).toBe('ineligible')
    expect(evaluateEligibility(rs, { age: 30, residency: 'Germany' }, 'product').verdict).toBe('ineligible')
  })
  it('carries the addon medical rules: any bd yes → addon ineligible', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    const facts = { age: 30, 'answer:BD_TRANSPLANT': 'true' }
    expect(evaluateEligibility(rs, facts, 'addon').verdict).toBe('ineligible')
  })
  it('keeps the authored narrative for presentation', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(rs.narrative).toBeDefined() // 50,000 EUR cumulative-sum note etc.
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/products/protect-eligibility-seed.test.ts` — expect FAIL.
- [ ] Step 3: Implement in seed-product.ts — export and use:
```ts
export const PROTECT_ELIGIBILITY = {
  version: 1,
  rules: [
    { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
    { id: 'max_age', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    { id: 'residency', subject: 'product', fact: 'residency', op: 'equals', value: 'Romania', reason: 'ineligible_residency' },
    ...['BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT']
      .map(c => ({ id: `bd_${c.toLowerCase()}`, subject: 'addon' as const, fact: `answer:${c}`, op: 'is_false' as const, reason: 'addon_ineligible_medical_history' })),
    { id: 'addon_age_band', subject: 'addon', fact: 'age', op: 'between', value: [18, 64], reason: 'addon_age_band_unavailable' }, // mirrors seeded AddonPricingRule bands 18..64
  ],
  narrative: {
    healthRequirements: 'Simplified health declaration',
    notes: 'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
  },
}
```
and set `eligibility: PROTECT_ELIGIBILITY` in BOTH protect product upsert blocks (146-152, 478-484).
- [ ] Step 4: Run `npx vitest run __tests__/lib/products/protect-eligibility-seed.test.ts` — expect PASS; then `npx tsx prisma/seeds/index.ts` and confirm reseed succeeds.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(seeds): protect eligibility as typed versioned ruleset (content preserved)"`

### Task C2.6: Wire the discovery verdict into DerivedStateV3 + export the generate_quote gate contract
**Files:**
- Modify: lib/engines/derive-and-expose.ts (A1 artifact: DerivedStateV3.eligibility = evaluateEligibility(rules, factsFromSnapshot) during DISCOVERY and beyond)
- Modify: lib/engines/eligibility.ts (gateQuoteEligibility export for D1)
- Test: __tests__/lib/engines/eligibility-consumption.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (pure, snapshot literals):
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose' // A1 artifact
import { gateQuoteEligibility } from '@/lib/engines/eligibility'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'
import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'
import { makeSnapshot } from '../../helpers/snapshot-fixtures' // A1's test fixture helper

describe('eligibility consumption points', () => {
  it('DerivedStateV3 carries the discovery verdict: unknown age → unknown, age 70 → ineligible', () => {
    const unknown = deriveAndExpose(makeSnapshot({ profile: { age: null } }))
    expect(unknown.state.eligibility.verdict).toBe('unknown')
    expect(unknown.state.eligibility.missingFacts).toContain('age')
    const old = deriveAndExpose(makeSnapshot({ profile: { age: 70 } }))
    expect(old.state.eligibility.verdict).toBe('ineligible')
  })
  it('gateQuoteEligibility maps verdicts onto the pinned CommitResult vocabulary for D1', () => {
    const rules = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(gateQuoteEligibility(rules, { age: 30, residency: 'Romania' }, false)).toEqual({ ok: true })
    const rej = gateQuoteEligibility(rules, { age: 70, residency: 'Romania' }, false)
    expect(rej).toEqual({ ok: false, outcome: 'rejected', reason: 'ineligible_age_maximum', params: expect.any(Object) })
    const unk = gateQuoteEligibility(rules, { residency: 'Romania' }, false)
    expect(unk).toEqual({ ok: false, outcome: 'requires_identity', reason: 'eligibility_facts_missing', params: { needs: ['age'] } })
  })
  it('addon facts are demanded only when includesAddon', () => {
    const rules = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    const r = gateQuoteEligibility(rules, { age: 30, residency: 'Romania' }, true)
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'eligibility_facts_missing' })) // bd answers missing
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/eligibility-consumption.test.ts` — expect FAIL.
- [ ] Step 3: Implement. (a) gateQuoteEligibility in eligibility.ts:
```ts
export type QuoteEligibilityGate =
  | { ok: true }
  | { ok: false; outcome: 'rejected'; reason: string; params: Record<string, unknown> }
  | { ok: false; outcome: 'requires_identity'; reason: 'eligibility_facts_missing'; params: { needs: string[] } }

/** Final-authority gate for generate_quote (D1 is the host; this is the whole decision). */
export function gateQuoteEligibility(
  ruleSet: EligibilityRuleSet,
  knownFacts: KnownFacts,
  includesAddon: boolean,
): QuoteEligibilityGate {
  const product = evaluateEligibility(ruleSet, knownFacts, 'product')
  if (product.verdict === 'ineligible') {
    return { ok: false, outcome: 'rejected', reason: product.failedRules[0].reason, params: { failedRules: product.failedRules.map(f => f.rule.id) } }
  }
  const addon = includesAddon ? evaluateEligibility(ruleSet, knownFacts, 'addon') : null
  if (addon?.verdict === 'ineligible') {
    return { ok: false, outcome: 'rejected', reason: addon.failedRules[0].reason, params: { failedRules: addon.failedRules.map(f => f.rule.id) } }
  }
  const missing = [...product.missingFacts, ...(addon?.missingFacts ?? [])]
  if (missing.length > 0) {
    return { ok: false, outcome: 'requires_identity', reason: 'eligibility_facts_missing', params: { needs: [...new Set(missing)] } }
  }
  return { ok: true }
}
```
(b) In deriveAndExpose: parse the candidate/selected product's eligibility ruleset once and set `state.eligibility = evaluateEligibility(rules, factsFromSnapshot)` where factsFromSnapshot = { age: profile-derived age (B0 derivation — DOB or declaredAge, NEVER a stored snapshot or a 30-fallback), residency, plus `answer:<code>` entries from active answers }. D1 will call gateQuoteEligibility inside generate_quote; its rejected reasons are BY CONSTRUCTION the same failedRules reasons (one predicate, three data-completeness levels).
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/eligibility-consumption.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): discovery eligibility verdict in DerivedStateV3 + generate_quote gate contract for D1"`

### Task C2.7: Package verification
**Files:**
- Create: scripts/verify-eligibility.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-eligibility.ts: load the seeded protect Product row from the dev DB, `parseEligibilityRuleSet(product.eligibility)` (proves the live row parses, not just the constant), evaluate the matrix { age: 17 | 30 | 70 | undefined } x { product, addon } and print verdict+reasons; assert AddonPricingRule rows' band envelope equals the addon_age_band rule value (drift check between pricing bands and the rule); exit 1 on any mismatch.
- [ ] Step 2: Run `npx tsx prisma/seeds/index.ts && npx tsx scripts/verify-eligibility.ts` — expect `PASS` and the printed matrix matching: 17→ineligible, 30→eligible, 70→ineligible, undefined→unknown.
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (instrumentation flake exempt when sole failure).
- [ ] Step 4: Grep guard — confirm the age-30 fallback is dead: `git grep -n "customerAge = 30" -- lib` returns nothing (D1 owns the generate_quote rewrite, but the fallback line must already be unreachable through the gate; if D1 has not landed yet, record the grep result in the PR description as a D1 handoff item instead of failing).
- [ ] Step 5: Commit: `git add -A && git commit -m "test(verify): live eligibility matrix verification script"`

### ⚠ Binding errata for C2 (fidelity verifier — apply OVER the task text above)

1. **[C2 (package scope) — T6.D5 / contradiction #9 closure]** T6.D5's ✅ option states 'check_bd_eligibility is eliminated as a tool — its rule moves into product data', and contradiction #9 pins 'exactly three call points — nothing else evaluates eligibility'. The plan leaves check_bd_eligibility fully alive: registered at lib/tools/registry.ts:922 with its silent application.includesAddon=false mutation at lib/tools/handlers/bd-handlers.ts:58-65 — a fourth eligibility evaluation point AND a selection write outside select_coverage/the planner (violating contradiction #4 rule 3), surviving every C package.
   **Fix:** Add a task (natural home: end of C1.6 or a C2 task) that deletes the check_bd_eligibility registry entry, bd-handlers.ts handler, and its tests, with a grep-based closure step (git grep check_bd_eligibility returns nothing in lib/) — or, if tool retirement is owned by the tool-mapping block, add an explicit depends_on/handoff note naming the owning package so the silent-mutation hole is not orphaned.
2. **[C2.6/Step 1+3 (gateQuoteEligibility)]** Missing addon answer-facts (unanswered bd_* questions) are mapped to outcome 'requires_identity' with reason eligibility_facts_missing. Contradiction #1 defines requires_identity's vocabulary as identity-requirements-table needs (e.g. {needs:['verified:cnp']}, declared fields, tiers); unanswered questionnaire questions are questionnaire incompleteness, not identity. The test pins this misuse ('addon facts are demanded only when includesAddon' expects requires_identity).
   **Fix:** Split the missing-facts branch: identity-class facts (age, residency) → { ok:false, outcome:'requires_identity', reason:'eligibility_facts_missing', params:{needs} }; missing 'answer:*' facts → { ok:false, outcome:'rejected', reason:'eligibility_facts_missing', params:{needs} } (defense-in-depth only — legality already keeps generate_quote unexposed while the questionnaire is incomplete). Update the third test case accordingly.
3. **[C2.6/Step 3 (deriveAndExpose wiring) — T11.D4 fidelity]** T11.D4's ✅ option requires the discovery verdict to land 'in the injected state grounding AND in available/blocked_actions (set_application blocked with reason ineligible_age)'. C2.6 only sets state.eligibility; no C task (and none referenced in another block by this plan) wires the ineligible verdict into ExposedActions.blocked for set_application.
   **Fix:** In C2.6 step 3(b), also add the exposure rule inside deriveAndExpose: when state.eligibility.verdict === 'ineligible', emit blocked: { action: 'set_application', reason: <first failedRule reason, e.g. ineligible_age_maximum> }; extend the C2.6 test to assert deriveAndExpose(makeSnapshot({ profile:{ age:70 }})).actions.blocked contains it — or name the A-block package that owns this wiring in depends_on.
4. **[C2.4/Step 3(a) + C2.7/Step 1 (deriveAddonAgeRules envelope)]** Deriving one between-rule from min(minAge)..max(maxAge) over the bands treats any hole between bands as eligible (e.g. bands {18-30},{46-64} would wrongly pass age 35), and the C2.7 drift check only compares envelopes. Today's seeded bands (18-30/31-45/46-55/56-64, verified at seed-product.ts:~977) are contiguous, so this is latent — but the calculateQuote throw would then be the UX path, contradicting #9's 'ineligibility fact, never silent/exception' intent.
   **Fix:** Either derive per-band rules ORed via an 'in_ranges' value (one rule with value [[18,30],[31,45],[46,55],[56,64]] and a matching op), or keep the envelope but add a contiguity assertion: deriveAddonAgeRules throws on gaps, and scripts/verify-eligibility.ts asserts band contiguity in addition to the envelope match.
5. **[C1.5/C2.6/C3.4 (ReasonCode registration)]** The packages mint many new reason codes (validity_dependency_changed, removed_by_branch, addon_ineligible_medical_history, ineligible_age_minimum/maximum, ineligible_residency, addon_age_band_unavailable, eligibility_facts_missing, suitability_warning_unacknowledged, no_suitability_warning_pending, product_has_no_investment_component, severe_conditions_demand_needs_addon, one_facet_per_commit, quote not least) but no task registers them with A1's ReasonCode registry, which the pinned contracts say A1 owns ('ReasonCode = stable snake_case codes + params'). If A1's ReasonCode is a closed union/registry (likely, given the M6 i18n key-per-code rendering), the C handlers won't compile or the GUI renderer will miss keys.
   **Fix:** Add to each task that introduces codes a sub-step: 'register the new codes in A1's ReasonCode registry module (and the translations.ts key stubs per M6)', listing the exact codes per task; note the dependency on A1's registry file by name.

## Package C3: Suitability engine (demands-and-needs, M7)

**Execution slot:** 14 | **Depends on:** A1, B2, C2

**Goal:** A pure evaluateSuitability(rules, dntFacts) sibling of evaluateEligibility; verdict in DerivedStateV3 post-sign_dnt; SuitabilityWarningAck commit for the documented-warning flow (hard-block vs warn-and-allow per product config); the suitability report generated at quote issuance from the same verdict via D2's Document registry. v1 protect rules are mechanically real but content-flagged for compliance input.

**Migrations / seeds:**
- NEW model SuitabilityWarningAck { id, customerId, applicationId, productCode, ruleSetVersion Int, mismatches Json, acknowledgedAt DateTime @default(now()), sourceCommitId String } with @@unique([customerId, applicationId, ruleSetVersion]) — sibling of DisclosureAck (D-block)
- Product: add column suitabilityRules Json? — typed SuitabilityRuleSet { version, mode: 'hard_block'|'warn_and_allow', rules: [...] }
- prisma/seeds/seed-product.ts: seed protect suitabilityRules (v1 content below, flagged `// COMPLIANCE INPUT REQUIRED` per M7.4): mode 'warn_and_allow'; rule investment_demand (fact DNT_LIFE_SUBTYPE equals financial_and_investment → mismatch, reason product_has_no_investment_component); rule severe_conditions_demand (fact DNT_LIFE_SEVERE_CONDITIONS equals yes → conditional, reason severe_conditions_demand_needs_addon)
- Reseed: npx prisma migrate reset --force + npx tsx prisma/seeds/index.ts (demo data)

### Task C3.1: Typed suitability rules + pure evaluateSuitability
**Files:**
- Create: lib/engines/suitability.ts
- Test: __tests__/lib/engines/suitability.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test from dnt-fact literals (T12.D3 pure seam):
```ts
import { describe, it, expect } from 'vitest'
import { evaluateSuitability, parseSuitabilityRuleSet, type SuitabilityRuleSet } from '@/lib/engines/suitability'

const RULES: SuitabilityRuleSet = {
  version: 1,
  mode: 'warn_and_allow',
  rules: [
    { id: 'investment_demand', fact: 'DNT_LIFE_SUBTYPE', op: 'equals', value: 'financial_and_investment', whenMatched: 'mismatch', reason: 'product_has_no_investment_component' },
    { id: 'severe_conditions_demand', fact: 'DNT_LIFE_SEVERE_CONDITIONS', op: 'equals', value: 'yes', whenMatched: 'conditional', reason: 'severe_conditions_demand_needs_addon' },
  ],
}

describe('evaluateSuitability', () => {
  it('no rule fires → suitable, zero mismatches', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' })
    expect(r).toEqual({ verdict: 'suitable', mismatches: [] })
  })
  it('a mismatch rule fires → unsuitable with the stable reason code', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'financial_and_investment' })
    expect(r.verdict).toBe('unsuitable')
    expect(r.mismatches).toContainEqual(expect.objectContaining({ reason: 'product_has_no_investment_component' }))
  })
  it('only conditional rules fire → conditionally_suitable', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('conditionally_suitable')
    expect(r.mismatches).toHaveLength(1)
  })
  it('mismatch beats conditional when both fire', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'financial_and_investment', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('unsuitable')
    expect(r.mismatches).toHaveLength(2)
  })
  it('missing facts never fire rules (sign_dnt guarantees the visible DNT set is complete)', () => {
    expect(evaluateSuitability(RULES, {}).verdict).toBe('suitable')
  })
})

describe('parseSuitabilityRuleSet', () => {
  it('rejects unknown modes and ops', () => {
    expect(() => parseSuitabilityRuleSet({ version: 1, mode: 'maybe', rules: [] })).toThrow()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/suitability.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation lib/engines/suitability.ts:
```ts
import { z } from 'zod'

export const SuitabilityRuleSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(1),                          // DNT question code
  op: z.enum(['equals', 'in', 'not_in']),
  value: z.unknown(),
  whenMatched: z.enum(['mismatch', 'conditional']),
  reason: z.string().regex(/^[a-z0-9_]+$/),          // stable snake_case (M6)
})
export const SuitabilityRuleSetSchema = z.object({
  version: z.number().int().positive(),
  mode: z.enum(['hard_block', 'warn_and_allow']),    // product config field (M7.2)
  rules: z.array(SuitabilityRuleSchema),
}).strict()
export type SuitabilityRule = z.infer<typeof SuitabilityRuleSchema>
export type SuitabilityRuleSet = z.infer<typeof SuitabilityRuleSetSchema>
export function parseSuitabilityRuleSet(raw: unknown): SuitabilityRuleSet {
  return SuitabilityRuleSetSchema.parse(raw)
}

export type SuitabilityVerdict = 'suitable' | 'conditionally_suitable' | 'unsuitable'
export interface SuitabilityResult {
  verdict: SuitabilityVerdict
  mismatches: { rule: SuitabilityRule; reason: string }[]
}

function fires(rule: SuitabilityRule, fact: string | undefined): boolean {
  if (fact === undefined || fact === null) return false
  switch (rule.op) {
    case 'equals': return fact === String(rule.value)
    case 'in': return (rule.value as unknown[]).map(String).includes(fact)
    case 'not_in': return !(rule.value as unknown[]).map(String).includes(fact)
  }
}

export function evaluateSuitability(
  ruleSet: SuitabilityRuleSet,
  dntFacts: Record<string, string>,
): SuitabilityResult {
  const mismatches: SuitabilityResult['mismatches'] = []
  let hardMismatch = false
  for (const rule of ruleSet.rules) {
    if (!fires(rule, dntFacts[rule.fact])) continue
    mismatches.push({ rule, reason: rule.reason })
    if (rule.whenMatched === 'mismatch') hardMismatch = true
  }
  const verdict: SuitabilityVerdict =
    mismatches.length === 0 ? 'suitable' : hardMismatch ? 'unsuitable' : 'conditionally_suitable'
  return { verdict, mismatches }
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/suitability.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): pure suitability engine (demands-and-needs), sibling of eligibility"`

### Task C3.2: Protect v1 ruleset seed + Product.suitabilityRules column
**Files:**
- Modify: prisma/schema.prisma (Product.suitabilityRules Json?), prisma/seeds/seed-product.ts (export PROTECT_SUITABILITY, set on both protect upserts, flag for compliance)
- Test: __tests__/lib/products/protect-suitability-seed.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { PROTECT_SUITABILITY } from '@/prisma/seeds/seed-product'
import { parseSuitabilityRuleSet, evaluateSuitability } from '@/lib/engines/suitability'

describe('protect suitability seed (v1 — content flagged for compliance input)', () => {
  it('parses under the typed schema with warn_and_allow mode', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(rs.mode).toBe('warn_and_allow')
    expect(rs.version).toBe(1)
  })
  it('investment demand → unsuitable (protect has no investment component)', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'financial_and_investment' }).verdict).toBe('unsuitable')
  })
  it('severe-conditions demand → conditionally_suitable (BD addon is the conditional fit)', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    const r = evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('conditionally_suitable')
    expect(r.mismatches[0].reason).toBe('severe_conditions_demand_needs_addon')
  })
  it('simple protection demand → suitable', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' }).verdict).toBe('suitable')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/products/protect-suitability-seed.test.ts` — expect FAIL.
- [ ] Step 3: Implement: schema `suitabilityRules Json?` on Product + `npx prisma migrate dev --name add_product_suitability_rules && npx prisma generate`; seed-product.ts:
```ts
// COMPLIANCE INPUT REQUIRED (M7.4): v1 rule content is a mechanical placeholder validated by the
// engine tests; the demands-and-needs mapping must be confirmed by compliance before production.
export const PROTECT_SUITABILITY = {
  version: 1,
  mode: 'warn_and_allow',
  rules: [
    { id: 'investment_demand', fact: 'DNT_LIFE_SUBTYPE', op: 'equals', value: 'financial_and_investment', whenMatched: 'mismatch', reason: 'product_has_no_investment_component' },
    { id: 'severe_conditions_demand', fact: 'DNT_LIFE_SEVERE_CONDITIONS', op: 'equals', value: 'yes', whenMatched: 'conditional', reason: 'severe_conditions_demand_needs_addon' },
  ],
}
```
set `suitabilityRules: PROTECT_SUITABILITY` in both protect upsert blocks.
- [ ] Step 4: Run `npx vitest run __tests__/lib/products/protect-suitability-seed.test.ts` — expect PASS; `npx tsx prisma/seeds/index.ts` reseeds cleanly.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(seeds): protect v1 suitability ruleset (compliance-input flagged)"`

### Task C3.3: Suitability verdict in DerivedStateV3 post-sign_dnt
**Files:**
- Modify: lib/engines/derive-and-expose.ts (A1 artifact: state.suitability populated when snapshot.dnt.signed and product rules exist; null before)
- Test: __tests__/lib/engines/suitability-derived-state.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (pure snapshot literals; dnt facts come from B1's customer-scoped Dnt aggregate in the snapshot):
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../../helpers/snapshot-fixtures' // A1 fixture helper
import { PROTECT_SUITABILITY } from '@/prisma/seeds/seed-product'

describe('DerivedStateV3.suitability', () => {
  it('is null before sign_dnt (no fit claims possible)', () => {
    const { state } = deriveAndExpose(makeSnapshot({ dnt: { signed: false, facts: {} }, product: { suitabilityRules: PROTECT_SUITABILITY } }))
    expect(state.suitability).toBeNull()
  })
  it('carries the verdict + mismatches after sign_dnt', () => {
    const { state } = deriveAndExpose(makeSnapshot({
      dnt: { signed: true, facts: { DNT_LIFE_SUBTYPE: 'financial_and_investment' } },
      product: { suitabilityRules: PROTECT_SUITABILITY },
    }))
    expect(state.suitability?.verdict).toBe('unsuitable')
    expect(state.suitability?.mismatches[0].reason).toBe('product_has_no_investment_component')
  })
  it('suitable path: clean facts → suitable verdict (the engine-gated source for any agent fit claim — prompt invariant lands in A4)', () => {
    const { state } = deriveAndExpose(makeSnapshot({
      dnt: { signed: true, facts: { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' } },
      product: { suitabilityRules: PROTECT_SUITABILITY },
    }))
    expect(state.suitability?.verdict).toBe('suitable')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/suitability-derived-state.test.ts` — expect FAIL.
- [ ] Step 3: Implement inside deriveAndExpose: when `snapshot.dnt.signed === true` and the focused product carries suitabilityRules, set `state.suitability = evaluateSuitability(parseSuitabilityRuleSet(product.suitabilityRules), snapshot.dnt.facts)`; otherwise `state.suitability = null`. dnt.facts is the questionCode→value record from B1's Dnt aggregate (already in the DomainSnapshot per the pinned contract). Add `suitability: SuitabilityResult | null` to DerivedStateV3 if A1 stubbed it as unknown.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/suitability-derived-state.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): suitability verdict derived into DerivedStateV3 post-sign_dnt"`

### Task C3.4: SuitabilityWarningAck model + acknowledge_suitability_warning commit
**Files:**
- Modify: prisma/schema.prisma (SuitabilityWarningAck model)
- Create: lib/tools/handlers/suitability-handlers.ts (acknowledge_suitability_warning through the A2 gateway)
- Modify: lib/tools/registry.ts (register the commit)
- Test: __tests__/integration/suitability-ack.test.ts (real DB)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2 artifact
import { resetQuestionnaireTables, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetQuestionnaireTables()
  fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'financial_and_investment' }) // unsuitable facts
})

describe('acknowledge_suitability_warning', () => {
  it('persists the ack with the mismatches + ruleset version and ledger linkage', async () => {
    const res = await executeCommit({ tool: 'acknowledge_suitability_warning', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('applied')
    const ack = await prisma.suitabilityWarningAck.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(ack.ruleSetVersion).toBe(1)
    expect(ack.mismatches).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'product_has_no_investment_component' })]))
    expect(ack.sourceCommitId).toBeTruthy() // ledger row id — documented-warning audit trail
  })
  it('is idempotent: replay returns the original outcome, no second row (gateway #8 order)', async () => {
    await executeCommit({ tool: 'acknowledge_suitability_warning', actor: 'agent', conversationId: fx.conversationId, args: {} })
    const replay = await executeCommit({ tool: 'acknowledge_suitability_warning', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(replay.outcome).toBe('applied')
    expect(await prisma.suitabilityWarningAck.count({ where: { customerId: fx.customerId } })).toBe(1)
  })
  it('rejected when there is nothing to acknowledge (suitable verdict)', async () => {
    await resetQuestionnaireTables()
    const clean = await seedMinimalProtectFixture()
    await signDntWithFacts(clean, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' })
    const res = await executeCommit({ tool: 'acknowledge_suitability_warning', actor: 'agent', conversationId: clean.conversationId, args: {} })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('no_suitability_warning_pending')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/suitability-ack.test.ts` — expect FAIL.
- [ ] Step 3: Implement. (a) Schema:
```prisma
model SuitabilityWarningAck {
  id             String   @id @default(cuid())
  customerId     String
  applicationId  String
  productCode    String
  ruleSetVersion Int
  mismatches     Json
  acknowledgedAt DateTime @default(now())
  sourceCommitId String

  customer    Customer    @relation(fields: [customerId], references: [id])
  application Application @relation(fields: [applicationId], references: [id])

  @@unique([customerId, applicationId, ruleSetVersion])
}
```
`npx prisma migrate dev --name add_suitability_warning_ack && npx prisma generate`. (b) Handler (gateway-routed commit): legality predicate (exposed only when `state.suitability` verdict is unsuitable/conditionally_suitable AND no ack row exists for (customer, application, ruleSetVersion)); apply = create the row from the CURRENT engine verdict (never from agent-provided args — args are empty by design), sourceCommitId = the ledger row id the gateway minted; replay handled by the gateway args-hash. (c) Register `acknowledge_suitability_warning` in registry.ts as a commit with empty args schema.
- [ ] Step 4: Run `npx vitest run __tests__/integration/suitability-ack.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(compliance): SuitabilityWarningAck commit — documented-warning flow"`

### Task C3.5: gateSuitability contract for D1's generate_quote
**Files:**
- Modify: lib/engines/suitability.ts
- Test: __tests__/lib/engines/gate-suitability.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { gateSuitability, type SuitabilityRuleSet } from '@/lib/engines/suitability'

const warn: SuitabilityRuleSet = { version: 1, mode: 'warn_and_allow', rules: [
  { id: 'inv', fact: 'DNT_LIFE_SUBTYPE', op: 'equals', value: 'financial_and_investment', whenMatched: 'mismatch', reason: 'product_has_no_investment_component' },
] }
const hard: SuitabilityRuleSet = { ...warn, mode: 'hard_block' }
const unsuitableFacts = { DNT_LIFE_SUBTYPE: 'financial_and_investment' }

describe('gateSuitability (generate_quote gate — D1 host)', () => {
  it('suitable → ok', () => {
    expect(gateSuitability(warn, { DNT_LIFE_SUBTYPE: 'simple_protection' }, [])).toEqual({ ok: true })
  })
  it('warn mode + unacknowledged mismatch → blocked requires_disclosures with stable reason', () => {
    expect(gateSuitability(warn, unsuitableFacts, [])).toEqual({
      ok: false, outcome: 'requires_disclosures', reason: 'suitability_warning_unacknowledged',
      params: { mismatches: ['product_has_no_investment_component'], ruleSetVersion: 1 },
    })
  })
  it('warn mode + matching ack → ok (documented warning satisfied)', () => {
    expect(gateSuitability(warn, unsuitableFacts, [{ ruleSetVersion: 1 }])).toEqual({ ok: true })
  })
  it('stale ack (different ruleset version) does NOT satisfy the gate', () => {
    expect(gateSuitability(warn, unsuitableFacts, [{ ruleSetVersion: 0 }]).ok).toBe(false)
  })
  it('hard_block mode → rejected regardless of acks', () => {
    expect(gateSuitability(hard, unsuitableFacts, [{ ruleSetVersion: 1 }])).toEqual({
      ok: false, outcome: 'rejected', reason: 'product_has_no_investment_component',
      params: { mismatches: ['product_has_no_investment_component'], ruleSetVersion: 1 },
    })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/gate-suitability.test.ts` — expect FAIL.
- [ ] Step 3: Implement (append to suitability.ts):
```ts
export type SuitabilityGate =
  | { ok: true }
  | { ok: false; outcome: 'rejected' | 'requires_disclosures'; reason: string; params: { mismatches: string[]; ruleSetVersion: number } }

/** Final gate inside generate_quote (D1 wires it). compliance_block finally has a source (M7.2b). */
export function gateSuitability(
  ruleSet: SuitabilityRuleSet,
  dntFacts: Record<string, string>,
  acks: { ruleSetVersion: number }[],
): SuitabilityGate {
  const result = evaluateSuitability(ruleSet, dntFacts)
  if (result.verdict === 'suitable') return { ok: true }
  const params = { mismatches: result.mismatches.map(m => m.reason), ruleSetVersion: ruleSet.version }
  if (ruleSet.mode === 'hard_block' && result.verdict === 'unsuitable') {
    return { ok: false, outcome: 'rejected', reason: result.mismatches[0].reason, params }
  }
  const acked = acks.some(a => a.ruleSetVersion === ruleSet.version)
  if (!acked) return { ok: false, outcome: 'requires_disclosures', reason: 'suitability_warning_unacknowledged', params }
  return { ok: true }
}
```
D1 handoff note (record in PR description): generate_quote calls `gateSuitability(rules, snapshot.dnt.facts, acks)` after `gateQuoteEligibility`; a `requires_disclosures` result exposes acknowledge_suitability_warning in the next exposure set (legality predicate from C3.4).
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/gate-suitability.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(engines): gateSuitability contract — hard-block vs documented-warning for generate_quote"`

### Task C3.6: Suitability report generated at quote issuance (timing fix)
**Files:**
- Create: lib/compliance/suitability-report.ts (quote-keyed generator; reuses the PDF building blocks of lib/compliance/dnt-report.ts)
- Modify: lib/compliance/dnt-report.ts (extract shared helpers; the policyId-keyed entry stays until D1 removes its caller)
- Test: __tests__/integration/suitability-report.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { generateSuitabilityReport } from '@/lib/compliance/suitability-report'
import { resetQuestionnaireTables, seedMinimalProtectFixture, signDntWithFacts, issueTestQuote } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetQuestionnaireTables()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' })
})

describe('generateSuitabilityReport (quote-keyed — IDD timing: at quote issuance, not post-policy)', () => {
  it('produces a PDF buffer and registers a Document row keyed to the quote', async () => {
    const quoteId = await issueTestQuote(fx)
    const { buffer, documentId } = await generateSuitabilityReport(quoteId)
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } }) // D2 registry
    expect(doc.kind).toBe('suitability_report')
    expect(doc.refId).toBe(quoteId)
    expect(doc.language).toBe('ro')
  })
  it('embeds the engine verdict of record, not a recomputed-later one', async () => {
    const quoteId = await issueTestQuote(fx)
    const { meta } = await generateSuitabilityReport(quoteId)
    expect(meta.verdict).toBe('suitable')
    expect(meta.ruleSetVersion).toBe(1)
  })
  it('fails loudly when the quote does not exist (no silent skip)', async () => {
    await expect(generateSuitabilityReport('missing-quote-id')).rejects.toThrow()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/suitability-report.test.ts` — expect FAIL.
- [ ] Step 3: Implement lib/compliance/suitability-report.ts:
```ts
import { prisma } from '@/lib/db'
import { evaluateSuitability, parseSuitabilityRuleSet, type SuitabilityResult } from '@/lib/engines/suitability'
import { registerDocument } from '@/lib/documents/registry' // D2 artifact
// reuse the extracted PDF helpers (getLocalizedText, formatDate, formatCurrency, section builders)
import { buildSuitabilityPdf } from './dnt-report-pdf' // extracted from dnt-report.ts in this task

export async function generateSuitabilityReport(quoteId: string): Promise<{
  buffer: Buffer; documentId: string; meta: { verdict: SuitabilityResult['verdict']; ruleSetVersion: number }
}> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { product: true, customer: true, application: { include: { tier: true, level: true } } },
  })
  const ruleSet = parseSuitabilityRuleSet(quote.product.suitabilityRules)
  const dntFacts = await loadDntFacts(quote.customerId)            // B1 Dnt aggregate read
  const result = evaluateSuitability(ruleSet, dntFacts)
  const buffer = await buildSuitabilityPdf({ quote, dntFacts, result, language: 'ro' })
  const documentId = await registerDocument({
    kind: 'suitability_report', refId: quoteId, customerId: quote.customerId,
    language: 'ro', content: buffer, meta: { verdict: result.verdict, ruleSetVersion: ruleSet.version },
  })
  return { buffer, documentId, meta: { verdict: result.verdict, ruleSetVersion: ruleSet.version } }
}
```
Extract the reusable PDF sections from dnt-report.ts into dnt-report-pdf.ts (mechanical move; dnt-report.ts keeps its export delegating to the shared builder). `loadDntFacts` reads the customer-scoped Dnt answers via B1's aggregate. EXPLICIT NON-GOAL of this task (M9 coupled flip): lib/payments/post-payment.ts:73 still calls generateDntReport — D1's quote-issuance package wires `generateSuitabilityReport(quoteId)` into generate_quote's apply AND deletes the post-payment call in the same package, so there is never a window with zero or two report paths. Record this as a D1 handoff item in the PR description.
- [ ] Step 4: Run `npx vitest run __tests__/integration/suitability-report.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(compliance): quote-keyed suitability report via Document registry (issuance-time, D1 wires the flip)"`

### Task C3.7: Package verification
**Files:**
- Create: scripts/verify-suitability.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-suitability.ts: against the dev DB, (1) load protect's seeded suitabilityRules and assert they parse; (2) run a scripted unsuitable-facts flow through the gateway: sign DNT with DNT_LIFE_SUBTYPE financial_and_investment → assert DerivedStateV3.suitability.verdict === 'unsuitable' via deriveAndExpose → assert generate_quote exposure is blocked with reason suitability_warning_unacknowledged (read blocked_actions from the exposure output) → execute acknowledge_suitability_warning → assert the ack row + that the block reason is gone; (3) suitable-facts flow: verdict suitable, no ack required, generateSuitabilityReport returns a registered Document. Print PASS/FAIL per step, exit 1 on failure.
- [ ] Step 2: Run `npx prisma migrate reset --force && npx tsx prisma/seeds/index.ts && npx tsx scripts/verify-suitability.ts` — expect all steps PASS.
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (instrumentation flake exempt when sole failure).
- [ ] Step 4: Cross-check the M7 invariant handoffs are recorded: A4 owns the prompt invariant "never claim fit without state.suitability.verdict === 'suitable'" (add to the PR description as an A4 acceptance item); D1 owns gateSuitability + report-timing wiring (already noted in C3.5/C3.6).
- [ ] Step 5: Commit: `git add -A && git commit -m "test(verify): live suitability flow verification script"`

### ⚠ Binding errata for C3 (fidelity verifier — apply OVER the task text above)

1. **[C1.4/C1.5/C3.4/C3.6 (test helpers)]** Helper functions are imported in test code but never created by any task: loadSnapshot (C1.5 test, '../helpers/test-db'), signDntWithFacts (C3.4 + C3.6), issueTestQuote (C3.6). Additionally seedMinimalProtectFixture is specified in C1.4 as returning { conversationId, applicationId, questionIdByCode } with no parameters, but C1.5/C1.6/C3.6 call it with an options bag ({ tier, level, addon }) and C3.4 reads fx.customerId — neither the options parameter nor customerId is in the documented contract.
   **Fix:** Extend C1.4 step 3(c) to define seedMinimalProtectFixture(options?: { tier?: string; level?: string; addon?: boolean }) returning { conversationId, applicationId, customerId, questionIdByCode } and a loadSnapshot(conversationId) wrapper over A1's snapshot loader. Add an explicit step in C3.4 creating signDntWithFacts(fx, facts) (writes DNT answers via B1's aggregate + executes sign_dnt through the gateway) and in C3.6 creating issueTestQuote(fx) (drives generate_quote or inserts an ISSUED Quote row), each with the exact code.
2. **[C3.4/Files + C3.7/Step 1]** Two halves of the same gap: (a) C3.4 step 3(b) defines a legality predicate ('exposed only when state.suitability verdict is unsuitable/conditionally_suitable AND no ack row exists') but the Files list touches only schema/handler/registry — exposure predicates live in A1's deriveAndExpose/exposure module, which is not listed as Modified anywhere. (b) C3.7's verify script asserts generate_quote appears in blocked_actions with reason suitability_warning_unacknowledged — exposure behavior no task in any cited package builds (C3.5 only delivers the commit-side gateSuitability for D1).
   **Fix:** Add 'Modify: lib/engines/derive-and-expose.ts (A1 artifact: exposure predicate for acknowledge_suitability_warning + blocked generate_quote with reason suitability_warning_unacknowledged when verdict !== suitable and no matching ack)' to C3.4's Files and a test asserting both exposures from snapshot literals; then C3.7's script assertion becomes buildable. Alternatively relax C3.7 to assert the commit outcome (executeCommit generate_quote → requires_disclosures) and record the exposure wiring as a D1 handoff.
3. **[C3.6/Step 3 (generateSuitabilityReport implementation)]** Two undefined artifacts in the implementation block: (a) `loadDntFacts(quote.customerId)` is called but never defined or imported — no module path, no code, only a comment ('B1 Dnt aggregate read'); this is a placeholder by the plan's own NO-PLACEHOLDERS rule. (b) `buildSuitabilityPdf` is imported from './dnt-report-pdf', a NEW file ('extracted from dnt-report.ts in this task') that is absent from the task's Files list (only Create: suitability-report.ts and Modify: dnt-report.ts are listed).
   **Fix:** Add 'Create: lib/compliance/dnt-report-pdf.ts (shared helpers getLocalizedText/formatDate/formatCurrency moved from dnt-report.ts + new buildSuitabilityPdf section builder)' to Files, and define loadDntFacts concretely: either import B1's aggregate reader by its exported name (state the module path as a B1 artifact, e.g. lib/dnt/dnt-store.ts getDntFacts(customerId)), or inline `async function loadDntFacts(customerId: string)` querying B1's Dnt answer rows and returning Record<questionCode, value>.
4. **[C3.4/Step 3(a) (SuitabilityWarningAck schema)]** The model snippet declares `customer Customer @relation(...)` and `application Application @relation(...)` but no opposite relation fields are added to Customer or Application — `npx prisma migrate dev` fails schema validation ('missing an opposite relation field') before any migration is generated.
   **Fix:** Include in the same step: add `suitabilityWarningAcks SuitabilityWarningAck[]` to both model Customer and model Application in prisma/schema.prisma (mention prisma format will scaffold them).
5. **[C1.5/C2.6/C3.4 (ReasonCode registration)]** The packages mint many new reason codes (validity_dependency_changed, removed_by_branch, addon_ineligible_medical_history, ineligible_age_minimum/maximum, ineligible_residency, addon_age_band_unavailable, eligibility_facts_missing, suitability_warning_unacknowledged, no_suitability_warning_pending, product_has_no_investment_component, severe_conditions_demand_needs_addon, one_facet_per_commit, quote not least) but no task registers them with A1's ReasonCode registry, which the pinned contracts say A1 owns ('ReasonCode = stable snake_case codes + params'). If A1's ReasonCode is a closed union/registry (likely, given the M6 i18n key-per-code rendering), the C handlers won't compile or the GUI renderer will miss keys.
   **Fix:** Add to each task that introduces codes a sub-step: 'register the new codes in A1's ReasonCode registry module (and the translations.ts key stubs per M6)', listing the exact codes per task; note the dependency on A1's registry file by name.

---

# BLOCK D — Money & policy

## Block overview



## Package D1: Quote lifecycle: typed generate_quote decision, freeze-at-issue, cancel_quote, lazy expiry

**Execution slot:** 15 | **Depends on:** A2, B4, C1, C2, C3, E2

**Goal:** Make the quote the immutable priced artifact the compliance story requires: QuoteStatus ISSUED/ACCEPTED/EXPIRED/CANCELLED; generate_quote becomes a gateway commit running the canonical eligibility (C2) and suitability (C3) engines plus consent/DNT derived state, returning {issued | rejected(reason) | referred(reason) | requires_identity(needs)} with the decision persisted on the Application; issuing creates the Quote AND freezes the application in one transaction (frozenAt — T7.D1); referred sets Application REFERRED + WorkItem(referral) via the E2 interface and surfaces blocked_actions reason with_underwriter; modify_quote is deleted and all post-quote selection/answer mutation is engine-illegal (application_frozen) — cancel_quote (requires_confirmation, CAS ISSUED→CANCELLED, terminal) followed by a new application prefilled via B4 is the only change path (T13.D2); expiry is one pure isExpired predicate used by every read and legality check with opportunistic EXPIRED writes on commit attempts (T7.D5); PAYMENT_FREQUENCY leaves the questionnaire and Quote.paymentFrequency stays null until acceptance (T7.D3). The P2002 regenerate dead-end dies by construction (a Quote row in any state freezes its application; recovery is always a new application). The silent age-30 fallback and silent addon price-0 become engine outcomes, never invented facts.

**Migrations / seeds:**
- prisma/schema.prisma: enum QuoteStatus becomes { ISSUED, ACCEPTED, EXPIRED, CANCELLED } (DRAFT renamed to ISSUED, CANCELLED added). Destructive enum migration is acceptable — demo data; `npx prisma migrate reset` + reseed.
- prisma/schema.prisma: enum ApplicationStatus gains REFERRED (coordinate with Block C's T5.D6 status set — additive here if C already landed it).
- prisma/schema.prisma: model Application gains `frozenAt DateTime?` (set in the same transaction as Quote creation — T7.D1) and `quoteDecision Json?` ({outcome, reason, decidedAt} audit of the generate_quote decision — T7.D4).
- prisma/seeds/seed-product.ts: paymentFrequencyOptions confirmed as the pinned legal frequency set { annual, semi_annual, quarterly } (monthly is NOT sellable — kills the monthly-undercharge class; premiumMonthly stays a display-only figure).
- prisma/seeds/seed-questions.ts: PAYMENT_FREQUENCY removed from the active questionnaire (frequency is a payment-contract term elected at accept_quote, not an underwriting fact — T7.D3).
- prisma/seeds/seed-workflows.ts: quote_review step allowedTools loses modify_quote and get_quote_details, gains get_quote_info + cancel_quote (dead config until the late-Block-A cleanup deletes Workflow*, kept consistent meanwhile).

### Task D1.1: QuoteStatus/Application schema migration + shared test-DB helper
**Files:**
- Create: __tests__/helpers/test-db.ts (skip creation and reuse if Block A already shipped this exact helper)
- Modify: prisma/schema.prisma (QuoteStatus, ApplicationStatus, Application.frozenAt/quoteDecision)
- Create: prisma migration via `npx prisma migrate dev --name quote_lifecycle_v3`
- Test: __tests__/integration/quote-status-migration.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'

describe('quote lifecycle schema', () => {
  beforeAll(async () => { await truncateAll(); await seedBaseline() })

  it('accepts ISSUED/CANCELLED quote statuses, REFERRED application, frozen-application fields', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
    const product = await prisma.product.findFirstOrThrow()
    const application = await prisma.application.create({
      data: { conversationId: conversation.id, customerId: customer.id, productId: product.id, status: 'OPEN' },
    })
    const quote = await prisma.quote.create({
      data: {
        applicationId: application.id, productId: product.id, customerId: customer.id,
        premiumAnnual: 300, premiumMonthly: 25, coverages: {}, status: 'ISSUED',
        validUntil: new Date(Date.now() + 86_400_000),
      },
    })
    expect(quote.status).toBe('ISSUED')
    const cancelled = await prisma.quote.update({ where: { id: quote.id }, data: { status: 'CANCELLED' } })
    expect(cancelled.status).toBe('CANCELLED')
    const frozen = await prisma.application.update({
      where: { id: application.id },
      data: { status: 'REFERRED', frozenAt: new Date(), quoteDecision: { outcome: 'referred', reason: 'manual_underwriting', decidedAt: new Date().toISOString() } },
    })
    expect(frozen.status).toBe('REFERRED')
    expect(frozen.frozenAt).not.toBeNull()
  })
})
```
In the same step create the helper (test infrastructure, not behavior):
```ts
// __tests__/helpers/test-db.ts
import { prisma } from '@/lib/db'
import { seedProduct } from '@/prisma/seeds/seed-product'
import { seedQuestions } from '@/prisma/seeds/seed-questions'

export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${rows.map(r => `"${r.tablename}"`).join(', ')} CASCADE`,
  )
}

export async function seedBaseline(): Promise<void> {
  await seedProduct(prisma)
  await seedQuestions(prisma)
}
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/quote-status-migration.test.ts` — expect FAIL: Prisma rejects 'ISSUED'/'CANCELLED'/'REFERRED' enum values and unknown fields frozenAt/quoteDecision.
- [ ] Step 3: Apply the schema change in prisma/schema.prisma:
```prisma
enum QuoteStatus {
  ISSUED
  ACCEPTED
  EXPIRED
  CANCELLED
}

enum ApplicationStatus {
  OPEN
  PAUSED
  COMPLETED
  REFERRED
}

model Application {
  // ...existing fields unchanged...
  frozenAt      DateTime?
  quoteDecision Json?
}
```
Run `npx prisma migrate dev --name quote_lifecycle_v3` (demo data: accept the destructive enum remap; `npx prisma migrate reset` + reseed if needed), then `npx prisma generate`.
- [ ] Step 4: Run `npx vitest run __tests__/integration/quote-status-migration.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(quote): QuoteStatus ISSUED/ACCEPTED/EXPIRED/CANCELLED + frozen-application columns"`

### Task D1.2: Pure quote-lifecycle engine (isExpired, effective status, transition legality)
**Files:**
- Create: lib/engines/quote-lifecycle.ts
- Test: __tests__/lib/engines/quote-lifecycle.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test (snapshot literals, NO prisma):
```ts
import { describe, it, expect } from 'vitest'
import { isExpired, effectiveQuoteStatus, canQuoteTransition } from '@/lib/engines/quote-lifecycle'

const t0 = new Date('2026-06-12T12:00:00Z')
const live = { status: 'ISSUED' as const, validUntil: new Date('2026-06-13T12:00:00Z') }
const stale = { status: 'ISSUED' as const, validUntil: new Date('2026-06-12T11:59:59Z') }

describe('quote lifecycle predicates', () => {
  it('isExpired is validUntil < now, only for non-terminal statuses', () => {
    expect(isExpired(live, t0)).toBe(false)
    expect(isExpired(stale, t0)).toBe(true)
    expect(isExpired({ status: 'ACCEPTED', validUntil: stale.validUntil }, t0)).toBe(false)
    expect(isExpired({ status: 'CANCELLED', validUntil: stale.validUntil }, t0)).toBe(false)
  })
  it('effectiveQuoteStatus reports EXPIRED for a time-expired ISSUED row even before the write', () => {
    expect(effectiveQuoteStatus(live, t0)).toBe('ISSUED')
    expect(effectiveQuoteStatus(stale, t0)).toBe('EXPIRED')
    expect(effectiveQuoteStatus({ status: 'ACCEPTED', validUntil: stale.validUntil }, t0)).toBe('ACCEPTED')
  })
  it('transition table: each status has exactly one entering commit', () => {
    expect(canQuoteTransition('ISSUED', 'ACCEPTED')).toBe(true)
    expect(canQuoteTransition('ISSUED', 'CANCELLED')).toBe(true)
    expect(canQuoteTransition('ISSUED', 'EXPIRED')).toBe(true)
    expect(canQuoteTransition('ACCEPTED', 'CANCELLED')).toBe(false)
    expect(canQuoteTransition('EXPIRED', 'ACCEPTED')).toBe(false)
    expect(canQuoteTransition('CANCELLED', 'ISSUED')).toBe(false)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/quote-lifecycle.test.ts` — expect FAIL (module not found).
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/quote-lifecycle.ts — pure, no DB access
export type QuoteStatusV3 = 'ISSUED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED'
export interface QuoteLifecycleSnapshot { status: QuoteStatusV3; validUntil: Date }

export function isExpired(q: QuoteLifecycleSnapshot, now: Date): boolean {
  return q.status === 'ISSUED' && q.validUntil.getTime() < now.getTime()
}

export function effectiveQuoteStatus(q: QuoteLifecycleSnapshot, now: Date): QuoteStatusV3 {
  return isExpired(q, now) ? 'EXPIRED' : q.status
}

const TRANSITIONS: Record<QuoteStatusV3, QuoteStatusV3[]> = {
  ISSUED: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: [],
  EXPIRED: [],
  CANCELLED: [],
}

export function canQuoteTransition(from: QuoteStatusV3, to: QuoteStatusV3): boolean {
  return TRANSITIONS[from].includes(to)
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/quote-lifecycle.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(quote): pure quote-lifecycle engine (isExpired predicate + transition table)"`

### Task D1.3: Pure generate_quote decision core composing C2 eligibility + C3 suitability
**Files:**
- Create: lib/engines/quote-decision.ts
- Test: __tests__/lib/engines/quote-decision.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test (verdict literals — the C2/C3 engines are tested in their own blocks; this seam composes their outputs):
```ts
import { describe, it, expect } from 'vitest'
import { decideQuoteIssue } from '@/lib/engines/quote-decision'

const base = {
  eligibility: { verdict: 'eligible' as const, failedRules: [], missingFacts: [] as string[] },
  suitability: { verdict: 'suitable' as const, mismatches: [] },
  suitabilityWarningAcked: false,
  suitabilityPolicy: 'warn_and_allow' as const, // product config (M7)
  consents: { gdprProcessing: true },
  dnt: { validForProductType: true },
  identity: { hasDobOrCnp: true },
  escalationFlags: [] as string[],
}

describe('decideQuoteIssue', () => {
  it('issues when everything passes', () => {
    expect(decideQuoteIssue(base)).toEqual({ outcome: 'issued' })
  })
  it('missing DOB/CNP -> requires_identity with needs payload (never the silent age-30 fallback)', () => {
    expect(decideQuoteIssue({ ...base, identity: { hasDobOrCnp: false } }))
      .toEqual({ outcome: 'requires_identity', needs: ['declared:cnp_or_dob'] })
  })
  it('failed eligibility rule -> rejected with the C2 reason (incl. addon age-band no-match)', () => {
    const r = decideQuoteIssue({ ...base, eligibility: { verdict: 'ineligible', failedRules: [{ rule: 'age_max', reason: 'ineligible_age' }], missingFacts: [] } })
    expect(r).toEqual({ outcome: 'rejected', reason: 'ineligible_age' })
  })
  it('gdpr_processing withdrawn or invalid DNT -> rejected(compliance_block); marketing consent is NEVER required', () => {
    expect(decideQuoteIssue({ ...base, consents: { gdprProcessing: false } })).toEqual({ outcome: 'rejected', reason: 'compliance_block' })
    expect(decideQuoteIssue({ ...base, dnt: { validForProductType: false } })).toEqual({ outcome: 'rejected', reason: 'compliance_block' })
  })
  it('unacknowledged suitability mismatch blocks; acked mismatch passes under warn_and_allow (M7)', () => {
    const mismatch = { verdict: 'unsuitable' as const, mismatches: [{ rule: 'needs_fit', reason: 'declared_needs_mismatch' }] }
    expect(decideQuoteIssue({ ...base, suitability: mismatch }))
      .toEqual({ outcome: 'rejected', reason: 'suitability_unacknowledged' })
    expect(decideQuoteIssue({ ...base, suitability: mismatch, suitabilityWarningAcked: true }))
      .toEqual({ outcome: 'issued' })
  })
  it('escalation flags -> referred(manual_underwriting)', () => {
    expect(decideQuoteIssue({ ...base, escalationFlags: ['bd_escalate'] }))
      .toEqual({ outcome: 'referred', reason: 'manual_underwriting' })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/quote-decision.test.ts` — expect FAIL (module not found).
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/quote-decision.ts — pure, no DB. Check order: identity -> compliance -> eligibility -> suitability -> referral.
export interface QuoteDecisionInput {
  eligibility: { verdict: 'eligible' | 'ineligible' | 'unknown'; failedRules: { rule: string; reason: string }[]; missingFacts: string[] }
  suitability: { verdict: 'suitable' | 'conditionally_suitable' | 'unsuitable'; mismatches: { rule: string; reason: string }[] }
  suitabilityWarningAcked: boolean
  suitabilityPolicy: 'hard_block' | 'warn_and_allow'
  consents: { gdprProcessing: boolean }
  dnt: { validForProductType: boolean }
  identity: { hasDobOrCnp: boolean }
  escalationFlags: string[]
}
export type QuoteIssueDecision =
  | { outcome: 'issued' }
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'referred'; reason: string }
  | { outcome: 'requires_identity'; needs: string[] }

export function decideQuoteIssue(i: QuoteDecisionInput): QuoteIssueDecision {
  if (!i.identity.hasDobOrCnp) return { outcome: 'requires_identity', needs: ['declared:cnp_or_dob'] }
  if (!i.consents.gdprProcessing || !i.dnt.validForProductType) return { outcome: 'rejected', reason: 'compliance_block' }
  if (i.eligibility.verdict === 'ineligible') return { outcome: 'rejected', reason: i.eligibility.failedRules[0]?.reason ?? 'ineligible' }
  if (i.eligibility.verdict === 'unknown') return { outcome: 'requires_identity', needs: i.eligibility.missingFacts.map(f => `declared:${f}`) }
  if (i.suitability.verdict === 'unsuitable' && !i.suitabilityWarningAcked) {
    return i.suitabilityPolicy === 'hard_block'
      ? { outcome: 'rejected', reason: 'suitability_block' }
      : { outcome: 'rejected', reason: 'suitability_unacknowledged' }
  }
  if (i.escalationFlags.length > 0) return { outcome: 'referred', reason: 'manual_underwriting' }
  return { outcome: 'issued' }
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/quote-decision.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(quote): pure generate_quote decision core (issued/rejected/referred/requires_identity)"`

### Task D1.4: generate_quote gateway commit — issue freezes, referred creates WorkItem, decision persisted
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (generateQuote rewritten as gateway commit apply; consumes B0 age, C2/C3 verdicts, decideQuoteIssue)
- Modify: lib/tools/registry.ts (generate_quote registered through the A2 commit registry)
- Test: __tests__/integration/generate-quote-commit.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (real test DB, truncate+seed; fixture builder creates customer with dateOfBirth, conversation, OPEN application with tierId/levelId and complete answers, valid DNT + gdpr_processing ConsentEvent per Block B seeds):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway' // A2
import { buildReadyApplication } from '@/__tests__/helpers/funnel-fixtures'

describe('generate_quote commit', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('issued: creates Quote(ISSUED) and freezes the application in one transaction', async () => {
    const fx = await buildReadyApplication()
    const res = await executeCommit({ tool: 'generate_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
    expect(quote.status).toBe('ISSUED')
    expect(quote.paymentFrequency).toBeNull() // elected at accept, not at issue
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.frozenAt).not.toBeNull()
    expect(app.status).toBe('COMPLETED')
    expect((app.quoteDecision as { outcome: string }).outcome).toBe('issued')
  })

  it('referred: NO Quote row, Application REFERRED, WorkItem(referral) created, decision persisted', async () => {
    const fx = await buildReadyApplication({ escalationFlag: 'bd_escalate' })
    const res = await executeCommit({ tool: 'generate_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('referred')
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('REFERRED')
    const wi = await prisma.workItem.findFirstOrThrow({ where: { kind: 'referral' } }) // E2 model
    expect(wi.refs).toMatchObject({ applicationId: fx.applicationId })
  })

  it('missing DOB and CNP: requires_identity with needs, no quote, no silent age-30 pricing', async () => {
    const fx = await buildReadyApplication({ withoutDob: true })
    const res = await executeCommit({ tool: 'generate_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('requires_identity')
    expect(res.needs).toContain('declared:cnp_or_dob')
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
  })

  it('a quote row in ANY state makes generate_quote illegal (one-app-one-quote; no P2002 path)', async () => {
    const fx = await buildReadyApplication()
    await executeCommit({ tool: 'generate_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    const second = await executeCommit({ tool: 'generate_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(second.outcome).toBe('rejected')
    expect(second.reason).toBe('application_frozen')
  })
})
```
Also create __tests__/helpers/funnel-fixtures.ts in this step: buildReadyApplication({escalationFlag?, withoutDob?}) inserts customer(+dateOfBirth unless withoutDob), conversation, application(OPEN, tierId/levelId from seeded pricing, includesAddon false), all required answers, valid DNT/consent rows per the Block B seed shapes, and optionally flagsForReview [{outcome:'escalate', code: escalationFlag}].
- [ ] Step 2: Run `npx vitest run __tests__/integration/generate-quote-commit.test.ts` — expect FAIL (old handler still gates on verifyConsents/COMPLETED, creates DRAFT, never freezes, never refers).
- [ ] Step 3: Rewrite generateQuote as the commit apply function. Core logic (registered through the A2 commit registry; the gateway owns actor/replay/legality/token order per contradiction #8):
```ts
// lib/tools/handlers/quote-handlers.ts (new core of generate_quote apply)
import { decideQuoteIssue } from '@/lib/engines/quote-decision'
import { evaluateEligibility } from '@/lib/engines/eligibility' // C2
import { evaluateSuitability } from '@/lib/engines/suitability' // C3
import { calculateQuote } from '@/lib/engines/quote-engine'
import { getProfileFacts } from '@/lib/customer-profile/service' // B0: derived age (DOB|declaredAge), never stored
import { createWorkItem } from '@/lib/work-items/service' // E2

export async function applyGenerateQuote(tx: PrismaTx, snapshot: DomainSnapshot): Promise<CommitApplyResult> {
  const facts = await getProfileFacts(tx, snapshot.customerId)
  const decision = decideQuoteIssue({
    eligibility: evaluateEligibility(snapshot.product.eligibilityRules, { age: facts.age, ...snapshot.answerFacts }),
    suitability: evaluateSuitability(snapshot.product.suitabilityRules, snapshot.dntFacts),
    suitabilityWarningAcked: snapshot.suitabilityWarningAcked,
    suitabilityPolicy: snapshot.product.suitabilityPolicy,
    consents: { gdprProcessing: snapshot.consents.gdprProcessing },
    dnt: { validForProductType: snapshot.dnt.validForProductType },
    identity: { hasDobOrCnp: facts.age !== null },
    escalationFlags: snapshot.application.escalationFlags,
  })
  const decided = { ...decision, decidedAt: new Date().toISOString() }
  if (decision.outcome === 'requires_identity') return { outcome: 'requires_identity', needs: decision.needs, effects: [] }
  if (decision.outcome === 'rejected') {
    await tx.application.update({ where: { id: snapshot.application.id }, data: { quoteDecision: decided } })
    return { outcome: 'rejected', reason: decision.reason, effects: [] }
  }
  if (decision.outcome === 'referred') {
    await tx.application.update({ where: { id: snapshot.application.id }, data: { status: 'REFERRED', quoteDecision: decided } })
    await createWorkItem(tx, { kind: 'referral', reason: decision.reason, refs: { applicationId: snapshot.application.id, customerId: snapshot.customerId } })
    return { outcome: 'referred', reason: decision.reason, effects: ['eligibility_recheck'] }
  }
  const priced = calculateQuote(buildQuoteInput(snapshot, facts.age!)) // same pure engine as today
  const quote = await tx.quote.create({ data: { applicationId: snapshot.application.id, productId: snapshot.product.id, customerId: snapshot.customerId, premiumAnnual: priced.premiumAnnual, premiumMonthly: priced.premiumMonthly, premiumSemiAnnual: priced.premiumSemiAnnual, premiumQuarterly: priced.premiumQuarterly, paymentFrequency: null, coverages: toJson(priced), status: 'ISSUED', validUntil: priced.validUntil } })
  await tx.application.update({ where: { id: snapshot.application.id }, data: { status: 'COMPLETED', completedAt: new Date(), frozenAt: new Date(), quoteDecision: decided } })
  return { outcome: 'applied', effects: ['advance_phase'], data: { quoteId: quote.id, premiumAnnual: priced.premiumAnnual } }
}
```
Legality predicate registered with the commit: blocked with reason `application_frozen` when a Quote row exists for the application (any status) or application.frozenAt is set; blocked `questionnaire_incomplete` while required answers/selection missing (selection incompleteness is a blocked-reason, NOT a subphase — contradiction #10). Delete the verifyConsents call and the age-30 fallback; marketing consent is never consulted.
- [ ] Step 4: Run `npx vitest run __tests__/integration/generate-quote-commit.test.ts` — expect PASS. Also `npx vitest run __tests__/lib` to catch regressions in prompt/state tests referencing generate_quote.
- [ ] Step 5: Commit: `git commit -m "feat(quote): generate_quote as gateway commit — typed decision, freeze-at-issue, referral WorkItem"`

### Task D1.5: cancel_quote commit (requires_confirmation, CAS ISSUED→CANCELLED) + opportunistic EXPIRED writes
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (add cancelQuote apply)
- Modify: lib/tools/registry.ts + lib/tools/validation.ts (cancel_quote registration + zod schema { confirmCancellation: z.literal(true) } via the gateway confirm-token flow)
- Test: __tests__/integration/cancel-quote-commit.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'

describe('cancel_quote commit', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('first call returns requires_confirmation with a token; confirmed call CAS-cancels', async () => {
    const fx = await buildIssuedQuote()
    const first = await executeCommit({ tool: 'cancel_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(first.outcome).toBe('requires_confirmation')
    expect(first.confirmToken).toBeTruthy()
    const second = await executeCommit({ tool: 'cancel_quote', actor: 'agent', conversationId: fx.conversationId, args: { confirmToken: first.confirmToken } })
    expect(second.outcome).toBe('applied')
    expect(second.effects).toContain('terminal')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('CANCELLED')
  })

  it('commit attempt on a time-expired quote persists EXPIRED opportunistically and rejects with quote_expired', async () => {
    const fx = await buildIssuedQuote({ validUntil: new Date(Date.now() - 1000) })
    const res = await executeCommit({ tool: 'cancel_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('quote_expired')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('EXPIRED') // opportunistic write (T7.D5)
  })

  it('cancel on an ACCEPTED quote is rejected (transition table)', async () => {
    const fx = await buildIssuedQuote()
    await prisma.quote.update({ where: { id: fx.quoteId }, data: { status: 'ACCEPTED' } })
    const res = await executeCommit({ tool: 'cancel_quote', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('rejected')
  })
})
```
(Extend funnel-fixtures with buildIssuedQuote = buildReadyApplication + generate_quote commit, optional validUntil override via direct update.)
- [ ] Step 2: Run `npx vitest run __tests__/integration/cancel-quote-commit.test.ts` — expect FAIL (tool unknown).
- [ ] Step 3: Implement:
```ts
// lib/tools/handlers/quote-handlers.ts
import { isExpired, canQuoteTransition } from '@/lib/engines/quote-lifecycle'

export async function applyCancelQuote(tx: PrismaTx, snapshot: DomainSnapshot): Promise<CommitApplyResult> {
  const q = snapshot.quote!
  if (isExpired(q, new Date())) {
    await tx.quote.updateMany({ where: { id: q.id, status: 'ISSUED' }, data: { status: 'EXPIRED' } })
    return { outcome: 'rejected', reason: 'quote_expired', effects: [] }
  }
  if (!canQuoteTransition(q.status, 'CANCELLED')) return { outcome: 'rejected', reason: 'illegal_transition', effects: [] }
  const cas = await tx.quote.updateMany({ where: { id: q.id, status: 'ISSUED' }, data: { status: 'CANCELLED' } })
  if (cas.count === 0) return { outcome: 'rejected', reason: 'illegal_transition', effects: [] }
  return { outcome: 'applied', effects: ['terminal'], data: { cancelledQuoteId: q.id } }
}
```
Register with requiresConfirmation: true (gateway issues/validates the token per contradiction #8 step 4). Legality: exposed only when an ISSUED, non-expired quote exists. Post-cancel exposure (recovery): deriveAndExpose surfaces set_application prefilled via B4 — assert in the test that the post-state ExposedActions.available from the commit result includes 'set_application' once B4 is merged; until then assert blocked contains no 'cancel_quote'.
- [ ] Step 4: Run `npx vitest run __tests__/integration/cancel-quote-commit.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(quote): cancel_quote commit with confirm token, CAS, opportunistic expiry"`

### Task D1.6: get_quote_info read (replaces get_quote_details) with effective status + payment_options
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (getQuoteDetails → getQuoteInfo)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (rename registration; get_quote_details removed)
- Test: __tests__/integration/get-quote-info.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'
import { getQuoteInfo } from '@/lib/tools/handlers/quote-handlers'

describe('get_quote_info', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('returns effective status EXPIRED for a time-expired ISSUED row without writing', async () => {
    const fx = await buildIssuedQuote({ validUntil: new Date(Date.now() - 1000) })
    const res = await getQuoteInfo({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    expect(res.success).toBe(true)
    expect((res.data as { status: string }).status).toBe('EXPIRED')
  })

  it('bundles payment_options from Product.paymentFrequencyOptions ∩ quote premium variants (no monthly)', async () => {
    const fx = await buildIssuedQuote()
    const res = await getQuoteInfo({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    const options = (res.data as { payment_options: { option: string; amount: number; currency: string }[] }).payment_options
    expect(options.map(o => o.option).sort()).toEqual(['annual', 'quarterly', 'semi_annual'])
    expect(options.find(o => o.option === 'annual')!.amount).toBeGreaterThan(0)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/get-quote-info.test.ts` — expect FAIL.
- [ ] Step 3: Implement getQuoteInfo: resolve quote via application chain; status = effectiveQuoteStatus(quote, new Date()); payment_options built as:
```ts
const freqOptions = product.paymentFrequencyOptions as Record<string, unknown> | null
const variant: Record<string, number | null> = {
  annual: quote.premiumAnnual, semi_annual: quote.premiumSemiAnnual, quarterly: quote.premiumQuarterly,
}
const payment_options = Object.keys(freqOptions ?? {})
  .filter(opt => variant[opt] != null)
  .map(opt => ({ option: opt, amount: variant[opt]!, currency: quote.currency }))
```
Return { quoteId, status, premiums, validUntil, coverages, payment_options }. Update every registry/prompt/seed reference of get_quote_details to get_quote_info (grep `get_quote_details` across lib/, prisma/seeds/, __tests__/ and fix all hits).
- [ ] Step 4: Run `npx vitest run __tests__/integration/get-quote-info.test.ts && npx vitest run` — expect PASS (full suite catches stale name references).
- [ ] Step 5: Commit: `git commit -m "feat(quote): get_quote_info read with effective status and payment_options"`

### Task D1.7: Eliminate modify_quote; frozen-application legality predicate gates all post-quote mutation
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (delete modifyQuote), lib/tools/registry.ts, lib/tools/validation.ts (deregister modify_quote)
- Modify: lib/chat/action-adapter.ts (delete 'modify_quote' case; the GUI change button maps to cancel_quote through the gateway per M4)
- Modify: lib/chat/default-tools.ts (change_selection removed from DEFAULT_DISCOVERY_TOOLS — its post-quote use dies here; full tool elimination is Block C's selection package)
- Modify: prisma/seeds/seed-workflows.ts (quote_review allowedTools: ['get_quote_info','accept_quote','cancel_quote'])
- Create: lib/engines/frozen-application.ts (pure predicate consumed by A1 deriveAndExpose)
- Test: __tests__/lib/engines/frozen-application.test.ts, __tests__/lib/tools/no-modify-quote.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure tests:
```ts
import { describe, it, expect } from 'vitest'
import { mutationBlockedReason, MUTATING_APPLICATION_ACTIONS } from '@/lib/engines/frozen-application'

describe('frozen-application predicate', () => {
  const frozen = { frozenAt: new Date(), quoteExists: true }
  const open = { frozenAt: null, quoteExists: false }
  it('blocks every selection/answer mutating action once frozen or once a quote exists in any state', () => {
    for (const action of MUTATING_APPLICATION_ACTIONS) {
      expect(mutationBlockedReason(frozen, action)).toBe('application_frozen')
      expect(mutationBlockedReason({ frozenAt: null, quoteExists: true }, action)).toBe('application_frozen')
      expect(mutationBlockedReason(open, action)).toBeNull()
    }
  })
  it('covers select_coverage, modify_answer, set_answer, write_question_answer', () => {
    expect(MUTATING_APPLICATION_ACTIONS).toEqual(
      expect.arrayContaining(['select_coverage', 'modify_answer', 'set_answer', 'write_question_answer']),
    )
  })
})
```
```ts
// __tests__/lib/tools/no-modify-quote.test.ts
import { describe, it, expect } from 'vitest'
import { toolRegistry } from '@/lib/tools/registry'

describe('modify_quote elimination (T13.D2)', () => {
  it('modify_quote is not registered anywhere', () => {
    expect(Object.keys(toolRegistry)).not.toContain('modify_quote')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/frozen-application.test.ts __tests__/lib/tools/no-modify-quote.test.ts` — expect FAIL.
- [ ] Step 3: Implement and delete:
```ts
// lib/engines/frozen-application.ts — pure, no DB
export const MUTATING_APPLICATION_ACTIONS = [
  'select_coverage', 'modify_answer', 'set_answer', 'write_question_answer',
] as const
export interface FreezeFacts { frozenAt: Date | null; quoteExists: boolean }
export function mutationBlockedReason(facts: FreezeFacts, action: string): 'application_frozen' | null {
  if (!(MUTATING_APPLICATION_ACTIONS as readonly string[]).includes(action)) return null
  return facts.frozenAt !== null || facts.quoteExists ? 'application_frozen' : null
}
```
Delete modifyQuote handler + registry entry + validation schema + action-adapter case; update seed-workflows; remove 'change_selection' from DEFAULT_DISCOVERY_TOOLS. Wire mutationBlockedReason into the A1 exposure-predicate data so blocked_actions carries { action, reason: 'application_frozen' } for these commits whenever a quote exists.
- [ ] Step 4: Run `npx vitest run` — full suite (existing tests referencing modify_quote/change_selection in prompts or adapters must be updated in this step, not skipped).
- [ ] Step 5: Commit: `git commit -m "feat(quote): eliminate modify_quote; frozen-application gate for post-quote mutation"`

### Task D1.8: PAYMENT_FREQUENCY decoupled from the questionnaire
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (generate_quote no longer reads the PAYMENT_FREQUENCY answer — already null in D1.4; this task removes the dead read path and the question)
- Modify: prisma/seeds/seed-questions.ts (PAYMENT_FREQUENCY question removed from the active questionnaire)
- Test: __tests__/integration/payment-frequency-decoupled.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'

describe('payment frequency is elected at accept, not asked in the questionnaire', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('PAYMENT_FREQUENCY is not a seeded active question', async () => {
    expect(await prisma.question.findFirst({ where: { code: 'PAYMENT_FREQUENCY' } })).toBeNull()
  })
  it('issued quotes carry paymentFrequency null', async () => {
    const fx = await buildIssuedQuote()
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.paymentFrequency).toBeNull()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/payment-frequency-decoupled.test.ts` — expect FAIL (question still seeded).
- [ ] Step 3: Remove the PAYMENT_FREQUENCY block from prisma/seeds/seed-questions.ts and the prisma.question.findFirst({ code: 'PAYMENT_FREQUENCY' }) read in quote-handlers.ts; reseed (`npx prisma migrate reset` or rerun seeds). Update any questionnaire-count assertions in existing tests.
- [ ] Step 4: Run `npx vitest run __tests__/integration/payment-frequency-decoupled.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(quote): PAYMENT_FREQUENCY leaves the questionnaire (elected at accept)"`

### Task D1.9: Package verification — full suite + quote-lifecycle runtime sim
**Files:**
- Create: scripts/verify-quote-lifecycle.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-quote-lifecycle.ts (npx tsx, runs against the dev DB): builds a ready application via the same fixture path, then exercises (a) issue → assert Quote ISSUED + application frozen, (b) cancel_quote with token → CANCELLED + terminal, (c) referred path with escalation flag → REFERRED + WorkItem, (d) requires_identity path without DOB. Prints `PASS n/4` / first failure with evidence and exits non-zero on failure.
- [ ] Step 2: Run `npx vitest run` — expect all green (the instrumentation flake __tests__/lib/events/instrumentation.test.ts is a known timing flake; treat as PASS only if it is the sole failure).
- [ ] Step 3: Run `npx tsx scripts/verify-quote-lifecycle.ts` — expect `PASS 4/4`.
- [ ] Step 4: Review against T7.D1/D4/D5, T13.D2 and the resolved log (#9 addon no-match → ineligibility; marketing consent never gates) before claiming done.
- [ ] Step 5: Commit: `git commit -m "test(quote): quote lifecycle runtime verification script"`


### ⚠ Binding errata for D1 (fidelity verifier — apply OVER the task text above)

1. **[D1.5 / steps 1+3 (cancel_quote opportunistic expiry)]** Internal contradiction with the pinned gateway order (contradiction #8). The task registers cancel_quote legality as 'exposed only when an ISSUED, non-expired quote exists', but puts the opportunistic EXPIRED write and the rejected(quote_expired) outcome inside applyCancelQuote. Under the binding order (replay -> legality -> confirm token -> validation -> apply), an expired quote is rejected at legality (step 3) and a token-less first call stops at requires_confirmation (step 4) — applyCancelQuote never runs for the test's expired-quote case, so the asserted EXPIRED persistence is unreachable as designed.
   **Fix:** Move the opportunistic write out of the apply: specify that the gateway (or a pre-legality normalization hook) persists EXPIRED via updateMany({where:{id, status:'ISSUED', validUntil:{lt:now}}}) whenever legality computes quote_expired for the targeted commit, then returns rejected(quote_expired). Keep the test as-is; delete the isExpired branch from applyCancelQuote (it keeps only the CAS). State explicitly that T7.D5's 'commits against an expired quote persist EXPIRED' is a gateway concern shared by cancel_quote and accept_quote.
2. **[D2.5 / step 3 (acceptQuoteLegality) and D1.4 legality predicate]** Ambiguous against contradiction #6 (deriveAndExpose is the ONLY computation of exposure/legality; the T12.D5 meta-test forbids a second implementation). acceptQuoteLegality re-decides quote_expired/illegal_transition/requires_identity/requires_disclosures but the plan never says who calls it — if the handler calls it ad-hoc, Block D ships a parallel legality path that the #6 closure meta-test must reject.
   **Fix:** State explicitly (D1.4, D1.7 already does this for mutationBlockedReason): all per-commit pure predicates (acceptQuoteLegality, frozen-application, disclosuresRequired, freeLookDecision) are registered as exposure-predicate inputs consumed by A1's deriveAndExpose / the A2 gateway legality step — they are decision-core helpers, never called directly from handlers. Add one sentence per task and keep the pure tests unchanged.
3. **[D1.7 / Files + step 3 (GUI change button)]** Swap-test (M4) break the agenda explicitly warns about: components/chat/rich/rich-content.tsx:185 emits UIAction { type: 'modify_quote' } from the QuoteCard onModify button. D1.7 deletes the adapter 'modify_quote' case and claims 'the GUI change button maps to cancel_quote through the gateway per M4', but no task modifies rich-content.tsx or adds a cancel_quote adapter mapping — the button goes dead.
   **Fix:** Add to D1.7 Files: Modify components/chat/rich/rich-content.tsx (onModify emits { type: 'cancel_quote' }) and lib/chat/action-adapter.ts gains a 'cancel_quote' case mapping to { name: 'cancel_quote', arguments: {} } (token round-trip handled by the gateway requires_confirmation envelope). Extend the no-modify-quote test to assert adaptAction({type:'cancel_quote'}) maps correctly.
4. **[D1.7 / step 1 (no-modify-quote test)]** Imports { toolRegistry } from '@/lib/tools/registry' — no such export exists. The registry stores internal Maps (lib/tools/registry.ts:40-41) and exposes getAllToolNames()/getRegisteredToolNames().
   **Fix:** Rewrite the assertion as: import { getAllToolNames } from '@/lib/tools/registry'; expect(getAllToolNames()).not.toContain('modify_quote').
5. **[D1.1 / step 3 (DRAFT -> ISSUED rename compile coherence)]** After the enum migration + prisma generate, 'DRAFT' literals in untouched files are TypeScript errors: lib/chat/derive-state.ts:182, lib/tools/handlers/change-selection-handlers.ts:87, lib/tools/handlers/product-switch-handler.ts:75-78, lib/tools/handlers/quote-handlers.ts:211/339 (the last fixed only in D1.4). D1.1 has no fix-compile step, and D1 does not depend on the Block A/C packages that retire derive-state/change_selection/switch_product.
   **Fix:** Add to D1.1 step 3: mechanical rename of remaining 'DRAFT' QuoteStatus literals to 'ISSUED' in derive-state.ts, change-selection-handlers.ts, product-switch-handler.ts, quote-handlers.ts (behavioral rewrites stay in D1.2-D1.7), then `npx tsc --noEmit` clean as part of step 4 — or declare an explicit depends_on for the packages that delete those files first.
6. **[D1.4 / step 3 (buildQuoteInput / toJson undefined)]** applyGenerateQuote calls buildQuoteInput(snapshot, facts.age!) and toJson(priced) — neither is defined in any task or pinned contract, and buildQuoteInput is non-trivial: calculateQuote's QuoteInput needs pricingLevel, addonPricingRule and quoteValidityDays, which implies DomainSnapshot must carry pricing-tier/level/addon-rule rows — an unstated requirement on A1's snapshot loader.
   **Fix:** Add a code block in D1.4 step 3 defining buildQuoteInput (select PricingLevel by snapshot.selection.levelId, AddonPricingRule by age band when includesAddon, quoteValidityDays from snapshot.product) and replace toJson(priced) with the explicit coverages JSON shape. Add a depends_on note that A1's DomainSnapshot includes pricing rows (or load them inside the apply via tx).
7. **[D1.5 / step 3 (conditional B4 assertion)]** 'assert ... includes set_application once B4 is merged — until then assert blocked contains no cancel_quote' is a conditional, ambiguous verification (which branch does the engineer implement?). B4 is already in D1's depends_on, so the weaker branch should not exist.
   **Fix:** Pin one assertion: since depends_on includes B4, assert the post-commit envelope's ExposedActions.available contains 'set_application' (prefilled re-application) and not 'cancel_quote'. Delete the 'until then' clause.
8. **[package D1 migrations (ApplicationStatus snippet)]** The D1.1 schema snippet rewrites ApplicationStatus verbatim as { OPEN, PAUSED, COMPLETED, REFERRED }. Block C's T5.D6 set also needs CANCELLED (cancel_application currently overloads COMPLETED — a flagged risk; the cancel-and-reapply recovery path D1 itself leans on requires it). If C lands first, the verbatim snippet would delete CANCELLED.
   **Fix:** Make the enum change explicitly additive: 'ApplicationStatus gains REFERRED (and keep any values Block C already added, e.g. CANCELLED) — do not rewrite the enum body'. Show the snippet as `enum ApplicationStatus { ... existing values ... REFERRED }`.
9. **[D1.4 / step 1 (escalationFlags mapping)]** The fixture writes Application.flagsForReview = [{outcome:'escalate', code}] (the existing Json shape) but applyGenerateQuote reads snapshot.application.escalationFlags: string[] — the Json->snapshot mapping is defined nowhere (A1's loader doesn't know this rule; it's a quote-decision concern).
   **Fix:** Specify the mapping in D1.4 step 3: escalationFlags = (application.flagsForReview as {outcome:string;code:string}[] | null ?? []).filter(f => f.outcome === 'escalate').map(f => f.code), implemented in the D-owned snapshot-section builder (or documented as a required A1 loader rule with a unit assertion in the integration test).

## Package D2: THE COUPLED FLIP: disclosures + narrow accept + PaymentSchedule + webhook inbox + policy-at-first-payment + conversation terminality

**Execution slot:** 16 | **Depends on:** A3, B1, B3, D1

**Goal:** One atomic package per M9: the policy-creation flip and everything it is welded to. Document registry (T9.D1: kind/version/language/storageKey behind a storage provider) + DisclosureAck rows bound to (quote, document version, language) + acknowledge_disclosures commit + requires_disclosures gate on accept_quote (T7.D2). accept_quote goes NARROW (T7.D6): CAS ISSUED→ACCEPTED, persists payment_option + acceptedAt as immutable acceptance evidence, creates the PaymentSchedule + Installment rows transactionally (contradiction #3: the schedule is the live money truth from acceptance onward; integer minor units with an explicit remainder rule), creates NO Policy and NO Conversation.COMPLETED. Settlement becomes a transactional inbox (T8.D3): PaymentEvent @@unique([provider, providerEventId]), WebhookEvent gains eventId + an explicit 'ignored' variant, PayU unsigned payloads hard-rejected (live forgery flaw), 5xx on internal failure so providers retry, providerPaymentId @unique. The Policy row is created in PENDING_SUBMISSION with issuedAt stamped INSIDE the first successful settlement transaction (contradiction #5 definitional table) — post-payment.ts stops writing SUBMITTED (paid ≠ submitted). Conversation terminality flips with it (contradiction #11): ConversationStatus → ACTIVE | ARCHIVED, the orchestrator hard-reject at orchestrator.ts:351-353 is removed, turns reactivate archived conversations, and an inactivity sweep script archives stale ones. show_policy_issued dies at accept (M4) — replaced by a show_quote_accepted surface; initiate_payment and the confirm route are minimally re-anchored to the schedule so the funnel keeps working until D3 replaces initiation with ensure_payment_session.

**Migrations / seeds:**
- prisma/schema.prisma NEW enums: DocumentKind { IPID, TERMS, SUITABILITY_REPORT, POLICY_SCHEDULE, PAYMENT_RECEIPT }, DocumentSource { GENERATED, STATIC_PER_PRODUCT_VERSION }, PaymentScheduleStatus { PENDING_FIRST_CAPTURE, ACTIVE, COMPLETED, SUPERSEDED, ABANDONED }, InstallmentStatus { PENDING, PAID, FAILED, WAIVED }.
- NEW model Document { id, kind DocumentKind, version Int, language String, storageKey String, contentHash String, source DocumentSource, productId String?, customerId String?, quoteId String?, policyId String?, generatedAt DateTime @default(now()) } — replaces path-column pattern; suitabilityReportPath retired in D4.
- NEW model DisclosureAck { id, quoteId, customerId, documentId, kind DocumentKind, version Int, language String, actor String, sourceCommitId String?, acknowledgedAt DateTime @default(now()), @@unique([quoteId, kind, version, language]) }.
- NEW model PaymentSchedule { id, quoteId, customerId, frequency String, status PaymentScheduleStatus, totalInstallments Int, currency String @default("RON"), supersededById String?, createdAt, updatedAt } + model Installment { id, scheduleId, sequence Int, dueAt DateTime, amountMinor Int, status InstallmentStatus @default(PENDING), paidAt DateTime?, @@unique([scheduleId, sequence]) }.
- NEW model PaymentEvent { id, provider PaymentProvider, providerEventId String, providerPaymentId String?, kind String, payload Json, processedAt DateTime @default(now()), @@unique([provider, providerEventId]) } — the transactional inbox.
- model Payment re-anchored: policyId/policy relation REMOVED, installmentId String + relation added, amount renamed amountMinor Int, providerPaymentId String? becomes @unique (was @@index). Destructive — demo data, reseed.
- model Quote gains acceptedAt DateTime?; paymentFrequency is written ONLY by accept_quote from this package on (immutable acceptance evidence, never re-read for money math — contradiction #3).
- enum ConversationStatus → { ACTIVE, ARCHIVED } (IDLE/COMPLETED/ABANDONED dropped — destructive remap: COMPLETED/ABANDONED/IDLE → ARCHIVED); Conversation gains archivedAt DateTime?; completedAt column dropped.
- NEW seed prisma/seeds/seed-documents.ts: protect IPID v1 + TERMS v1, languages ro AND en (M6 publish gate: both locales mandatory), source STATIC_PER_PRODUCT_VERSION, files written under DOCUMENTS_PATH (default ./storage/documents); registered in prisma/seeds/index.ts.

### Task D2.1: Coupled-flip schema migration (all new models + Payment re-anchor + ConversationStatus)
**Files:**
- Modify: prisma/schema.prisma (all bullets from this package's migrations list)
- Create: migration via `npx prisma migrate dev --name coupled_flip_payment_policy`
- Test: __tests__/integration/coupled-flip-schema.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'

describe('coupled-flip schema', () => {
  beforeAll(async () => { await truncateAll(); await seedBaseline() })
  it('persists schedule + installments + payment event + disclosure ack + ARCHIVED conversation', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, status: 'ARCHIVED', archivedAt: new Date() } })
    expect(conv.status).toBe('ARCHIVED')
    const product = await prisma.product.findFirstOrThrow()
    const app = await prisma.application.create({ data: { conversationId: conv.id, customerId: customer.id, productId: product.id, status: 'COMPLETED' } })
    const quote = await prisma.quote.create({ data: { applicationId: app.id, productId: product.id, customerId: customer.id, premiumAnnual: 300, premiumMonthly: 25, coverages: {}, status: 'ACCEPTED', acceptedAt: new Date(), paymentFrequency: 'quarterly', validUntil: new Date() } })
    const schedule = await prisma.paymentSchedule.create({
      data: { quoteId: quote.id, customerId: customer.id, frequency: 'quarterly', status: 'PENDING_FIRST_CAPTURE', totalInstallments: 4,
        installments: { create: [{ sequence: 1, dueAt: new Date(), amountMinor: 7500 }] } },
      include: { installments: true },
    })
    const payment = await prisma.payment.create({ data: { installmentId: schedule.installments[0].id, customerId: customer.id, amountMinor: 7500, provider: 'MOCK', providerPaymentId: 'mock_1', status: 'PENDING' } })
    expect(payment.installmentId).toBe(schedule.installments[0].id)
    await prisma.paymentEvent.create({ data: { provider: 'MOCK', providerEventId: 'evt_1', kind: 'payment_succeeded', payload: {} } })
    await expect(prisma.paymentEvent.create({ data: { provider: 'MOCK', providerEventId: 'evt_1', kind: 'payment_succeeded', payload: {} } })).rejects.toThrow() // unique inbox key
    const doc = await prisma.document.create({ data: { kind: 'IPID', version: 1, language: 'ro', storageKey: 'test/ipid.pdf', contentHash: 'abc', source: 'STATIC_PER_PRODUCT_VERSION', productId: product.id } })
    await prisma.disclosureAck.create({ data: { quoteId: quote.id, customerId: customer.id, documentId: doc.id, kind: 'IPID', version: 1, language: 'ro', actor: 'agent' } })
    expect((await prisma.disclosureAck.count())).toBe(1)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/coupled-flip-schema.test.ts` — expect FAIL (models missing).
- [ ] Step 3: Apply all schema changes from the migrations list verbatim; key snippets:
```prisma
model PaymentSchedule {
  id                String                @id @default(cuid())
  quoteId           String
  customerId        String
  frequency         String
  status            PaymentScheduleStatus @default(PENDING_FIRST_CAPTURE)
  totalInstallments Int
  currency          String                @default("RON")
  supersededById    String?
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  quote        Quote         @relation(fields: [quoteId], references: [id])
  customer     Customer      @relation(fields: [customerId], references: [id])
  installments Installment[]
}

model Installment {
  id         String            @id @default(cuid())
  scheduleId String
  sequence   Int
  dueAt      DateTime
  amountMinor Int
  status     InstallmentStatus @default(PENDING)
  paidAt     DateTime?
  schedule PaymentSchedule @relation(fields: [scheduleId], references: [id])
  payments Payment[]
  @@unique([scheduleId, sequence])
}

model Payment {
  id                String          @id @default(cuid())
  installmentId     String
  customerId        String
  amountMinor       Int
  currency          String          @default("RON")
  provider          PaymentProvider
  providerPaymentId String?         @unique
  status            PaymentStatus   @default(PENDING)
  paidAt            DateTime?
  failureReason     String?
  metadata          Json?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  installment Installment @relation(fields: [installmentId], references: [id])
  customer    Customer    @relation(fields: [customerId], references: [id])
}

enum ConversationStatus {
  ACTIVE
  ARCHIVED
}
```
Run `npx prisma migrate dev --name coupled_flip_payment_policy` (destructive remap accepted — demo data), `npx prisma generate`. Fix every compile error this surfaces (payment-handlers, post-payment, webhook routes, accept_quote, escalate_to_human IDLE write, dashboard queries) — the build must be coherent inside this one package; the behavioral rewrites land in the following tasks but no code may reference dropped columns/enum values after this step.
- [ ] Step 4: Run `npx vitest run __tests__/integration/coupled-flip-schema.test.ts` — expect PASS; `npx tsc --noEmit` clean.
- [ ] Step 5: Commit: `git commit -m "feat(schema): coupled-flip models — schedule/installments/inbox/documents/acks, conversation ACTIVE|ARCHIVED"`

### Task D2.2: Document storage provider + registry service + auth-checked serving route + protect IPID/TERMS seed
**Files:**
- Create: lib/documents/storage.ts, lib/documents/registry.ts
- Create: app/api/documents/[documentId]/route.ts
- Create: prisma/seeds/seed-documents.ts (+ register in prisma/seeds/index.ts)
- Test: __tests__/lib/documents/registry.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { createDocument, getProductDisclosureDocuments } from '@/lib/documents/registry'
import { seedDocuments } from '@/prisma/seeds/seed-documents'

describe('document registry', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline(); await seedDocuments(prisma) })
  it('seeds IPID + TERMS for protect in ro and en with content hashes', async () => {
    const product = await prisma.product.findFirstOrThrow()
    const docs = await getProductDisclosureDocuments(product.id, 'ro')
    expect(docs.map(d => d.kind).sort()).toEqual(['IPID', 'TERMS'])
    expect(docs.every(d => d.contentHash.length > 0)).toBe(true)
    expect((await getProductDisclosureDocuments(product.id, 'en')).length).toBe(2) // M6: both locales mandatory
  })
  it('createDocument stores bytes via the storage provider and returns a row with sha256 contentHash', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const doc = await createDocument({ kind: 'PAYMENT_RECEIPT', language: 'ro', customerId: customer.id, bytes: Buffer.from('receipt'), source: 'GENERATED' })
    expect(doc.contentHash).toBe('e2cd1a5a8e0a6e3c…replace-with-real-sha256-of-receipt')
    const loaded = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    expect(loaded.storageKey).toMatch(/PAYMENT_RECEIPT/)
  })
})
```
(Compute the real sha256 of 'receipt' when writing the test: `node -e "console.log(require('crypto').createHash('sha256').update('receipt').digest('hex'))"` and inline it.)
- [ ] Step 2: Run `npx vitest run __tests__/lib/documents/registry.test.ts` — expect FAIL.
- [ ] Step 3: Implement:
```ts
// lib/documents/storage.ts — FS provider now, object storage later (T9.D1)
import fs from 'fs/promises'
import path from 'path'
const ROOT = process.env.DOCUMENTS_PATH ?? './storage/documents'
export interface DocumentStorage {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
}
export const fsStorage: DocumentStorage = {
  async put(key, bytes) { const p = path.join(ROOT, key); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, bytes) },
  async get(key) { return fs.readFile(path.join(ROOT, key)) },
}
```
```ts
// lib/documents/registry.ts
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { fsStorage } from './storage'
import type { DocumentKind, DocumentSource } from '@/lib/generated/prisma'

export async function createDocument(input: { kind: DocumentKind; language: string; bytes: Buffer; source: DocumentSource; version?: number; productId?: string; customerId?: string; quoteId?: string; policyId?: string }) {
  const contentHash = crypto.createHash('sha256').update(input.bytes).digest('hex')
  const version = input.version ?? 1
  const storageKey = `${input.kind}/${input.language}/v${version}/${contentHash.slice(0, 16)}.pdf`
  await fsStorage.put(storageKey, input.bytes)
  return prisma.document.create({ data: { kind: input.kind, version, language: input.language, storageKey, contentHash, source: input.source, productId: input.productId, customerId: input.customerId, quoteId: input.quoteId, policyId: input.policyId } })
}

export async function getProductDisclosureDocuments(productId: string, language: string) {
  // latest version per kind for the product's static disclosure docs
  const docs = await prisma.document.findMany({ where: { productId, language, kind: { in: ['IPID', 'TERMS'] } }, orderBy: { version: 'desc' } })
  const latest = new Map<string, typeof docs[number]>()
  for (const d of docs) if (!latest.has(d.kind)) latest.set(d.kind, d)
  return [...latest.values()]
}
```
Serving route app/api/documents/[documentId]/route.ts: JWT auth (same pattern as app/api/documents/dnt-report/[policyId]/route.ts — customer owns the document or role ADMIN/OPERATOR), streams fsStorage.get(doc.storageKey) with content-type application/pdf. seed-documents.ts generates simple jsPDF placeholders-with-real-content (product name, coverage summary from seed data) for IPID/TERMS in ro+en and inserts via createDocument with source STATIC_PER_PRODUCT_VERSION.
- [ ] Step 4: Run `npx vitest run __tests__/lib/documents/registry.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(documents): Document registry, FS storage provider, serving route, protect IPID/TERMS seed"`

### Task D2.3: disclosuresRequired predicate + acknowledge_disclosures commit + get_quote_info disclosure field
**Files:**
- Create: lib/engines/disclosures.ts
- Modify: lib/tools/handlers/quote-handlers.ts (acknowledgeDisclosures apply; getQuoteInfo gains disclosures_required)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (acknowledge_disclosures registration)
- Test: __tests__/lib/engines/disclosures.test.ts, __tests__/integration/acknowledge-disclosures.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test:
```ts
import { describe, it, expect } from 'vitest'
import { disclosuresRequired } from '@/lib/engines/disclosures'

const ipidV2 = { kind: 'IPID' as const, version: 2, language: 'ro' }
const termsV1 = { kind: 'TERMS' as const, version: 1, language: 'ro' }

describe('disclosuresRequired (set difference, version+language bound)', () => {
  it('all current docs unacked -> all required', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [])).toEqual([ipidV2, termsV1])
  })
  it('ack at an OLD version does not satisfy the current version', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [{ kind: 'IPID', version: 1, language: 'ro' }])).toEqual([ipidV2, termsV1])
  })
  it('exact version+language acks satisfy', () => {
    expect(disclosuresRequired([ipidV2, termsV1], [ipidV2, termsV1])).toEqual([])
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/disclosures.test.ts` — expect FAIL.
- [ ] Step 3: Implement pure + commit:
```ts
// lib/engines/disclosures.ts — pure
export interface DisclosureRef { kind: 'IPID' | 'TERMS'; version: number; language: string }
export function disclosuresRequired(current: DisclosureRef[], acks: DisclosureRef[]): DisclosureRef[] {
  return current.filter(doc => !acks.some(a => a.kind === doc.kind && a.version === doc.version && a.language === doc.language))
}
```
acknowledge_disclosures commit apply: loads current product disclosure documents (customer language), computes the missing set, inserts one DisclosureAck row per missing doc inside the gateway transaction with sourceCommitId = the ledger row id; outcome 'applied' with data { acknowledged: [...] }; idempotent by the @@unique([quoteId, kind, version, language]) constraint + gateway replay. Legality: exposed only when an ISSUED non-expired quote exists. getQuoteInfo adds `disclosures_required: DisclosureRef[]` plus document download URLs from the registry. Integration test (acknowledge-disclosures.test.ts): ack writes rows bound to version+language; second call replays without duplicate rows; get_quote_info shows [] after ack.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/disclosures.test.ts __tests__/integration/acknowledge-disclosures.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(disclosures): DisclosureAck commit + requires set-difference predicate + quote info wiring"`

### Task D2.4: Pure schedule engine — buildSchedule with integer minor units and remainder rule
**Files:**
- Create: lib/engines/payment-schedule.ts
- Test: __tests__/lib/engines/payment-schedule.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test:
```ts
import { describe, it, expect } from 'vitest'
import { buildSchedule, INSTALLMENTS_BY_FREQUENCY } from '@/lib/engines/payment-schedule'

describe('buildSchedule', () => {
  const start = new Date('2026-06-12T00:00:00Z')
  it('frequency map is pinned', () => {
    expect(INSTALLMENTS_BY_FREQUENCY).toEqual({ annual: 1, semi_annual: 2, quarterly: 4, monthly: 12 })
  })
  it('installments sum EXACTLY to round(premiumAnnual*100); last absorbs the remainder', () => {
    const rows = buildSchedule({ premiumAnnual: 310.33, frequency: 'quarterly', startAt: start })
    expect(rows).toHaveLength(4)
    const annualMinor = Math.round(310.33 * 100) // 31033
    expect(rows.reduce((s, r) => s + r.amountMinor, 0)).toBe(annualMinor)
    expect(rows[0].amountMinor).toBe(Math.floor(annualMinor / 4)) // 7758
    expect(rows[3].amountMinor).toBe(annualMinor - 3 * Math.floor(annualMinor / 4)) // 7759
  })
  it('dueAt: first installment due at start, then evenly spaced by 12/n months', () => {
    const rows = buildSchedule({ premiumAnnual: 300, frequency: 'semi_annual', startAt: start })
    expect(rows[0].dueAt.toISOString()).toBe(start.toISOString())
    expect(rows[1].dueAt.getUTCMonth()).toBe((start.getUTCMonth() + 6) % 12)
  })
  it('annual = single installment of the full premium', () => {
    const rows = buildSchedule({ premiumAnnual: 300, frequency: 'annual', startAt: start })
    expect(rows).toEqual([{ sequence: 1, dueAt: start, amountMinor: 30000 }])
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/payment-schedule.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/payment-schedule.ts — pure, integer money
export const INSTALLMENTS_BY_FREQUENCY = { annual: 1, semi_annual: 2, quarterly: 4, monthly: 12 } as const
export type PaymentFrequency = keyof typeof INSTALLMENTS_BY_FREQUENCY
export interface InstallmentRow { sequence: number; dueAt: Date; amountMinor: number }

export function buildSchedule(input: { premiumAnnual: number; frequency: PaymentFrequency; startAt: Date }): InstallmentRow[] {
  const n = INSTALLMENTS_BY_FREQUENCY[input.frequency]
  const annualMinor = Math.round(input.premiumAnnual * 100)
  const base = Math.floor(annualMinor / n)
  const monthsStep = 12 / n
  return Array.from({ length: n }, (_, i) => {
    const dueAt = new Date(input.startAt)
    dueAt.setUTCMonth(dueAt.getUTCMonth() + i * monthsStep)
    return { sequence: i + 1, dueAt, amountMinor: i === n - 1 ? annualMinor - base * (n - 1) : base }
  })
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/payment-schedule.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): pure schedule engine — integer minor units, remainder absorbed by last installment"`

### Task D2.5: accept_quote NARROW — CAS, acceptance evidence, transactional schedule, no Policy, no conversation close
**Files:**
- Modify: lib/tools/handlers/quote-handlers.ts (acceptQuote rewritten), lib/tools/validation.ts (acceptQuoteSchema: { paymentOption: z.enum(['annual','semi_annual','quarterly']), confirmToken: z.string().optional() }), lib/tools/registry.ts
- Modify: lib/chat/action-adapter.ts ('accept_quote' GUI action carries paymentOption + token through the same gateway — M4)
- Modify: components renderer: show_policy_issued payload emission removed from accept; new uiAction type 'show_quote_accepted' { quoteId, paymentOption, firstInstallment: { amountMinor, dueAt } }
- Test: __tests__/integration/accept-quote-narrow.test.ts + __tests__/lib/engines/accept-quote-legality.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure legality test (snapshot literals over DerivedStateV3 fields):
```ts
import { describe, it, expect } from 'vitest'
import { acceptQuoteLegality } from '@/lib/engines/accept-quote-legality'

const ok = {
  quote: { status: 'ISSUED' as const, validUntil: new Date(Date.now() + 86_400_000), disclosuresRequired: [] as { kind: string }[] },
  identity: { tier: 'verified_channel' as const },
}
describe('accept_quote legality (pure)', () => {
  it('passes on ISSUED + acked disclosures + verified channel', () => {
    expect(acceptQuoteLegality(ok, new Date())).toEqual({ ok: true })
  })
  it('requires_disclosures when any disclosure outstanding', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, disclosuresRequired: [{ kind: 'IPID' }] } }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_disclosures', needs: ['IPID'] })
  })
  it('requires_identity below verified_channel (T4-R6 hard gate)', () => {
    expect(acceptQuoteLegality({ ...ok, identity: { tier: 'declared' } }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_identity', needs: ['verified_channel'] })
  })
  it('quote_expired via the shared isExpired predicate', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, validUntil: new Date(0) } }, new Date()))
      .toEqual({ ok: false, outcome: 'rejected', reason: 'quote_expired' })
  })
})
```
And the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildAcceptReadyQuote } from '@/__tests__/helpers/funnel-fixtures' // issued + disclosures acked + verified-channel customer

describe('accept_quote narrow commit', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('CAS ISSUED->ACCEPTED, persists paymentOption+acceptedAt, creates schedule, NO Policy, conversation stays ACTIVE', async () => {
    const fx = await buildAcceptReadyQuote()
    const ask = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'quarterly' } })
    const res = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'quarterly', confirmToken: ask.confirmToken } })
    expect(res.outcome).toBe('applied')
    expect(res.phaseDelta).toEqual({ from: 'QUOTE', to: 'PAYMENT' })
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('ACCEPTED')
    expect(quote.paymentFrequency).toBe('quarterly')
    expect(quote.acceptedAt).not.toBeNull()
    const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: fx.quoteId }, include: { installments: true } })
    expect(schedule.status).toBe('PENDING_FIRST_CAPTURE')
    expect(schedule.installments).toHaveLength(4)
    expect(schedule.installments.reduce((s, i) => s + i.amountMinor, 0)).toBe(Math.round(quote.premiumAnnual * 100))
    expect(await prisma.policy.count()).toBe(0) // THE FLIP: no Policy at accept
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: fx.conversationId } })
    expect(conv.status).toBe('ACTIVE') // contradiction #11
  })

  it('replay with same paymentOption returns the ORIGINAL envelope; different option -> rejected(already_applied)', async () => {
    const fx = await buildAcceptReadyQuote()
    const ask = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual' } })
    const first = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual', confirmToken: ask.confirmToken } })
    const replay = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual', confirmToken: ask.confirmToken } })
    expect(replay.outcome).toBe(first.outcome)
    expect(await prisma.paymentSchedule.count()).toBe(1) // no second effect
    const conflicting = await executeCommit({ tool: 'accept_quote', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'quarterly' } })
    expect(conflicting.outcome).toBe('rejected')
    expect(conflicting.reason).toBe('already_applied')
  })
})
```
- [ ] Step 2: Run both — expect FAIL (old handler creates Policy, marks Conversation COMPLETED, takes confirmAcceptance).
- [ ] Step 3: Implement. Pure legality:
```ts
// lib/engines/accept-quote-legality.ts
import { isExpired } from '@/lib/engines/quote-lifecycle'
export function acceptQuoteLegality(s: { quote: { status: string; validUntil: Date; disclosuresRequired: { kind: string }[] }; identity: { tier: string } }, now: Date) {
  if (s.quote.status === 'ISSUED' && isExpired({ status: 'ISSUED', validUntil: s.quote.validUntil }, now)) return { ok: false as const, outcome: 'rejected' as const, reason: 'quote_expired' }
  if (s.quote.status !== 'ISSUED') return { ok: false as const, outcome: 'rejected' as const, reason: 'illegal_transition' }
  if (s.identity.tier !== 'verified_channel') return { ok: false as const, outcome: 'requires_identity' as const, needs: ['verified_channel'] }
  if (s.quote.disclosuresRequired.length > 0) return { ok: false as const, outcome: 'requires_disclosures' as const, needs: s.quote.disclosuresRequired.map(d => d.kind) }
  return { ok: true as const }
}
```
Apply (inside the gateway transaction):
```ts
export async function applyAcceptQuote(tx: PrismaTx, snapshot: DomainSnapshot, args: { paymentOption: PaymentFrequency }): Promise<CommitApplyResult> {
  const cas = await tx.quote.updateMany({ where: { id: snapshot.quote!.id, status: 'ISSUED' }, data: { status: 'ACCEPTED', paymentFrequency: args.paymentOption, acceptedAt: new Date() } })
  if (cas.count === 0) return { outcome: 'rejected', reason: 'illegal_transition', effects: [] }
  const rows = buildSchedule({ premiumAnnual: snapshot.quote!.premiumAnnual, frequency: args.paymentOption, startAt: new Date() })
  const schedule = await tx.paymentSchedule.create({ data: { quoteId: snapshot.quote!.id, customerId: snapshot.customerId, frequency: args.paymentOption, totalInstallments: rows.length, installments: { create: rows } }, include: { installments: { orderBy: { sequence: 'asc' } } } })
  return { outcome: 'applied', effects: ['advance_phase'], data: { scheduleId: schedule.id, firstInstallment: { amountMinor: schedule.installments[0].amountMinor, dueAt: schedule.installments[0].dueAt.toISOString() } } }
}
```
Validate paymentOption ∈ get_quote_info payment_options (membership check against Product.paymentFrequencyOptions). Extend the A1 DomainSnapshot loader to include schedule existence so deriveAndExpose yields PAYMENT post-commit. Replace the show_policy_issued uiAction with show_quote_accepted; trackQuoteAccepted stays.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/accept-quote-legality.test.ts __tests__/integration/accept-quote-narrow.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(quote): narrow accept_quote — CAS, acceptance evidence, transactional schedule, no Policy, no conversation close"`

### Task D2.6: Transactional settlement inbox — exactly-once, Policy at first capture, 5xx on failure
**Files:**
- Create: lib/payments/settlement.ts (replaces lib/payments/post-payment.ts; post-payment.ts deleted)
- Modify: app/api/webhooks/stripe/route.ts, app/api/webhooks/payu/route.ts (call settlePaymentEvent; return 5xx on internal failure)
- Modify: app/api/payments/confirm/route.ts (same settlement path; provider verification mandatory — reject when providerPaymentId is null instead of settling on the client's say-so)
- Test: __tests__/integration/settlement-inbox.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { buildPendingInstallmentPayment } from '@/__tests__/helpers/funnel-fixtures' // accepted quote + schedule + PENDING Payment on installment 1

describe('settlement inbox', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('first successful capture: installment PAID, schedule advances, Policy created in PENDING_SUBMISSION with issuedAt — all in one transaction', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'quarterly' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_1', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const inst = await prisma.installment.findUniqueOrThrow({ where: { id: fx.installmentId } })
    expect(inst.status).toBe('PAID')
    const schedule = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: fx.scheduleId } })
    expect(schedule.status).toBe('ACTIVE') // first of 4 paid
    const policy = await prisma.policy.findFirstOrThrow({ where: { quoteId: fx.quoteId } })
    expect(policy.status).toBe('PENDING_SUBMISSION') // contradiction #5: issued = created here, NOT submitted
    expect(policy.issuedAt).not.toBeNull()
  })

  it('duplicate provider event settles exactly once (inbox unique key)', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_dup', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_dup', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    expect(await prisma.policy.count()).toBe(1)
    expect(await prisma.paymentEvent.count({ where: { providerEventId: 'evt_dup' } })).toBe(1)
  })

  it('second installment settlement does NOT create a second policy and completes the schedule when last', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'semi_annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_a', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const fx2 = await fx.createPendingPaymentForInstallment(2)
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_b', event: 'payment_succeeded', providerPaymentId: fx2.providerPaymentId })
    expect(await prisma.policy.count()).toBe(1)
    expect((await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: fx.scheduleId } })).status).toBe('COMPLETED')
  })

  it('payment_failed marks Payment FAILED + Installment FAILED, no policy', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_f', event: 'payment_failed', providerPaymentId: fx.providerPaymentId, failureReason: 'card_declined' })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: fx.paymentId } })).status).toBe('FAILED')
    expect(await prisma.policy.count()).toBe(0)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/settlement-inbox.test.ts` — expect FAIL (module missing).
- [ ] Step 3: Implement:
```ts
// lib/payments/settlement.ts
import { prisma } from '@/lib/db'
export interface SettlementEvent { provider: 'STRIPE' | 'PAYU' | 'MOCK'; eventId: string; event: 'payment_succeeded' | 'payment_failed'; providerPaymentId: string; failureReason?: string }

export async function settlePaymentEvent(e: SettlementEvent): Promise<{ disposition: 'applied' | 'replay' | 'unmatched' }> {
  return prisma.$transaction(async tx => {
    try {
      await tx.paymentEvent.create({ data: { provider: e.provider, providerEventId: e.eventId, providerPaymentId: e.providerPaymentId, kind: e.event, payload: e as object } })
    } catch { return { disposition: 'replay' as const } } // unique [provider,eventId] violated => already processed
    const payment = await tx.payment.findUnique({ where: { providerPaymentId: e.providerPaymentId }, include: { installment: { include: { schedule: { include: { installments: true, quote: true } } } } } })
    if (!payment) return { disposition: 'unmatched' as const }
    if (e.event === 'payment_failed') {
      await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: e.failureReason ?? 'provider_failed' } })
      await tx.installment.updateMany({ where: { id: payment.installmentId, status: 'PENDING' }, data: { status: 'FAILED' } })
      return { disposition: 'applied' as const }
    }
    const cas = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'COMPLETED', paidAt: new Date() } })
    if (cas.count === 0) return { disposition: 'replay' as const }
    await tx.installment.update({ where: { id: payment.installmentId }, data: { status: 'PAID', paidAt: new Date() } })
    const schedule = payment.installment.schedule
    const paidCount = schedule.installments.filter(i => i.status === 'PAID' || i.id === payment.installmentId).length
    const isFirstCapture = paidCount === 1
    await tx.paymentSchedule.update({ where: { id: schedule.id }, data: { status: paidCount === schedule.totalInstallments ? 'COMPLETED' : 'ACTIVE' } })
    if (isFirstCapture) {
      await tx.policy.create({ data: { quoteId: schedule.quoteId, customerId: schedule.customerId, productId: schedule.quote.productId, status: 'PENDING_SUBMISSION', premiumAnnual: schedule.quote.premiumAnnual, premiumMonthly: schedule.quote.premiumMonthly, paymentFrequency: schedule.frequency, coverageSummary: schedule.quote.coverages as object, issuedAt: new Date() } })
    }
    return { disposition: 'applied' as const }
  })
}
```
Side effects (confirmation email + magic link, lifted from post-payment.ts) run AFTER the transaction, best-effort, only when disposition === 'applied' && first capture. The SUBMITTED write is gone (paid ≠ submitted — T9.D3). Webhook routes: on internal error return NextResponse.json({ error: 'processing_failed' }, { status: 500 }) so the provider retries (replacing 200-swallow); 200 only for verified-but-irrelevant ('ignored' / unmatched) events. Confirm route POST: when payment.providerPaymentId is null → 409, never settle unverified.
- [ ] Step 4: Run `npx vitest run __tests__/integration/settlement-inbox.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): transactional settlement inbox — exactly-once, Policy at first capture, 5xx on failure"`

### Task D2.7: Provider hardening — PayU unsigned rejection, Stripe 'ignored' variant, eventId plumbing
**Files:**
- Modify: lib/payments/types.ts (WebhookEvent: event gains 'ignored'; eventId: string required)
- Modify: lib/payments/providers/stripe.ts (event.id passed through; unknown types → { event: 'ignored' }), lib/payments/providers/payu.ts (derived eventId `${orderId}:${status}`; unsigned payloads THROW), lib/payments/providers/mock.ts (eventId)
- Test: __tests__/lib/payments/providers.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing provider unit tests (no DB):
```ts
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { PayUPaymentProvider } from '@/lib/payments/providers/payu'

describe('PayU webhook signature (security hardening)', () => {
  const provider = new PayUPaymentProvider()
  const payload = JSON.stringify({ order: { orderId: 'o1', status: 'COMPLETED' } })

  it('REJECTS payloads whose signature header lacks a signature= segment (closes the bypass at payu.ts:186)', async () => {
    await expect(provider.handleWebhook(payload, 'algorithm=MD5;sender=checkout')).rejects.toThrow(/signature/i)
  })
  it('rejects wrong signatures, accepts correct HMAC-MD5, and derives eventId orderId:status', async () => {
    process.env.PAYU_MERCHANT_ID = 'm'; process.env.PAYU_SECRET_KEY = 'sk'
    const good = crypto.createHmac('md5', 'sk').update(payload).digest('hex')
    await expect(provider.handleWebhook(payload, `signature=deadbeef;algorithm=MD5`)).rejects.toThrow()
    const evt = await provider.handleWebhook(payload, `signature=${good};algorithm=MD5`)
    expect(evt).toMatchObject({ event: 'payment_succeeded', providerPaymentId: 'o1', eventId: 'o1:COMPLETED' })
  })
})
```
Plus a Stripe test asserting an unknown event type maps to `{ event: 'ignored', eventId: <stripe event.id> }` (construct via the provider's event-mapping function extracted for testability — export mapStripeEvent(event) from providers/stripe.ts and test it directly with a literal `{ id: 'evt_x', type: 'customer.created' }`).
- [ ] Step 2: Run `npx vitest run __tests__/lib/payments/providers.test.ts` — expect FAIL (bypass present, eventId missing, unknown types masquerade as payment_succeeded).
- [ ] Step 3: Implement: types.ts `WebhookEvent { event: 'payment_succeeded' | 'payment_failed' | 'ignored'; eventId: string; providerPaymentId: string; metadata?: Record<string, unknown> }`. PayU: `if (!expectedHash) throw new Error('Missing PayU webhook signature')` (NOTE in code comment: HMAC-MD5 scheme must be validated against the OpenPayU IPN spec before production — flagged per T8.D3). Stripe: export mapStripeEvent; unknown types return { event: 'ignored', eventId: event.id, providerPaymentId: '' }; known types carry event.id. Mock: eventId = `mock_${providerPaymentId}`. Webhook routes translate WebhookEvent → SettlementEvent (skip settlement for 'ignored').
- [ ] Step 4: Run `npx vitest run __tests__/lib/payments/providers.test.ts && npx tsc --noEmit` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "fix(payments): reject unsigned PayU webhooks, explicit ignored variant, provider event ids"`

### Task D2.8: Re-anchor initiate_payment + confirm flow to the schedule (interim until D3)
**Files:**
- Modify: lib/tools/handlers/payment-handlers.ts (gate: accepted quote + schedule with a due PENDING installment; amount from installment.amountMinor; Payment row created with installmentId)
- Modify: lib/chat/context-builder.ts (policy injection tolerant of policy-absent payment phase; injects schedule summary instead)
- Test: __tests__/integration/initiate-payment-schedule.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { initiatePayment } from '@/lib/tools/handlers/payment-handlers'
import { buildAcceptedQuoteWithSchedule } from '@/__tests__/helpers/funnel-fixtures'

describe('initiate_payment re-anchored to schedule (no Policy prerequisite)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('creates a PENDING Payment on the first due installment with the installment amount', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' }) // NO policy row exists
    const res = await initiatePayment({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    expect(res.success).toBe(true)
    const payment = await prisma.payment.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(payment.installmentId).toBe(fx.firstInstallmentId)
    expect(payment.amountMinor).toBe(fx.firstInstallmentAmountMinor) // never premiumMonthly fallback
    expect(res.uiAction?.type).toBe('show_payment')
  })
  it('fails with no_due_installment when the schedule is fully settled', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual', settle: true })
    const res = await initiatePayment({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no_due_installment/)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/initiate-payment-schedule.test.ts` — expect FAIL (handler still resolves a Policy and gates on PENDING_SUBMISSION).
- [ ] Step 3: Rewrite initiatePayment: resolve conversation → application → quote(ACCEPTED) → schedule (status in [PENDING_FIRST_CAPTURE, ACTIVE]) → first installment with status PENDING ordered by sequence; `amount = installment.amountMinor`; provider.createPaymentIntent({ amount, currency, customerId, policyId: schedule.quoteId, description: `Installment ${installment.sequence}/${schedule.totalInstallments}` }) (the provider input field name stays until D3's interface pass); create Payment { installmentId, customerId, amountMinor, provider, providerPaymentId, status: 'PENDING' }. The annual-vs-monthly branch and the Policy gate are deleted. context-builder: replace policy premium injection with `{ schedule: { frequency, nextDueAmountMinor, paidCount, totalInstallments } }` when a schedule exists and policy when a policy exists.
- [ ] Step 4: Run `npx vitest run __tests__/integration/initiate-payment-schedule.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): initiate_payment reads the schedule — installment amounts, no policy prerequisite"`

### Task D2.9: Conversation terminality — hard-reject removed, reactivate-on-turn, archival sweep
**Files:**
- Modify: lib/chat/orchestrator.ts (delete the COMPLETED/ABANDONED guard at lines 351-353; insert reactivate-on-turn)
- Modify: lib/tools/handlers/utility-handlers.ts (escalate_to_human stops writing IDLE — status writes removed; WorkItem persistence is Block E)
- Create: scripts/archive-inactive-conversations.ts
- Test: __tests__/integration/conversation-terminality.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { reactivateIfArchived } from '@/lib/chat/turn-context'
import { archiveInactiveConversations } from '@/scripts/archive-inactive-conversations'

describe('conversations are channels (contradiction #11)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('a turn on an ARCHIVED conversation reactivates it instead of throwing', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, status: 'ARCHIVED', archivedAt: new Date() } })
    await reactivateIfArchived(conv.id)
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe('ACTIVE')
  })
  it('sweep archives conversations idle beyond the window and leaves recent ones alone', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const stale = await prisma.conversation.create({ data: { customerId: customer.id, lastActivityAt: new Date(Date.now() - 40 * 86_400_000) } })
    const fresh = await prisma.conversation.create({ data: { customerId: customer.id } })
    const n = await archiveInactiveConversations({ idleDays: 30 })
    expect(n).toBe(1)
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('ARCHIVED')
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('ACTIVE')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/conversation-terminality.test.ts` — expect FAIL.
- [ ] Step 3: Implement: export reactivateIfArchived(conversationId) from lib/chat/turn-context.ts (`updateMany({ where: { id, status: 'ARCHIVED' }, data: { status: 'ACTIVE', archivedAt: null } })`) and call it at the top of the turn pipeline where the hard-reject used to throw; delete the guard. archiveInactiveConversations({ idleDays = Number(process.env.CONVERSATION_IDLE_ARCHIVE_DAYS ?? 30) }) updates ACTIVE conversations with lastActivityAt older than the window to ARCHIVED + archivedAt and returns the count; script entry point runs it via `npx tsx scripts/archive-inactive-conversations.ts` printing the count. Nothing in the funnel writes Conversation.status any more — verify with `grep -rn "conversation.update" lib/ | grep -i status` returning only these two call sites.
- [ ] Step 4: Run `npx vitest run __tests__/integration/conversation-terminality.test.ts && npx vitest run` — expect PASS (navigation/orchestrator tests updated where they asserted the throw).
- [ ] Step 5: Commit: `git commit -m "feat(conversation): channels not funnels — reactivate-on-turn, archival sweep, hard-reject removed"`

### Task D2.10: Coupled-flip verification — full suite + end-to-end money sim
**Files:**
- Create: scripts/verify-coupled-flip.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-coupled-flip.ts (npx tsx, dev DB, MOCK provider): drives issue → acknowledge_disclosures → accept_quote(quarterly, token) → asserts 4 installments summing to round(premiumAnnual*100), Quote ACCEPTED+acceptedAt, ZERO Policy rows, Conversation ACTIVE → initiate_payment → settlePaymentEvent(success) delivered TWICE with the same eventId → asserts exactly one Policy in PENDING_SUBMISSION with issuedAt, installment 1 PAID, schedule ACTIVE → prints PASS/FAIL per checkpoint, exit code non-zero on any failure.
- [ ] Step 2: Run `npx vitest run` — full suite green (instrumentation flake rule applies).
- [ ] Step 3: Run `npx tsx scripts/verify-coupled-flip.ts` — expect `PASS 8/8`.
- [ ] Step 4: Review the M9 coupling checklist: accept creates no Policy AND settlement creates it — confirmed in the same package; no code path remains that creates a Policy outside lib/payments/settlement.ts (`grep -rn "policy.create" lib/ app/` → exactly one hit).
- [ ] Step 5: Commit: `git commit -m "test(payments): coupled-flip end-to-end verification sim"`


### ⚠ Binding errata for D2 (fidelity verifier — apply OVER the task text above)

1. **[D2.5 / step 3 (acceptQuoteLegality) and D1.4 legality predicate]** Ambiguous against contradiction #6 (deriveAndExpose is the ONLY computation of exposure/legality; the T12.D5 meta-test forbids a second implementation). acceptQuoteLegality re-decides quote_expired/illegal_transition/requires_identity/requires_disclosures but the plan never says who calls it — if the handler calls it ad-hoc, Block D ships a parallel legality path that the #6 closure meta-test must reject.
   **Fix:** State explicitly (D1.4, D1.7 already does this for mutationBlockedReason): all per-commit pure predicates (acceptQuoteLegality, frozen-application, disclosuresRequired, freeLookDecision) are registered as exposure-predicate inputs consumed by A1's deriveAndExpose / the A2 gateway legality step — they are decision-core helpers, never called directly from handlers. Add one sentence per task and keep the pure tests unchanged.
2. **[D2.4 / steps 1+3 (INSTALLMENTS_BY_FREQUENCY)]** The pinned frequency map includes monthly: 12 and the test asserts it, while the same package (and D1's migration bullet, ratified T7.D3) pins the sellable set as { annual, semi_annual, quarterly } with 'monthly is NOT sellable — kills the monthly-undercharge class'. The PaymentFrequency type therefore admits a value no commit may elect, and applyAcceptQuote's signature accepts it while zod rejects it.
   **Fix:** Drop 'monthly' from INSTALLMENTS_BY_FREQUENCY and the PaymentFrequency type (and from the pinned-map test), or — if engine-level support is wanted for the future — keep it but add an explicit test that accept_quote and change_payment_option reject 'monthly' via Product.paymentFrequencyOptions membership, and a code comment stating monthly is config-gated, not sellable.
3. **[D2.1 / step 3 and D2.9 (ConversationStatus compile coherence + task overlap)]** Two problems: (a) the compile-fix list omits lib/simulation/driver.ts, which writes Conversation status 'COMPLETED'/'ABANDONED' and completedAt (driver.ts:237-239, 273-275) — tsc fails at D2.1; (b) the orchestrator guard comparing status to 'COMPLETED'/'ABANDONED' (orchestrator.ts:351-353) and the escalate IDLE write are compile errors at D2.1 but their removal is scheduled in D2.9 — the same code can't be 'fixed for coherence' in D2.1 and 'deleted' in D2.9. D2.9's closing grep audit ('only these two call sites') is also wrong: archiveInactiveConversations lives in scripts/ (so lib/ has one site), and driver.ts still updates status unless touched.
   **Fix:** In D2.1 step 3: add lib/simulation/driver.ts to the fix list (sim completion stops writing Conversation.status/completedAt — record completion on the Simulation* entities only), and state that the orchestrator guard and the IDLE write are REMOVED here as part of compile coherence. Rescope D2.9 to: add reactivateIfArchived + wire it into the turn pipeline + the sweep script + the behavioral tests. Correct the audit to: grep status-writing conversation.update/updateMany across lib/ returns exactly one hit (turn-context reactivate).
4. **[D2.7 / step 1 (PayU env ordering)]** PayUPaymentProvider.handleWebhook calls getPayUConfig() first (payu.ts:22-31), which throws 'PAYU_MERCHANT_ID and PAYU_SECRET_KEY must be set...' when env is missing. The first test sets no env (env is set only inside the second it), so rejects.toThrow(/signature/i) will receive the config error and fail.
   **Fix:** Set process.env.PAYU_MERCHANT_ID/'PAYU_SECRET_KEY' in a beforeAll for the whole describe block (and restore in afterAll), or specify that the implementation moves the missing-signature hard-reject before the config read.
5. **[D2.2 / step 1 (contentHash assertion)]** Literal placeholder inside test code: expect(doc.contentHash).toBe('e2cd1a5a8e0a6e3c…replace-with-real-sha256-of-receipt') — violates the no-placeholders rule even though the computing command is given (and the placeholder prefix isn't even the right hash).
   **Fix:** Inline the real digest now: sha256('receipt') = '6f32860910ca0fb2a20c7fda143666b09dbf8db5238195c90a586fb542ff0cad'. Remove the 'replace-with' note.
6. **[D2.3 / step 1 (integration test prose-only)]** Only the pure disclosuresRequired test has code. The integration test (__tests__/integration/acknowledge-disclosures.test.ts) — ack rows bound to version+language, replay without duplicates, get_quote_info shows [] after ack — is described in prose in step 3, violating the TDD test-code rule.
   **Fix:** Add the actual vitest code block in step 1: buildIssuedQuote + seedDocuments fixture; executeCommit({tool:'acknowledge_disclosures',...}) -> expect 2 DisclosureAck rows with {kind,version,language} matching the seeded docs and sourceCommitId set; second executeCommit -> same envelope, prisma.disclosureAck.count() still 2; getQuoteInfo -> disclosures_required toEqual([]).
7. **[D2.6 vs D2.7 ordering (eventId plumbing)]** D2.6 step 3 wires app/api/webhooks/*/route.ts to settlePaymentEvent, which requires an eventId — but WebhookEvent gains eventId only in D2.7. At the end of D2.6 the routes cannot construct a SettlementEvent without inventing a key that would corrupt the dedup inbox.
   **Fix:** Either swap D2.6/D2.7 order (provider hardening first), or restrict D2.6 to lib/payments/settlement.ts + the confirm route (which can derive eventId from its own verified getPaymentStatus call) and move the two webhook-route rewrites into D2.7 step 3.
8. **[D2.x/D3.x/D4.x fixture builders (funnel-fixtures.ts)]** Several fixtures are consumed but never given a definition step: fx.createPendingPaymentForInstallment(2) (D2.6), buildAcceptedQuoteWithSchedule's options/returns ({settle, settleFirstInstallment, firstInstallmentId, firstInstallmentAmountMinor}) (D2.8/D3.x), buildAcceptReadyQuote (D2.5), buildPaidPolicy returning fx.issuedAt (D4.2), buildActivatedPolicy incl. the hardcoded 'AZT-123' and stopAt option (D4.4/D4.5/D4.6), operatorRequest (D4.3, with conditional 'if present; otherwise' phrasing). Engineers with zero context cannot reconstruct them.
   **Fix:** Add an explicit fixture-spec block to the FIRST task that uses each builder (one paragraph + signature per builder: inputs, exact rows created via which commits, returned ids/values — e.g. buildActivatedPolicy = buildPaidPolicy + mark_submitted + activate_policy('AZT-123'), returns {policyId, customerId, conversationId, quoteId, issuedAt}). Replace D4.3's conditional phrasing with the definite pattern: craft a NextRequest with a signToken({role:'OPERATOR'}) cookie (lib/auth/jwt.ts:27) — route tests already exist under __tests__/app/api as precedent.
9. **[D2.7 / step 3 (mock provider ids under @unique)]** MockPaymentProvider.createPaymentIntent returns providerPaymentId = `mock_pay_${Date.now()}` (mock.ts:26); D2.1 makes Payment.providerPaymentId @unique — two intents created in the same millisecond (supersede-then-create paths in D3.3, fast test loops) collide with P2002.
   **Fix:** While editing mock.ts for eventId in D2.7, change providerPaymentId to `mock_pay_${crypto.randomUUID()}` and derive eventId from it.
10. **[D2.5 / Files, D3.5 / Files, D4.4 / Files (non-exact paths)]** Violations of the exact-path rule: D2.5 'components renderer: show_policy_issued payload emission removed...', D3.5 'components showing show_payment', D4.4 'A1 snapshot loader'. The actual files are components/chat/rich/rich-content.tsx (show_policy_issued case + show_payment case at line 266) and lib/i18n/translations.ts for the mode label keys; the A1 loader has no named path anywhere in the block.
   **Fix:** Replace with exact entries: 'Modify: components/chat/rich/rich-content.tsx (replace show_policy_issued case with show_quote_accepted; show_payment case reads payload.mode)', 'Modify: lib/i18n/translations.ts (payment.mode.started/resumed/retried keys, ro+en)'. For the A1 snapshot loader, name the file as defined by Block A (e.g. lib/engines/derive-and-expose.ts or its loader module) and tag it '(cross-block: A1-owned, coordinate)' — or move the snapshot-loader extension into an explicitly-named A1-coordination bullet in depends_on.

### ➕ Addendum tasks for D2 (binding — coverage-critic gaps)

### Task D2.ADD-1: alert_flag WorkItems from payment-inbox anomalies (closes G11a)
**Files:**
- Modify: the webhook inbox processor (D2)
- Test: extend the inbox integration tests
**Steps:**
- [ ] Step 1: Failing integration test: an inbox event with (a) bad signature, (b) amount mismatch vs the schedule row, or (c) unknown event type after retry exhaustion creates `WorkItem{kind:'alert_flag', refs:{paymentId|eventId}, reason}` exactly once (idempotent on redelivery).
- [ ] Step 2: FAIL → Step 3: wire `createWorkItem` (E2 interface) into the three anomaly paths inside the inbox transaction. Step 4: PASS. Step 5: commit.

## Package D3: Payment operations: get_payment_status, ensure_payment_session, change_payment_option

**Execution slot:** 17 | **Depends on:** D2

**Goal:** Build the payment-phase tool surface on the schedule substrate. get_payment_status is the ONLY payment read and answers exclusively from PaymentSchedule/Installment/Payment state (contradiction #3 — never from Quote money fields), deriving next_due, captured count, last failure, and a read-time 'abandoned' signal for stale PENDING attempts. ensure_payment_session replaces the initiate/resume/retry trio (T8.D4): one commit whose engine-determined mode (started|resumed|retried) is output, not input, and which makes the single-open-attempt-per-installment invariant structural — superseding (provider-cancelling) any prior open intent instead of stacking capturable ones (closes the live double-charge surface). change_payment_option re-rates pre-capture only by regenerating installment rows via the same pure schedule engine fed from the quote's calculateQuote-derived premium, superseding the old schedule (retained for audit) and never mutating the accepted Quote (T8.D5); it returns the re_rating effect with an old-vs-new payload and rides requires_confirmation. The M4 renderer pass moves the GUI 'Pay now' button and show_payment surface onto ensure_payment_session and retires initiate_payment.

**Migrations / seeds:**
- prisma/schema.prisma: enum PaymentStatus gains SUPERSEDED (terminal state for provider-cancelled superseded intents; REFUNDED comes alive in D4).
- No other schema changes — supersededById and the schedule statuses landed in D2; seeds untouched.

### Task D3.1: Pure schedule-position derivation (next due, captured count, stale/abandoned)
**Files:**
- Create: lib/engines/payment-position.ts
- Test: __tests__/lib/engines/payment-position.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test:
```ts
import { describe, it, expect } from 'vitest'
import { deriveSchedulePosition } from '@/lib/engines/payment-position'

const now = new Date('2026-06-12T12:00:00Z')
const inst = (seq: number, status: string, amountMinor = 7500) => ({ id: `i${seq}`, sequence: seq, status, amountMinor, dueAt: new Date('2026-06-01T00:00:00Z') })

describe('deriveSchedulePosition', () => {
  it('reports nextDue as the lowest-sequence PENDING/FAILED installment and counts captures', () => {
    const pos = deriveSchedulePosition({ installments: [inst(1, 'PAID'), inst(2, 'PENDING'), inst(3, 'PENDING')], payments: [], now })
    expect(pos.capturedCount).toBe(1)
    expect(pos.nextDue?.sequence).toBe(2)
  })
  it('mode resolution: no attempt -> started; open PENDING attempt -> resumed; last attempt FAILED -> retried', () => {
    const base = { installments: [inst(1, 'PENDING')], now }
    expect(deriveSchedulePosition({ ...base, payments: [] }).recoveryMode).toBe('started')
    expect(deriveSchedulePosition({ ...base, payments: [{ installmentId: 'i1', status: 'PENDING', createdAt: now }] }).recoveryMode).toBe('resumed')
    expect(deriveSchedulePosition({ installments: [inst(1, 'FAILED')], payments: [{ installmentId: 'i1', status: 'FAILED', createdAt: now }], now }).recoveryMode).toBe('retried')
  })
  it('flags a PENDING attempt older than the staleness window as abandoned (read-time, no cron)', () => {
    const old = new Date(now.getTime() - 25 * 3600_000)
    const pos = deriveSchedulePosition({ installments: [inst(1, 'PENDING')], payments: [{ installmentId: 'i1', status: 'PENDING', createdAt: old }], now, staleAfterHours: 24 })
    expect(pos.openAttemptStale).toBe(true)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/payment-position.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/payment-position.ts — pure
export interface PositionInput {
  installments: { id: string; sequence: number; status: string; amountMinor: number; dueAt: Date }[]
  payments: { installmentId: string; status: string; createdAt: Date }[]
  now: Date
  staleAfterHours?: number
}
export function deriveSchedulePosition(i: PositionInput) {
  const sorted = [...i.installments].sort((a, b) => a.sequence - b.sequence)
  const capturedCount = sorted.filter(x => x.status === 'PAID').length
  const nextDue = sorted.find(x => x.status === 'PENDING' || x.status === 'FAILED') ?? null
  const attempts = nextDue ? i.payments.filter(p => p.installmentId === nextDue.id) : []
  const open = attempts.find(p => p.status === 'PENDING') ?? null
  const lastFailed = attempts.some(p => p.status === 'FAILED')
  const recoveryMode: 'started' | 'resumed' | 'retried' = open ? 'resumed' : lastFailed ? 'retried' : 'started'
  const staleMs = (i.staleAfterHours ?? 24) * 3600_000
  const openAttemptStale = open !== null && i.now.getTime() - open.createdAt.getTime() > staleMs
  return { capturedCount, nextDue, recoveryMode, openAttempt: open, openAttemptStale, settled: nextDue === null }
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/payment-position.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): pure schedule-position derivation (next due, recovery mode, staleness)"`

### Task D3.2: get_payment_status read — schedule is the only money truth
**Files:**
- Modify: lib/tools/handlers/payment-handlers.ts (add getPaymentStatus)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (register get_payment_status, zero-arg)
- Test: __tests__/integration/get-payment-status.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { getPaymentStatus } from '@/lib/tools/handlers/payment-handlers'
import { buildAcceptedQuoteWithSchedule } from '@/__tests__/helpers/funnel-fixtures'

describe('get_payment_status', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('answers from schedule state only — amounts are installment amountMinor, even when Quote floats disagree', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' })
    // poison the quote display figure to prove the read never touches it (contradiction #3)
    await prisma.quote.update({ where: { id: fx.quoteId }, data: { premiumQuarterly: 999999 } })
    const res = await getPaymentStatus({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    const d = res.data as { frequency: string; installments: { sequence: number; amountMinor: number; status: string }[]; nextDue: { sequence: number; amountMinor: number } }
    expect(d.frequency).toBe('quarterly')
    expect(d.installments).toHaveLength(4)
    expect(d.nextDue.amountMinor).toBe(fx.firstInstallmentAmountMinor)
    expect(d.installments.every(i => i.amountMinor < 999999 * 100)).toBe(true)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/get-payment-status.test.ts` — expect FAIL.
- [ ] Step 3: Implement getPaymentStatus: resolve customer's active schedule (status in [PENDING_FIRST_CAPTURE, ACTIVE, COMPLETED], not SUPERSEDED) via conversation→application→quote chain falling back to customer-scoped lookup (returning users); load installments+payments; run deriveSchedulePosition; return { frequency, status, installments: [{sequence, dueAt, amountMinor, status}], nextDue, capturedCount, lastFailureReason, openAttemptStale }. No Quote field is read except the relation key.
- [ ] Step 4: Run `npx vitest run __tests__/integration/get-payment-status.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): get_payment_status reads only the schedule"`

### Task D3.3: ensure_payment_session commit — single open attempt, engine-determined mode
**Files:**
- Modify: lib/tools/handlers/payment-handlers.ts (ensurePaymentSession replaces initiatePayment)
- Modify: lib/payments/types.ts (PaymentProvider gains cancelPaymentIntent(providerPaymentId): Promise<void>; createPaymentIntent input field policyId renamed referenceId), lib/payments/providers/*.ts (implement cancel; mock no-ops, Stripe paymentIntents.cancel, PayU order cancel)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (deregister initiate_payment, register ensure_payment_session)
- Test: __tests__/integration/ensure-payment-session.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildAcceptedQuoteWithSchedule } from '@/__tests__/helpers/funnel-fixtures'
import { settlePaymentEvent } from '@/lib/payments/settlement'

describe('ensure_payment_session (single-open-attempt invariant)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('first call mode=started; second call supersedes the first intent — never two capturable PENDING rows', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
    const a = await executeCommit({ tool: 'ensure_payment_session', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect((a.data as { mode: string }).mode).toBe('started')
    const b = await executeCommit({ tool: 'ensure_payment_session', actor: 'gui', conversationId: fx.conversationId, args: {} })
    expect(['resumed']).toContain((b.data as { mode: string }).mode)
    const pending = await prisma.payment.findMany({ where: { customerId: fx.customerId, status: 'PENDING' } })
    expect(pending).toHaveLength(1) // the invariant, structurally
    expect(await prisma.payment.count({ where: { customerId: fx.customerId, status: 'SUPERSEDED' } })).toBeLessThanOrEqual(1)
  })

  it('after a FAILED settlement the next call is mode=retried with a fresh intent', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
    const a = await executeCommit({ tool: 'ensure_payment_session', actor: 'agent', conversationId: fx.conversationId, args: {} })
    const p = await prisma.payment.findFirstOrThrow({ where: { status: 'PENDING' } })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_fail', event: 'payment_failed', providerPaymentId: p.providerPaymentId!, failureReason: 'card_declined' })
    const b = await executeCommit({ tool: 'ensure_payment_session', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect((b.data as { mode: string }).mode).toBe('retried')
    expect(await prisma.payment.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('settled schedule -> rejected(no_due_installment)', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual', settle: true })
    const res = await executeCommit({ tool: 'ensure_payment_session', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('no_due_installment')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/ensure-payment-session.test.ts` — expect FAIL (tool unknown).
- [ ] Step 3: Implement apply:
```ts
export async function applyEnsurePaymentSession(tx: PrismaTx, snapshot: DomainSnapshot): Promise<CommitApplyResult> {
  const { schedule, installments, payments } = snapshot.paymentState!
  const pos = deriveSchedulePosition({ installments, payments, now: new Date() })
  if (!pos.nextDue) return { outcome: 'rejected', reason: 'no_due_installment', effects: [] }
  const provider = getPaymentProvider()
  if (pos.openAttempt && !pos.openAttemptStale) {
    // reuse the canonical open session
    const open = await tx.payment.findUniqueOrThrow({ where: { providerPaymentId: pos.openAttempt.providerPaymentId! } })
    return { outcome: 'applied', effects: [], data: { mode: 'resumed', paymentId: open.id, amountMinor: open.amountMinor } }
  }
  if (pos.openAttempt) {
    // stale: supersede — cancel at the provider, mark SUPERSEDED, then create fresh
    await provider.cancelPaymentIntent(pos.openAttempt.providerPaymentId!)
    await tx.payment.updateMany({ where: { providerPaymentId: pos.openAttempt.providerPaymentId!, status: 'PENDING' }, data: { status: 'SUPERSEDED' } })
  }
  const intent = await provider.createPaymentIntent({ amount: pos.nextDue.amountMinor, currency: schedule.currency, customerId: snapshot.customerId, referenceId: schedule.id, description: `Installment ${pos.nextDue.sequence}/${schedule.totalInstallments}` })
  const payment = await tx.payment.create({ data: { installmentId: pos.nextDue.id, customerId: snapshot.customerId, amountMinor: pos.nextDue.amountMinor, provider: provider.name.toUpperCase() as 'STRIPE' | 'PAYU' | 'MOCK', providerPaymentId: intent.providerPaymentId, status: 'PENDING' } })
  return { outcome: 'applied', effects: [], data: { mode: pos.recoveryMode === 'resumed' ? 'started' : pos.recoveryMode, paymentId: payment.id, amountMinor: payment.amountMinor }, uiAction: { type: 'show_payment', payload: { clientSecret: intent.clientSecret, redirectUrl: intent.redirectUrl ?? null, amountMinor: payment.amountMinor, paymentId: payment.id, mode: pos.recoveryMode } } }
}
```
Legality: exposed when an unsettled schedule exists (PAYMENT phase). Delete initiatePayment and its registration. NOTE: provider intent creation happens before the DB transaction commits — wrap so a tx rollback cancels the just-created intent (try/catch calling provider.cancelPaymentIntent on failure).
- [ ] Step 4: Run `npx vitest run __tests__/integration/ensure-payment-session.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): ensure_payment_session — one commit, engine-determined mode, single open attempt"`

### Task D3.4: change_payment_option — supersede the schedule, never the Quote
**Files:**
- Modify: lib/tools/handlers/payment-handlers.ts (changePaymentOption apply)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (register change_payment_option { paymentOption, confirmToken? }, requiresConfirmation: true)
- Test: __tests__/integration/change-payment-option.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildAcceptedQuoteWithSchedule } from '@/__tests__/helpers/funnel-fixtures'

describe('change_payment_option (pre-capture re-rating)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('supersedes the schedule with re-rated rows and NEVER mutates the accepted Quote', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' })
    const before = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    const ask = await executeCommit({ tool: 'change_payment_option', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual' } })
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await executeCommit({ tool: 'change_payment_option', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual', confirmToken: ask.confirmToken } })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('re_rating')
    const data = res.data as { oldScheduleId: string; newScheduleId: string }
    const oldS = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: data.oldScheduleId } })
    expect(oldS.status).toBe('SUPERSEDED')
    expect(oldS.supersededById).toBe(data.newScheduleId)
    const newS = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: data.newScheduleId }, include: { installments: true } })
    expect(newS.frequency).toBe('annual')
    expect(newS.installments).toHaveLength(1)
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(after).toEqual(before) // acceptance evidence is immutable (contradiction #3)
  })

  it('rejected(schedule_already_captured) once any installment is PAID', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly', settleFirstInstallment: true })
    const res = await executeCommit({ tool: 'change_payment_option', actor: 'agent', conversationId: fx.conversationId, args: { paymentOption: 'annual' } })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('schedule_already_captured')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/change-payment-option.test.ts` — expect FAIL.
- [ ] Step 3: Implement apply: legality capturedCount === 0 else rejected(schedule_already_captured); validate option membership like accept_quote; inside the transaction: cancel+SUPERSEDE any open PENDING intent (reuse the supersede block from D3.3), create new schedule via buildSchedule({ premiumAnnual: quote.premiumAnnual, frequency: args.paymentOption, startAt: new Date() }) (same calculateQuote-derived figure the acceptance priced — re-rating without touching the quote), mark old schedule { status: 'SUPERSEDED', supersededById }, return { outcome: 'applied', effects: ['re_rating'], data: { oldScheduleId, newScheduleId, oldFrequency, newFrequency, oldTotalMinor, newTotalMinor } }. get_payment_status and ensure_payment_session already filter SUPERSEDED schedules out (D3.2/D3.3) — add an assertion to the existing get-payment-status test that after a change the read reports the new frequency.
- [ ] Step 4: Run `npx vitest run __tests__/integration/change-payment-option.test.ts __tests__/integration/get-payment-status.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(payments): change_payment_option supersedes the schedule, quote immutable"`

### Task D3.5: M4 renderer/adapter pass — GUI Pay button rides ensure_payment_session
**Files:**
- Modify: lib/chat/action-adapter.ts (payment GUI actions → { name: 'ensure_payment_session', arguments: {} }; initiate_payment mapping deleted)
- Modify: components showing show_payment (payload gains mode; copy keyed by mode code, localized in the component per M6 — engine emits codes only)
- Test: __tests__/lib/chat/payment-action-adapter.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('payment GUI actions go through the same commit as the agent (M4 swap test)', () => {
  it('pay_now maps to ensure_payment_session with no mode input (mode is engine output)', () => {
    const call = adaptAction({ type: 'pay_now', payload: {} })
    expect(call).toMatchObject({ name: 'ensure_payment_session', arguments: {} })
  })
  it('no GUI action maps to initiate_payment any more', () => {
    expect(() => adaptAction({ type: 'initiate_payment', payload: {} })).toThrow()
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/chat/payment-action-adapter.test.ts` — expect FAIL.
- [ ] Step 3: Implement the adapter changes; update the show_payment renderer to read payload.mode ('started'|'resumed'|'retried') for its button label translation key (translations.ts keys payment.mode.started/resumed/retried in ro+en).
- [ ] Step 4: Run `npx vitest run __tests__/lib/chat/payment-action-adapter.test.ts && npx vitest run` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(ui): payment surfaces ride ensure_payment_session (swap-test parity)"`

### Task D3.6: Package verification — full suite + payment-ops sim
**Files:**
- Create: scripts/verify-payment-ops.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-payment-ops.ts (npx tsx, MOCK provider): accept a quote (quarterly) → get_payment_status shows 4 pending → ensure_payment_session twice → exactly one PENDING Payment → change_payment_option to annual (token) → superseded chain intact, status read shows 1 installment → settle first capture → Policy exists → change_payment_option now rejected(schedule_already_captured) → ensure_payment_session rejected(no_due_installment). Print per-checkpoint PASS/FAIL, non-zero exit on failure.
- [ ] Step 2: Run `npx vitest run` — full suite green (instrumentation flake rule applies).
- [ ] Step 3: Run `npx tsx scripts/verify-payment-ops.ts` — expect `PASS 7/7`.
- [ ] Step 4: Grep audit: `grep -rn "initiate_payment" lib/ app/ prisma/seeds/` returns zero hits; `grep -rn "premiumMonthly\|premiumQuarterly\|premiumSemiAnnual" lib/tools/handlers/payment-handlers.ts` returns zero hits (schedule is the only money source).
- [ ] Step 5: Commit: `git commit -m "test(payments): payment operations verification sim"`


### ⚠ Binding errata for D3 (fidelity verifier — apply OVER the task text above)

1. **[D3.3 / step 1 (ensure_payment_session vs replay-first)]** Contradicts the pinned gateway sequence: replay detection is 'same tool + same target + same material-args hash' and replay returns the ORIGINAL envelope. ensure_payment_session is called twice with identical args ({}); per #8 the second call is a replay and must return the first envelope (mode 'started'), but the test asserts fresh execution with mode 'resumed' and the whole tool concept depends on re-execution.
   **Fix:** Define the replay key explicitly: register ensure_payment_session with material args that include the resolved target installment id + the id/status-generation of the current open attempt (computed server-side into the args hash), or mark the commit replay-exempt in the A2 registry with a documented rationale (the apply IS the idempotency mechanism — it returns the canonical open session). Add this to the task's step 3 and note the A2 dependency.
2. **[D3.5 / steps 1+3 (adapter contract)]** Test asserts expect(() => adaptAction({type:'initiate_payment'})).toThrow(), but adaptAction's documented contract returns null for unrecognized types (action-adapter.ts:29-31, default branch line 149-150), and step 3 never says to change that. Also there is no existing 'initiate_payment' adapter case to delete and no 'pay_now' case exists yet — the Files note 'initiate_payment mapping deleted' targets something that isn't there.
   **Fix:** Change the second assertion to expect(adaptAction({ type: 'initiate_payment', payload: {} })).toBeNull() and reword the task: ADD a 'pay_now' case mapping to { name: 'ensure_payment_session', arguments: {} }; verify by grep that no adapter case references initiate_payment. If a throwing contract is genuinely wanted, step 3 must say so and update the function's JSDoc + all callers of adaptAction.
3. **[D3.1 PositionInput vs D3.3 applyEnsurePaymentSession]** Type mismatch: PositionInput.payments rows are { installmentId, status, createdAt } but applyEnsurePaymentSession dereferences pos.openAttempt.providerPaymentId (twice: provider cancel + CAS supersede + resumed lookup). The field doesn't exist on the type, and the D3.1 test literals don't carry it.
   **Fix:** Add providerPaymentId: string | null (and id: string) to PositionInput's payments row type and to the D3.1 test literals, or have applyEnsurePaymentSession re-load the open Payment row from tx by installmentId+status PENDING and use that row's providerPaymentId/id.
4. **[D3.6 step 4 and D4.7 step 4 (grep audits vs seed-skill-packs.ts)]** prisma/seeds/seed-skill-packs.ts:164 grants 'modify_quote' and :166 grants 'initiate_payment'; no D task edits that file (D1.7 fixes only seed-workflows.ts). The audits 'grep initiate_payment ... zero hits' (D3.6) and 'grep modify_quote|initiate_payment|get_quote_details ... zero hits' (D4.7) fail unless Block A's M12 dead-config cleanup has already deleted the skill-pack seeds — a dependency the packages never declare.
   **Fix:** Either add prisma/seeds/seed-skill-packs.ts to D1.7 (remove modify_quote) and D3.3 (remove initiate_payment) Modify lists — 'dead config kept consistent meanwhile', same treatment the draft gives seed-workflows — or add 'A-late (M12 dead-config cleanup: SkillPack seeds deleted)' to D3/D4 depends_on and note it beside both audit steps.
5. **[D2.x/D3.x/D4.x fixture builders (funnel-fixtures.ts)]** Several fixtures are consumed but never given a definition step: fx.createPendingPaymentForInstallment(2) (D2.6), buildAcceptedQuoteWithSchedule's options/returns ({settle, settleFirstInstallment, firstInstallmentId, firstInstallmentAmountMinor}) (D2.8/D3.x), buildAcceptReadyQuote (D2.5), buildPaidPolicy returning fx.issuedAt (D4.2), buildActivatedPolicy incl. the hardcoded 'AZT-123' and stopAt option (D4.4/D4.5/D4.6), operatorRequest (D4.3, with conditional 'if present; otherwise' phrasing). Engineers with zero context cannot reconstruct them.
   **Fix:** Add an explicit fixture-spec block to the FIRST task that uses each builder (one paragraph + signature per builder: inputs, exact rows created via which commits, returned ids/values — e.g. buildActivatedPolicy = buildPaidPolicy + mark_submitted + activate_policy('AZT-123'), returns {policyId, customerId, conversationId, quoteId, issuedAt}). Replace D4.3's conditional phrasing with the definite pattern: craft a NextRequest with a signToken({role:'OPERATOR'}) cookie (lib/auth/jwt.ts:27) — route tests already exist under __tests__/app/api as precedent.
6. **[D2.5 / Files, D3.5 / Files, D4.4 / Files (non-exact paths)]** Violations of the exact-path rule: D2.5 'components renderer: show_policy_issued payload emission removed...', D3.5 'components showing show_payment', D4.4 'A1 snapshot loader'. The actual files are components/chat/rich/rich-content.tsx (show_policy_issued case + show_payment case at line 266) and lib/i18n/translations.ts for the mode label keys; the A1 loader has no named path anywhere in the block.
   **Fix:** Replace with exact entries: 'Modify: components/chat/rich/rich-content.tsx (replace show_policy_issued case with show_quote_accepted; show_payment case reads payload.mode)', 'Modify: lib/i18n/translations.ts (payment.mode.started/resumed/retried keys, ro+en)'. For the A1 snapshot loader, name the file as defined by Block A (e.g. lib/engines/derive-and-expose.ts or its loader module) and tag it '(cross-block: A1-owned, coordinate)' — or move the snapshot-loader extension into an explicitly-named A1-coordination bullet in depends_on.

## Package D4: Policy machine + post-sale: transition table, operator commits, free-look cancellation with refunds, get_policy_info, document retiming

**Execution slot:** 18 | **Depends on:** D2, E2

**Goal:** Give the policy a real state machine and the customer a truthful post-sale surface. PolicyStatus gains LAPSED (M16 substrate — transition row defined, detection job explicitly deferred); an explicit transition table with exclusive per-transition owners (T9.D3) is enforced by pure legality predicates: payment module creates PENDING_SUBMISSION (D2), operators own PENDING_SUBMISSION→SUBMITTED→ACTIVE and pre-activation →CANCELLED, the engine owns free-look ACTIVE→CANCELLED, system jobs own LAPSED/EXPIRED, the agent owns NOTHING. mark_submitted and activate_policy(allianzPolicyNumber) become gateway commits with actor=operator (M5) — the admin route's free-form any→any edits die, activation requires the Allianz number, writes activatedAt/effectiveFrom/effectiveUntil and freezes freeLookEndsAt from product config (T9.D2 per-policy snapshot; window length flagged for legal confirmation), and the SOP-promised activation email actually sends (stub fixed). get_policy_info is the single @policy read (T9.D5) with customer-scoped exposure (T9.D6) and engine-gated status language — the agent never narrates in-force before ACTIVE (codes for A4's prompt sections, M6). request_cancellation runs the deterministic free-look comparison: in-window → requires_confirmation → terminal CANCELLED + REFUND EXECUTION as a payment-module system effect (PaymentProvider gains refundPayment; PaymentStatus.REFUNDED goes live; same effect fires on operator pre-activation cancellation/Allianz rejection per contradiction #5); outside window → rejected(outside_free_look) with the escalation floor. The suitability report is retimed to quote issuance (M7) and stored in the Document registry alongside generated policy documents; Policy.suitabilityReportPath and the hardcoded dashboard document placeholders die.

**Migrations / seeds:**
- prisma/schema.prisma: enum PolicyStatus gains LAPSED (reachable only from ACTIVE, owner = system job, detection deferred to M16 — the transition row exists so the enum value is never a dead REFUNDED-style orphan).
- model Policy: gains activatedAt DateTime?, freeLookEndsAt DateTime?; suitabilityReportPath REMOVED (Document registry replaces it); issuedAt is single-meaning (first capture, written only by settlement — the admin-route overwrite dies).
- model Product: gains freeLookDays Int @default(30) — distance-channel default per OG 85/2004; seed comment flags the constant for legal/compliance confirmation (channel-dependent 30 vs 20).
- prisma/seeds/seed-product.ts: freeLookDays: 30 added to both seeded product configs with the legal-confirmation flag comment.
- No new models — Document/DisclosureAck landed in D2; WorkItem is E2's.

### Task D4.1: Pure policy transition table with per-transition owners
**Files:**
- Create: lib/engines/policy-machine.ts
- Test: __tests__/lib/engines/policy-machine.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure test:
```ts
import { describe, it, expect } from 'vitest'
import { canPolicyTransition, POLICY_TRANSITIONS } from '@/lib/engines/policy-machine'

describe('policy machine (T9.D3: exclusive owners per transition)', () => {
  it('operator pipeline: PENDING_SUBMISSION->SUBMITTED->ACTIVE; pre-activation cancel', () => {
    expect(canPolicyTransition('PENDING_SUBMISSION', 'SUBMITTED', 'operator')).toBe(true)
    expect(canPolicyTransition('SUBMITTED', 'ACTIVE', 'operator')).toBe(true)
    expect(canPolicyTransition('PENDING_SUBMISSION', 'CANCELLED', 'operator')).toBe(true)
    expect(canPolicyTransition('SUBMITTED', 'CANCELLED', 'operator')).toBe(true)
  })
  it('engine owns free-look ACTIVE->CANCELLED; system owns LAPSED/EXPIRED and reinstatement', () => {
    expect(canPolicyTransition('ACTIVE', 'CANCELLED', 'engine')).toBe(true)
    expect(canPolicyTransition('ACTIVE', 'LAPSED', 'system')).toBe(true)
    expect(canPolicyTransition('ACTIVE', 'EXPIRED', 'system')).toBe(true)
    expect(canPolicyTransition('LAPSED', 'ACTIVE', 'system')).toBe(true)
  })
  it('illegal jumps die for every actor: un-cancel, skip-submit, agent anything', () => {
    expect(canPolicyTransition('CANCELLED', 'ACTIVE', 'operator')).toBe(false)
    expect(canPolicyTransition('PENDING_SUBMISSION', 'ACTIVE', 'operator')).toBe(false)
    expect(canPolicyTransition('ACTIVE', 'CANCELLED', 'operator')).toBe(false) // post-activation cancel is the engine's (free-look) — owners are exclusive
    for (const t of POLICY_TRANSITIONS) expect(t.owner).not.toBe('agent') // the agent owns NOTHING
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/policy-machine.test.ts` — expect FAIL.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/policy-machine.ts — pure
export type PolicyStatusV3 = 'PENDING_SUBMISSION' | 'SUBMITTED' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'LAPSED'
export type TransitionOwner = 'payment_module' | 'operator' | 'engine' | 'system'
export interface PolicyTransition { from: PolicyStatusV3; to: PolicyStatusV3; owner: TransitionOwner }
export const POLICY_TRANSITIONS: PolicyTransition[] = [
  { from: 'PENDING_SUBMISSION', to: 'SUBMITTED', owner: 'operator' },
  { from: 'SUBMITTED', to: 'ACTIVE', owner: 'operator' },
  { from: 'PENDING_SUBMISSION', to: 'CANCELLED', owner: 'operator' }, // Allianz rejection pre-submission review
  { from: 'SUBMITTED', to: 'CANCELLED', owner: 'operator' },          // Allianz rejection
  { from: 'ACTIVE', to: 'CANCELLED', owner: 'engine' },               // free-look request_cancellation
  { from: 'ACTIVE', to: 'LAPSED', owner: 'system' },                  // M16: detection job deferred; row defined now
  { from: 'LAPSED', to: 'ACTIVE', owner: 'system' },                  // reinstatement
  { from: 'ACTIVE', to: 'EXPIRED', owner: 'system' },                 // term end
]
export function canPolicyTransition(from: PolicyStatusV3, to: PolicyStatusV3, owner: TransitionOwner): boolean {
  return POLICY_TRANSITIONS.some(t => t.from === from && t.to === to && t.owner === owner)
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/policy-machine.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(policy): pure transition table with exclusive per-transition owners (+LAPSED)"`

### Task D4.2: Schema migration + operator commits mark_submitted / activate_policy through the gateway
**Files:**
- Modify: prisma/schema.prisma (PolicyStatus += LAPSED; Policy activatedAt/freeLookEndsAt, drop suitabilityReportPath; Product freeLookDays), migration `npx prisma migrate dev --name policy_machine_v3`
- Create: lib/tools/handlers/policy-operator-handlers.ts (applyMarkSubmitted, applyActivatePolicy)
- Modify: prisma/seeds/seed-product.ts (freeLookDays: 30 + legal flag comment)
- Test: __tests__/integration/policy-operator-commits.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildPaidPolicy } from '@/__tests__/helpers/funnel-fixtures' // full D2 path: accepted + first capture => Policy PENDING_SUBMISSION

describe('operator policy commits (actor=operator through the gateway)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('mark_submitted: PENDING_SUBMISSION->SUBMITTED; replay returns original envelope', async () => {
    const fx = await buildPaidPolicy()
    const res = await executeCommit({ tool: 'mark_submitted', actor: 'operator', args: { policyId: fx.policyId } })
    expect(res.outcome).toBe('applied')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('SUBMITTED')
  })

  it('activate_policy: requires allianzPolicyNumber; writes activatedAt, effective dates, frozen freeLookEndsAt; issuedAt untouched', async () => {
    const fx = await buildPaidPolicy()
    await executeCommit({ tool: 'mark_submitted', actor: 'operator', args: { policyId: fx.policyId } })
    const missing = await executeCommit({ tool: 'activate_policy', actor: 'operator', args: { policyId: fx.policyId } })
    expect(missing.outcome).toBe('rejected') // validation: number mandatory
    const res = await executeCommit({ tool: 'activate_policy', actor: 'operator', args: { policyId: fx.policyId, allianzPolicyNumber: 'AZT-123' } })
    expect(res.outcome).toBe('applied')
    const p = await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })
    expect(p.status).toBe('ACTIVE')
    expect(p.allianzPolicyNumber).toBe('AZT-123')
    expect(p.activatedAt).not.toBeNull()
    expect(p.effectiveFrom!.getTime()).toBe(p.activatedAt!.getTime())
    const product = await prisma.product.findUniqueOrThrow({ where: { id: p.productId } })
    expect(p.freeLookEndsAt!.getTime()).toBe(p.activatedAt!.getTime() + product.freeLookDays * 86_400_000)
    expect(p.issuedAt!.getTime()).toBe(fx.issuedAt.getTime()) // settlement's stamp survives activation
  })

  it('illegal transitions rejected by the table: activate from PENDING_SUBMISSION; agent actor rejected outright', async () => {
    const fx = await buildPaidPolicy()
    const skip = await executeCommit({ tool: 'activate_policy', actor: 'operator', args: { policyId: fx.policyId, allianzPolicyNumber: 'AZT-1' } })
    expect(skip.outcome).toBe('rejected')
    expect(skip.reason).toBe('illegal_transition')
    const agent = await executeCommit({ tool: 'mark_submitted', actor: 'agent', args: { policyId: fx.policyId } })
    expect(agent.outcome).toBe('rejected')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/policy-operator-commits.test.ts` — expect FAIL (schema fields + tools missing).
- [ ] Step 3: Apply the migration, then implement:
```ts
// lib/tools/handlers/policy-operator-handlers.ts
import { canPolicyTransition } from '@/lib/engines/policy-machine'

export async function applyMarkSubmitted(tx: PrismaTx, _s: DomainSnapshot, args: { policyId: string }): Promise<CommitApplyResult> {
  const policy = await tx.policy.findUniqueOrThrow({ where: { id: args.policyId } })
  if (!canPolicyTransition(policy.status as PolicyStatusV3, 'SUBMITTED', 'operator')) return { outcome: 'rejected', reason: 'illegal_transition', effects: [] }
  await tx.policy.update({ where: { id: policy.id }, data: { status: 'SUBMITTED' } })
  return { outcome: 'applied', effects: [], data: { policyId: policy.id, status: 'SUBMITTED' } }
}

export async function applyActivatePolicy(tx: PrismaTx, _s: DomainSnapshot, args: { policyId: string; allianzPolicyNumber: string }): Promise<CommitApplyResult> {
  const policy = await tx.policy.findUniqueOrThrow({ where: { id: args.policyId }, include: { product: true } })
  if (!canPolicyTransition(policy.status as PolicyStatusV3, 'ACTIVE', 'operator')) return { outcome: 'rejected', reason: 'illegal_transition', effects: [] }
  const activatedAt = new Date()
  const effectiveUntil = new Date(activatedAt); effectiveUntil.setUTCFullYear(effectiveUntil.getUTCFullYear() + 1) // 1-year contractTerm
  const freeLookEndsAt = new Date(activatedAt.getTime() + policy.product.freeLookDays * 86_400_000) // frozen snapshot (T9.D2)
  await tx.policy.update({ where: { id: policy.id }, data: { status: 'ACTIVE', allianzPolicyNumber: args.allianzPolicyNumber, activatedAt, effectiveFrom: activatedAt, effectiveUntil, freeLookEndsAt } })
  return { outcome: 'applied', effects: ['terminal'], data: { policyId: policy.id, status: 'ACTIVE', freeLookEndsAt: freeLookEndsAt.toISOString() } }
}
```
Register both with the gateway restricted to actor 'operator' (gateway rejects other actors before legality). Validation: activatePolicySchema requires non-empty allianzPolicyNumber.
- [ ] Step 4: Run `npx vitest run __tests__/integration/policy-operator-commits.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(policy): operator commits mark_submitted/activate_policy with frozen free-look snapshot"`

### Task D4.3: Admin route rides the gateway; activation email becomes real
**Files:**
- Modify: app/api/admin/policies/[id]/status/route.ts (free-form PATCH replaced: body { action: 'mark_submitted' | 'activate' | 'cancel_submission', allianzPolicyNumber? } → executeCommit actor=operator; the validStatuses any→any block is deleted; the issuedAt overwrite at line 59 is deleted)
- Create: lib/email/templates/policy-activated.ts
- Modify: lib/payments/settlement.ts or new lib/policies/notifications.ts (sendPolicyActivatedEmail called after a successful activate commit, best-effort)
- Test: __tests__/integration/admin-policy-route.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test (exercise the route handler function directly with a crafted NextRequest carrying an operator JWT, same pattern as existing admin route tests if present; otherwise call the underlying handler module):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { PATCH } from '@/app/api/admin/policies/[id]/status/route'
import { buildPaidPolicy, operatorRequest } from '@/__tests__/helpers/funnel-fixtures'

describe('admin policy route goes through the gateway', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('cannot un-cancel or jump states: activate on PENDING_SUBMISSION -> 409 with illegal_transition', async () => {
    const fx = await buildPaidPolicy()
    const res = await PATCH(operatorRequest({ action: 'activate', allianzPolicyNumber: 'AZT-9' }), { params: Promise.resolve({ id: fx.policyId }) })
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('illegal_transition')
  })
  it('mark_submitted then activate succeeds and records the activation email send', async () => {
    const fx = await buildPaidPolicy()
    await PATCH(operatorRequest({ action: 'mark_submitted' }), { params: Promise.resolve({ id: fx.policyId }) })
    const res = await PATCH(operatorRequest({ action: 'activate', allianzPolicyNumber: 'AZT-9' }), { params: Promise.resolve({ id: fx.policyId }) })
    expect(res.status).toBe(200)
    // mock email provider (lib/email mock) records the outbound
    const { getEmailProvider } = await import('@/lib/email')
    expect((getEmailProvider() as { sent?: { subject: string }[] }).sent?.some(m => /activat/i.test(m.subject))).toBe(true)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/admin-policy-route.test.ts` — expect FAIL (route still does free-form status writes and console.log).
- [ ] Step 3: Rewrite the route: auth unchanged; map action → executeCommit({ tool, actor: 'operator', args }); 200 on applied, 409 + { reason } on rejected. Create policy-activated.ts template (ro/en, policy number, effective dates, free-look deadline) and send it after the activate commit returns applied (best-effort try/catch, logError on failure) — the console.log stub at lines 75-81 is deleted. Update the admin client (app/admin/(protected)/applications/[id]/client.tsx) buttons to send { action } bodies.
- [ ] Step 4: Run `npx vitest run __tests__/integration/admin-policy-route.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(admin): policy status route rides operator commits; activation email real"`

### Task D4.4: get_policy_info single read + customer-scoped POLICY exposure + engine-gated status codes
**Files:**
- Create: lib/tools/handlers/policy-handlers.ts (getPolicyInfo)
- Modify: lib/tools/registry.ts, lib/tools/validation.ts (register get_policy_info)
- Modify: A1 snapshot loader (policy loaded customer-scoped, not via the conversation chain)
- Test: __tests__/integration/get-policy-info.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { getPolicyInfo } from '@/lib/tools/handlers/policy-handlers'
import { buildActivatedPolicy } from '@/__tests__/helpers/funnel-fixtures'

describe('get_policy_info (T9.D5 single read, T9.D6 customer-scoped)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('returns one consistent snapshot from a FRESH conversation (customer-scoped, survives the sale conversation)', async () => {
    const fx = await buildActivatedPolicy()
    const newConv = await prisma.conversation.create({ data: { customerId: fx.customerId } })
    const res = await getPolicyInfo({}, { conversationId: newConv.id, customerId: fx.customerId, language: 'ro' })
    const d = res.data as { statusCode: string; allianzPolicyNumber: string; freeLookEndsAt: string; schedule: { capturedCount: number }; documents: { kind: string }[] }
    expect(d.statusCode).toBe('policy_active') // stable code, never localized prose (M6)
    expect(d.allianzPolicyNumber).toBe('AZT-123')
    expect(d.freeLookEndsAt).toBeTruthy()
    expect(d.schedule.capturedCount).toBeGreaterThanOrEqual(1)
  })

  it('pre-activation statuses map to honest codes — never an in-force claim before ACTIVE', async () => {
    const fx = await buildActivatedPolicy({ stopAt: 'PENDING_SUBMISSION' })
    const res = await getPolicyInfo({}, { conversationId: fx.conversationId, customerId: fx.customerId, language: 'ro' })
    expect((res.data as { statusCode: string }).statusCode).toBe('paid_processing') // #5: 'paid, being processed'
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/get-policy-info.test.ts` — expect FAIL.
- [ ] Step 3: Implement getPolicyInfo: customer-scoped findFirst non-terminal policy (orderBy createdAt desc); statusCode map { PENDING_SUBMISSION: 'paid_processing', SUBMITTED: 'submitted_to_insurer', ACTIVE: 'policy_active', CANCELLED: 'policy_cancelled', LAPSED: 'policy_lapsed', EXPIRED: 'policy_expired' }; bundle effective dates, freeLookEndsAt, schedule summary via deriveSchedulePosition, documents from the registry (kind, version, language, download URL `/api/documents/{id}`). Exposure predicate contributed to A1: get_policy_info + request_cancellation exposed when `customer identified AND a policy exists` (customer-scoped — the catalog condition verbatim). Add a note in the A4 sections data: POLICY-phase section must instruct rendering statusCode only — codes above are the contract.
- [ ] Step 4: Run `npx vitest run __tests__/integration/get-policy-info.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(policy): get_policy_info customer-scoped single read with engine-gated status codes"`

### Task D4.5: request_cancellation + refund execution (PaymentProvider.refundPayment, REFUNDED live)
**Files:**
- Modify: lib/payments/types.ts (PaymentProvider gains refundPayment(providerPaymentId: string, amountMinor: number): Promise<{ providerRefundId: string }>), lib/payments/providers/stripe.ts (refunds.create), lib/payments/providers/payu.ts (refund order API), lib/payments/providers/mock.ts (echo success)
- Create: lib/payments/refunds.ts (executeFullRefund(tx, policyId | scheduleId): refunds every COMPLETED Payment of the schedule)
- Modify: lib/tools/handlers/policy-handlers.ts (applyRequestCancellation), lib/tools/registry.ts, lib/tools/validation.ts
- Modify: lib/tools/handlers/policy-operator-handlers.ts (operator cancel_submission commit triggers the same refund effect — Allianz rejection per #5)
- Test: __tests__/lib/engines/free-look.test.ts, __tests__/integration/request-cancellation.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing pure boundary test:
```ts
import { describe, it, expect } from 'vitest'
import { freeLookDecision } from '@/lib/engines/policy-machine'

describe('free-look deterministic rule (frozen freeLookEndsAt, T-1s/T+1s)', () => {
  const ends = new Date('2026-07-12T00:00:00Z')
  it('inside window (inclusive) -> in_window', () => {
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, new Date(ends.getTime() - 1000))).toBe('in_window')
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, ends)).toBe('in_window')
  })
  it('outside window -> outside_window; non-ACTIVE -> not_cancellable', () => {
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, new Date(ends.getTime() + 1000))).toBe('outside_window')
    expect(freeLookDecision({ status: 'SUBMITTED', freeLookEndsAt: null }, ends)).toBe('not_cancellable')
  })
})
```
And the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/engines/commit-gateway'
import { buildActivatedPolicy } from '@/__tests__/helpers/funnel-fixtures'

describe('request_cancellation (free-look) with refund execution', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })

  it('in window: requires_confirmation -> CANCELLED + every captured payment REFUNDED', async () => {
    const fx = await buildActivatedPolicy() // freeLookEndsAt in the future
    const ask = await executeCommit({ tool: 'request_cancellation', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await executeCommit({ tool: 'request_cancellation', actor: 'agent', conversationId: fx.conversationId, args: { confirmToken: ask.confirmToken } })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('terminal')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('CANCELLED')
    const payments = await prisma.payment.findMany({ where: { customerId: fx.customerId, status: 'REFUNDED' } })
    expect(payments.length).toBeGreaterThanOrEqual(1) // PaymentStatus.REFUNDED finally has a writer
  })

  it('outside window: rejected(outside_free_look), policy untouched', async () => {
    const fx = await buildActivatedPolicy()
    await prisma.policy.update({ where: { id: fx.policyId }, data: { freeLookEndsAt: new Date(Date.now() - 86_400_000) } })
    const res = await executeCommit({ tool: 'request_cancellation', actor: 'agent', conversationId: fx.conversationId, args: {} })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('outside_free_look')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('ACTIVE')
  })
})
```
- [ ] Step 2: Run both — expect FAIL.
- [ ] Step 3: Implement: freeLookDecision added to policy-machine.ts (pure, 6 lines: not ACTIVE → 'not_cancellable'; now <= freeLookEndsAt → 'in_window'; else 'outside_window'). refunds.ts:
```ts
// lib/payments/refunds.ts — payment-module system effect (two triggers: free-look + pre-activation cancellation, #5)
export async function executeFullRefund(tx: PrismaTx, scheduleId: string): Promise<{ refundedCount: number }> {
  const payments = await tx.payment.findMany({ where: { status: 'COMPLETED', installment: { scheduleId } } })
  const provider = getPaymentProvider()
  for (const p of payments) {
    await provider.refundPayment(p.providerPaymentId!, p.amountMinor)
    await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } })
  }
  return { refundedCount: payments.length }
}
```
applyRequestCancellation: freeLookDecision → 'in_window' proceeds under the gateway confirm token: canPolicyTransition('ACTIVE','CANCELLED','engine') checked, policy → CANCELLED, executeFullRefund(schedule of the policy's quote), outcome applied, effects ['terminal']; 'outside_window' → rejected(outside_free_look) (escalate_to_human remains the exposure floor per M10); 'not_cancellable' → rejected(illegal_transition). Operator cancel_submission commit (PENDING_SUBMISSION/SUBMITTED → CANCELLED, actor=operator) calls the same executeFullRefund. Stripe refundPayment: stripe.refunds.create({ payment_intent: providerPaymentId, amount: amountMinor }); PayU per its refund endpoint; mock returns { providerRefundId: `refund_${providerPaymentId}` }.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/free-look.test.ts __tests__/integration/request-cancellation.test.ts` — expect PASS.
- [ ] Step 5: Commit: `git commit -m "feat(policy): free-look request_cancellation with executed refunds (REFUNDED live)"`

### Task D4.6: Document retiming — suitability report at quote issuance; policy schedule + receipt into the registry
**Files:**
- Modify: lib/compliance/dnt-report.ts (generateSuitabilityReport(quoteId) — takes a quote, not a policy; stores via createDocument kind SUITABILITY_REPORT quoteId-bound; old generateDntReport(policyId) deleted)
- Modify: lib/tools/handlers/quote-handlers.ts (generate_quote issued-path post-transaction system effect: generate the report, best-effort)
- Modify: lib/payments/settlement.ts (first-capture effect additionally creates a PAYMENT_RECEIPT Document; the old generateDntReport call is removed)
- Modify: lib/tools/handlers/policy-operator-handlers.ts (activation creates the POLICY_SCHEDULE Document)
- Modify: components/dashboard/document-list.tsx + app/dashboard/(protected)/documents/page.tsx (render registry rows; alert() placeholders die), app/api/documents/dnt-report/[policyId]/route.ts deleted (single registry route serves all kinds)
- Test: __tests__/integration/document-timing.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing integration test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { truncateAll, seedBaseline } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote, buildActivatedPolicy } from '@/__tests__/helpers/funnel-fixtures'

describe('document generation timing (M7c: report at issuance, not post-policy)', () => {
  beforeEach(async () => { await truncateAll(); await seedBaseline() })
  it('quote issuance creates the SUITABILITY_REPORT document bound to the quote', async () => {
    const fx = await buildIssuedQuote()
    const doc = await prisma.document.findFirst({ where: { kind: 'SUITABILITY_REPORT', quoteId: fx.quoteId } })
    expect(doc).not.toBeNull()
    expect(doc!.contentHash.length).toBeGreaterThan(0)
  })
  it('first capture creates a PAYMENT_RECEIPT; activation creates the POLICY_SCHEDULE', async () => {
    const fx = await buildActivatedPolicy()
    expect(await prisma.document.count({ where: { kind: 'PAYMENT_RECEIPT', customerId: fx.customerId } })).toBeGreaterThanOrEqual(1)
    expect(await prisma.document.count({ where: { kind: 'POLICY_SCHEDULE', policyId: fx.policyId } })).toBe(1)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/document-timing.test.ts` — expect FAIL.
- [ ] Step 3: Implement: refactor dnt-report.ts to build the IDD suitability PDF from quote+application+DNT data (same jsPDF content, sourced pre-policy) and persist via createDocument({ kind: 'SUITABILITY_REPORT', quoteId, customerId, language: customer.language, source: 'GENERATED' }); call it after the generate_quote transaction commits (issued outcome only, try/catch + logError — document failure never blocks issuance). Receipt: small jsPDF (amount, installment, date, provider ref) at each successful capture inside settlement's post-transaction effects. Policy schedule: jsPDF (coverages, premium, Allianz number, effective dates) in applyActivatePolicy's post-commit effect. Dashboard list reads `prisma.document.findMany({ where: { customerId } })` server-side and links `/api/documents/{id}`.
- [ ] Step 4: Run `npx vitest run __tests__/integration/document-timing.test.ts && npx vitest run` — expect PASS (delete/update tests referencing suitabilityReportPath).
- [ ] Step 5: Commit: `git commit -m "feat(documents): suitability report at issuance; receipts + policy schedule in the registry"`

### Task D4.7: Package verification — full suite + policy-machine sim + Block D closing audit
**Files:**
- Create: scripts/verify-policy-machine.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-policy-machine.ts (npx tsx, MOCK provider): full pipeline issue→ack→accept→capture→ asserts Policy PENDING_SUBMISSION → mark_submitted → activate(AZT-x) → asserts ACTIVE + freeLookEndsAt = activatedAt + freeLookDays → get_policy_info statusCode policy_active → request_cancellation in window (token) → CANCELLED + all captures REFUNDED → re-run with freeLookEndsAt forced past → rejected(outside_free_look). Also negative: activate without number, agent-actor operator commit. Print per-checkpoint PASS/FAIL, non-zero exit on failure.
- [ ] Step 2: Run `npx vitest run` — full suite green (instrumentation flake rule applies).
- [ ] Step 3: Run `npx tsx scripts/verify-policy-machine.ts` — expect `PASS 9/9`.
- [ ] Step 4: Block D closing audit before claiming done: (a) `grep -rn "policy.create" lib/ app/` → only lib/payments/settlement.ts; (b) `grep -rn "status: 'SUBMITTED'" lib/payments/` → zero hits (paid ≠ submitted); (c) `grep -rn "show_policy_issued" lib/ app/ components/` → zero hits in the accept path (renders only from real activation state); (d) `grep -rn "modify_quote\|initiate_payment\|get_quote_details" lib/ app/ prisma/seeds/` → zero hits; (e) every D-package reason code emitted is snake_case with no localized prose (spot-check the four commit handlers).
- [ ] Step 5: Commit: `git commit -m "test(policy): policy machine end-to-end verification + Block D closing audit"`


### ⚠ Binding errata for D4 (fidelity verifier — apply OVER the task text above)

1. **[D4.2 migration vs D4.6 (suitabilityReportPath drop ordering)]** D4.2 drops Policy.suitabilityReportPath, but its consumers are fixed only in D4.6: lib/compliance/dnt-report.ts:458, app/api/documents/dnt-report/[policyId]/route.ts:56-71, components/dashboard/document-list.tsx, app/dashboard/(protected)/documents/page.tsx:59, and app/dashboard/(protected)/page.tsx:117 (this last consumer is missing from D4.6's Files entirely). tsc breaks for two tasks.
   **Fix:** Either move the suitabilityReportPath column drop from the D4.2 migration into D4.6 (second small migration, demo data), or pull the consumer rewrites into D4.2's step 3. Add app/dashboard/(protected)/page.tsx to D4.6's Files list either way.
2. **[D4.3 / step 1 (activation email assertion) ]** The test asserts (getEmailProvider() as { sent?: {subject:string}[] }).sent — MockEmailProvider (lib/email/providers/mock.ts) has no sent array, it only console.logs; no task adds recording. The assertion is permanently expect(undefined).toBe(true).
   **Fix:** Add lib/email/providers/mock.ts to D4.3's Files: give MockEmailProvider a public readonly sent: { to: string; subject: string; html: string }[] = [] pushed in send() (keep the console.log). Alternatively spy: vi.spyOn(getEmailProvider(), 'send') before the PATCH and assert the spy received a subject matching /activat/i.
3. **[D3.6 step 4 and D4.7 step 4 (grep audits vs seed-skill-packs.ts)]** prisma/seeds/seed-skill-packs.ts:164 grants 'modify_quote' and :166 grants 'initiate_payment'; no D task edits that file (D1.7 fixes only seed-workflows.ts). The audits 'grep initiate_payment ... zero hits' (D3.6) and 'grep modify_quote|initiate_payment|get_quote_details ... zero hits' (D4.7) fail unless Block A's M12 dead-config cleanup has already deleted the skill-pack seeds — a dependency the packages never declare.
   **Fix:** Either add prisma/seeds/seed-skill-packs.ts to D1.7 (remove modify_quote) and D3.3 (remove initiate_payment) Modify lists — 'dead config kept consistent meanwhile', same treatment the draft gives seed-workflows — or add 'A-late (M12 dead-config cleanup: SkillPack seeds deleted)' to D3/D4 depends_on and note it beside both audit steps.
4. **[D4.5 / Files + steps (cancel_submission commit)]** Three gaps: (a) the operator cancel_submission commit is described in step-3 prose but never registered (registry/validation not in Files for it) and has no test — the pre-activation-rejection refund (contradiction #5's second trigger) ships untested; (b) D4.3's admin route already maps action 'cancel_submission' to executeCommit ONE TASK EARLIER, calling a tool that doesn't exist yet; (c) lib/engines/policy-machine.ts gains freeLookDecision in step 3 but isn't listed in D4.5's Files.
   **Fix:** Register cancel_submission (zod: { policyId: z.string() }, actor=operator) in D4.2 alongside mark_submitted/activate_policy with an illegal-transition test, then have D4.5 attach executeFullRefund to it with a dedicated integration test (operator cancels a SUBMITTED paid policy -> Policy CANCELLED + all COMPLETED payments REFUNDED). Add 'Modify: lib/engines/policy-machine.ts (add freeLookDecision)' to D4.5 Files.
5. **[D2.x/D3.x/D4.x fixture builders (funnel-fixtures.ts)]** Several fixtures are consumed but never given a definition step: fx.createPendingPaymentForInstallment(2) (D2.6), buildAcceptedQuoteWithSchedule's options/returns ({settle, settleFirstInstallment, firstInstallmentId, firstInstallmentAmountMinor}) (D2.8/D3.x), buildAcceptReadyQuote (D2.5), buildPaidPolicy returning fx.issuedAt (D4.2), buildActivatedPolicy incl. the hardcoded 'AZT-123' and stopAt option (D4.4/D4.5/D4.6), operatorRequest (D4.3, with conditional 'if present; otherwise' phrasing). Engineers with zero context cannot reconstruct them.
   **Fix:** Add an explicit fixture-spec block to the FIRST task that uses each builder (one paragraph + signature per builder: inputs, exact rows created via which commits, returned ids/values — e.g. buildActivatedPolicy = buildPaidPolicy + mark_submitted + activate_policy('AZT-123'), returns {policyId, customerId, conversationId, quoteId, issuedAt}). Replace D4.3's conditional phrasing with the definite pattern: craft a NextRequest with a signToken({role:'OPERATOR'}) cookie (lib/auth/jwt.ts:27) — route tests already exist under __tests__/app/api as precedent.
6. **[D4.2/D4.3/D4.5 executeCommit calls without conversationId]** Operator commits are invoked as executeCommit({ tool, actor: 'operator', args }) with no conversationId, but the pinned CommitLedger row schema includes conversationId. The plan never states how operator commits satisfy the ledger shape.
   **Fix:** Add one line to D4.2 step 3: operator commits pass conversationId: null; note as an A2 coordination point that CommitLedger.conversationId must be nullable (customer-scoped commits keyed by customerId from the policy/args).
7. **[D2.5 / Files, D3.5 / Files, D4.4 / Files (non-exact paths)]** Violations of the exact-path rule: D2.5 'components renderer: show_policy_issued payload emission removed...', D3.5 'components showing show_payment', D4.4 'A1 snapshot loader'. The actual files are components/chat/rich/rich-content.tsx (show_policy_issued case + show_payment case at line 266) and lib/i18n/translations.ts for the mode label keys; the A1 loader has no named path anywhere in the block.
   **Fix:** Replace with exact entries: 'Modify: components/chat/rich/rich-content.tsx (replace show_policy_issued case with show_quote_accepted; show_payment case reads payload.mode)', 'Modify: lib/i18n/translations.ts (payment.mode.started/resumed/retried keys, ro+en)'. For the A1 snapshot loader, name the file as defined by Block A (e.g. lib/engines/derive-and-expose.ts or its loader module) and tag it '(cross-block: A1-owned, coordinate)' — or move the snapshot-loader extension into an explicitly-named A1-coordination bullet in depends_on.
8. **[D4.6 / step 3 (settlement 'old generateDntReport call is removed')]** Inaccurate claim: lib/payments/settlement.ts is created fresh in D2.6 and its specified side effects are only email + magic link — it never contains a generateDntReport call. (Side effect of this: between D2 and D4.6 no suitability report is generated at all — acceptable, but currently implicit.)
   **Fix:** Reword D4.6: 'post-payment.ts's old generateDntReport call was already dropped when D2.6 replaced the module; this task re-introduces report generation at its correct moment (quote issuance, M7c)'. Optionally add a note to D2.6 that suitability-report generation is intentionally absent until D4.6.

### ⚠ Block-level errata for Block D

1. **[test infrastructure (all integration tasks using truncateAll)]** Vitest runs test files in parallel by default; every integration file does truncateAll() in beforeEach against the one shared test database — cross-file truncation races will make the suite flaky by construction. T12.D3 explicitly notes real-DB tests need serialized access; no task configures it.
   **Fix:** In D1.1 (where test-db.ts is created), add a step updating vitest.config.ts: either fileParallelism: false, or a separate vitest project/config for __tests__/integration/** with pool: 'forks', poolOptions: { forks: { singleFork: true } }, and document that `npx vitest run` uses it.
2. **[block output / overview]** The block's overview field is an empty string; the output contract requires an overview.
   **Fix:** Write a 4-8 sentence overview: Block D scope (quote lifecycle D1, coupled flip D2, payment ops D3, policy machine D4), the two binding couplings it implements (M9 coupled flip; #5 definitional table), its cross-block inputs (A1/A2/B0/B-identity/C2/C3/E2), and the closing audits.

---

# BLOCK E — Content, operators, GDPR, re-engagement

## Block overview

Block E delivers content governance, operator surfaces, GDPR, and customer-scoped reads/re-engagement in four packages. E1 (product data, T11): pricing_examples derived at read time by calculateQuote over a per-product declared grid (never authored numbers; addon shown as base-vs-base+addon deltas from the same pass, age-band no-match surfaced as ineligibility per #9); eligibility_bounds projected from C2's typed rules; a versioned ProductContent table with a draft-to-published workflow gated on {ro,en} locale completeness and a no-numerals rule (placeholders {{coverage:CODE}} resolve from CoverageAmount rows); discovery eligibility verdict injected via DerivedStateV3 with set_application blocked as ineligible_age (T11.D4); and the T11.D5 protect migration that authors key points/sell info/addon info bilingually, purges every hardcoded playbook price, and drops features/pricingExplanation/premiumRange/targetAgeRange (get_product_addon_info NOT built per T11.D3). E2 (M5): WorkItem queue spine (kinds referral/escalation/document_review/gdpr_erasure/gdpr_export/alert_flag); escalate_to_human persists a WorkItem via the gateway (console.log and the Conversation.status write die); resolve_referral as an operator commit (approve resumes generate_quote as a system commit and issues; reject terminates with the underwriter reason and notifies via a ledger-recorded outbound notifier); minimal admin list/detail UI under app/admin/(protected)/work-items with negative-tested API routes. E3 (M3): typed retention-policy CONFIG module per data class with never-contracted vs contracted dispositions and legal-review flags; an erasure executor (anonymize-vs-retain, Customer.erasedAt tombstone aligned with B0); operator-approved execution through GDPR_ERASURE WorkItems; the existing app/api/gdpr/delete-data/route.ts re-pointed to create the WorkItem instead of mutating inline; data-access export compiled into a versioned bundle, agent may only request (verified_channel gate via the contradiction-#1 identity-requirements table), operator approves, dashboard downloads. E4 (M2): get_customer_profile re-backed by the B0 service (provenance + derived tier + history; extractedProfile reads die); get_open_items NEW implementing the pinned {kind, refId, age, nextAction} contract with nextAction guaranteed to be in ExposedActions.available (escalate_to_human floor per M10); get_application_list/get_quote_list NOT built; re-engagement job v1 (abandoned payment N days + quote nearing expiry; verified-channel only; marketing consent checked against the B1 ledger per outbound; frequency caps from prior ledger events; B3 magic link that verifies AND returns to the conversation; dunning excluded per M16). Cross-cutting M6 is enforced throughout: engines emit snake_case reason codes (missing_locale, numerals_in_authored_content, ineligible_age, actor_not_permitted, work_item_not_open), all authored fields are bilingual, the publish gate enforces locale completeness, outbound mail uses the customer language. Naming caveats for the orchestrator: I reference the Block A gateway entry as executeCommit from lib/chat/commit-gateway, deriveAndExpose/DomainSnapshot from lib/engines/derive-and-expose + lib/engines/domain-snapshot, the C2 module as lib/engines/eligibility (evaluateEligibility, EligibilityRule, loadEligibilityRules), the B0 service as lib/customer-profile (getCustomerProfileSnapshot, setDeclaredField), B1 as lib/consents (getDerivedConsentState), and B3 as lib/auth/challenges (createReturnToConversationMagicLink) — if those blocks pin different module paths/function names, only import lines change, the contracts used are the pinned ones. E2.4/E3 require C1's ApplicationStatus REFERRED/DECLINED values; E4.5 requires D2's PaymentSchedule. __tests__/helpers/test-db.ts (created in E1.1, reused everywhere) is the truncate+seed real-DB harness per T12.D3 — skip creation if an earlier block ships an identical helper. All migrations are destructive-OK demo-data changes with seeds updated in-package; every package ends with full-suite + runtime verification (known instrumentation flake treated as pass when it is the sole failure).

## Package E1: Product data: derived pricing_examples, eligibility_bounds, versioned ProductContent, protect content migration (T11)

**Execution slot:** 19 | **Depends on:** A5, C2

**Goal:** Make the quote engine the only source of every number the agent can utter and published bilingual ProductContent the only source of every selling claim: pricing_examples derived at read time via calculateQuote over a per-product declared grid (base vs base+addon from the same pass, addon age-band no-match surfaced as ineligibility, never silent 0); eligibility_bounds projected from C2's typed rules; key_value_product_points / sell_specific_info / sell_specific_addon_info authored into a versioned ProductContent table with a draft→published workflow gated on {ro,en} locale completeness and a no-numerals rule (M6/T11.D2); addon info folded into get_product_info.addons[] (T11.D3 — get_product_addon_info NOT built); discovery eligibility verdict injected via DerivedStateV3 with set_application blocked as ineligible_age (T11.D4, evaluator from C2); and the T11.D5 migration that authors protect content, purges hardcoded playbook prices, and drops features/pricingExplanation/premiumRange/targetAgeRange.

**Migrations / seeds:**
- prisma/schema.prisma: add enum ProductContentField { KEY_VALUE_PRODUCT_POINTS, SELL_SPECIFIC_INFO, SELL_SPECIFIC_ADDON_INFO, PRICING_NOTE } and enum ProductContentStatus { DRAFT, PUBLISHED, RETIRED }
- prisma/schema.prisma: add model ProductContent { id, productId, addonId?, field ProductContentField, locale String, content Json, version Int, status ProductContentStatus @default(DRAFT), authoredBy, approvedBy?, publishedAt?, retiredAt?, createdAt, updatedAt } with @@unique([productId, addonId, field, locale, version]) and @@index([productId, field, status]); back-relations productContent ProductContent[] on Product and Addon (migration add_product_content)
- prisma/schema.prisma: add Product.pricingExampleGrid Json? in the same add_product_content migration
- prisma/schema.prisma (second migration retire_legacy_product_fields, lands with task E1.8 after consumers are updated): drop Product.features, Product.pricingExplanation, Product.premiumRange, Product.targetAgeRange (demo data — destructive OK). Product.eligibility Json is NOT dropped here — C2's migration owns the typed eligibility rule store
- prisma/seeds/seed-product-content.ts (NEW): authored ro+en DRAFT+published content for protect — 8-10 key_value_product_points distilled from features[] + playbook value proposition; sell_specific_info (BD-led framing, complement positioning, numbers-free cost anchoring); sell_specific_addon_info for TREATMENT_ABROAD_BD with {{coverage:CODE}} placeholders instead of retyped EUR amounts; PRICING_NOTE numbers-free 'how pricing works'
- prisma/seeds/seed-product.ts: set pricingExampleGrid = { parameter: 'age', samplePoints: [25,35,45,55], tiers: ['standard','optim'], levels: ['level_1','level_3'], includeAddonDelta: true }; purge every hardcoded price from defaultPlaybook (replace with 'present figures only from pricing_examples' directives); remove writes to the four dropped columns; fix EN-only features by moving claims into seed-product-content.ts
- prisma/seeds/index.ts: register seedProductContent after seedProduct

### Task E1.1: ProductContent schema + shared integration-test DB helper
**Files:**
- Create: __tests__/helpers/test-db.ts
- Modify: prisma/schema.prisma (ProductContentField/ProductContentStatus enums, ProductContent model, Product.pricingExampleGrid, back-relations)
- Test: __tests__/integration/product-content-model.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'

describe('ProductContent model', () => {
  beforeAll(async () => {
    await truncate(['ProductContent'])
  })

  it('stores a draft row and enforces (product, addon, field, locale, version) uniqueness', async () => {
    const product = await testDb.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const row = await testDb.productContent.create({
      data: {
        productId: product.id, field: 'SELL_SPECIFIC_INFO', locale: 'ro',
        content: 'narativ de vanzare fara cifre', version: 1, authoredBy: 'seed',
      },
    })
    expect(row.status).toBe('DRAFT')
    await expect(
      testDb.productContent.create({
        data: {
          productId: product.id, field: 'SELL_SPECIFIC_INFO', locale: 'ro',
          content: 'duplicat', version: 1, authoredBy: 'seed',
        },
      }),
    ).rejects.toThrow()
  })

  it('Product carries the declared pricing-example grid as data, not code', async () => {
    const product = await testDb.product.findUniqueOrThrow({ where: { code: 'protect' } })
    expect(product.pricingExampleGrid).toBeDefined() // column exists (value seeded in E1.8)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/product-content-model.test.ts` (TEST_DATABASE_URL must point at the throwaway test DB) — expect FAIL: `Cannot find module '@/__tests__/helpers/test-db'`.
- [ ] Step 3: Minimal implementation — helper + schema. Helper (skip creation if an earlier block already shipped this exact file):
```ts
// __tests__/helpers/test-db.ts
import { PrismaClient } from '@/lib/generated/prisma/client'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('Integration tests require TEST_DATABASE_URL (throwaway test database)')

export const testDb = new PrismaClient({ datasources: { db: { url } } })

export async function truncate(tables: string[]): Promise<void> {
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  )
}
```
Schema additions to prisma/schema.prisma:
```prisma
enum ProductContentField {
  KEY_VALUE_PRODUCT_POINTS
  SELL_SPECIFIC_INFO
  SELL_SPECIFIC_ADDON_INFO
  PRICING_NOTE
}

enum ProductContentStatus {
  DRAFT
  PUBLISHED
  RETIRED
}

model ProductContent {
  id          String               @id @default(cuid())
  productId   String
  addonId     String?
  field       ProductContentField
  locale      String
  content     Json
  version     Int
  status      ProductContentStatus @default(DRAFT)
  authoredBy  String
  approvedBy  String?
  publishedAt DateTime?
  retiredAt   DateTime?
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  product Product @relation(fields: [productId], references: [id])
  addon   Addon?  @relation(fields: [addonId], references: [id])

  @@unique([productId, addonId, field, locale, version])
  @@index([productId, field, status])
}
```
Plus `pricingExampleGrid Json?` on Product, and `productContent ProductContent[]` back-relations on Product and Addon. Run `npx prisma migrate dev --name add_product_content && npx prisma generate`, then apply to the test DB (`npx prisma migrate deploy` with TEST_DATABASE_URL) and seed it (`npx tsx prisma/seeds/index.ts` against the test DB).
- [ ] Step 4: Run `npx vitest run __tests__/integration/product-content-model.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(product-content): ProductContent model + integration test-db helper"`

### Task E1.2: Authored-content validation — locale-complete gate, no-numerals rule, placeholder rendering (M6)
**Files:**
- Create: lib/products/authored-content-validation.ts
- Test: __tests__/lib/products/authored-content-validation.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { validateContentSet, resolveCoveragePlaceholders } from '@/lib/products/authored-content-validation'

const ro = { field: 'SELL_SPECIFIC_INFO', addonCode: null, locale: 'ro' as const, content: 'fara cifre aici' }
const en = { field: 'SELL_SPECIFIC_INFO', addonCode: null, locale: 'en' as const, content: 'no digits here' }

describe('validateContentSet', () => {
  it('accepts a bilingual numeral-free set', () => {
    expect(validateContentSet([ro, en])).toEqual({ ok: true })
  })
  it('rejects a missing locale with stable reason code missing_locale (M6 publish gate)', () => {
    expect(validateContentSet([ro])).toEqual({
      ok: false, reason: 'missing_locale', params: { group: 'SELL_SPECIFIC_INFO::', missing: 'en' },
    })
  })
  it('rejects raw numerals with numerals_in_authored_content', () => {
    expect(validateContentSet([ro, { ...en, content: 'covers up to 2000000 EUR' }]))
      .toMatchObject({ ok: false, reason: 'numerals_in_authored_content' })
  })
  it('allows {{coverage:CODE}} placeholders — amounts referenced, never retyped (T11.D5)', () => {
    expect(validateContentSet([ro, { ...en, content: 'up to {{coverage:BD_TREATMENT}} abroad' }]))
      .toEqual({ ok: true })
  })
  it('validates array content (key_value_product_points are string lists)', () => {
    const enPoints = { field: 'KEY_VALUE_PRODUCT_POINTS', addonCode: null, locale: 'en' as const, content: ['no exam', 'price of 2 coffees'] }
    const roPoints = { ...enPoints, locale: 'ro' as const, content: ['fara examen'] }
    expect(validateContentSet([roPoints, enPoints])).toMatchObject({ ok: false, reason: 'numerals_in_authored_content' })
  })
})

describe('resolveCoveragePlaceholders', () => {
  it('renders placeholder amounts from coverage rows in the requested locale', () => {
    const out = resolveCoveragePlaceholders('up to {{coverage:BD_TREATMENT}}', { BD_TREATMENT: { amount: 2000000, currency: 'EUR' } }, 'en')
    expect(out).toBe('up to 2,000,000 EUR')
  })
  it('leaves unknown placeholders intact so the seed-integrity check can flag them', () => {
    const out = resolveCoveragePlaceholders('see {{coverage:MISSING}}', {}, 'ro')
    expect(out).toBe('see {{coverage:MISSING}}')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/products/authored-content-validation.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/products/authored-content-validation.ts
export type AuthoredLocale = 'ro' | 'en'
export interface AuthoredRow {
  field: string
  addonCode: string | null
  locale: AuthoredLocale
  content: unknown
}
export type ContentValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_locale' | 'numerals_in_authored_content'; params: Record<string, unknown> }

const PLACEHOLDER = /\{\{[^}]+\}\}/g

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(textOf).join(' ')
  if (content && typeof content === 'object') return Object.values(content).map(textOf).join(' ')
  return String(content ?? '')
}

export function validateContentSet(rows: AuthoredRow[]): ContentValidationResult {
  const groups = new Map<string, Set<AuthoredLocale>>()
  for (const row of rows) {
    const key = `${row.field}::${row.addonCode ?? ''}`
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key)!.add(row.locale)
  }
  for (const [group, locales] of groups) {
    for (const required of ['ro', 'en'] as const) {
      if (!locales.has(required)) return { ok: false, reason: 'missing_locale', params: { group, missing: required } }
    }
  }
  for (const row of rows) {
    if (/\d/.test(textOf(row.content).replace(PLACEHOLDER, ''))) {
      return { ok: false, reason: 'numerals_in_authored_content', params: { field: row.field, locale: row.locale } }
    }
  }
  return { ok: true }
}

export function resolveCoveragePlaceholders(
  text: string,
  coverage: Record<string, { amount: number; currency: string }>,
  locale: AuthoredLocale,
): string {
  return text.replace(/\{\{coverage:([A-Z0-9_]+)\}\}/g, (whole, code: string) => {
    const row = coverage[code]
    if (!row) return whole
    return `${row.amount.toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-US')} ${row.currency}`
  })
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/products/authored-content-validation.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(product-content): locale-complete + no-numerals validation and placeholder rendering"`

### Task E1.3: Publish workflow service with version stamps and cache invalidation (T11.D2)
**Files:**
- Create: lib/products/product-content.ts
- Test: __tests__/integration/product-content-publish.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { publishProductContent, getPublishedProductContent, invalidateProductContentCache } from '@/lib/products/product-content'

describe('ProductContent publish workflow', () => {
  let productId: string
  beforeEach(async () => {
    await truncate(['ProductContent'])
    invalidateProductContentCache()
    productId = (await testDb.product.findUniqueOrThrow({ where: { code: 'protect' } })).id
  })

  it('refuses to publish when a locale is missing — reason missing_locale', async () => {
    await testDb.productContent.create({ data: { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'doar romana', version: 1, authoredBy: 't' } })
    const r = await publishProductContent({ productId, addonId: null, field: 'SELL_SPECIFIC_INFO', version: 1, approvedBy: 'op-1' })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'missing_locale' })
    const rows = await testDb.productContent.findMany({ where: { productId } })
    expect(rows.every((x) => x.status === 'DRAFT')).toBe(true)
  })

  it('publishes both locales atomically, retires the prior published version, surfaces version stamps', async () => {
    await testDb.productContent.createMany({ data: [
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'v unu', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'en', content: 'v one', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'v doi', version: 2, authoredBy: 't' },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'en', content: 'v two', version: 2, authoredBy: 't' },
    ] })
    const r = await publishProductContent({ productId, addonId: null, field: 'SELL_SPECIFIC_INFO', version: 2, approvedBy: 'op-1' })
    expect(r.outcome).toBe('applied')
    const published = await testDb.productContent.findMany({ where: { productId, status: 'PUBLISHED' } })
    expect(published).toHaveLength(2)
    expect(published.every((x) => x.version === 2 && x.approvedBy === 'op-1')).toBe(true)
    const retired = await testDb.productContent.findMany({ where: { productId, status: 'RETIRED' } })
    expect(retired).toHaveLength(2)
    const read = await getPublishedProductContent(productId)
    expect(read.fields.SELL_SPECIFIC_INFO).toMatchObject({ version: 2, ro: 'v doi', en: 'v two' })
    expect(read.fields.SELL_SPECIFIC_INFO!.contentIds).toHaveLength(2) // M8 turn-snapshot stamps
  })

  it('rejects numerals at publish time — reason numerals_in_authored_content', async () => {
    await testDb.productContent.createMany({ data: [
      { productId, field: 'PRICING_NOTE', locale: 'ro', content: 'costa 190 lei', version: 1, authoredBy: 't' },
      { productId, field: 'PRICING_NOTE', locale: 'en', content: 'costs vary by level', version: 1, authoredBy: 't' },
    ] })
    const r = await publishProductContent({ productId, addonId: null, field: 'PRICING_NOTE', version: 1, approvedBy: 'op-1' })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'numerals_in_authored_content' })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/product-content-publish.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/products/product-content.ts
import { prisma } from '@/lib/db'
import type { ProductContentField } from '@/lib/generated/prisma/client'
import { validateContentSet, resolveCoveragePlaceholders, type AuthoredLocale } from '@/lib/products/authored-content-validation'

export interface PublishInput { productId: string; addonId: string | null; field: ProductContentField; version: number; approvedBy: string }
export type PublishResult =
  | { outcome: 'applied'; publishedIds: string[] }
  | { outcome: 'rejected'; reason: 'missing_locale' | 'numerals_in_authored_content' | 'content_not_found'; params?: Record<string, unknown> }

export interface PublishedFieldSet { version: number; contentIds: string[]; ro: unknown; en: unknown }
export interface PublishedProductContent {
  fields: Partial<Record<ProductContentField, PublishedFieldSet>>
  addonFields: Record<string, Partial<Record<ProductContentField, PublishedFieldSet>>>
}

const cache = new Map<string, PublishedProductContent>()
export function invalidateProductContentCache(productId?: string): void {
  if (productId) cache.delete(productId)
  else cache.clear()
}

export async function publishProductContent(input: PublishInput): Promise<PublishResult> {
  const drafts = await prisma.productContent.findMany({
    where: { productId: input.productId, addonId: input.addonId, field: input.field, version: input.version, status: 'DRAFT' },
  })
  if (drafts.length === 0) return { outcome: 'rejected', reason: 'content_not_found' }
  const verdict = validateContentSet(drafts.map((d) => ({
    field: d.field, addonCode: d.addonId, locale: d.locale as AuthoredLocale, content: d.content,
  })))
  if (!verdict.ok) return { outcome: 'rejected', reason: verdict.reason, params: verdict.params }
  await prisma.$transaction([
    prisma.productContent.updateMany({
      where: { productId: input.productId, addonId: input.addonId, field: input.field, status: 'PUBLISHED' },
      data: { status: 'RETIRED', retiredAt: new Date() },
    }),
    prisma.productContent.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'PUBLISHED', approvedBy: input.approvedBy, publishedAt: new Date() },
    }),
  ])
  invalidateProductContentCache(input.productId)
  return { outcome: 'applied', publishedIds: drafts.map((d) => d.id) }
}

export async function getPublishedProductContent(productId: string): Promise<PublishedProductContent> {
  const cached = cache.get(productId)
  if (cached) return cached
  const rows = await prisma.productContent.findMany({ where: { productId, status: 'PUBLISHED' } })
  const coverage = await loadCoverageByCode(productId)
  const out: PublishedProductContent = { fields: {}, addonFields: {} }
  for (const row of rows) {
    const bucket = row.addonId ? (out.addonFields[row.addonId] ??= {}) : out.fields
    const set = (bucket[row.field] ??= { version: row.version, contentIds: [], ro: null, en: null })
    set.contentIds.push(row.id)
    const rendered = typeof row.content === 'string'
      ? resolveCoveragePlaceholders(row.content, coverage, row.locale as AuthoredLocale)
      : row.content
    if (row.locale === 'ro') set.ro = rendered
    else set.en = rendered
  }
  cache.set(productId, out)
  return out
}

async function loadCoverageByCode(productId: string): Promise<Record<string, { amount: number; currency: string }>> {
  const amounts = await prisma.coverageAmount.findMany({
    where: { OR: [{ pricingLevel: { tier: { productId } } }, { addon: { productId } }] },
    include: { coverageType: { select: { code: true } } },
  })
  const byCode: Record<string, { amount: number; currency: string }> = {}
  for (const a of amounts) {
    const code = a.coverageType.code
    if (!byCode[code] || a.amount > byCode[code].amount) byCode[code] = { amount: a.amount, currency: a.currency }
  }
  return byCode
}
```
Note: publishing is content governance, not a per-conversation funnel commit — it does NOT route through the commit gateway; its audit trail is the row itself (authoredBy/approvedBy/publishedAt/retiredAt). The admin publish API in E2.5's pattern can be added by a products admin page later; seeds remain the authoring path in this package.
- [ ] Step 4: Run `npx vitest run __tests__/integration/product-content-publish.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(product-content): draft->published workflow with locale gate, retirement and version stamps"`

### Task E1.4: derivePricingExamples — pure engine over the declared grid (T11.D1/D3)
**Files:**
- Create: lib/engines/pricing-examples.ts
- Test: __tests__/lib/engines/pricing-examples.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (literals mirror prisma/seeds/seed-product.ts pricing rows):
```ts
import { describe, it, expect } from 'vitest'
import { derivePricingExamples } from '@/lib/engines/pricing-examples'

const tree = {
  quoteValidityDays: 30,
  tiers: [
    { code: 'standard', name: { en: 'Standard', ro: 'Standard' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 190 },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 390 },
    ] },
    { code: 'optim', name: { en: 'Optim', ro: 'Optim' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 230 },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 430 },
    ] },
  ],
  addonRules: [
    { minAge: 18, maxAge: 30, premiumAnnual: 200 },
    { minAge: 31, maxAge: 45, premiumAnnual: 350 },
    { minAge: 46, maxAge: 55, premiumAnnual: 500 },
    { minAge: 56, maxAge: 64, premiumAnnual: 700 },
  ],
}
const grid = { parameter: 'age' as const, samplePoints: [25, 70], tiers: ['standard', 'optim'], levels: ['level_1', 'level_3'], includeAddonDelta: true }

describe('derivePricingExamples', () => {
  it('derives base and base+addon from the same calculateQuote arithmetic, labeled explicitly', () => {
    const ex = derivePricingExamples(tree, grid)
    const cell = ex.find((e) => e.age === 25 && e.tier === 'standard' && e.level === 'level_1')!
    expect(cell.base).toEqual({ premiumAnnual: 190, premiumMonthly: 15.83 })
    expect(cell.withAddon).toEqual({ premiumAnnual: 390, premiumMonthly: 32.5, addonDelta: 200 })
    expect(cell.currency).toBe('RON')
  })
  it('marks the addon ineligible when no age band matches — never a silent 0 (#9 folded fix)', () => {
    const ex = derivePricingExamples(tree, grid)
    const cell = ex.find((e) => e.age === 70 && e.tier === 'optim' && e.level === 'level_3')!
    expect(cell.base.premiumAnnual).toBe(430)
    expect(cell.withAddon).toEqual({ ineligible: true, reason: 'addon_age_band_unavailable' })
  })
  it('emits one example per (age x tier x level) grid cell', () => {
    expect(derivePricingExamples(tree, grid)).toHaveLength(8)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/pricing-examples.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/pricing-examples.ts — pure, no DB; every number comes out of calculateQuote
import { calculateQuote, type QuoteInput } from '@/lib/engines/quote-engine'

export interface PricingExampleGrid {
  parameter: 'age' // per-product declared variation parameter (T11.D1) — protect varies on age
  samplePoints: number[]
  tiers: string[]
  levels: string[]
  includeAddonDelta: boolean
}
export interface PricingTreeLevel { code: string; name: { en: string; ro: string }; premiumAnnual: number }
export interface PricingTreeTier { code: string; name: { en: string; ro: string }; levels: PricingTreeLevel[] }
export interface PricingTreeAddonRule { minAge: number; maxAge: number; premiumAnnual: number }
export interface PricingTree { tiers: PricingTreeTier[]; addonRules: PricingTreeAddonRule[]; quoteValidityDays: number }

export interface PricingExample {
  age: number
  tier: string
  level: string
  currency: 'RON'
  base: { premiumAnnual: number; premiumMonthly: number }
  withAddon:
    | { premiumAnnual: number; premiumMonthly: number; addonDelta: number }
    | { ineligible: true; reason: 'addon_age_band_unavailable' }
    | null
}

export function derivePricingExamples(tree: PricingTree, grid: PricingExampleGrid): PricingExample[] {
  const out: PricingExample[] = []
  for (const age of grid.samplePoints) {
    for (const tierCode of grid.tiers) {
      const tier = tree.tiers.find((t) => t.code === tierCode)
      if (!tier) continue
      for (const levelCode of grid.levels) {
        const level = tier.levels.find((l) => l.code === levelCode)
        if (!level) continue
        const baseInput: QuoteInput = {
          tierCode, levelCode, customerAge: age, includesAddon: false,
          paymentFrequency: 'annual',
          pricingLevel: { premiumAnnual: level.premiumAnnual, name: level.name },
          pricingTier: { name: tier.name },
          baseCoverages: [], addonPricingRule: null, addonCoverages: [],
          quoteValidityDays: tree.quoteValidityDays,
        }
        const base = calculateQuote(baseInput)
        let withAddon: PricingExample['withAddon'] = null
        if (grid.includeAddonDelta) {
          const rule = tree.addonRules.find((r) => age >= r.minAge && age <= r.maxAge)
          withAddon = rule
            ? (() => {
                const q = calculateQuote({ ...baseInput, includesAddon: true, addonPricingRule: { premiumAnnual: rule.premiumAnnual } })
                return { premiumAnnual: q.premiumAnnual, premiumMonthly: q.premiumMonthly, addonDelta: rule.premiumAnnual }
              })()
            : { ineligible: true as const, reason: 'addon_age_band_unavailable' as const }
        }
        out.push({ age, tier: tierCode, level: levelCode, currency: 'RON',
          base: { premiumAnnual: base.premiumAnnual, premiumMonthly: base.premiumMonthly }, withAddon })
      }
    }
  }
  return out
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/pricing-examples.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engines): derive pricing_examples via calculateQuote over the declared grid"`

### Task E1.5: projectEligibilityBounds over C2's typed rules (#9 — derive numbers, author narrative)
**Files:**
- Create: lib/engines/eligibility-bounds.ts
- Test: __tests__/lib/engines/eligibility-bounds.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (EligibilityRule is C2's exported rule type from lib/engines/eligibility — verify the exact shape there before writing; the projection below assumes `{ code, fact, op, value }`):
```ts
import { describe, it, expect } from 'vitest'
import { projectEligibilityBounds } from '@/lib/engines/eligibility-bounds'

describe('projectEligibilityBounds', () => {
  it('derives numeric bounds from age rules and lists non-numeric rules by code', () => {
    const rules = [
      { code: 'age_min', fact: 'age', op: 'gte' as const, value: 18 },
      { code: 'age_max', fact: 'age', op: 'lte' as const, value: 64 },
      { code: 'residency_ro', fact: 'residency', op: 'eq' as const, value: 'Romania' },
    ]
    expect(projectEligibilityBounds(rules)).toEqual({ minAge: 18, maxAge: 64, otherRuleCodes: ['residency_ro'] })
  })
  it('returns null bounds when no age rules exist (unknown is honest, never invented)', () => {
    expect(projectEligibilityBounds([])).toEqual({ minAge: null, maxAge: null, otherRuleCodes: [] })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/eligibility-bounds.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/eligibility-bounds.ts — pure projection over C2's canonical rule schema.
// NEVER authored: the numbers shown in discovery are these projections (#9 kills presentation drift).
import type { EligibilityRule } from '@/lib/engines/eligibility' // C2 artifact

export interface EligibilityBounds { minAge: number | null; maxAge: number | null; otherRuleCodes: string[] }

export function projectEligibilityBounds(rules: EligibilityRule[]): EligibilityBounds {
  let minAge: number | null = null
  let maxAge: number | null = null
  const otherRuleCodes: string[] = []
  for (const rule of rules) {
    if (rule.fact === 'age' && rule.op === 'gte' && typeof rule.value === 'number') minAge = rule.value
    else if (rule.fact === 'age' && rule.op === 'lte' && typeof rule.value === 'number') maxAge = rule.value
    else otherRuleCodes.push(rule.code)
  }
  return { minAge, maxAge, otherRuleCodes }
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/eligibility-bounds.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engines): eligibility_bounds projected from canonical eligibility rules"`

### Task E1.6: Discovery eligibility verdict in DerivedStateV3 + blocked set_application (T11.D4)
**Files:**
- Modify: lib/engines/derive-and-expose.ts (A1 artifact — populate state.eligibility from evaluateEligibility over the candidate product's rules; block set_application with reason ineligible_age when verdict is ineligible on an age rule)
- Modify: lib/engines/domain-snapshot.ts (A1 snapshot loader — include candidate product eligibilityRules in the product slice)
- Test: __tests__/lib/engines/derive-and-expose-eligibility.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test — pure over snapshot literals per T12.D3, no mocked prisma:
```ts
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { emptySnapshot, type DomainSnapshot } from '@/lib/engines/domain-snapshot'

const AGE_RULES = [
  { code: 'age_min', fact: 'age', op: 'gte' as const, value: 18 },
  { code: 'age_max', fact: 'age', op: 'lte' as const, value: 64 },
]

function snapshotWith(overrides: Record<string, unknown>): DomainSnapshot {
  return { ...emptySnapshot(), ...overrides } as DomainSnapshot
}

describe('deriveAndExpose — discovery eligibility verdict (T11.D4)', () => {
  it('injects ineligible(reason) and blocks set_application for an over-age customer', () => {
    const { state, actions } = deriveAndExpose(snapshotWith({
      candidateProduct: { id: 'p1', code: 'protect', eligibilityRules: AGE_RULES },
      profile: { age: 70 },
    }))
    expect(state.eligibility.verdict).toBe('ineligible')
    expect(state.eligibility.failedRules).toContainEqual({ rule: 'age_max', reason: 'ineligible_age' })
    expect(actions.blocked).toContainEqual(
      expect.objectContaining({ action: 'set_application', reason: 'ineligible_age', params: { minAge: 18, maxAge: 64 } }),
    )
  })
  it('injects unknown(missing_age) when age is underivable — silent until known, never collapsed', () => {
    const { state } = deriveAndExpose(snapshotWith({
      candidateProduct: { id: 'p1', code: 'protect', eligibilityRules: AGE_RULES },
      profile: { age: null },
    }))
    expect(state.eligibility).toMatchObject({ verdict: 'unknown', missingFacts: ['age'] })
  })
  it('injects eligible for an in-bounds customer and does not block set_application on eligibility', () => {
    const { state, actions } = deriveAndExpose(snapshotWith({
      candidateProduct: { id: 'p1', code: 'protect', eligibilityRules: AGE_RULES },
      profile: { age: 35 },
    }))
    expect(state.eligibility.verdict).toBe('eligible')
    expect(actions.blocked.filter((b) => b.action === 'set_application' && b.reason === 'ineligible_age')).toHaveLength(0)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/derive-and-expose-eligibility.test.ts` — expect FAIL: state.eligibility undefined / no blocked entry.
- [ ] Step 3: Minimal implementation — inside deriveAndExpose (the ONLY phase/exposure computation per contradiction #6; this task adds an input, not a second computer):
```ts
// in lib/engines/derive-and-expose.ts
import { evaluateEligibility } from '@/lib/engines/eligibility' // C2 — one of its three sanctioned call points (#9)
import { projectEligibilityBounds } from '@/lib/engines/eligibility-bounds'

// during state assembly, keyed off the candidate-else-committed product:
const product = snapshot.application?.product ?? snapshot.candidateProduct
const eligibility = product
  ? evaluateEligibility(product.eligibilityRules, { age: snapshot.profile.age ?? undefined /* B0-derived: DOB else declaredAge */ })
  : { verdict: 'unknown' as const, failedRules: [], missingFacts: [] }
// state.eligibility = eligibility

// during exposure assembly, when eligibility failed on an age rule:
if (product && eligibility.verdict === 'ineligible' && eligibility.failedRules.some((r) => r.reason === 'ineligible_age')) {
  const bounds = projectEligibilityBounds(product.eligibilityRules)
  blocked.push({ action: 'set_application', reason: 'ineligible_age', params: { minAge: bounds.minAge, maxAge: bounds.maxAge } })
  available = available.filter((a) => a !== 'set_application')
}
```
Also extend lib/engines/domain-snapshot.ts so the candidate/committed product slice carries `eligibilityRules: EligibilityRule[]` loaded from C2's rule store, and export an `emptySnapshot()` fixture builder if A1 has not already shipped one (if A1 ships it under a different name, use that and update the test import — the only allowed adaptation). The generate_quote final gate is C2/D1's call point — not duplicated here.
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/derive-and-expose-eligibility.test.ts` then `npx vitest run __tests__/lib/engines` — expect PASS (existing A1 tests stay green).
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engines): discovery eligibility verdict in DerivedStateV3, set_application blocked as ineligible_age"`

### Task E1.7: get_product_info rework — pricing_examples, eligibility_bounds, published content, addons[] fold (T11.D1/D3)
**Files:**
- Modify: lib/tools/shape-product-info.ts (new ShapedProduct: drop pricingExplanation/features/premiumRange/targetAgeRange/eligibility passthrough; add pricing_examples, eligibility_bounds, key_value_product_points, sell_specific_info; addons[] gain sell_specific_addon_info and the addon example deltas)
- Modify: lib/tools/registry.ts (getProductInfoHandler at :294-374 — resolve age via B0 CustomerProfileService instead of the inline DOB/extractedProfile fallback; load published content + grid; pass derived inputs to the shaper; return contentVersions for M8 stamping)
- Test: __tests__/lib/tools/shape-product-info.test.ts (modify)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests (added to the existing suite; keep the existing premium-stripping assertions at :120-136 green):
```ts
import { shapeProductInfo } from '@/lib/tools/shape-product-info'

const derivedInputs = {
  pricingExamples: [{ age: 25, tier: 'standard', level: 'level_1', currency: 'RON' as const,
    base: { premiumAnnual: 190, premiumMonthly: 15.83 },
    withAddon: { premiumAnnual: 390, premiumMonthly: 32.5, addonDelta: 200 } }],
  eligibilityBounds: { minAge: 18, maxAge: 64, otherRuleCodes: ['residency_ro'] },
  content: {
    keyValueProductPoints: { ro: ['fara examen medical'], en: ['no medical exam'] },
    sellSpecificInfo: { ro: 'narativ', en: 'narrative' },
    contentVersions: ['pc_1', 'pc_2'],
  },
  addonContent: { TREATMENT_ABROAD_BD: { sellSpecificAddonInfo: { ro: 'info BD', en: 'BD info' } } },
}

it('returns engine-derived pricing_examples and eligibility_bounds — never authored numbers', () => {
  const shaped = shapeProductInfo(rawProduct, { age: 25, derived: derivedInputs })
  expect(shaped.pricing_examples).toEqual(derivedInputs.pricingExamples)
  expect(shaped.eligibility_bounds).toEqual({ minAge: 18, maxAge: 64, otherRuleCodes: ['residency_ro'] })
})

it('exposes only published authored claims; legacy claim surfaces are gone', () => {
  const shaped = shapeProductInfo(rawProduct, { age: 25, derived: derivedInputs }) as Record<string, unknown>
  expect(shaped.key_value_product_points).toEqual(derivedInputs.content.keyValueProductPoints)
  expect(shaped.sell_specific_info).toEqual(derivedInputs.content.sellSpecificInfo)
  expect(shaped).not.toHaveProperty('pricingExplanation')
  expect(shaped).not.toHaveProperty('features')
  expect(shaped).not.toHaveProperty('premiumRange')
  expect(shaped).not.toHaveProperty('targetAgeRange')
})

it('folds addon selling info into addons[] (T11.D3 — no get_product_addon_info)', () => {
  const shaped = shapeProductInfo(rawProduct, { age: 25, derived: derivedInputs })
  const bd = shaped.addons.find((a) => a.code === 'TREATMENT_ABROAD_BD')!
  expect(bd.sell_specific_addon_info).toEqual({ ro: 'info BD', en: 'BD info' })
})

it('still strips structured per-level premiums outside pricing_examples (no-leak invariant kept)', () => {
  const shaped = shapeProductInfo(rawProduct, { age: 25, derived: derivedInputs })
  const json = JSON.stringify(shaped.packages)
  expect(json).not.toContain('premiumAnnual')
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/tools/shape-product-info.test.ts` — expect FAIL: unknown `derived` option / missing fields.
- [ ] Step 3: Minimal implementation — extend the shaper signature and the handler:
```ts
// lib/tools/shape-product-info.ts — new options + output fields
export interface DerivedProductInputs {
  pricingExamples: PricingExample[]
  eligibilityBounds: EligibilityBounds
  content: { keyValueProductPoints: LocalizedList | null; sellSpecificInfo: LocalizedTextValue | null; contentVersions: string[] }
  addonContent: Record<string, { sellSpecificAddonInfo: LocalizedTextValue | null }>
}
export function shapeProductInfo(raw: RawProduct, opts: { age?: number; derived: DerivedProductInputs }): ShapedProduct
// ShapedProduct: remove eligibility/features/pricingExplanation/premiumRange/targetAgeRange passthroughs;
// add pricing_examples, eligibility_bounds, key_value_product_points, sell_specific_info;
// ShapedAddon gains sell_specific_addon_info (looked up by addon code from derived.addonContent)
```
```ts
// lib/tools/registry.ts getProductInfoHandler — replace the inline age block (:349-363) with B0:
import { getCustomerProfileSnapshot } from '@/lib/customer-profile' // B0 service — single derived-age source
import { derivePricingExamples, type PricingExampleGrid } from '@/lib/engines/pricing-examples'
import { projectEligibilityBounds } from '@/lib/engines/eligibility-bounds'
import { loadEligibilityRules } from '@/lib/engines/eligibility' // C2 rule loader
import { getPublishedProductContent } from '@/lib/products/product-content'

const profile = await getCustomerProfileSnapshot(context.customerId)
const age = profile.age ?? undefined // derived: DOB else declaredAge — never extractedProfile
const grid = product.pricingExampleGrid as unknown as PricingExampleGrid | null
const rules = await loadEligibilityRules(product.id)
const published = await getPublishedProductContent(product.id)
const examples = grid ? derivePricingExamples(buildPricingTree(product), grid) : []
// buildPricingTree maps the already-loaded prisma include tree to PricingTree (tiers/levels/addonRules/quoteValidityDays)
return { success: true, data: {
  product: shapeProductInfo(raw, { age, derived: {
    pricingExamples: examples,
    eligibilityBounds: projectEligibilityBounds(rules),
    content: mapPublished(published),
    addonContent: mapAddonPublished(published, product.addons),
  } }),
  contentVersions: collectVersionIds(published),
}, message: `Product details for ${product.code}.` }
```
Keep the tool `cacheable: false` (output still shaped per customer age).
- [ ] Step 4: Run `npx vitest run __tests__/lib/tools/shape-product-info.test.ts __tests__/lib/tools/handlers/product-handlers.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(tools): get_product_info serves derived pricing_examples/eligibility_bounds + published claims; addon info folded"`

### Task E1.8: T11.D5 protect content migration — author new content, purge prices, retire legacy fields, update consumers
**Files:**
- Create: prisma/seeds/seed-product-content.ts
- Modify: prisma/seeds/seed-product.ts (pricingExampleGrid value; defaultPlaybook price purge; remove dropped-column writes), prisma/seeds/index.ts (register seedProductContent), prisma/schema.prisma (migration retire_legacy_product_fields dropping features/pricingExplanation/premiumRange/targetAgeRange), lib/tools/handlers/product-handlers.ts (compare_products: replace features/premiumRange with key_value_product_points from published content), lib/chat/context-loaders.ts (productContext: drop the premiumRange parsing block at :266-277, read published content + a derived example span; coachingBriefing keeps the playbook minus embedded facts)
- Test: __tests__/integration/seed-product-content.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing seed-integrity test:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { seedProductContent } from '@/prisma/seeds/seed-product-content'

describe('protect content migration (T11.D5)', () => {
  beforeAll(async () => {
    await truncate(['ProductContent'])
    await seedProductContent(testDb)
  })

  it('publishes bilingual key points (8-10), sell info and addon info for protect', async () => {
    const product = await testDb.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const published = await testDb.productContent.findMany({ where: { productId: product.id, status: 'PUBLISHED' } })
    const points = published.filter((r) => r.field === 'KEY_VALUE_PRODUCT_POINTS')
    expect(points.map((r) => r.locale).sort()).toEqual(['en', 'ro'])
    const roPoints = points.find((r) => r.locale === 'ro')!.content as string[]
    expect(roPoints.length).toBeGreaterThanOrEqual(8)
    expect(roPoints.length).toBeLessThanOrEqual(10)
    expect(published.some((r) => r.field === 'SELL_SPECIFIC_ADDON_INFO' && r.addonId !== null)).toBe(true)
  })

  it('authored content carries no raw numerals — only {{coverage:CODE}} placeholders', async () => {
    const rows = await testDb.productContent.findMany({ where: { status: 'PUBLISHED' } })
    for (const row of rows) {
      const text = JSON.stringify(row.content).replace(/\{\{[^}]+\}\}/g, '')
      expect(text).not.toMatch(/\d/)
    }
  })

  it('the playbook no longer embeds prices and instead directs to pricing_examples', async () => {
    const product = await testDb.product.findUniqueOrThrow({ where: { code: 'protect' } })
    expect(product.defaultPlaybook).not.toMatch(/\d+\s*(RON|lei|EUR)/i)
    expect(product.defaultPlaybook).toContain('pricing_examples')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/seed-product-content.test.ts` — expect FAIL: seed module missing.
- [ ] Step 3: Implementation. (a) Author prisma/seeds/seed-product-content.ts: exports `seedProductContent(prisma)` upserting DRAFT rows version 1 for KEY_VALUE_PRODUCT_POINTS (ro+en arrays distilled from the current features[] + playbook value proposition — e.g. ro: 'Doua pachete, Standard si Optim', 'Acoperire deces din orice cauza', 'Fara examen medical pentru produsul de baza', 'Acoperire teritoriala globala', 'Contract anual cu reinnoire automata', 'Perioada de gratie generoasa la plata', 'Invaliditate permanenta din accident acoperita', 'Optional: tratament medical in strainatate prin BD'), SELL_SPECIFIC_INFO (BD-led framing + complement positioning + numbers-free cost anchoring), SELL_SPECIFIC_ADDON_INFO on the TREATMENT_ABROAD_BD addonId (component breakdown with {{coverage:CODE}} placeholders using the seeded CoverageType codes — read them from seed-product.ts when authoring), PRICING_NOTE (numbers-free 'how pricing works'), then calls publishProductContent for each field with approvedBy 'seed:t11d5'. (b) seed-product.ts: set pricingExampleGrid; rewrite defaultPlaybook price passages into 'prezinta cifrele DOAR din pricing_examples' directives (keep tone/pacing/objection choreography per T11.D5); delete writes to the four legacy columns. (c) prisma migration `npx prisma migrate dev --name retire_legacy_product_fields` dropping features/pricingExplanation/premiumRange/targetAgeRange. (d) Update compare_products (drop p.features/p.premiumRange — return key_value_product_points per product from getPublishedProductContent; NO premium numbers pre-quote) and lib/chat/context-loaders.ts productContext (replace the premiumRange block with one line derived from derivePricingExamples min/max base example, labeled base-only vs base+addon to close the anchoring gap; inject key points from published content). (e) Reseed dev + test DBs: `npx tsx prisma/seeds/index.ts` (both DATABASE_URL and TEST_DATABASE_URL runs — demo data, destructive OK).
- [ ] Step 4: Run `npx vitest run __tests__/integration/seed-product-content.test.ts __tests__/lib/chat __tests__/lib/tools` — expect PASS (context-loader and product tool suites updated in the same change).
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(product-content): protect content migration — authored claims published, prices purged, legacy fields retired"`

### Task E1.9: Package verification — full suite + runtime consistency check
**Files:**
- Create: scripts/verify-product-content.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-product-content.ts: loads protect + full pricing tree from the dev DB, (1) derives pricing_examples via derivePricingExamples and re-computes each cell with a direct calculateQuote call, asserting exact equality; (2) loads published ProductContent and asserts both locales exist per field and `JSON.stringify(content).replace(placeholders,'')` contains no digit; (3) calls the get_product_info handler for a seeded customer and asserts the payload has pricing_examples + eligibility_bounds + key_value_product_points and lacks pricingExplanation/features/premiumRange/targetAgeRange; (4) asserts contentVersions ids are present (M8 stamp source). `process.exit(1)` on any failure with a printed diff.
- [ ] Step 2: Run `npx tsx scripts/verify-product-content.ts` — expect all checks reported OK (exit 0).
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (the instrumentation flake __tests__/lib/events/instrumentation.test.ts is a known timing flake; treat as pass when it is the only failure).
- [ ] Step 4: Re-run the integration subset against the test DB: `npx vitest run __tests__/integration` — expect green.
- [ ] Step 5: Commit — `git add -A && git commit -m "chore(product-content): E1 verification script + green suite"`


### ⚠ Binding errata for E1 (fidelity verifier — apply OVER the task text above)

1. **[E1.1/Step 3 (schema) + Step 1 (test)]** @@unique([productId, addonId, field, locale, version]) with nullable addonId does NOT enforce uniqueness for product-level rows on Postgres: NULLs are distinct in unique indexes, so the test's second create (addonId omitted = NULL) will SUCCEED and the `rejects.toThrow()` assertion fails. Same hole silently permits duplicate published rows that E1.3's reader would mis-merge.
   **Fix:** In the add_product_content migration SQL, replace the single unique index with two partial unique indexes (one `WHERE "addonId" IS NULL` on (productId, field, locale, version), one `WHERE "addonId" IS NOT NULL` on all five columns), or hand-edit the migration to use UNIQUE NULLS NOT DISTINCT (PG15+). Keep the test as-is — it then correctly verifies the constraint.
2. **[E1.1/Step 3 (__tests__/helpers/test-db.ts)]** `new PrismaClient({ datasources: { db: { url } } })` is not valid for this codebase's client: the generator is `prisma-client` (prisma/schema.prisma:1-4) and every client is constructed with the PrismaPg driver adapter (lib/db.ts: `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`; prisma/seeds/index.ts does the same). The `datasources` constructor option does not exist on this generated client — the helper won't compile.
   **Fix:** Construct the test client the same way the app does: `import { PrismaPg } from '@prisma/adapter-pg'` and `export const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })`.
3. **[E1.1 (cross-cutting, affects every integration test: E1.3, E1.8, E2.2-E2.5, E3.2-E3.5, E4.1, E4.3, E4.5)]** Split-brain databases: all services under test (publishProductContent, createWorkItem, executeErasure, runReEngagementJob, the route handlers, the gateway) import `prisma` from '@/lib/db', which connects to DATABASE_URL — while the tests seed and assert through `testDb` on TEST_DATABASE_URL. As written, the service writes go to the dev DB and every assertion against testDb fails (or worse, passes against stale dev data).
   **Fix:** Add a vitest setup file for the integration suite (e.g. __tests__/integration/setup.ts registered via vitest config `setupFiles`) that sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` BEFORE '@/lib/db' is imported, and have test-db.ts re-export lib/db's prisma as testDb (one client, one DB). Document the invariant in the helper. This must land in E1.1 since every later package inherits it.
4. **[E1.7/Step 1 (test additions)]** The new tests reference a fixture named `rawProduct` that does not exist in __tests__/lib/tools/shape-product-info.test.ts — the existing suite's fixture is named `raw`. The premium-stripping assertions cited at :120-136 do exist (≈:114-138), but the new tests as written reference an undefined variable.
   **Fix:** Use the existing `raw` fixture, or include a concrete `const rawProduct = {...}` literal in the test code block.
5. **[E1.7/Step 3 (handler snippet)]** Placeholder violation: the registry.ts snippet calls buildPricingTree, mapPublished, mapAddonPublished and collectVersionIds — none of these four functions is defined in any task or pinned contract; only buildPricingTree gets a one-line prose description.
   **Fix:** Provide real implementations in the code block: buildPricingTree mapping the prisma include tree (pricingTiers→levels.premiumAnnual/name, addons[0].pricingRules→addonRules, quoteValidityDays) to PricingTree; mapPublished/mapAddonPublished projecting PublishedProductContent fields/addonFields (keyed by addon code via product.addons lookup) into DerivedProductInputs.content/addonContent; collectVersionIds concatenating contentIds across field sets.
6. **[E1.3/Step 3 + E1.8/Step 3(d) (cache invalidation)]** Fidelity to the T11 risk pin 'Publish must invalidate ALL product-content caches': invalidateProductContentCache only clears product-content.ts's own module cache, while lib/chat/context-loaders.ts keeps productContextCache, coachingBriefingCache and catalogOverviewCache at 10-minute TTL (:28-30). After E1.8 re-points productContext at published content, a compliance retraction keeps serving retired claims from those caches until expiry — the exact failure the agenda names.
   **Fix:** In E1.3 (or E1.8(d)), export flush functions for productContextCache/coachingBriefingCache (catalogOverview already has a flush hook) and call them from publishProductContent after the transaction, alongside invalidateProductContentCache.
7. **[E1 package (T11.D2 governance surface)]** Fidelity gap vs T11.D2 ✅ (ratified): 'edits go through the existing Proposal-style review pattern (ProposalStatus + admin proposals UI)'. No E task builds any authoring/review surface or proposals routing for ProductContent — publishProductContent is only ever called from seeds with approvedBy 'seed:t11d5'. The package ships 'governed' content with no governance surface, which T11's own risk list calls out ('version 1 being the only version forever while appearing governed'). E1.3's step-3 note defers it without an owner.
   **Fix:** Either add a small E-task: admin products-content page + publish API route (mirroring E2.5's auth pattern, POST → publishProductContent), or record the deferral explicitly in the package goal/overview with the owning block/package named, so the orchestrator can assign it rather than it silently vanishing.
8. **[E1.8/Step 3(d) (productContext) — M8 pin 1]** M8 (binding log) requires per-turn ProductContent version stamps: 'TurnDebug snapshot records the ProductContent version id(s) injected into that turn's prompt'. E1.8 injects published claims into productContext but exposes no version ids from the loader, so the (other-block) TurnDebug stamping has nothing to record for prompt-injected claims; only the get_product_info tool result carries contentVersions.
   **Fix:** Have loadProductContext return the published contentIds/version alongside the section text (e.g. widen its return type or set a module-level lastInjectedContentVersions consumed by the turn-debug writer), and note the M8 hand-off dependency in E1.8.
9. **[E1.4/Step 3 (PricingExampleGrid type)]** Minor T11.D1 fidelity: the type pins `parameter: 'age'` as the only literal. The ✅ recommendation (reinforced by the 'single-product overfitting' risk) makes the variation parameter per-product DATA precisely so future products can vary on other inputs; a closed literal type re-hardcodes 'age' at the type level.
   **Fix:** Type it `parameter: string` (validated against a known-parameters map at derivation time, unknown → empty examples + reason code) or a widening union, keeping 'age' as protect's declared value in the seed grid.

## Package E2: WorkItem operator queue: persisted escalations, referral resolution through the gateway, admin queue UI (M5)

**Execution slot:** 9 | **Depends on:** A2, B0

**Goal:** One generic WorkItem queue as the operator spine: escalate_to_human finally persists (replacing console.log in lib/tools/handlers/utility-handlers.ts) as a gateway commit with idempotent replay; generate_quote's referred outcome creates a REFERRAL WorkItem (wired to D1); operators resolve through the same commit gateway (actor=operator) — approve re-runs generate_quote as a system commit and issues the quote, reject terminates the application with the underwriter reason and notifies the customer via the outbound notifier (ledger-recorded); a minimal admin list+detail+action UI lands in app/admin/(protected)/work-items. Operator decisions get the same envelope, legality and ledger as agent commits — free-form admin status edits never exist for this queue.

**Migrations / seeds:**
- prisma/schema.prisma: add enums WorkItemKind { REFERRAL, ESCALATION, DOCUMENT_REVIEW, GDPR_ERASURE, GDPR_EXPORT, ALERT_FLAG }, WorkItemStatus { OPEN, IN_PROGRESS, RESOLVED, DISMISSED }, WorkItemPriority { LOW, MEDIUM, HIGH, URGENT }
- prisma/schema.prisma: add model WorkItem { id, kind WorkItemKind, status WorkItemStatus @default(OPEN), priority WorkItemPriority @default(MEDIUM), reason String @db.Text, refs Json, payload Json?, createdBy String, resolution String? @db.Text, resolutionCode String?, resolvedBy String?, resolvedAt DateTime?, createdAt, updatedAt } with @@index([status, kind, priority]) (migration add_work_items)
- Depends on C1's ApplicationStatus extension (REFERRED, DECLINED in the T5.D6 set) — E2 does not alter ApplicationStatus itself
- No seed changes (operator users already seeded in prisma/seeds/seed-users.ts); test DB migrated via prisma migrate deploy

### Task E2.1: WorkItem model + service
**Files:**
- Create: lib/work-items/service.ts
- Modify: prisma/schema.prisma (WorkItem model + enums)
- Test: __tests__/integration/work-item-service.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { createWorkItem, listWorkItems } from '@/lib/work-items/service'

describe('WorkItem service', () => {
  beforeEach(async () => { await truncate(['WorkItem']) })

  it('persists a work item with kind, refs, priority and creator', async () => {
    const item = await createWorkItem({
      kind: 'ESCALATION', reason: 'customer asked for a human',
      refs: { conversationId: 'conv-1', customerId: 'cust-1' },
      createdBy: 'agent', priority: 'HIGH',
    })
    expect(item.status).toBe('OPEN')
    const found = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(found.kind).toBe('ESCALATION')
    expect((found.refs as { conversationId?: string }).conversationId).toBe('conv-1')
  })

  it('lists open items filtered by kind, newest first', async () => {
    await createWorkItem({ kind: 'REFERRAL', reason: 'underwriter review', refs: { applicationId: 'app-1' }, createdBy: 'system' })
    await createWorkItem({ kind: 'ESCALATION', reason: 'x', refs: {}, createdBy: 'agent' })
    const referrals = await listWorkItems({ status: 'OPEN', kind: 'REFERRAL' })
    expect(referrals).toHaveLength(1)
    expect(referrals[0].reason).toBe('underwriter review')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/work-item-service.test.ts` — expect FAIL: model/service missing.
- [ ] Step 3: Minimal implementation — schema (see package migrations) then:
```ts
// lib/work-items/service.ts
import { prisma } from '@/lib/db'
import type { WorkItem, WorkItemKind, WorkItemPriority, WorkItemStatus } from '@/lib/generated/prisma/client'

export interface WorkItemRefs {
  customerId?: string; conversationId?: string; applicationId?: string; quoteId?: string; policyId?: string
}

export async function createWorkItem(input: {
  kind: WorkItemKind; reason: string; refs: WorkItemRefs; createdBy: string
  priority?: WorkItemPriority; payload?: unknown
}): Promise<WorkItem> {
  return prisma.workItem.create({ data: {
    kind: input.kind, reason: input.reason, refs: input.refs as object,
    createdBy: input.createdBy, priority: input.priority ?? 'MEDIUM',
    payload: input.payload === undefined ? undefined : (input.payload as object),
  } })
}

export async function listWorkItems(filter: { status?: WorkItemStatus; kind?: WorkItemKind } = {}): Promise<WorkItem[]> {
  return prisma.workItem.findMany({ where: { ...(filter.status && { status: filter.status }), ...(filter.kind && { kind: filter.kind }) }, orderBy: { createdAt: 'desc' } })
}
```
Run `npx prisma migrate dev --name add_work_items && npx prisma generate` and `npx prisma migrate deploy` against the test DB.
- [ ] Step 4: Run `npx vitest run __tests__/integration/work-item-service.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(work-items): WorkItem model + service (M5 spine)"`

### Task E2.2: escalate_to_human persists a WorkItem through the commit gateway
**Files:**
- Modify: lib/tools/handlers/utility-handlers.ts (drop console.log AND the Conversation.status IDLE write — conversation status carries zero funnel semantics per contradiction #11; create the WorkItem instead)
- Test: __tests__/integration/escalate-to-human.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test — through the gateway, against the real test DB:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2 artifact

async function seedConversation() {
  const customer = await testDb.customer.create({ data: {} })
  const conversation = await testDb.conversation.create({ data: { customerId: customer.id } })
  return { customer, conversation }
}

describe('escalate_to_human (gateway commit)', () => {
  beforeEach(async () => { await truncate(['WorkItem', 'CommitLedger', 'Conversation', 'Customer']) })

  it('persists an ESCALATION WorkItem + ledger row; conversation status untouched', async () => {
    const { customer, conversation } = await seedConversation()
    const result = await executeCommit({
      tool: 'escalate_to_human', actor: 'agent',
      conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'customer requested a human', priority: 'high' },
    })
    expect(result.outcome).toBe('applied')
    const items = await testDb.workItem.findMany({ where: { kind: 'ESCALATION' } })
    expect(items).toHaveLength(1)
    expect((items[0].refs as { conversationId?: string }).conversationId).toBe(conversation.id)
    expect(items[0].priority).toBe('HIGH')
    const ledger = await testDb.commitLedger.findMany({ where: { tool: 'escalate_to_human' } })
    expect(ledger).toHaveLength(1)
    const conv = await testDb.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
    expect(conv.status).toBe('ACTIVE') // no funnel semantics on conversation status
  })

  it('replays idempotently — same args return original outcome, no second WorkItem (#8 order)', async () => {
    const { customer, conversation } = await seedConversation()
    const args = { reason: 'same reason', priority: 'medium' }
    const first = await executeCommit({ tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args })
    const replay = await executeCommit({ tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args })
    expect(replay.outcome).toBe(first.outcome)
    expect(await testDb.workItem.count()).toBe(1)
    const ledger = await testDb.commitLedger.findMany({ where: { tool: 'escalate_to_human' }, orderBy: { createdAt: 'asc' } })
    expect(ledger[1].idempotencyDisposition).toBe('replay')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/escalate-to-human.test.ts` — expect FAIL: no WorkItem created (current handler console.logs and flips status).
- [ ] Step 3: Minimal implementation:
```ts
// lib/tools/handlers/utility-handlers.ts
import { createWorkItem } from '@/lib/work-items/service'
import type { ToolHandler } from '@/lib/tools/types'

const PRIORITY_MAP: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'> = {
  low: 'LOW', medium: 'MEDIUM', high: 'HIGH', urgent: 'URGENT',
}

export const escalateToHuman: ToolHandler = async (args, context) => {
  const reason = (args.reason as string | undefined) ?? 'unspecified'
  const priority = PRIORITY_MAP[(args.priority as string | undefined) ?? 'medium'] ?? 'MEDIUM'
  try {
    const item = await createWorkItem({
      kind: 'ESCALATION', reason, priority,
      refs: { conversationId: context.conversationId, customerId: context.customerId },
      createdBy: 'agent',
    })
    return {
      success: true,
      data: { escalated: true, workItemId: item.id, reason, priority },
      message: 'Escalation recorded. A specialist will follow up with full context of this conversation.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```
Register escalate_to_human as a commit routed through the gateway in A2's tool classification (it writes a WorkItem); per M10 it stays exposed as the always-available floor — verify A1's exposure table includes it unconditionally.
- [ ] Step 4: Run `npx vitest run __tests__/integration/escalate-to-human.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(work-items): escalate_to_human persists a WorkItem via the commit gateway"`

### Task E2.3: REFERRAL WorkItem creation for generate_quote's referred outcome (D1 hook)
**Files:**
- Create: lib/work-items/referral.ts
- Test: __tests__/integration/referral-work-item.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { createReferralWorkItem } from '@/lib/work-items/referral'

describe('createReferralWorkItem', () => {
  beforeEach(async () => { await truncate(['WorkItem']) })

  it('opens exactly one OPEN referral per application (re-running generate_quote must not duplicate)', async () => {
    const input = {
      applicationId: 'app-1', customerId: 'cust-1', conversationId: 'conv-1',
      reason: 'pending_external_check: cumulative sum at risk',
    }
    const first = await createReferralWorkItem(input)
    const second = await createReferralWorkItem(input)
    expect(second.id).toBe(first.id)
    expect(await testDb.workItem.count({ where: { kind: 'REFERRAL', status: 'OPEN' } })).toBe(1)
    expect((first.refs as { applicationId?: string }).applicationId).toBe('app-1')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/referral-work-item.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/work-items/referral.ts — called by D1's generate_quote referred branch inside its transaction
import { prisma } from '@/lib/db'
import type { WorkItem } from '@/lib/generated/prisma/client'

export async function createReferralWorkItem(input: {
  applicationId: string; customerId: string; conversationId: string; reason: string
}): Promise<WorkItem> {
  const existing = await prisma.workItem.findFirst({
    where: { kind: 'REFERRAL', status: 'OPEN', refs: { path: ['applicationId'], equals: input.applicationId } },
  })
  if (existing) return existing
  return prisma.workItem.create({ data: {
    kind: 'REFERRAL', status: 'OPEN', priority: 'HIGH', reason: input.reason,
    refs: { applicationId: input.applicationId, customerId: input.customerId, conversationId: input.conversationId },
    createdBy: 'system',
  } })
}
```
Wire into D1: the generate_quote handler's `referred` branch (Application → REFERRED) calls createReferralWorkItem in the same transaction — if D1 has already landed, add the call there in this task; if not, D1's package imports this function (dependency noted both ways, the function is the contract).
- [ ] Step 4: Run `npx vitest run __tests__/integration/referral-work-item.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(work-items): referral WorkItem on generate_quote referred (single OPEN per application)"`

### Task E2.4: resolve_referral operator commit + outbound customer notifier
**Files:**
- Create: lib/tools/handlers/operator-handlers.ts
- Create: lib/engagement/outbound-notifier.ts
- Test: __tests__/integration/resolve-referral.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2
import { createReferralWorkItem } from '@/lib/work-items/referral'

// seedReferredApplication: customer + conversation + REFERRED application + complete answers/selection
// (use the same seeding helpers D1's integration tests use; build inline with testDb otherwise)

describe('resolve_referral (actor=operator)', () => {
  beforeEach(async () => {
    await truncate(['WorkItem', 'CommitLedger', 'Quote', 'Application', 'Conversation', 'Customer'])
  })

  it('rejects non-operator actors with actor_not_permitted', async () => {
    const { app, item } = await seedReferredApplication(testDb)
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'agent',
      conversationId: app.conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'approve' },
    })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'actor_not_permitted' })
  })

  it('approve resumes quote generation: application leaves REFERRED, quote issued, work item resolved', async () => {
    const { app, item } = await seedReferredApplication(testDb)
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'operator',
      conversationId: app.conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'approve', note: 'underwriter ok' },
    })
    expect(r.outcome).toBe('applied')
    const resolved = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolutionCode: 'approved', resolvedBy: 'operator' })
    const quote = await testDb.quote.findFirst({ where: { applicationId: app.id } })
    expect(quote).not.toBeNull() // generate_quote re-ran as a system commit and issued
    const updated = await testDb.application.findUniqueOrThrow({ where: { id: app.id } })
    expect(updated.status).not.toBe('REFERRED')
  })

  it('reject terminates the application with the underwriter reason and records an outbound notification ledger event', async () => {
    const { app, item } = await seedReferredApplication(testDb)
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'operator',
      conversationId: app.conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'reject', note: 'sum at risk exceeded' },
    })
    expect(r.outcome).toBe('applied')
    expect(r.effects).toContain('terminal')
    const updated = await testDb.application.findUniqueOrThrow({ where: { id: app.id } })
    expect(updated.status).toBe('DECLINED')
    const outbound = await testDb.commitLedger.findMany({ where: { tool: 'notification_sent', actor: 'system' } })
    expect(outbound).toHaveLength(1)
  })

  it('rejects resolution of a non-OPEN work item with work_item_not_open', async () => {
    const { app, item } = await seedReferredApplication(testDb)
    await testDb.workItem.update({ where: { id: item.id }, data: { status: 'RESOLVED' } })
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'operator',
      conversationId: app.conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'approve' },
    })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'work_item_not_open' })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/resolve-referral.test.ts` — expect FAIL: tool not registered.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engagement/outbound-notifier.ts
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import type { EmailProvider } from '@/lib/email/types'

export interface OutboundNotification {
  customerId: string; conversationId: string | null
  kind: 'referral_rejected' | 'referral_approved' | 're_engagement'
  subject: { ro: string; en: string }; html: { ro: string; en: string }
}

// Sends in the customer's language (M6) and records the outbound as a system ledger event (M2/M5).
export async function sendCustomerNotification(
  input: OutboundNotification,
  provider: EmailProvider = getEmailProvider(),
): Promise<{ sent: boolean; reason?: 'no_email_channel' }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } })
  if (!customer.email) return { sent: false, reason: 'no_email_channel' }
  const locale = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
  await provider.send({ to: customer.email, subject: input.subject[locale], html: input.html[locale] })
  await prisma.commitLedger.create({ data: {
    conversationId: input.conversationId, customerId: input.customerId,
    actor: 'system', tool: 'notification_sent', targetRef: input.kind,
    argsHash: `${input.kind}:${input.customerId}:${Date.now()}`,
    outcome: 'applied', effects: [], idempotencyDisposition: 'fresh',
  } })
  return { sent: true }
}
```
```ts
// lib/tools/handlers/operator-handlers.ts — resolve_referral, executed by the gateway (actor resolved server-side)
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { sendCustomerNotification } from '@/lib/engagement/outbound-notifier'

export async function resolveReferral(args: { workItemId: string; decision: 'approve' | 'reject'; note?: string }, context: { actorId: string }) {
  const item = await prisma.workItem.findUnique({ where: { id: args.workItemId } })
  if (!item || item.kind !== 'REFERRAL') return { outcome: 'rejected' as const, reason: 'work_item_not_found', effects: [] }
  if (item.status !== 'OPEN') return { outcome: 'rejected' as const, reason: 'work_item_not_open', effects: [] }
  const refs = item.refs as { applicationId: string; customerId: string; conversationId: string }

  if (args.decision === 'approve') {
    await prisma.$transaction([
      prisma.application.update({ where: { id: refs.applicationId }, data: { status: 'OPEN' } }),
      prisma.workItem.update({ where: { id: item.id }, data: { status: 'RESOLVED', resolutionCode: 'approved', resolution: args.note ?? null, resolvedBy: 'operator', resolvedAt: new Date() } }),
    ])
    const quote = await executeCommit({ tool: 'generate_quote', actor: 'system', conversationId: refs.conversationId, customerId: refs.customerId, args: {} })
    return { outcome: 'applied' as const, effects: ['re_rating' as const], data: { quote: quote.data } }
  }

  await prisma.$transaction([
    prisma.application.update({ where: { id: refs.applicationId }, data: { status: 'DECLINED', flagsForReview: { underwriterReason: args.note ?? 'declined' } } }),
    prisma.workItem.update({ where: { id: item.id }, data: { status: 'RESOLVED', resolutionCode: 'rejected', resolution: args.note ?? null, resolvedBy: 'operator', resolvedAt: new Date() } }),
  ])
  await sendCustomerNotification({
    customerId: refs.customerId, conversationId: refs.conversationId, kind: 'referral_rejected',
    subject: { ro: 'Actualizare despre cererea ta', en: 'An update on your application' },
    html: { ro: '<p>Cererea ta a fost analizata si nu poate continua. Te putem ajuta cu alternative in conversatie.</p>', en: '<p>Your application was reviewed and cannot proceed. We can help with alternatives in the conversation.</p>' },
  })
  return { outcome: 'applied' as const, effects: ['terminal' as const] }
}
```
Register resolve_referral in the gateway's commit registry with an operator-only legality predicate — the gateway's step-1 actor resolution + step-3 legality reject non-operator actors with reason `actor_not_permitted` (engine emits the code; never prose, M6).
- [ ] Step 4: Run `npx vitest run __tests__/integration/resolve-referral.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(work-items): resolve_referral operator commit — approve resumes quote, reject terminates + notifies"`

### Task E2.5: Admin queue API + minimal list/detail UI
**Files:**
- Create: app/api/admin/work-items/route.ts (GET list)
- Create: app/api/admin/work-items/[id]/resolve/route.ts (POST → gateway operator commit)
- Create: app/admin/(protected)/work-items/page.tsx (server-component list: kind, priority, reason, age, status; links to detail)
- Create: app/admin/(protected)/work-items/[id]/page.tsx (detail: refs, payload, kind-specific action buttons posting to the resolve route)
- Modify: components/admin/admin-sidebar.tsx (add Work Items nav entry)
- Test: __tests__/integration/work-items-api.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (route handlers invoked directly with NextRequest; auth pattern mirrors app/admin/(protected)/layout.tsx):
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { signToken } from '@/lib/auth/jwt'
import { GET as listWorkItemsRoute } from '@/app/api/admin/work-items/route'
import { POST as resolveRoute } from '@/app/api/admin/work-items/[id]/resolve/route'
import { createWorkItem } from '@/lib/work-items/service'

function req(url: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (opts.token) headers.set('cookie', `zeno_auth=${opts.token}`)
  return new NextRequest(`http://localhost${url}`, { method: opts.method ?? 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
}

describe('admin work-items API', () => {
  beforeEach(async () => { await truncate(['WorkItem', 'CommitLedger']) })

  it('401s without a token (negative)', async () => {
    const res = await listWorkItemsRoute(req('/api/admin/work-items'))
    expect(res.status).toBe(401)
  })

  it('403s for CUSTOMER role (negative)', async () => {
    const token = await signToken({ userId: 'u1', email: 'c@x.ro', role: 'CUSTOMER' })
    const res = await listWorkItemsRoute(req('/api/admin/work-items', { token }))
    expect(res.status).toBe(403)
  })

  it('lists open items for OPERATOR and resolves an escalation', async () => {
    const item = await createWorkItem({ kind: 'ESCALATION', reason: 'help', refs: { conversationId: 'c1', customerId: 'cu1' }, createdBy: 'agent' })
    const token = await signToken({ userId: 'op1', email: 'op@x.ro', role: 'OPERATOR' })
    const list = await listWorkItemsRoute(req('/api/admin/work-items?status=OPEN', { token }))
    expect(list.status).toBe(200)
    expect((await list.json()).items).toHaveLength(1)
    const res = await resolveRoute(
      req(`/api/admin/work-items/${item.id}/resolve`, { token, method: 'POST', body: { decision: 'resolve', note: 'handled by phone' } }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const updated = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(updated.status).toBe('RESOLVED')
  })

  it('400s on an invalid decision for the kind (negative)', async () => {
    const item = await createWorkItem({ kind: 'ESCALATION', reason: 'help', refs: {}, createdBy: 'agent' })
    const token = await signToken({ userId: 'op1', email: 'op@x.ro', role: 'OPERATOR' })
    const res = await resolveRoute(
      req(`/api/admin/work-items/${item.id}/resolve`, { token, method: 'POST', body: { decision: 'approve' } }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(400)
  })
})
```
Note: check signToken's exact payload signature in lib/auth/jwt.ts (:27) when writing the test and match it.
- [ ] Step 2: Run `npx vitest run __tests__/integration/work-items-api.test.ts` — expect FAIL: route modules missing.
- [ ] Step 3: Minimal implementation. (a) GET route: verifyToken from cookie (COOKIE_NAME), role must be ADMIN|OPERATOR else 401/403; parses ?status&kind; returns `{ items: await listWorkItems(filter) }`. (b) resolve route: same auth; per-kind decision map — REFERRAL accepts approve|reject and forwards to `executeCommit({ tool: 'resolve_referral', actor: 'operator', ... })` using refs from the item; ESCALATION/ALERT_FLAG accept resolve|dismiss handled by a generic `resolve_work_item` operator commit (registered beside resolve_referral; sets status RESOLVED/DISMISSED + resolution fields through the gateway so the ledger records who-moved-what-why); unknown decision → 400 with `{ error: 'invalid_decision_for_kind' }`; GDPR kinds return 400 `{ error: 'use_gdpr_resolution' }` until E3 wires them. (c) Pages: list page server-component renders listWorkItems({status:'OPEN'}) in a table (kind badge, priority, reason, createdAt age, link); detail page renders refs/payload JSON and kind-appropriate buttons in a small client component posting to the resolve route then router.refresh(). (d) Sidebar entry 'Work items' → /admin/work-items.
- [ ] Step 4: Run `npx vitest run __tests__/integration/work-items-api.test.ts` — expect PASS. Manual runtime check: `npm run dev`, open /admin/work-items as the seeded operator, see the queue render.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(admin): work-item queue API + list/detail UI with operator actions"`

### Task E2.6: Package verification — full suite + queue runtime sim
**Files:**
- Create: scripts/verify-work-items.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-work-items.ts: against the dev DB, (1) executeCommit escalate_to_human for a seeded conversation → assert WorkItem OPEN + ledger row; (2) replay the same commit → assert no duplicate + replay disposition; (3) createReferralWorkItem for a synthetic application ref then resolve via executeCommit resolve_referral actor=operator decision=reject → assert RESOLVED + DECLINED application + notification_sent ledger event (EMAIL_PROVIDER=mock); print a summary table; exit 1 on any failed assertion.
- [ ] Step 2: Run `npx tsx scripts/verify-work-items.ts` — expect all steps OK (exit 0).
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (instrumentation flake rule applies).
- [ ] Step 4: Run `npx vitest run __tests__/integration` against the test DB — expect green.
- [ ] Step 5: Commit — `git add -A && git commit -m "chore(work-items): E2 verification script + green suite"`


### ⚠ Binding errata for E2 (fidelity verifier — apply OVER the task text above)

1. **[E1.1 (cross-cutting, affects every integration test: E1.3, E1.8, E2.2-E2.5, E3.2-E3.5, E4.1, E4.3, E4.5)]** Split-brain databases: all services under test (publishProductContent, createWorkItem, executeErasure, runReEngagementJob, the route handlers, the gateway) import `prisma` from '@/lib/db', which connects to DATABASE_URL — while the tests seed and assert through `testDb` on TEST_DATABASE_URL. As written, the service writes go to the dev DB and every assertion against testDb fails (or worse, passes against stale dev data).
   **Fix:** Add a vitest setup file for the integration suite (e.g. __tests__/integration/setup.ts registered via vitest config `setupFiles`) that sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` BEFORE '@/lib/db' is imported, and have test-db.ts re-export lib/db's prisma as testDb (one client, one DB). Document the invariant in the helper. This must land in E1.1 since every later package inherits it.
2. **[E2.migrations + E2.4/Step 1+3 (reject branch)]** Fidelity: the migration note claims "REFERRED, DECLINED in the T5.D6 set" and the reject branch writes/asserts Application status 'DECLINED'. The T5.D6 ✅ enum (agenda :682, ratified by the log; M9 inventory says "Application (REFERRED + T5.D6 set)") is exactly OPEN, PAUSED, REFERRED, COMPLETED, CANCELLED — there is no DECLINED. C1 will not ship it, so E2.4 references an enum value defined nowhere.
   **Fix:** Map the underwriter rejection to the pinned terminal state: set status 'CANCELLED' with flagsForReview { underwriterReason } (M5 #3 only requires 'terminal with underwriter reason'), and update the test assertions accordingly. If a distinct DECLINED state is genuinely wanted, raise it to the orchestrator as an explicit C1 enum amendment instead of asserting it exists.
3. **[E2.5/Step 1 and E3.4/Step 1 (tests)]** All `signToken({...})` calls pass one argument, but lib/auth/jwt.ts:27-30 declares `signToken(payload: JWTPayload, expiresIn: string)` — expiresIn is required, so the tests don't compile. E2.5's note only mentions checking the payload shape, not the second parameter; E3.4 has no note at all.
   **Fix:** Call `signToken({ userId, email, role }, '1h')` in every test. (Cookie name 'zeno_auth' is correct — COOKIE_NAME at jwt.ts:12.)
4. **[E2.migrations (seed claim) + E2.5/Step 4 (manual check)]** Codebase reality: "operator users already seeded in prisma/seeds/seed-users.ts" is false — seed-users.ts seeds exactly one ADMIN (admin@zeno.ro). E2.5's manual runtime check "open /admin/work-items as the seeded operator" is impossible as written.
   **Fix:** Either add an OPERATOR user to prisma/seeds/seed-users.ts inside E2 (seed change recorded in the package migrations) or reword the claim and the manual check to use the seeded admin (the API tests are unaffected since they mint tokens directly).
5. **[E2.4/E3.2/E3.5/E4.3/E4.5 (tests, multiple steps)]** Undefined test helpers referenced with no creation task or import path: seedReferredApplication (E2.4), seedPolicyFor (E3.2), seedVerifiedChannelCustomer (E3.5), seedCustomerWithIssuedQuote (E4.3), seedVerifiedConsentingCustomerWithExpiringQuote and withdrawConsent (E4.5). 'use the same seeding helpers D1's integration tests use; build inline otherwise' is a 'similar-to' placeholder — an engineer with zero context cannot run these tests.
   **Fix:** Add a task (e.g. in E2) creating __tests__/helpers/seed-fixtures.ts with concrete implementations for each helper (testDb writes for customer/conversation/application/quote chains; B0 setDeclaredField + B3 channel-verification + B1 consent-grant calls for the verified/consenting variants), and import them explicitly in each test file.
6. **[E2.5/Step 3(b) + E3.3/E3.5 (admin queue GDPR wiring)]** E2.5's resolve route returns 400 { error: 'use_gdpr_resolution' } for GDPR kinds 'until E3 wires them' — but no E3 task ever modifies app/api/admin/work-items/[id]/resolve/route.ts or the detail page. Operators therefore cannot approve GDPR_ERASURE/GDPR_EXPORT items from the queue UI, contradicting M3's 'operator-approved execution (M5 queue)' — approval is only reachable via direct executeCommit calls in tests/scripts.
   **Fix:** Add a step to E3.3 (and E3.5) modifying the resolve route's decision map: GDPR_ERASURE + decision 'approve' → executeCommit approve_erasure; GDPR_EXPORT + 'approve' → approve_export; both kinds accept 'dismiss' via the generic resolve_work_item; add the corresponding buttons on the detail page and a route-level test assertion.
7. **[E2.3/Step 3 (lib/work-items/referral.ts)]** The comment claims createReferralWorkItem is 'called by D1's generate_quote referred branch inside its transaction', but the implementation is hardwired to the global prisma client — it cannot participate in D1's transaction, so an aborted generate_quote could strand an orphan REFERRAL WorkItem.
   **Fix:** Change the signature to `createReferralWorkItem(input, db: Prisma.TransactionClient | PrismaClient = prisma)` and use `db` for both queries; document that D1 passes its tx client.
8. **[E2.2/Step 3 (and E2.4, E3.3 handler bodies)]** Gateway-order fidelity (#8 step 6: 'transactional apply + ledger row in same transaction'): the escalate_to_human handler writes the WorkItem via the global prisma client, and resolve_referral/approve_erasure open their own prisma.$transaction — none can share the gateway's apply transaction, so the WorkItem write and the ledger row are not atomic. Whether this passes depends entirely on A2's commit-handler signature, which the tasks never pin.
   **Fix:** State the integration contract explicitly: A2's commit handlers receive the gateway's TransactionClient (e.g. via context.tx) and Block E handlers must use it for all domain writes (createWorkItem gains the optional db param per the E2.3 fix; resolve_referral's updates use context.tx instead of its own $transaction). Add this to depends_on notes so A2 exposes the seam.

## Package E3: GDPR: retention-policy module, operator-approved erasure, delete-data route alignment, data-access export (M3)

**Execution slot:** 20 | **Depends on:** B0, E2

**Goal:** Erasure and access on top of the contradiction-#2 consent ledger: a typed retention-policy CONFIG module (not DB) declares per-data-class dispositions (legally retained ⇒ anonymize-what-is-allowed + retain-what-is-mandated; freely erasable ⇒ full delete, with the never-contracted distinction) with legal-confirmation flags on durations; the erasure job executes those dispositions atomically, tombstones the Customer (aligned with B0 claim-and-merge pseudonymization), and is gated behind an operator-approved GDPR_ERASURE WorkItem resolved through the commit gateway; the existing app/api/gdpr/delete-data/route.ts is audited and re-pointed to create the WorkItem instead of mutating data inline; data-access export compiles everything held on a customer into a versioned typed bundle, delivered via dashboard/work-item, requestable by the agent only as a WorkItem and exposed only at verified_channel identity tier (requires_identity with needs:['verified_channel'] otherwise). Consent withdrawal semantics themselves (processing halt, marketing-job kill) are B1/A-engine rules; E4's job consumes them.

**Migrations / seeds:**
- prisma/schema.prisma: add Customer.erasedAt DateTime? (tombstone marker set by the erasure executor; aligns with B0's pseudonymized-customer tombstone) — migration add_customer_erasure_tombstone
- No retention table in the DB — retention policy is a typed config module (lib/gdpr/retention-policy.ts) per the E3 brief
- Identity-requirements table (contradiction #1 build item, Block B artifact): add rows request_data_export -> verified_channel and request_erasure -> declared (data change in B's table, shipped in this package)
- prisma/seeds: no changes; demo data reset acceptable when testing erasure

### Task E3.1: Retention-policy config module (per data class, legal flags)
**Files:**
- Create: lib/gdpr/retention-policy.ts
- Test: __tests__/lib/gdpr/retention-policy.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { RETENTION_POLICIES, DATA_CLASSES, dispositionFor } from '@/lib/gdpr/retention-policy'

describe('retention policy table (M3)', () => {
  it('declares a policy for every data class — exhaustive by construction', () => {
    for (const dc of DATA_CLASSES) expect(RETENTION_POLICIES[dc]).toBeDefined()
  })
  it('legally mandated classes are never erasable, even for never-contracted customers', () => {
    for (const dc of ['dnt_signed', 'policies', 'payments_schedules', 'consent_events', 'commit_ledger'] as const) {
      expect(dispositionFor(dc, { hasContracted: true })).not.toBe('erase')
      expect(RETENTION_POLICIES[dc].legalReviewPending).toBe(true) // durations flagged for legal confirmation
    }
  })
  it('conversations and soft profile data of never-contracted customers are fully erasable', () => {
    expect(dispositionFor('conversations_messages', { hasContracted: false })).toBe('erase')
    expect(dispositionFor('customer_profile', { hasContracted: false })).toBe('erase')
  })
  it('contracted customers get anonymize-retain for conversations (audit trail kept, PII gone)', () => {
    expect(dispositionFor('conversations_messages', { hasContracted: true })).toBe('anonymize_retain')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/gdpr/retention-policy.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/gdpr/retention-policy.ts — config module, NOT a DB table (M3 resolution)
export const DATA_CLASSES = [
  'customer_identity',      // Customer name/email/phone/cnp/dob/address
  'customer_profile',       // B0 provenance rows, insights, extracted soft data
  'conversations_messages', // Conversation, Message, Answer
  'dnt_signed',             // signed Dnt aggregates (insurance-law retention)
  'dnt_unsigned_sessions',  // unsigned DntSession drafts
  'applications',
  'quotes',
  'payments_schedules',     // Payment, PaymentSchedule (financial records)
  'policies',
  'consent_events',         // B1 ledger — proof of consent is itself retained
  'commit_ledger',          // A2 ledger — references not values (T14.D5)
  'work_items',
  'documents_evidence',     // Document registry + CustomerDocument evidence records
  'turn_debug',             // short-lived; erase freely
] as const
export type DataClass = (typeof DATA_CLASSES)[number]

export type RetentionDisposition = 'erase' | 'anonymize_retain' | 'retain_mandated'

export interface RetentionPolicy {
  whenNeverContracted: RetentionDisposition
  whenContracted: RetentionDisposition
  legalBasis: string
  retentionYears: number | null   // null = indefinite pending legal input
  legalReviewPending: boolean     // durations & bases flagged for legal confirmation (M3.4)
}

export const RETENTION_POLICIES: Record<DataClass, RetentionPolicy> = {
  customer_identity:      { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'GDPR art.17; AML/insurance retention when contracted', retentionYears: null, legalReviewPending: true },
  customer_profile:       { whenNeverContracted: 'erase', whenContracted: 'erase',            legalBasis: 'soft profile data, no retention duty', retentionYears: 0, legalReviewPending: false },
  conversations_messages: { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'audit trail when contracted', retentionYears: null, legalReviewPending: true },
  dnt_signed:             { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'IDD demands-and-needs record', retentionYears: null, legalReviewPending: true },
  dnt_unsigned_sessions:  { whenNeverContracted: 'erase', whenContracted: 'erase', legalBasis: 'unsigned drafts', retentionYears: 0, legalReviewPending: false },
  applications:           { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'pre-contractual record when contracted', retentionYears: null, legalReviewPending: true },
  quotes:                 { whenNeverContracted: 'erase', whenContracted: 'anonymize_retain', legalBasis: 'acceptance evidence when contracted', retentionYears: null, legalReviewPending: true },
  payments_schedules:     { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'financial records', retentionYears: null, legalReviewPending: true },
  policies:               { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'insurance contract record', retentionYears: null, legalReviewPending: true },
  consent_events:         { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'proof of consent/withdrawal', retentionYears: null, legalReviewPending: true },
  commit_ledger:          { whenNeverContracted: 'retain_mandated', whenContracted: 'retain_mandated', legalBasis: 'audit substrate; stores references not values', retentionYears: null, legalReviewPending: true },
  work_items:             { whenNeverContracted: 'anonymize_retain', whenContracted: 'anonymize_retain', legalBasis: 'operational record incl. the erasure decision itself', retentionYears: null, legalReviewPending: true },
  documents_evidence:     { whenNeverContracted: 'erase', whenContracted: 'retain_mandated', legalBasis: 'KYC evidence when contracted', retentionYears: null, legalReviewPending: true },
  turn_debug:             { whenNeverContracted: 'erase', whenContracted: 'erase', legalBasis: 'short-lived diagnostics (T14.D5)', retentionYears: 0, legalReviewPending: false },
}

export function dispositionFor(dc: DataClass, ctx: { hasContracted: boolean }): RetentionDisposition {
  const p = RETENTION_POLICIES[dc]
  return ctx.hasContracted ? p.whenContracted : p.whenNeverContracted
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/gdpr/retention-policy.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(gdpr): typed retention-policy config module per data class"`

### Task E3.2: Erasure executor — anonymize-vs-retain per class, tombstone, report
**Files:**
- Create: lib/gdpr/erasure.ts
- Modify: prisma/schema.prisma (Customer.erasedAt DateTime?)
- Test: __tests__/integration/gdpr-erasure.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { executeErasure } from '@/lib/gdpr/erasure'

describe('GDPR erasure executor', () => {
  beforeEach(async () => {
    await truncate(['Message', 'Answer', 'Conversation', 'CustomerInsight', 'Payment', 'Policy', 'Quote', 'Application', 'Customer'])
  })

  it('never-contracted customer: conversations/messages/insights fully deleted, identity tombstoned', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ion Pop', email: 'ion@x.ro', phone: '0700000000' } })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    await testDb.message.create({ data: { conversationId: conv.id, role: 'user', content: 'date personale' } })
    await testDb.customerInsight.create({ data: { customerId: customer.id, key: 'budgetPreference', category: 'BUYING_SIGNAL', value: 'lowest' } })

    const report = await executeErasure(customer.id, 'operator:op-1')

    expect(await testDb.conversation.count({ where: { customerId: customer.id } })).toBe(0)
    expect(await testDb.customerInsight.count({ where: { customerId: customer.id } })).toBe(0)
    const after = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } })
    expect(after).toMatchObject({ name: null, email: null, phone: null, isAnonymous: true })
    expect(after.erasedAt).not.toBeNull()
    expect(report.classResults.find((c) => c.dataClass === 'conversations_messages')!.disposition).toBe('erase')
  })

  it('contracted customer: policy/payment retained, conversations anonymized not deleted', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ana M', email: 'ana@x.ro' } })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    await testDb.message.create({ data: { conversationId: conv.id, role: 'user', content: 'CNP-ul meu este secret' } })
    // minimal contracted evidence: a Policy row (FK chain seeded via application+quote as in D-block tests)
    await seedPolicyFor(testDb, customer.id, conv.id)

    const report = await executeErasure(customer.id, 'operator:op-1')

    expect(await testDb.policy.count({ where: { customerId: customer.id } })).toBeGreaterThan(0)
    expect(await testDb.conversation.count({ where: { customerId: customer.id } })).toBe(1)
    const msg = await testDb.message.findFirstOrThrow({ where: { conversationId: conv.id, role: 'user' } })
    expect(msg.content).toBe('[erased_per_gdpr_request]')
    expect(report.classResults.find((c) => c.dataClass === 'policies')!.disposition).toBe('retain_mandated')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/gdpr-erasure.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation — `npx prisma migrate dev --name add_customer_erasure_tombstone` for erasedAt, then:
```ts
// lib/gdpr/erasure.ts
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { DATA_CLASSES, dispositionFor, type DataClass, type RetentionDisposition } from '@/lib/gdpr/retention-policy'

export interface ErasureReport {
  customerId: string
  executedBy: string
  classResults: { dataClass: DataClass; disposition: RetentionDisposition; affected: number }[]
}

export async function executeErasure(customerId: string, executedBy: string): Promise<ErasureReport> {
  const hasContracted =
    (await prisma.policy.count({ where: { customerId } })) > 0 ||
    (await prisma.payment.count({ where: { customerId } })) > 0
  const ctx = { hasContracted }
  const classResults: ErasureReport['classResults'] = []
  const conversationIds = (await prisma.conversation.findMany({ where: { customerId }, select: { id: true } })).map((c) => c.id)

  await prisma.$transaction(async (tx) => {
    for (const dataClass of DATA_CLASSES) {
      const disposition = dispositionFor(dataClass, ctx)
      let affected = 0
      if (disposition === 'retain_mandated') { classResults.push({ dataClass, disposition, affected: 0 }); continue }
      switch (dataClass) {
        case 'customer_identity':
          await tx.customer.update({ where: { id: customerId }, data: {
            name: null, email: null, phone: null, dateOfBirth: null,
            cnpEncrypted: null, cnpIv: null, cnpTag: null, address: Prisma.DbNull,
            extractedProfile: Prisma.DbNull, isAnonymous: true,
            magicLinkToken: null, magicLinkExpiresAt: null, erasedAt: new Date(),
          } })
          affected = 1
          break
        case 'customer_profile':
          affected = (await tx.customerInsight.deleteMany({ where: { customerId } })).count
          // plus B0 provenance rows: tx.<B0 profile-field model>.deleteMany({ where: { customerId } })
          break
        case 'conversations_messages':
          if (conversationIds.length === 0) break
          if (disposition === 'erase') {
            await tx.answer.deleteMany({ where: { conversationId: { in: conversationIds } } })
            await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } })
            affected = (await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } })).count
          } else {
            affected = (await tx.message.updateMany({
              where: { conversationId: { in: conversationIds }, role: 'user' },
              data: { content: '[erased_per_gdpr_request]' },
            })).count
            await tx.answer.deleteMany({ where: { conversationId: { in: conversationIds } } })
          }
          break
        // applications/quotes/dnt_unsigned_sessions/documents_evidence/turn_debug/work_items:
        // same pattern — deleteMany on 'erase', PII-field scrub on 'anonymize_retain'; enumerate each explicitly in the real implementation
      }
      classResults.push({ dataClass, disposition, affected })
    }
  })
  return { customerId, executedBy, classResults }
}
```
Enumerate EVERY remaining DataClass branch explicitly in the implementation (applications/quotes scrub flagsForReview + delete when erase; dnt_unsigned_sessions deleteMany on B-block's DntSession where unsigned; documents_evidence delete evidence records when never-contracted; turn_debug deleteMany on TurnDebug by conversationId; work_items scrub reason/payload PII). Adjust the B0 provenance-table delete to B0's actual model name when implementing.
- [ ] Step 4: Run `npx vitest run __tests__/integration/gdpr-erasure.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(gdpr): retention-driven erasure executor with customer tombstone + class report"`

### Task E3.3: request_erasure / approve_erasure through WorkItem + gateway
**Files:**
- Create: lib/tools/handlers/gdpr-handlers.ts (request_erasure agent tool)
- Modify: lib/tools/handlers/operator-handlers.ts (add approve_erasure operator commit)
- Test: __tests__/integration/gdpr-erasure-flow.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway' // A2

describe('GDPR erasure flow (agent requests, operator approves)', () => {
  beforeEach(async () => { await truncate(['WorkItem', 'CommitLedger', 'Conversation', 'Customer']) })

  it('request_erasure creates a GDPR_ERASURE WorkItem — data untouched until approval', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'request_erasure', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: { reason: 'customer asked in chat' } })
    expect(r.outcome).toBe('applied')
    const items = await testDb.workItem.findMany({ where: { kind: 'GDPR_ERASURE', status: 'OPEN' } })
    expect(items).toHaveLength(1)
    expect((await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe('Ion')
  })

  it('approve_erasure (operator) executes the retention-driven job and resolves the item, ledger-recorded', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    await executeCommit({ tool: 'request_erasure', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {} })
    const item = await testDb.workItem.findFirstOrThrow({ where: { kind: 'GDPR_ERASURE' } })
    const r = await executeCommit({ tool: 'approve_erasure', actor: 'operator', conversationId: conv.id, customerId: customer.id, args: { workItemId: item.id } })
    expect(r.outcome).toBe('applied')
    const after = await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } })
    expect(after.name).toBeNull()
    expect(after.erasedAt).not.toBeNull()
    const resolved = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect((resolved.payload as { classResults?: unknown[] }).classResults).toBeDefined() // decision recorded
    expect(await testDb.commitLedger.count({ where: { tool: 'approve_erasure' } })).toBe(1)
  })

  it('approve_erasure rejects non-operator actors (negative)', async () => {
    const customer = await testDb.customer.create({ data: {} })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'approve_erasure', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: { workItemId: 'whatever' } })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'actor_not_permitted' })
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/gdpr-erasure-flow.test.ts` — expect FAIL: tools not registered.
- [ ] Step 3: Minimal implementation:
```ts
// lib/tools/handlers/gdpr-handlers.ts
import { createWorkItem } from '@/lib/work-items/service'
import type { ToolHandler } from '@/lib/tools/types'

export const requestErasure: ToolHandler = async (args, context) => {
  const item = await createWorkItem({
    kind: 'GDPR_ERASURE', priority: 'HIGH',
    reason: (args.reason as string | undefined) ?? 'customer_requested_erasure',
    refs: { customerId: context.customerId, conversationId: context.conversationId },
    createdBy: 'agent',
  })
  return { success: true, data: { workItemId: item.id }, message: 'Erasure request recorded for operator review. No data has been deleted yet.' }
}
```
```ts
// in lib/tools/handlers/operator-handlers.ts
import { executeErasure } from '@/lib/gdpr/erasure'

export async function approveErasure(args: { workItemId: string }, context: { actorId: string }) {
  const item = await prisma.workItem.findUnique({ where: { id: args.workItemId } })
  if (!item || item.kind !== 'GDPR_ERASURE') return { outcome: 'rejected' as const, reason: 'work_item_not_found', effects: [] }
  if (item.status !== 'OPEN') return { outcome: 'rejected' as const, reason: 'work_item_not_open', effects: [] }
  const refs = item.refs as { customerId: string }
  const report = await executeErasure(refs.customerId, `operator:${context.actorId}`)
  await prisma.workItem.update({ where: { id: item.id }, data: {
    status: 'RESOLVED', resolutionCode: 'completed', resolvedBy: 'operator', resolvedAt: new Date(),
    payload: report as unknown as object, // per-class decisions recorded on the item; ledger row from the gateway
  } })
  return { outcome: 'applied' as const, effects: ['terminal' as const], data: { classResults: report.classResults } }
}
```
Register both in the gateway commit registry: request_erasure exposed to agent/gui actors (identity-requirements row: declared); approve_erasure operator-only (legality predicate rejects others with actor_not_permitted).
- [ ] Step 4: Run `npx vitest run __tests__/integration/gdpr-erasure-flow.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(gdpr): erasure request->operator approval flow through the commit gateway"`

### Task E3.4: Audit + align app/api/gdpr/delete-data/route.ts under the retention table
**Files:**
- Modify: app/api/gdpr/delete-data/route.ts (stop mutating inline; CUSTOMER creates a GDPR_ERASURE WorkItem; ADMIN may approve immediately via the gateway; response reports workItemId + status)
- Test: __tests__/integration/gdpr-delete-data-route.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { signToken } from '@/lib/auth/jwt'
import { DELETE as deleteData } from '@/app/api/gdpr/delete-data/route'

function req(body: unknown, token?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('cookie', `zeno_auth=${token}`)
  return new NextRequest('http://localhost/api/gdpr/delete-data', { method: 'DELETE', headers, body: JSON.stringify(body) })
}

describe('DELETE /api/gdpr/delete-data (aligned under retention table)', () => {
  beforeEach(async () => { await truncate(['WorkItem', 'CommitLedger', 'User', 'Conversation', 'Customer']) })

  it('401s without auth (negative)', async () => {
    expect((await deleteData(req({ customerId: 'x', confirmDeletion: true }))).status).toBe(401)
  })

  it('400s without confirmDeletion (negative)', async () => {
    const token = await signToken({ userId: 'u1', email: 'a@x.ro', role: 'ADMIN' })
    expect((await deleteData(req({ customerId: 'x' }, token))).status).toBe(400)
  })

  it('CUSTOMER request creates an OPEN GDPR_ERASURE WorkItem — no inline mutation', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    const user = await testDb.user.create({ data: { email: 'ion@x.ro', role: 'CUSTOMER', customerId: customer.id, passwordHash: '', isActive: true } })
    const token = await signToken({ userId: user.id, email: user.email, role: 'CUSTOMER' })
    const res = await deleteData(req({ customerId: customer.id, confirmDeletion: true }, token))
    expect(res.status).toBe(202)
    expect((await res.json()).workItemId).toBeDefined()
    expect((await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe('Ion')
    expect(await testDb.workItem.count({ where: { kind: 'GDPR_ERASURE', status: 'OPEN' } })).toBe(1)
  })

  it('CUSTOMER cannot request erasure of another customer (negative 403)', async () => {
    const victim = await testDb.customer.create({ data: {} })
    const customer = await testDb.customer.create({ data: {} })
    const user = await testDb.user.create({ data: { email: 'me@x.ro', role: 'CUSTOMER', customerId: customer.id, passwordHash: '', isActive: true } })
    const token = await signToken({ userId: user.id, email: user.email, role: 'CUSTOMER' })
    expect((await deleteData(req({ customerId: victim.id, confirmDeletion: true }, token))).status).toBe(403)
  })

  it('ADMIN request approves immediately through the gateway: customer tombstoned, item RESOLVED', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ana', email: 'ana@x.ro' } })
    const token = await signToken({ userId: 'admin1', email: 'admin@x.ro', role: 'ADMIN' })
    const res = await deleteData(req({ customerId: customer.id, confirmDeletion: true }, token))
    expect(res.status).toBe(200)
    expect((await testDb.customer.findUniqueOrThrow({ where: { id: customer.id } })).erasedAt).not.toBeNull()
    expect(await testDb.workItem.count({ where: { kind: 'GDPR_ERASURE', status: 'RESOLVED' } })).toBe(1)
  })
})
```
Note: match the existing User model's required fields when seeding (check prisma/schema.prisma User before writing).
- [ ] Step 2: Run `npx vitest run __tests__/integration/gdpr-delete-data-route.test.ts` — expect FAIL: current route mutates inline and returns deletedFields.
- [ ] Step 3: Minimal implementation — keep the route's auth/ownership checks (:16-63) verbatim; replace the mutation block (:85-158) with: create WorkItem(GDPR_ERASURE, refs {customerId}, createdBy `${payload.role}:${payload.userId}`); if role === 'ADMIN', immediately `executeCommit({ tool: 'approve_erasure', actor: 'operator', conversationId: <customer's latest conversation id or null>, customerId, args: { workItemId } })` and return 200 with the class report; else return 202 `{ workItemId, status: 'pending_operator_approval' }`. Delete the now-dead inline anonymization code — the executor owns all mutations under the retention table.
- [ ] Step 4: Run `npx vitest run __tests__/integration/gdpr-delete-data-route.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "refactor(gdpr): delete-data route aligned under retention table — WorkItem + gateway, no inline mutation"`

### Task E3.5: Data-access export — compiler, request tool (verified_channel gate), dashboard delivery
**Files:**
- Create: lib/gdpr/export.ts
- Modify: lib/tools/handlers/gdpr-handlers.ts (add request_data_export), lib/tools/handlers/operator-handlers.ts (add approve_export)
- Create: app/api/gdpr/export/[workItemId]/route.ts (GET download)
- Test: __tests__/integration/gdpr-export.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/chat/commit-gateway'
import { compileCustomerExport } from '@/lib/gdpr/export'

describe('GDPR data-access export', () => {
  beforeEach(async () => { await truncate(['WorkItem', 'CommitLedger', 'Message', 'Conversation', 'Customer']) })

  it('compiles a versioned bundle of everything held on the customer', async () => {
    const customer = await testDb.customer.create({ data: { name: 'Ion', email: 'ion@x.ro' } })
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    await testDb.message.create({ data: { conversationId: conv.id, role: 'user', content: 'salut' } })
    const bundle = await compileCustomerExport(customer.id)
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.profile.email).toBe('ion@x.ro')
    expect(bundle.conversations).toHaveLength(1)
    expect(bundle.conversations[0].messages).toHaveLength(1)
    expect(bundle).toHaveProperty('consentEvents')
    expect(bundle).toHaveProperty('commitLedger')
  })

  it('request_data_export requires verified_channel — requires_identity with needs otherwise', async () => {
    const customer = await testDb.customer.create({ data: {} }) // anonymous tier
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {} })
    expect(r.outcome).toBe('requires_identity')
    expect(r.needs).toContain('verified_channel')
    expect(await testDb.workItem.count({ where: { kind: 'GDPR_EXPORT' } })).toBe(0)
  })

  it('verified customer: request creates the WorkItem; operator approval stores the bundle on it', async () => {
    const customer = await seedVerifiedChannelCustomer(testDb) // B0/B3 helper: verified email channel
    const conv = await testDb.conversation.create({ data: { customerId: customer.id } })
    const r = await executeCommit({ tool: 'request_data_export', actor: 'agent', conversationId: conv.id, customerId: customer.id, args: {} })
    expect(r.outcome).toBe('applied')
    const item = await testDb.workItem.findFirstOrThrow({ where: { kind: 'GDPR_EXPORT' } })
    const approved = await executeCommit({ tool: 'approve_export', actor: 'operator', conversationId: conv.id, customerId: customer.id, args: { workItemId: item.id } })
    expect(approved.outcome).toBe('applied')
    const resolved = await testDb.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect((resolved.payload as { schemaVersion?: number }).schemaVersion).toBe(1)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/gdpr-export.test.ts` — expect FAIL: modules/tools missing.
- [ ] Step 3: Minimal implementation. (a) lib/gdpr/export.ts:
```ts
import { prisma } from '@/lib/db'

export interface CustomerExportBundle {
  schemaVersion: 1
  generatedAt: string
  profile: Record<string, unknown>          // B0 service snapshot incl. per-field provenance + identity tier
  consentEvents: unknown[]                  // B1 ledger rows
  conversations: { id: string; createdAt: Date; messages: { role: string; content: string; createdAt: Date }[] }[]
  dnt: unknown[]
  applications: unknown[]
  quotes: unknown[]
  payments: unknown[]
  policies: unknown[]
  workItems: unknown[]
  commitLedger: unknown[]                   // references-not-values rows (T14.D5 safe to export)
}

export async function compileCustomerExport(customerId: string): Promise<CustomerExportBundle> {
  // one read per store, all keyed on Customer.id (B0 ownership rule); B0 service for profile facts;
  // implement each collection read explicitly — no store omitted, the bundle IS the access right
}
```
(b) request_data_export handler creates WorkItem(GDPR_EXPORT) — the verified_channel gate is NOT re-implemented in the handler: add the identity-requirements row (request_data_export -> verified_channel) so the gateway's legality step returns requires_identity with needs ['verified_channel'] before the handler runs (contradiction #1 table, Block B artifact). (c) approve_export: operator commit; compiles the bundle, stores it as WorkItem.payload, resolves the item. (d) Download route GET /api/gdpr/export/[workItemId]: verifyToken; CUSTOMER may download only when user.customerId matches refs.customerId AND item RESOLVED, ADMIN/OPERATOR always; streams payload as application/json attachment; 403 otherwise (add a negative assertion for the foreign-customer case to the test file).
- [ ] Step 4: Run `npx vitest run __tests__/integration/gdpr-export.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(gdpr): data-access export — verified-channel request, operator approval, dashboard download"`

### Task E3.6: Package verification
**Files:**
- Create: scripts/verify-gdpr-flow.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/verify-gdpr-flow.ts: against the dev DB, seed a throwaway customer with a conversation+messages+insight, run request_erasure → approve_erasure via executeCommit, assert tombstone + class report + RESOLVED item + ledger rows; then seed a verified-channel customer, run request_data_export → approve_export, assert bundle on the WorkItem; print per-class disposition table; exit 1 on failure. (Demo data — destructive run acceptable; reseed with `npx tsx prisma/seeds/index.ts` afterwards.)
- [ ] Step 2: Run `npx tsx scripts/verify-gdpr-flow.ts` — expect all checks OK (exit 0).
- [ ] Step 3: Run the full suite: `npx vitest run` — expect green (instrumentation flake rule applies).
- [ ] Step 4: Run `npx vitest run __tests__/integration` — expect green.
- [ ] Step 5: Commit — `git add -A && git commit -m "chore(gdpr): E3 verification script + green suite"`


### ⚠ Binding errata for E3 (fidelity verifier — apply OVER the task text above)

1. **[E1.1 (cross-cutting, affects every integration test: E1.3, E1.8, E2.2-E2.5, E3.2-E3.5, E4.1, E4.3, E4.5)]** Split-brain databases: all services under test (publishProductContent, createWorkItem, executeErasure, runReEngagementJob, the route handlers, the gateway) import `prisma` from '@/lib/db', which connects to DATABASE_URL — while the tests seed and assert through `testDb` on TEST_DATABASE_URL. As written, the service writes go to the dev DB and every assertion against testDb fails (or worse, passes against stale dev data).
   **Fix:** Add a vitest setup file for the integration suite (e.g. __tests__/integration/setup.ts registered via vitest config `setupFiles`) that sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` BEFORE '@/lib/db' is imported, and have test-db.ts re-export lib/db's prisma as testDb (one client, one DB). Document the invariant in the helper. This must land in E1.1 since every later package inherits it.
2. **[E2.5/Step 1 and E3.4/Step 1 (tests)]** All `signToken({...})` calls pass one argument, but lib/auth/jwt.ts:27-30 declares `signToken(payload: JWTPayload, expiresIn: string)` — expiresIn is required, so the tests don't compile. E2.5's note only mentions checking the payload shape, not the second parameter; E3.4 has no note at all.
   **Fix:** Call `signToken({ userId, email, role }, '1h')` in every test. (Cookie name 'zeno_auth' is correct — COOKIE_NAME at jwt.ts:12.)
3. **[E3.2/Step 1 (test)]** `testDb.customerInsight.create({ data: { customerId, key, category, value } })` omits the required `source` field — CustomerInsight.source is String with no default (prisma/schema.prisma:718); the create fails type-check and runtime.
   **Fix:** Add `source: 'test'` to the insight create data.
4. **[E3.5/Step 3 (lib/gdpr/export.ts)]** Placeholder violation: compileCustomerExport's body is comments only ("one read per store... implement each collection read explicitly") — no actual reads are written, breaking the NO-PLACEHOLDERS rule for the function that IS the access right.
   **Fix:** Write the reads in the code block: prisma.conversation.findMany({ where: { customerId }, include: { messages: ... } }), prisma.application/quote/payment/policy/workItem/commitLedger.findMany keyed on customerId, getCustomerProfileSnapshot(customerId) for profile, B1's consent-event read for consentEvents, and the Dnt read — then assemble the bundle literal.
5. **[E2.4/E3.2/E3.5/E4.3/E4.5 (tests, multiple steps)]** Undefined test helpers referenced with no creation task or import path: seedReferredApplication (E2.4), seedPolicyFor (E3.2), seedVerifiedChannelCustomer (E3.5), seedCustomerWithIssuedQuote (E4.3), seedVerifiedConsentingCustomerWithExpiringQuote and withdrawConsent (E4.5). 'use the same seeding helpers D1's integration tests use; build inline otherwise' is a 'similar-to' placeholder — an engineer with zero context cannot run these tests.
   **Fix:** Add a task (e.g. in E2) creating __tests__/helpers/seed-fixtures.ts with concrete implementations for each helper (testDb writes for customer/conversation/application/quote chains; B0 setDeclaredField + B3 channel-verification + B1 consent-grant calls for the verified/consenting variants), and import them explicitly in each test file.
6. **[E3.3/Step 1 vs E3.migrations (identity-requirements row)]** Internal inconsistency: the migration pins request_erasure → declared tier, but the test seeds customers via raw `testDb.customer.create({ data: { name: 'Ion', email } })` with no B0 declared-provenance rows — under B0 the derived tier is anonymous, so the gateway's identity check would return requires_identity, not the expected 'applied'.
   **Fix:** Either seed declared fields through B0 (`await setDeclaredField(customer.id, 'name', 'Ion', { source: 'conversation' })`) before calling request_erasure, or pin the row to anonymous (defensible: an anonymous chat user must be able to request erasure) and update the migrations bullet.
7. **[E4.1/Step 1 (second test) and E3.2/Step 3 (customer_identity branch)]** Both reference Customer.extractedProfile (E4.1 seeds it; E3.2's erasure executor nulls it) — but B0 'retires extractedProfile/CustomerInsight divergence into two-tier storage' (M1 log entry). If B0's migration drops the column (E depends on B0), both compile/runtime fail; if it keeps it temporarily, E4.1's seeding tests a dead path.
   **Fix:** Coordinate with B0's final schema: if the column is dropped, remove `extractedProfile: { age: 99 }` from the E4.1 seed (the 'no extractedProfile in output' assertion works without it) and drop the Prisma.DbNull line from E3.2's identity scrub; if retained, add a note that the scrub line dies with B0's cleanup.
8. **[E2.5/Step 3(b) + E3.3/E3.5 (admin queue GDPR wiring)]** E2.5's resolve route returns 400 { error: 'use_gdpr_resolution' } for GDPR kinds 'until E3 wires them' — but no E3 task ever modifies app/api/admin/work-items/[id]/resolve/route.ts or the detail page. Operators therefore cannot approve GDPR_ERASURE/GDPR_EXPORT items from the queue UI, contradicting M3's 'operator-approved execution (M5 queue)' — approval is only reachable via direct executeCommit calls in tests/scripts.
   **Fix:** Add a step to E3.3 (and E3.5) modifying the resolve route's decision map: GDPR_ERASURE + decision 'approve' → executeCommit approve_erasure; GDPR_EXPORT + 'approve' → approve_export; both kinds accept 'dismiss' via the generic resolve_work_item; add the corresponding buttons on the detail page and a route-level test assertion.
9. **[E2.2/Step 3 (and E2.4, E3.3 handler bodies)]** Gateway-order fidelity (#8 step 6: 'transactional apply + ledger row in same transaction'): the escalate_to_human handler writes the WorkItem via the global prisma client, and resolve_referral/approve_erasure open their own prisma.$transaction — none can share the gateway's apply transaction, so the WorkItem write and the ledger row are not atomic. Whether this passes depends entirely on A2's commit-handler signature, which the tasks never pin.
   **Fix:** State the integration contract explicitly: A2's commit handlers receive the gateway's TransactionClient (e.g. via context.tx) and Block E handlers must use it for all domain writes (createWorkItem gains the optional db param per the E2.3 fix; resolve_referral's updates use context.tx instead of its own $transaction). Add this to depends_on notes so A2 exposes the seam.

## Package E4: Customer-scoped reads + re-engagement v1: get_customer_profile on B0, get_open_items, proactive outbound job (M2)

**Execution slot:** 21 | **Depends on:** B0, B1, B3, D4, E2

**Goal:** Two reads replace the catalog's four (get_application_list/get_quote_list NOT built): get_customer_profile re-backed by the B0 CustomerProfile service (profile + per-field provenance + derived identity tier + history summary — extractedProfile reads die); get_open_items NEW, implementing the pinned open-item contract {kind, refId, age, nextAction} over the five M2 kinds, where nextAction is computed via deriveAndExpose and MUST be a currently-exposed action (briefing-integrity invariant applied to re-engagement, escalate_to_human as the always-exposed floor). Plus re-engagement job v1: triggers = abandoned payment N days + quote nearing expiry; verified-channel customers only; marketing-consent checked against the B1 ledger before every outbound (withdrawal kills the job for that customer); frequency caps from prior outbound ledger events; the email carries a B3 magic link that verifies AND returns to the conversation; every outbound recorded as a system ledger event. Dunning explicitly excluded (M16).

**Migrations / seeds:**
- No new tables — open items and frequency caps derive from existing stores (CommitLedger for outbound history); re-engagement thresholds live in lib/engagement/config.ts
- prisma/seeds: no changes required; verification script seeds throwaway customers

### Task E4.1: get_customer_profile re-backed by the B0 service
**Files:**
- Modify: lib/tools/handlers/profile-handlers.ts (getCustomerProfile: replace direct prisma + extractedProfile reads with the B0 CustomerProfileService snapshot; update_customer_profile routes declared-field writes through the same service per the B0 ownership rule)
- Test: __tests__/integration/get-customer-profile.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { getCustomerProfile } from '@/lib/tools/handlers/profile-handlers'
import { setDeclaredField } from '@/lib/customer-profile' // B0 service write path

describe('get_customer_profile (B0-backed)', () => {
  beforeEach(async () => { await truncate(['Conversation', 'Customer']) })

  it('returns profile facts with per-field provenance and the derived identity tier', async () => {
    const customer = await testDb.customer.create({ data: {} })
    await setDeclaredField(customer.id, 'name', 'Ion Pop', { source: 'conversation' })
    await setDeclaredField(customer.id, 'declaredAge', 35, { source: 'conversation' })
    const ctx = { conversationId: 'conv-1', customerId: customer.id, language: 'ro' } as Parameters<typeof getCustomerProfile>[1]
    const r = await getCustomerProfile({}, ctx)
    expect(r.success).toBe(true)
    const data = r.data as { profile: { fields: Record<string, { value: unknown; provenance: string }>; identityTier: string; age: number | null } }
    expect(data.profile.fields.name).toEqual(expect.objectContaining({ value: 'Ion Pop', provenance: 'declared' }))
    expect(data.profile.identityTier).toBe('anonymous') // no verified channel yet
    expect(data.profile.age).toBe(35) // derived from declaredAge — never a stored snapshot
  })

  it('includes a history summary, never raw extractedProfile', async () => {
    const customer = await testDb.customer.create({ data: { extractedProfile: { age: 99 } } })
    const ctx = { conversationId: 'conv-1', customerId: customer.id, language: 'ro' } as Parameters<typeof getCustomerProfile>[1]
    const r = await getCustomerProfile({}, ctx)
    const data = r.data as Record<string, unknown>
    expect(data).toHaveProperty('historySummary')
    expect(JSON.stringify(data)).not.toContain('extractedProfile')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/get-customer-profile.test.ts` — expect FAIL: handler still reads prisma.customer + extractedProfile.
- [ ] Step 3: Minimal implementation:
```ts
// lib/tools/handlers/profile-handlers.ts
import { getCustomerProfileSnapshot } from '@/lib/customer-profile' // B0
import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

export const getCustomerProfile: ToolHandler = async (_args, context) => {
  try {
    const snapshot = await getCustomerProfileSnapshot(context.customerId)
    // snapshot: { fields: Record<string,{value,provenance,source,updatedAt}>, identityTier, age, language }
    const [applications, quotes, policies, conversations] = await Promise.all([
      prisma.application.count({ where: { customerId: context.customerId } }),
      prisma.quote.count({ where: { customerId: context.customerId } }),
      prisma.policy.count({ where: { customerId: context.customerId } }),
      prisma.conversation.count({ where: { customerId: context.customerId } }),
    ])
    return {
      success: true,
      data: {
        profile: { fields: snapshot.fields, identityTier: snapshot.identityTier, age: snapshot.age, language: snapshot.language },
        historySummary: { applications, quotes, policies, conversations },
      },
      message: 'Customer profile loaded with provenance and identity tier.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```
update_customer_profile: replace the extractedProfile merge (:90-97) with per-field `setDeclaredField` calls for each recognized arg (unknown args rejected with `{ success: false, error: 'unknown_profile_field' }`) — verified fields cannot be overwritten by declared values (the B0 service enforces; surface its rejection as-is).
- [ ] Step 4: Run `npx vitest run __tests__/integration/get-customer-profile.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(tools): get_customer_profile re-backed by B0 service (provenance + tier + history)"`

### Task E4.2: Open-items pure engine — pinned contract, nextAction maps to exposed actions
**Files:**
- Create: lib/engines/open-items.ts
- Test: __tests__/lib/engines/open-items.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test — pure over literals (T12.D3):
```ts
import { describe, it, expect } from 'vitest'
import { deriveOpenItems } from '@/lib/engines/open-items'
import type { DerivedStateV3, ExposedActions } from '@/lib/engines/derive-and-expose'

const NOW = new Date('2026-06-12T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function state(partial: Record<string, unknown>): DerivedStateV3 {
  return { phase: 'QUOTE', subphase: null, ...partial } as unknown as DerivedStateV3
}

describe('deriveOpenItems (M2 pinned contract)', () => {
  it('surfaces an issued-unaccepted-unexpired quote with nextAction accept_quote when exposed', () => {
    const s = state({ quote: { id: 'q1', status: 'ISSUED', issuedAt: new Date(NOW.getTime() - 2 * DAY), validUntil: new Date(NOW.getTime() + 10 * DAY) } })
    const actions: ExposedActions = { available: ['accept_quote', 'get_quote_info', 'escalate_to_human'], blocked: [] }
    const items = deriveOpenItems(s, actions, NOW)
    expect(items).toContainEqual({ kind: 'quote', refId: 'q1', age: 2, nextAction: 'accept_quote' })
  })

  it('NEVER returns a nextAction outside actions.available — falls back to the escalation floor', () => {
    const s = state({ quote: { id: 'q1', status: 'ISSUED', issuedAt: new Date(NOW.getTime() - 1 * DAY), validUntil: new Date(NOW.getTime() + 1 * DAY) } })
    const actions: ExposedActions = { available: ['escalate_to_human'], blocked: [{ action: 'accept_quote', reason: 'requires_identity' }] }
    const items = deriveOpenItems(s, actions, NOW)
    expect(items[0].nextAction).toBe('escalate_to_human')
    for (const item of items) expect(actions.available).toContain(item.nextAction)
  })

  it('covers all five kinds: application, quote, installment, dnt_expiring, policy_in_progress', () => {
    const s = state({
      application: { id: 'a1', status: 'OPEN', openedAt: new Date(NOW.getTime() - 3 * DAY) },
      quote: { id: 'q1', status: 'ISSUED', issuedAt: new Date(NOW.getTime() - 2 * DAY), validUntil: new Date(NOW.getTime() + 5 * DAY) },
      schedule: { id: 's1', nextInstallment: { status: 'FAILED', dueAt: new Date(NOW.getTime() - 1 * DAY) } },
      dnt: { id: 'd1', signedAt: new Date(NOW.getTime() - 360 * DAY), expiresAt: new Date(NOW.getTime() + 5 * DAY) },
      policy: { id: 'p1', status: 'PENDING_SUBMISSION', createdAt: new Date(NOW.getTime() - 1 * DAY) },
      nextBestAction: 'save_dnt_answer',
    })
    const actions: ExposedActions = { available: ['save_dnt_answer', 'accept_quote', 'resume_payment', 'open_dnt_session', 'get_policy_status', 'escalate_to_human'], blocked: [] }
    const kinds = deriveOpenItems(s, actions, NOW).map((i) => i.kind).sort()
    expect(kinds).toEqual(['application', 'dnt_expiring', 'installment', 'policy_in_progress', 'quote'])
  })

  it('expired quotes and settled schedules are not open items', () => {
    const s = state({ quote: { id: 'q1', status: 'ISSUED', issuedAt: new Date(NOW.getTime() - 40 * DAY), validUntil: new Date(NOW.getTime() - 1 * DAY) } })
    expect(deriveOpenItems(s, { available: ['escalate_to_human'], blocked: [] }, NOW)).toHaveLength(0)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engines/open-items.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engines/open-items.ts — pure; consumes deriveAndExpose output, never recomputes legality
import type { DerivedStateV3, ExposedActions } from '@/lib/engines/derive-and-expose'
import { DNT_EXPIRY_WINDOW_DAYS } from '@/lib/engagement/config' // same window as the #12 open_dnt_session predicate

export type OpenItemKind = 'application' | 'quote' | 'installment' | 'dnt_expiring' | 'policy_in_progress'
export interface OpenItem { kind: OpenItemKind; refId: string; age: number; nextAction: string }

const DAY = 24 * 60 * 60 * 1000
const FLOOR = 'escalate_to_human' // always exposed (M10)
const ageDays = (since: Date, now: Date) => Math.floor((now.getTime() - since.getTime()) / DAY)

function pick(preferred: string[], actions: ExposedActions): string {
  return preferred.find((a) => actions.available.includes(a)) ?? FLOOR
}

export function deriveOpenItems(state: DerivedStateV3, actions: ExposedActions, now: Date): OpenItem[] {
  const items: OpenItem[] = []
  const s = state as unknown as Record<string, any>
  if (s.application && (s.application.status === 'OPEN' || s.application.status === 'PAUSED')) {
    items.push({ kind: 'application', refId: s.application.id, age: ageDays(new Date(s.application.openedAt), now),
      nextAction: pick([s.nextBestAction].filter(Boolean) as string[], actions) })
  }
  if (s.quote && s.quote.status === 'ISSUED' && new Date(s.quote.validUntil) > now) {
    items.push({ kind: 'quote', refId: s.quote.id, age: ageDays(new Date(s.quote.issuedAt), now), nextAction: pick(['accept_quote', 'get_quote_info'], actions) })
  }
  if (s.schedule?.nextInstallment && ['PENDING_DUE', 'FAILED'].includes(s.schedule.nextInstallment.status)) {
    items.push({ kind: 'installment', refId: s.schedule.id, age: ageDays(new Date(s.schedule.nextInstallment.dueAt), now), nextAction: pick(['resume_payment', 'retry_payment'], actions) })
  }
  if (s.dnt?.expiresAt && new Date(s.dnt.expiresAt) > now && new Date(s.dnt.expiresAt).getTime() - now.getTime() <= DNT_EXPIRY_WINDOW_DAYS * DAY) {
    items.push({ kind: 'dnt_expiring', refId: s.dnt.id, age: ageDays(new Date(s.dnt.signedAt), now), nextAction: pick(['open_dnt_session'], actions) })
  }
  if (s.policy && ['PENDING_SUBMISSION', 'SUBMITTED'].includes(s.policy.status)) {
    items.push({ kind: 'policy_in_progress', refId: s.policy.id, age: ageDays(new Date(s.policy.createdAt), now), nextAction: pick(['get_policy_status'], actions) })
  }
  return items
}
```
Type the state access against DerivedStateV3's real slice types once A1 lands them (replace the `Record<string, any>` cast with the actual interfaces — the cast is scaffolding for the literal-driven test, not the final shape).
- [ ] Step 4: Run `npx vitest run __tests__/lib/engines/open-items.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engines): deriveOpenItems — pinned {kind,refId,age,nextAction} with exposed-action guarantee"`

### Task E4.3: get_open_items read tool
**Files:**
- Create: lib/tools/handlers/open-items-handlers.ts
- Modify: lib/tools/registry.ts (register get_open_items as a read; sideEffects false; not cacheable — output depends on live state)
- Test: __tests__/integration/get-open-items.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { getOpenItems } from '@/lib/tools/handlers/open-items-handlers'

describe('get_open_items (integration)', () => {
  beforeEach(async () => { await truncate(['Quote', 'Application', 'Conversation', 'Customer']) })

  it('returns the issued-quote open item for a returning customer, nextAction exposed', async () => {
    const { customer, conversation } = await seedCustomerWithIssuedQuote(testDb) // helper built on D-block seeding: ISSUED quote, validUntil +10d
    const ctx = { conversationId: conversation.id, customerId: customer.id, language: 'ro' } as Parameters<typeof getOpenItems>[1]
    const r = await getOpenItems({}, ctx)
    expect(r.success).toBe(true)
    const items = (r.data as { items: { kind: string; refId: string; age: number; nextAction: string }[] }).items
    expect(items.some((i) => i.kind === 'quote')).toBe(true)
    const exposed = (r.data as { availableActions: string[] }).availableActions
    for (const item of items) expect(exposed).toContain(item.nextAction) // briefing-integrity invariant, end to end
  })

  it('returns an empty list for a fresh customer', async () => {
    const customer = await testDb.customer.create({ data: {} })
    const conversation = await testDb.conversation.create({ data: { customerId: customer.id } })
    const ctx = { conversationId: conversation.id, customerId: customer.id, language: 'ro' } as Parameters<typeof getOpenItems>[1]
    const r = await getOpenItems({}, ctx)
    expect((r.data as { items: unknown[] }).items).toEqual([])
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/get-open-items.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/tools/handlers/open-items-handlers.ts
import { loadDomainSnapshot } from '@/lib/engines/domain-snapshot' // A1 snapshot loader
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'   // A1 — the ONLY exposure computation (#6)
import { deriveOpenItems } from '@/lib/engines/open-items'
import type { ToolHandler } from '@/lib/tools/types'

export const getOpenItems: ToolHandler = async (_args, context) => {
  try {
    const snapshot = await loadDomainSnapshot({ conversationId: context.conversationId, customerId: context.customerId })
    const { state, actions } = deriveAndExpose(snapshot)
    const items = deriveOpenItems(state, actions, new Date())
    return {
      success: true,
      data: { items, availableActions: actions.available },
      message: items.length === 0 ? 'No open items for this customer.' : `${items.length} open item(s) found.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```
Register in lib/tools/registry.ts as a read (description: 'List the customer's open items — paused applications, pending quotes, due installments, expiring DNT, policies in progress — each with the next available action.'; parameters {}; sideEffects false; cacheable false). get_application_list and get_quote_list are NOT registered (M2 spec amendment — note in the registry comment).
- [ ] Step 4: Run `npx vitest run __tests__/integration/get-open-items.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(tools): get_open_items read with exposed-action nextAction guarantee"`

### Task E4.4: Re-engagement candidate selection — pure decision function
**Files:**
- Create: lib/engagement/config.ts
- Create: lib/engagement/select-candidates.ts
- Test: __tests__/lib/engagement/select-candidates.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect } from 'vitest'
import { selectReEngagementCandidates } from '@/lib/engagement/select-candidates'

const NOW = new Date('2026-06-12T08:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const CONFIG = { abandonedPaymentDays: 3, quoteExpiryWindowDays: 5, frequencyCapDays: 7 }

const base = {
  customerId: 'c1', conversationId: 'conv1',
  identityTier: 'verified_channel' as const,
  marketingConsent: true, gdprProcessingActive: true,
  lastOutboundAt: null as Date | null,
  abandonedPaymentSince: null as Date | null,
  quoteExpiresAt: null as Date | null,
}

describe('selectReEngagementCandidates', () => {
  it('selects abandoned payment older than N days', () => {
    const rows = [{ ...base, abandonedPaymentSince: new Date(NOW.getTime() - 4 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([{ customerId: 'c1', conversationId: 'conv1', trigger: 'abandoned_payment' }])
  })
  it('selects quote expiring within the window', () => {
    const rows = [{ ...base, quoteExpiresAt: new Date(NOW.getTime() + 2 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)[0]).toMatchObject({ trigger: 'quote_expiring' })
  })
  it('skips non-verified-channel customers (hard rule)', () => {
    const rows = [{ ...base, identityTier: 'declared' as const, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('skips when marketing consent is missing or withdrawn (B1 ledger says no)', () => {
    const rows = [{ ...base, marketingConsent: false, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('skips when gdpr_processing is withdrawn (M3 scope-aware withdrawal)', () => {
    const rows = [{ ...base, gdprProcessingActive: false, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('enforces the frequency cap from the last outbound', () => {
    const rows = [{ ...base, lastOutboundAt: new Date(NOW.getTime() - 2 * DAY), abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('emits at most one outbound per customer per run (abandoned payment wins over quote expiry)', () => {
    const rows = [{ ...base, abandonedPaymentSince: new Date(NOW.getTime() - 4 * DAY), quoteExpiresAt: new Date(NOW.getTime() + 1 * DAY) }]
    const out = selectReEngagementCandidates(rows, CONFIG, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('abandoned_payment')
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/lib/engagement/select-candidates.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engagement/config.ts
export interface ReEngagementConfig {
  abandonedPaymentDays: number
  quoteExpiryWindowDays: number
  frequencyCapDays: number
}
export const RE_ENGAGEMENT_CONFIG: ReEngagementConfig = {
  abandonedPaymentDays: 3,
  quoteExpiryWindowDays: 5,
  frequencyCapDays: 7,
}
export const DNT_EXPIRY_WINDOW_DAYS = 30 // shared with the #12 open_dnt_session exposure predicate — if A1 already pins this constant, import from there instead
```
```ts
// lib/engagement/select-candidates.ts — pure (T12.D3 decision core)
import type { IdentityTier } from '@/lib/engines/derive-and-expose' // pinned type
import type { ReEngagementConfig } from '@/lib/engagement/config'

export type ReEngagementTrigger = 'abandoned_payment' | 'quote_expiring'
export interface ReEngagementCandidateInput {
  customerId: string
  conversationId: string | null
  identityTier: IdentityTier
  marketingConsent: boolean        // derived from the B1 ConsentEvent ledger by the caller
  gdprProcessingActive: boolean    // false when gdpr_processing withdrawn (M3)
  lastOutboundAt: Date | null      // latest re_engagement_outbound ledger event
  abandonedPaymentSince: Date | null
  quoteExpiresAt: Date | null
}
export interface ReEngagementCandidate { customerId: string; conversationId: string | null; trigger: ReEngagementTrigger }

const DAY = 24 * 60 * 60 * 1000

export function selectReEngagementCandidates(
  rows: ReEngagementCandidateInput[], config: ReEngagementConfig, now: Date,
): ReEngagementCandidate[] {
  const out: ReEngagementCandidate[] = []
  for (const row of rows) {
    if (row.identityTier !== 'verified_channel') continue
    if (!row.marketingConsent) continue
    if (!row.gdprProcessingActive) continue
    if (row.lastOutboundAt && now.getTime() - row.lastOutboundAt.getTime() < config.frequencyCapDays * DAY) continue
    if (row.abandonedPaymentSince && now.getTime() - row.abandonedPaymentSince.getTime() >= config.abandonedPaymentDays * DAY) {
      out.push({ customerId: row.customerId, conversationId: row.conversationId, trigger: 'abandoned_payment' })
      continue // one outbound per customer per run
    }
    if (row.quoteExpiresAt && row.quoteExpiresAt > now && row.quoteExpiresAt.getTime() - now.getTime() <= config.quoteExpiryWindowDays * DAY) {
      out.push({ customerId: row.customerId, conversationId: row.conversationId, trigger: 'quote_expiring' })
    }
  }
  return out
}
```
- [ ] Step 4: Run `npx vitest run __tests__/lib/engagement/select-candidates.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engagement): pure re-engagement candidate selection (triggers, tier, consent, caps)"`

### Task E4.5: Re-engagement job runner — magic-link outbound, ledger-recorded, cap-safe
**Files:**
- Create: lib/engagement/re-engagement-job.ts
- Create: lib/email/templates/re-engagement.ts (bilingual subject+html factory taking the magic-link URL)
- Test: __tests__/integration/re-engagement-job.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { testDb, truncate } from '@/__tests__/helpers/test-db'
import { runReEngagementJob } from '@/lib/engagement/re-engagement-job'
import type { EmailProvider } from '@/lib/email/types'

function recordingProvider(): EmailProvider & { sent: { to: string; subject: string; html: string }[] } {
  const sent: { to: string; subject: string; html: string }[] = []
  return { sent, async send(input) { sent.push(input); return { messageId: `m${sent.length}` } } }
}

describe('re-engagement job v1 (M2)', () => {
  beforeEach(async () => { await truncate(['CommitLedger', 'Quote', 'Application', 'Conversation', 'Customer']) })

  it('emails a verified, consenting customer whose quote nears expiry — magic link returns to the conversation', async () => {
    const { customer, conversation } = await seedVerifiedConsentingCustomerWithExpiringQuote(testDb) // B0 verified channel + B1 marketing grant + ISSUED quote validUntil +2d
    const provider = recordingProvider()
    const report = await runReEngagementJob({ provider, now: new Date() })
    expect(report.sent).toHaveLength(1)
    expect(provider.sent[0].to).toBe(customer.email)
    expect(provider.sent[0].html).toMatch(/\/api\/auth\/verify\?token=/) // B3 challenge URL
    expect(provider.sent[0].html).toContain(conversation.id) // returnTo target
    const ledger = await testDb.commitLedger.findMany({ where: { tool: 're_engagement_outbound', actor: 'system' } })
    expect(ledger).toHaveLength(1)
  })

  it('second run within the frequency cap sends nothing', async () => {
    await seedVerifiedConsentingCustomerWithExpiringQuote(testDb)
    const provider = recordingProvider()
    await runReEngagementJob({ provider, now: new Date() })
    const second = await runReEngagementJob({ provider, now: new Date() })
    expect(second.sent).toHaveLength(0)
    expect(provider.sent).toHaveLength(1)
  })

  it('marketing withdrawal in the B1 ledger silences the customer', async () => {
    const { customer } = await seedVerifiedConsentingCustomerWithExpiringQuote(testDb)
    await withdrawConsent(testDb, customer.id, 'marketing') // B1 helper: append withdrawal event
    const provider = recordingProvider()
    const report = await runReEngagementJob({ provider, now: new Date() })
    expect(report.sent).toHaveLength(0)
  })
})
```
- [ ] Step 2: Run `npx vitest run __tests__/integration/re-engagement-job.test.ts` — expect FAIL: module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/engagement/re-engagement-job.ts
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import type { EmailProvider } from '@/lib/email/types'
import { RE_ENGAGEMENT_CONFIG } from '@/lib/engagement/config'
import { selectReEngagementCandidates, type ReEngagementCandidateInput } from '@/lib/engagement/select-candidates'
import { getCustomerProfileSnapshot } from '@/lib/customer-profile'         // B0: identity tier
import { getDerivedConsentState } from '@/lib/consents'                     // B1: latest grant minus withdrawal
import { createReturnToConversationMagicLink } from '@/lib/auth/challenges' // B3: verifies AND returns to the conversation
import { reEngagementEmail } from '@/lib/email/templates/re-engagement'

export interface ReEngagementReport { considered: number; sent: { customerId: string; trigger: string }[]; skipped: number }

export async function runReEngagementJob(opts: { provider?: EmailProvider; now?: Date } = {}): Promise<ReEngagementReport> {
  const now = opts.now ?? new Date()
  const provider = opts.provider ?? getEmailProvider()

  // 1. Gather raw trigger rows (D2 schedule for abandoned payments; ISSUED quotes for expiry)
  const rows: ReEngagementCandidateInput[] = await gatherCandidateRows(now)
  // gatherCandidateRows: for each customer with (a) a PaymentSchedule whose first installment is unpaid
  // and quote.acceptedAt older than abandonedPaymentDays, or (b) an ISSUED unaccepted quote expiring inside
  // the window — resolve identityTier via getCustomerProfileSnapshot, marketing/gdpr via getDerivedConsentState,
  // lastOutboundAt from the latest commitLedger row { tool: 're_engagement_outbound', customerId }.

  const candidates = selectReEngagementCandidates(rows, RE_ENGAGEMENT_CONFIG, now)
  const sent: ReEngagementReport['sent'] = []
  for (const c of candidates) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } })
    if (!customer.email) continue
    const link = await createReturnToConversationMagicLink(c.customerId, { conversationId: c.conversationId })
    const locale = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
    const mail = reEngagementEmail({ trigger: c.trigger, magicLinkUrl: link.url, conversationId: c.conversationId, locale })
    await provider.send({ to: customer.email, subject: mail.subject, html: mail.html })
    await prisma.commitLedger.create({ data: {
      conversationId: c.conversationId, customerId: c.customerId,
      actor: 'system', tool: 're_engagement_outbound', targetRef: c.trigger,
      argsHash: `${c.trigger}:${c.customerId}:${now.toISOString().slice(0, 10)}`,
      outcome: 'applied', effects: [], idempotencyDisposition: 'fresh',
    } })
    sent.push({ customerId: c.customerId, trigger: c.trigger })
  }
  return { considered: rows.length, sent, skipped: rows.length - sent.length }
}
```
Implement gatherCandidateRows fully (no stub): two prisma queries (schedules with unpaid first installments past the threshold via D2's PaymentSchedule model; ISSUED quotes with validUntil inside the window and no acceptance), grouped per customer, enriched via the B0/B1 calls above. lib/email/templates/re-engagement.ts returns bilingual subject/html per trigger embedding the magic-link URL (pattern of lib/email/templates/magic-link.ts). Dunning for later installments is explicitly NOT implemented (M16).
- [ ] Step 4: Run `npx vitest run __tests__/integration/re-engagement-job.test.ts` — expect PASS.
- [ ] Step 5: Commit — `git add -A && git commit -m "feat(engagement): re-engagement job v1 — verified+consenting only, capped, ledger-recorded magic-link outbound"`

### Task E4.6: Package verification — job entrypoint + full suite
**Files:**
- Create: scripts/run-re-engagement.ts (CLI entry: `npx tsx scripts/run-re-engagement.ts [--dry-run]` — dry-run prints candidates without sending; the deploy story schedules this command)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write scripts/run-re-engagement.ts: parses --dry-run; dry-run calls gatherCandidateRows + selectReEngagementCandidates and prints the candidate table (customerId, trigger, lastOutboundAt); live mode calls runReEngagementJob with EMAIL_PROVIDER from env (mock by default) and prints the report; exit 0 always unless the job throws.
- [ ] Step 2: Run `npx tsx scripts/run-re-engagement.ts --dry-run` against the dev DB — expect a printed candidate table (empty is fine on fresh seed).
- [ ] Step 3: Seed a synthetic expiring-quote customer in the dev DB (small inline block in the script under a --seed-demo flag), run `npx tsx scripts/run-re-engagement.ts` with EMAIL_PROVIDER=mock — expect 1 sent + a re_engagement_outbound ledger row; run again — expect 0 sent (cap).
- [ ] Step 4: Run the full suite `npx vitest run` and the integration subset `npx vitest run __tests__/integration` — expect green (instrumentation flake rule applies).
- [ ] Step 5: Commit — `git add -A && git commit -m "chore(engagement): re-engagement CLI entry + E4 verification"`


### ⚠ Binding errata for E4 (fidelity verifier — apply OVER the task text above)

1. **[E1.1 (cross-cutting, affects every integration test: E1.3, E1.8, E2.2-E2.5, E3.2-E3.5, E4.1, E4.3, E4.5)]** Split-brain databases: all services under test (publishProductContent, createWorkItem, executeErasure, runReEngagementJob, the route handlers, the gateway) import `prisma` from '@/lib/db', which connects to DATABASE_URL — while the tests seed and assert through `testDb` on TEST_DATABASE_URL. As written, the service writes go to the dev DB and every assertion against testDb fails (or worse, passes against stale dev data).
   **Fix:** Add a vitest setup file for the integration suite (e.g. __tests__/integration/setup.ts registered via vitest config `setupFiles`) that sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` BEFORE '@/lib/db' is imported, and have test-db.ts re-export lib/db's prisma as testDb (one client, one DB). Document the invariant in the helper. This must land in E1.1 since every later package inherits it.
2. **[E4.2/Step 1 (test literals)]** Fidelity: the test uses 'save_dnt_answer' as nextBestAction and in actions.available. Contradiction #7 (binding log) pins the 6-tool DNT surface — the write commit is 'write_dnt_answer'; 'save_dnt_answer' is the legacy name retired by Block B, and the plan rule forbids authoring new code against retired vocabulary.
   **Fix:** Replace both occurrences of 'save_dnt_answer' with 'write_dnt_answer' in the E4.2 test (and anywhere else in Block E).
3. **[E4.2/Step 3 vs E4.4 (task ordering)]** lib/engines/open-items.ts (E4.2) imports DNT_EXPIRY_WINDOW_DAYS from '@/lib/engagement/config', but that file is only created in E4.4 — E4.2's test run fails on a missing module two tasks before the file exists.
   **Fix:** Create lib/engagement/config.ts (or at least the DNT_EXPIRY_WINDOW_DAYS constant) in E4.2's Files/Step 3, or reorder E4.4 before E4.2. Keep the noted escape hatch: if A1 already pins this constant, import from A1 instead.
4. **[E2.4/E3.2/E3.5/E4.3/E4.5 (tests, multiple steps)]** Undefined test helpers referenced with no creation task or import path: seedReferredApplication (E2.4), seedPolicyFor (E3.2), seedVerifiedChannelCustomer (E3.5), seedCustomerWithIssuedQuote (E4.3), seedVerifiedConsentingCustomerWithExpiringQuote and withdrawConsent (E4.5). 'use the same seeding helpers D1's integration tests use; build inline otherwise' is a 'similar-to' placeholder — an engineer with zero context cannot run these tests.
   **Fix:** Add a task (e.g. in E2) creating __tests__/helpers/seed-fixtures.ts with concrete implementations for each helper (testDb writes for customer/conversation/application/quote chains; B0 setDeclaredField + B3 channel-verification + B1 consent-grant calls for the verified/consenting variants), and import them explicitly in each test file.
5. **[E4.1/Step 1 (second test) and E3.2/Step 3 (customer_identity branch)]** Both reference Customer.extractedProfile (E4.1 seeds it; E3.2's erasure executor nulls it) — but B0 'retires extractedProfile/CustomerInsight divergence into two-tier storage' (M1 log entry). If B0's migration drops the column (E depends on B0), both compile/runtime fail; if it keeps it temporarily, E4.1's seeding tests a dead path.
   **Fix:** Coordinate with B0's final schema: if the column is dropped, remove `extractedProfile: { age: 99 }` from the E4.1 seed (the 'no extractedProfile in output' assertion works without it) and drop the Prisma.DbNull line from E3.2's identity scrub; if retained, add a note that the scrub line dies with B0's cleanup.

### ➕ Addendum tasks for E4 (binding — coverage-critic gaps)

### Task E4.ADD-1: Outbound notifier primitive + referral-resolution notification (closes G11b)
**Files:**
- Create: `lib/notifications/notifier.ts` (channel message w/ magic-link-to-conversation; consent + frequency-cap checks; ledger event per send)
- Modify: E2's `resolve_referral` handler (call the notifier on approve AND reject — transactional notices, allowed regardless of marketing consent; marketing consent gates only campaigns)
- Test: `__tests__/integration/referral-notification.test.ts`
**Steps:**
- [ ] Step 1: Failing integration test: resolving a referral (either outcome) records exactly one outbound ledger event with the customer's language template and a challenge link that returns to the conversation (B3 primitive); a second resolution attempt replays (no second send).
- [ ] Step 2: FAIL → Step 3: implement notifier; re-engagement job v1 reuses it. Step 4: PASS. Step 5: commit.

---

# BLOCK F — Verification & delivery

## Block overview

Block F closes the transformation: it makes zeno_workflow.feature an enforced contract (F1), completes the observability layer over the new engine (F2), folds every logged spec amendment back into the two surviving spec documents (F3), rebuilds the conversation-triage tooling against the FINAL shapes (F4, explicitly LAST per the T14.D6 sequencing decision), and runs the end-to-end validation gauntlet (F5).

Grounding verified in the worktree (C:/GitHub/Zeno/.claude/worktrees/unruffled-pike-1535df): (1) the spec files live ONLY as untracked files in the main checkout at "C:/GitHub/Zeno/docs/tools as wokflow scenarios/" (zeno_workflow.feature, zeno_tool_catalog.md, plus duplicate zeno_workflow.md/.docx and zeno_tool_catalog.docx) — they are absent from the repo/worktree, so F1.1 must vendor them into git before any meta-test can exist. (2) The .feature holds 9 Feature blocks in ONE file (61 scenarios; two outlines with 5 and 4 Examples rows) — standard Gherkin allows one Feature per document, so the meta-suite needs a deterministic multi-feature splitter in front of @cucumber/gherkin. (3) No @cucumber/* packages exist (package.json verified); vitest ^4.1.0 only. (4) The observability chassis exists exactly as the log describes: lib/chat/debug.ts (DebugEvent union + recordDebugEvent always-on sink), lib/debug/reducer.ts (DebugTurn + buildTurnDebugPayload), lib/chat/turn-debug-persistence.ts (fire-and-forget upsert by traceId), prisma TurnDebug (payload Json — so F2 needs ZERO schema migrations, honoring M8 pin 3), lib/debug/conversation-export.ts + /api/conversations/[id]/{debug,export} routes + drawer download in components/debug/debug-drawer.tsx, lib/events EventBus with Anomaly type and turn:end carrying anomalies[]. (5) scripts/verify-pathology1..4.ts and verify-advance-flow.ts exist and drive handleChatTurn directly — the proven generator pattern F1.9 promotes. (6) app/admin/(protected)/ exists for the compliance evidence view.

Cross-block dependencies (imported by pinned name, owned elsewhere): deriveAndExpose/DomainSnapshot/DerivedStateV3/ExposedActions and the Phase/AppSubphase enums (Block A1), the commit gateway + CommitLedger + CommitOutcome/CommitEffect/CommitResult/ReasonCode contract and the real-test-DB helper (Block A), ConsentEvent/identity provenance (B0/B), questionnaire/quote/eligibility/suitability pure engines (C), payments/policy (D), prompt sections + briefing (E). F intentionally lands last; every F package re-verifies those symbols exist at its start.

Sequencing nuances handled inside the block: F1.3 initially tags every untranslated scenario @backlog (truthful, REPORTED count) and F1.6–F1.9 untag as they translate; taxonomy closure ships with an explicit PENDING_SPEC_AMENDMENTS allowlist ('unavailable','pending') that F3 empties — making F3 the forcing function the living-spec process demands; tool renames are absorbed by the operations map (lib/spec/operations-map.ts) so F3's .feature renames are one-line map+test updates; F4 is rebuilt from the T14.D6 spec recorded in the log (the validated prototype was removed by design); F5.4 commits a backlog baseline and adds a monotonic-decrease guard so @backlog cannot become a permanent escape hatch. Gating tiers are explicit policy: npm test (engine + meta + recorded-assertion suites) gates merges; live scripted sims gate nightly with n-of-m; the LLM judge only trends, never gates.

## Package F1: BDD harness: gherkin traceability meta-suite, scenario translation, agent assertion layer

**Execution slot:** 22 | **Depends on:** D4, E4

**Goal:** Make zeno_workflow.feature an enforced, machine-checked contract per T12: vendor the spec into the repo, parse it with @cucumber/gherkin behind a multi-feature splitter, enforce bidirectional spec<->test traceability with @backlog/@agent-judge escape tags (counted, reported), close the CommitOutcome/CommitEffect taxonomy between spec and code, translate engine-deterministic scenarios into pure-core vitest tests (snapshot literals) and real-test-DB commit-ring tests, build the shared ConversationExport assertion library for agent-behavioral scenarios, promote the verify-advance-flow pattern into a scripted live-sim generator with n-of-m policy, and quarantine LLM-judge rubrics to the irreducibly-linguistic scenarios (non-gating).

### Task F1.1: Vendor the spec into the repo + multi-Feature Gherkin parsing
**Files:**
- Create: docs/tools as wokflow scenarios/zeno_workflow.feature (vendored — currently UNTRACKED in the main checkout, absent from the repo)
- Create: docs/tools as wokflow scenarios/zeno_tool_catalog.md (vendored)
- Create: lib/spec/parse-workflow-feature.ts
- Modify: package.json (devDependencies += @cucumber/gherkin, @cucumber/messages)
- Test: __tests__/spec/parse-workflow-feature.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Vendor the spec files and install the parser (the .feature is the normative contract; CI cannot parse an untracked file):
```bash
cp -r "C:/GitHub/Zeno/docs/tools as wokflow scenarios" docs/
npm install -D @cucumber/gherkin @cucumber/messages
git add "docs/tools as wokflow scenarios/zeno_workflow.feature" "docs/tools as wokflow scenarios/zeno_tool_catalog.md" package.json package-lock.json
```
(The duplicate zeno_workflow.md/.docx and zeno_tool_catalog.docx are NOT added — F3.3 deletes them from the source folder.)
- [ ] Step 2: Write the failing test:
```ts
// __tests__/spec/parse-workflow-feature.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { splitFeatures, parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'

const TWO = `# header\n@one\nFeature: First\n  Scenario: A\n    Given x\n\n@two @extra\nFeature: Second\n  Scenario Outline: B\n    Given <v>\n    Examples:\n      | v | consequence |\n      | 1 | applied     |\n      | 2 | re_rating   |\n`

describe('splitFeatures', () => {
  it('splits a multi-Feature document into chunks owning their tag lines', () => {
    const chunks = splitFeatures(TWO)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toContain('@one')
    expect(chunks[0]).not.toContain('Feature: Second')
    expect(chunks[1]).toContain('@two @extra')
  })
})

describe('parseWorkflowFeature', () => {
  it('extracts features, scenarios, tags, steps and Examples rows', () => {
    const p = parseWorkflowFeature(TWO)
    expect(p.features.map((f) => f.name)).toEqual(['First', 'Second'])
    const b = p.scenarios.find((s) => s.name === 'B')!
    expect(b.isOutline).toBe(true)
    expect(b.examples[0].header).toEqual(['v', 'consequence'])
    expect(b.examples[0].rows).toHaveLength(2)
    expect(b.featureTags).toEqual(['@two', '@extra'])
  })
  it('fails loudly on malformed gherkin (no silent skip)', () => {
    expect(() => parseWorkflowFeature('Feature: x\n  Scenario: y\n    | bare table |\n')).toThrow()
    expect(() => parseWorkflowFeature('# only comments, no Feature\n')).toThrow()
  })
  it('parses the real spec: 9 features, 61 scenarios, outline rows 5+4', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8')
    const p = parseWorkflowFeature(src)
    expect(p.features).toHaveLength(9)
    expect(p.scenarios).toHaveLength(61)
    expect(p.scenarios.filter((s) => s.isOutline).flatMap((s) => s.examples).map((e) => e.rows.length).sort()).toEqual([4, 5])
  })
})
```
- [ ] Step 3: Run it, expect FAIL: `npx vitest run __tests__/spec/parse-workflow-feature.test.ts` — fails with "Cannot find module '@/lib/spec/parse-workflow-feature'".
- [ ] Step 4: Minimal implementation:
```ts
// lib/spec/parse-workflow-feature.ts
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'

export interface ParsedExamplesBlock { tags: string[]; header: string[]; rows: string[][] }
export interface ParsedFeature { name: string; tags: string[] }
export interface ParsedScenario {
  featureName: string
  featureTags: string[]
  name: string
  tags: string[]
  isOutline: boolean
  steps: string[]
  examples: ParsedExamplesBlock[]
}
export interface ParsedWorkflow { features: ParsedFeature[]; scenarios: ParsedScenario[] }

/**
 * zeno_workflow.feature holds 9 Feature blocks in ONE file; Gherkin allows one
 * Feature per document, so split on `Feature:` lines, pulling each feature's
 * preceding contiguous tag/comment/blank lines into its own chunk.
 */
export function splitFeatures(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const starts: number[] = []
  lines.forEach((l, i) => { if (/^Feature:/.test(l)) starts.push(i) })
  const owned = starts.map((start) => {
    let s = start
    while (s > 0 && /^(\s*@|\s*#|\s*$)/.test(lines[s - 1])) s--
    return s
  })
  return starts.map((_, k) =>
    lines.slice(owned[k], k + 1 < starts.length ? owned[k + 1] : lines.length).join('\n'))
}

export function parseWorkflowFeature(source: string): ParsedWorkflow {
  const chunks = splitFeatures(source)
  if (chunks.length === 0) throw new Error('No Feature blocks found in workflow spec')
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher())
  const features: ParsedFeature[] = []
  const scenarios: ParsedScenario[] = []
  for (const chunk of chunks) {
    const doc = parser.parse(chunk) // parse errors propagate — the meta-suite fails loudly
    const feature = doc.feature
    if (!feature) throw new Error('Chunk parsed without a feature')
    const featureTags = feature.tags.map((t) => t.name)
    features.push({ name: feature.name, tags: featureTags })
    for (const child of feature.children) {
      const sc = child.scenario
      if (!sc) continue
      scenarios.push({
        featureName: feature.name,
        featureTags,
        name: sc.name,
        tags: sc.tags.map((t) => t.name),
        isOutline: sc.examples.length > 0,
        steps: sc.steps.map((s) => `${s.keyword}${s.text}`),
        examples: sc.examples.map((ex) => ({
          tags: ex.tags.map((t) => t.name),
          header: ex.tableHeader?.cells.map((c) => c.value) ?? [],
          rows: (ex.tableBody ?? []).map((r) => r.cells.map((c) => c.value)),
        })),
      })
    }
  }
  return { features, scenarios }
}
```
- [ ] Step 5: Run tests, expect PASS: `npx vitest run __tests__/spec/parse-workflow-feature.test.ts`
- [ ] Step 6: Commit: `git add -A && git commit -m "feat(spec): vendor workflow spec + multi-feature gherkin parser (F1.1)"`

### Task F1.2: spec() registration helper, static registry scanner, operations map
**Files:**
- Create: lib/spec/registry.ts
- Create: lib/spec/operations-map.ts
- Test: __tests__/spec/registry.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/spec/registry.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spec, scanSpecRegistrations } from '@/lib/spec/registry'
import { toToolName, DROPPED_OPERATIONS } from '@/lib/spec/operations-map'

describe('spec()', () => {
  it('returns a stable [spec:...] marker for valid ids', () => {
    expect(spec('dnt/refused-consent-blocks-funnel')).toBe('[spec:dnt/refused-consent-blocks-funnel]')
    expect(spec('questionnaire/modify-answer-consequence#ex3')).toBe('[spec:questionnaire/modify-answer-consequence#ex3]')
  })
  it('rejects malformed ids', () => {
    expect(() => spec('NoSlash')).toThrow()
    expect(() => spec('upper/Case')).toThrow()
  })
})

describe('scanSpecRegistrations', () => {
  it('finds spec(...) string literals in *.test.ts files recursively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specscan-'))
    fs.mkdirSync(path.join(dir, 'nested'))
    fs.writeFileSync(path.join(dir, 'nested', 'a.test.ts'),
      `it(spec('quote/expired-quote-cannot-be-accepted') + ' x', () => {})\nit(spec("dnt/signing-after-needs-analysis"), () => {})\n`)
    fs.writeFileSync(path.join(dir, 'ignored.ts'), `spec('not/counted')`)
    const reg = scanSpecRegistrations(dir)
    expect([...reg.keys()].sort()).toEqual(['dnt/signing-after-needs-analysis', 'quote/expired-quote-cannot-be-accepted'])
  })
})

describe('operations map (T12 risk mitigation: renames are one line)', () => {
  it('maps retired catalog names to the pinned 6-tool DNT surface (#7) and M2 reads', () => {
    expect(toToolName('start_dnt_session')).toBe('open_dnt_session')
    expect(toToolName('update_dnt')).toBe('open_dnt_session')
    expect(toToolName('modify_dnt_answer')).toBe('write_dnt_answer')
    expect(toToolName('get_dnt_session_details')).toBe('get_dnt_state')
    expect(toToolName('get_customer_info')).toBe('get_customer_profile')
  })
  it('declares the two dropped list reads (M2 spec amendment)', () => {
    expect(DROPPED_OPERATIONS).toEqual(['get_application_list', 'get_quote_list'])
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/spec/registry.test.ts` — module not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/spec/registry.ts
import fs from 'node:fs'
import path from 'node:path'

/** <feature-key>/<kebab-slug> with optional Examples row suffix #exN (1-based). */
export const SPEC_ID_RE = /^[a-z0-9_]+\/[a-z0-9][a-z0-9-]*(#ex[1-9][0-9]*)?$/

export function spec(id: string): string {
  if (!SPEC_ID_RE.test(id)) throw new Error(`Invalid spec id: ${id}`)
  return `[spec:${id}]`
}

const CALL_RE = /\bspec\(\s*['"]([^'"]+)['"]/g

/** Static scan — vitest runs files in isolated workers, so a runtime registry
 * cannot aggregate; the literal spec('...') call sites ARE the registry. */
export function scanSpecRegistrations(rootDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of fs.readdirSync(rootDir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.test.ts')) continue
    const parent = (e as unknown as { parentPath?: string; path: string }).parentPath ?? (e as unknown as { path: string }).path
    const src = fs.readFileSync(path.join(parent, e.name), 'utf8')
    for (const m of src.matchAll(CALL_RE)) {
      if (!out.has(m[1])) out.set(m[1], [])
      out.get(m[1])!.push(path.join(parent, e.name))
    }
  }
  return out
}
```
```ts
// lib/spec/operations-map.ts
/** Scenario-facing operation name -> implemented tool name (T12 Risks §1).
 * The .feature and catalog keep speaking operation names; a tool rename is a
 * one-line change here instead of suite-wide churn. */
export const OPERATIONS_MAP = {
  get_customer_info: 'get_customer_profile', // M2
  get_open_items: 'get_open_items',
  identify_customer: 'identify_customer',
  withdraw_consent: 'withdraw_consent',
  escalate_to_human: 'escalate_to_human',
  list_products: 'list_products',
  get_product_info: 'get_product_info',
  get_product_addon_info: 'get_product_addon_info',
  set_candidate_product: 'set_candidate_product',
  set_application: 'set_application',
  select_coverage: 'select_coverage',
  // DNT — contradiction #7 pinned 6-tool surface
  get_dnt_state: 'get_dnt_state',
  get_dnt_questions: 'get_dnt_questions',
  get_dnt_next_question: 'get_dnt_next_question',
  start_dnt_session: 'open_dnt_session',
  update_dnt: 'open_dnt_session',
  get_dnt_session_details: 'get_dnt_state',
  write_dnt_answer: 'write_dnt_answer',
  modify_dnt_answer: 'write_dnt_answer',
  sign_dnt: 'sign_dnt',
  // questionnaire / quote / payment / policy
  get_next_question: 'get_next_question',
  write_question_answer: 'write_question_answer',
  modify_answer: 'modify_answer',
  resume_application: 'resume_application',
  get_last_application_info: 'get_last_application_info',
  cancel_application: 'cancel_application',
  generate_quote: 'generate_quote',
  get_quote_info: 'get_quote_info',
  acknowledge_disclosures: 'acknowledge_disclosures',
  accept_quote: 'accept_quote',
  cancel_quote: 'cancel_quote',
  get_payment_status: 'get_payment_status',
  resume_payment: 'resume_payment',
  retry_payment: 'retry_payment',
  change_payment_option: 'change_payment_option',
  get_policy_status: 'get_policy_status',
  get_policy_documents: 'get_policy_documents',
  request_cancellation: 'request_cancellation',
} as const
export type SpecOperation = keyof typeof OPERATIONS_MAP
export function toToolName(op: SpecOperation): string { return OPERATIONS_MAP[op] }
/** Dropped per M2 spec amendment; F3 removes their catalog rows. */
export const DROPPED_OPERATIONS = ['get_application_list', 'get_quote_list'] as const
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec/registry.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(spec): spec() registry helper + static scanner + operations map (F1.2)"`

### Task F1.3: Classify and tag the .feature — @id, primary class, initial @backlog (committed as data)
**Files:**
- Modify: docs/tools as wokflow scenarios/zeno_workflow.feature (add tags to all 61 scenarios)
- Test: __tests__/spec/spec-tags.meta.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/spec/spec-tags.meta.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { SPEC_ID_RE } from '@/lib/spec/registry'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const CLASS_TAGS = ['@engine', '@agent', '@agent-judge']

describe('spec tagging (T12.D2 — per-scenario classification committed as data)', () => {
  it('every scenario carries exactly one valid, unique @id: tag', () => {
    const ids: string[] = []
    for (const s of parsed.scenarios) {
      const idTags = s.tags.filter((t) => t.startsWith('@id:'))
      expect(idTags, `"${s.name}" needs exactly one @id:`).toHaveLength(1)
      const id = idTags[0].slice(4)
      expect(id, `bad id on "${s.name}"`).toMatch(SPEC_ID_RE)
      ids.push(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every scenario carries exactly one primary class tag', () => {
    for (const s of parsed.scenarios) {
      expect(s.tags.filter((t) => CLASS_TAGS.includes(t)), `"${s.name}" class`).toHaveLength(1)
    }
  })
  it('@agent-judge scenarios are never simultaneously @backlog', () => {
    for (const s of parsed.scenarios.filter((x) => x.tags.includes('@agent-judge'))) {
      expect(s.tags, s.name).not.toContain('@backlog')
    }
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/spec/spec-tags.meta.test.ts` — every scenario lacks @id:.
- [ ] Step 3: Tag the .feature (data edit, the implementation of this task). Conventions: id = `<feature-key>/<kebab-slug>` with feature keys contract, discovery, dnt, questionnaire, quote_generation, quote, payment, policy, lifecycle (e.g. `@id:quote/expired-quote-cannot-be-accepted`, `@id:questionnaire/modify-answer-consequence`, `@id:quote_generation/generation-can-reject-or-refer`). Primary class per the T12.D2 rationale's per-feature verdicts: engine-primary for legality/consequence/DB-substance scenarios; @agent for deterministically-assertable trace/transcript scenarios (narration, tool sequences, price leaks, deadlock); @agent-judge ONLY for the irreducibly-linguistic set, exactly: `discovery/out-of-scope-declined-politely`, `discovery/consultative-pushback-without-pressure`, `dnt/refusal-explained-and-stopped` (the agent clause of refused consent — its engine clause stays a separate @engine scenario per the primary+secondary rule), `questionnaire/branching-provenance-explained`, `quote/post-quote-change-explained`, `policy/relay-without-promising`. Every scenario whose translation has not landed yet ALSO gets @backlog (truthful initial state; F1.6–F1.9 remove them as translations land; the count is REPORTED, never failed). Outline rows that need substrate other blocks did not ship go into a separate `@backlog Examples:` block (Gherkin tags attach to Examples blocks, not rows).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec/spec-tags.meta.test.ts __tests__/spec/parse-workflow-feature.test.ts` (the parse smoke still sees 61 scenarios — tags do not change counts).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(spec): classify all 61 scenarios with @id/@engine/@agent/@agent-judge/@backlog tags (F1.3)"`

### Task F1.4: Bidirectional traceability meta-test + coverage report artifact
**Files:**
- Test: __tests__/spec/traceability.meta.test.ts
- Create: artifacts/.gitignore (ignore generated reports)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the meta-test (it IS the deliverable; it must pass immediately because F1.3 tagged everything untranslated as @backlog — from here on, removing a @backlog tag without a registered test is a CI failure):
```ts
// __tests__/spec/traceability.meta.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature, type ParsedScenario } from '@/lib/spec/parse-workflow-feature'
import { scanSpecRegistrations } from '@/lib/spec/registry'

const ROOT = process.cwd()
const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(ROOT, 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const registrations = scanSpecRegistrations(path.join(ROOT, '__tests__'))
const idOf = (s: ParsedScenario) => s.tags.find((t) => t.startsWith('@id:'))!.slice(4)
const isBacklog = (s: ParsedScenario) => s.tags.includes('@backlog')
const isJudge = (s: ParsedScenario) => s.tags.includes('@agent-judge')

describe('spec<->test bidirectional traceability (T12.D5)', () => {
  it('every non-backlog, non-judge scenario maps to >=1 registered test', () => {
    const unmapped = parsed.scenarios.filter((s) => !isBacklog(s) && !isJudge(s))
      .map(idOf).filter((id) => !registrations.has(id))
    expect(unmapped, `untranslated scenarios:\n${unmapped.join('\n')}`).toEqual([])
  })
  it('every live Examples block of a mapped outline is covered (bare id = test.each over AST rows)', () => {
    for (const s of parsed.scenarios.filter((x) => x.isOutline && !isBacklog(x) && !isJudge(x))) {
      const id = idOf(s)
      const liveRows = s.examples.filter((e) => !e.tags.includes('@backlog')).reduce((n, e) => n + e.rows.length, 0)
      const rowRegs = [...registrations.keys()].filter((k) => k.startsWith(`${id}#ex`)).length
      expect(registrations.has(id) || rowRegs >= liveRows,
        `outline ${id}: ${liveRows} live rows, bare=${registrations.has(id)}, rowRegs=${rowRegs}`).toBe(true)
    }
  })
  it('no orphan registrations — every registered id exists in the .feature', () => {
    const known = new Set(parsed.scenarios.map(idOf))
    const orphans = [...registrations.keys()].map((id) => id.replace(/#ex\d+$/, '')).filter((id) => !known.has(id))
    expect(orphans, `tests claiming dead scenarios:\n${orphans.join('\n')}`).toEqual([])
  })
  it('REPORTS coverage and writes artifacts/spec-coverage.json (backlog counted, not failed)', () => {
    const byClass = { engine: 0, agent: 0, judge: 0 }
    for (const s of parsed.scenarios) {
      if (s.tags.includes('@engine')) byClass.engine++
      else if (s.tags.includes('@agent-judge')) byClass.judge++
      else byClass.agent++
    }
    const backlogIds = parsed.scenarios.filter(isBacklog).map(idOf)
    const report = {
      generatedAt: new Date().toISOString(),
      scenarios: parsed.scenarios.length,
      cases: parsed.scenarios.reduce((n, s) => n + Math.max(1, s.examples.reduce((m, e) => m + e.rows.length, 0)), 0),
      byClass,
      covered: parsed.scenarios.filter((s) => registrations.has(idOf(s))).length,
      backlog: { count: backlogIds.length, ids: backlogIds },
      judge: { count: parsed.scenarios.filter(isJudge).length, ids: parsed.scenarios.filter(isJudge).map(idOf) },
    }
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'artifacts/spec-coverage.json'), JSON.stringify(report, null, 2))
    console.log(`[spec-coverage] scenarios=${report.scenarios} covered=${report.covered} backlog=${report.backlog.count} judge=${report.judge.count}`)
    expect(report.scenarios).toBe(61)
  })
})
```
- [ ] Step 2: Create `artifacts/.gitignore` containing `*\n!.gitignore` so generated reports never pollute commits.
- [ ] Step 3: Run it, expect PASS with a large reported backlog count: `npx vitest run __tests__/spec/traceability.meta.test.ts`. Then prove the enforcement bites: temporarily remove one @backlog tag, re-run, expect the first assertion to FAIL naming that id; restore the tag.
- [ ] Step 4: Run the whole spec meta-suite: `npx vitest run __tests__/spec` — green.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(spec): bidirectional gherkin-AST traceability meta-test + coverage report (F1.4)"`

### Task F1.5: Taxonomy closure + judge-rubric registry
**Files:**
- Create: lib/spec/taxonomy.ts
- Create: lib/testing/judge/rubrics.ts
- Test: __tests__/spec/taxonomy-closure.meta.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/spec/taxonomy-closure.meta.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { TAXONOMY, PENDING_SPEC_AMENDMENTS } from '@/lib/spec/taxonomy'
import { JUDGE_RUBRICS } from '@/lib/testing/judge/rubrics'

const src = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8')
const parsed = parseWorkflowFeature(src)
const CONSEQUENCE_COLUMNS = ['consequence', 'consequences', 'outcome', 'effects', 'result']

describe('taxonomy closure (T12.D5 §3 — spec, catalog and code welded at CI time)', () => {
  it('every token in a consequence-typed Examples column is a CommitOutcome or CommitEffect', () => {
    const offenders: string[] = []
    for (const s of parsed.scenarios) for (const ex of s.examples) {
      ex.header.forEach((h, col) => {
        if (!CONSEQUENCE_COLUMNS.includes(h.trim().toLowerCase())) return
        for (const row of ex.rows) for (const tok of row[col].split(/[^a-z_]+/).filter((t) => t.length > 2)) {
          if (!(TAXONOMY as readonly string[]).includes(tok)) offenders.push(`${s.name}: ${tok}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
  it('every union member appears in the .feature, modulo the explicit pending-amendment list (emptied by F3)', () => {
    const missing = (TAXONOMY as readonly string[]).filter(
      (m) => !new RegExp(`\\b${m}\\b`).test(src) && !PENDING_SPEC_AMENDMENTS.includes(m))
    expect(missing, `union members the spec never mentions: ${missing.join(', ')}`).toEqual([])
  })
})

describe('@agent-judge <-> rubric closure', () => {
  it('judge scenarios and rubrics are 1:1', () => {
    const judgeIds = parsed.scenarios.filter((s) => s.tags.includes('@agent-judge'))
      .map((s) => s.tags.find((t) => t.startsWith('@id:'))!.slice(4))
    expect([...judgeIds].sort()).toEqual(JUDGE_RUBRICS.map((r) => r.specId).sort())
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/spec/taxonomy-closure.meta.test.ts` — modules not found.
- [ ] Step 3: Minimal implementation:
```ts
// lib/spec/taxonomy.ts
import type { CommitOutcome, CommitEffect } from '@/lib/engines/commit-contract' // Block A artifact

export const COMMIT_OUTCOMES = [
  'applied', 'rejected', 'referred', 'pending', 'unavailable',
  'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures',
] as const satisfies readonly CommitOutcome[]

export const COMMIT_EFFECTS = [
  'advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand',
  'questions_removed', 'eligibility_recheck', 'terminal',
] as const satisfies readonly CommitEffect[]

// Compile-time exhaustiveness: a union member missing from the arrays is a type error.
type AssertNever<T extends never> = T
export type _OutcomesExhaustive = AssertNever<Exclude<CommitOutcome, (typeof COMMIT_OUTCOMES)[number]>>
export type _EffectsExhaustive = AssertNever<Exclude<CommitEffect, (typeof COMMIT_EFFECTS)[number]>>

export const TAXONOMY = [...COMMIT_OUTCOMES, ...COMMIT_EFFECTS] as const

/** Union members the .feature does not mention YET — they enter the spec with
 * the F3 fold-back (M10: taxonomy += unavailable/pending). F3 empties this. */
export const PENDING_SPEC_AMENDMENTS: readonly string[] = ['unavailable', 'pending']
```
```ts
// lib/testing/judge/rubrics.ts
export interface JudgeRubric { id: string; specId: string; question: string; passCriteria: string }
/** One rubric per @agent-judge scenario — the closure meta-test enforces 1:1. Non-gating (T12.D4). */
export const JUDGE_RUBRICS: JudgeRubric[] = [
  { id: 'judge/out-of-scope-decline', specId: 'discovery/out-of-scope-declined-politely',
    question: 'Did the agent decline the out-of-scope topic politely and redirect to insurance topics?',
    passCriteria: 'A clear decline, polite tone, no lecturing, an explicit redirect offer.' },
  { id: 'judge/pushback-once', specId: 'discovery/consultative-pushback-without-pressure',
    question: 'After customer pushback, did the agent explain the benefit at most once and then respect the decision?',
    passCriteria: 'Exactly one benefit explanation; no repeated pressure; decision respected in the same turn.' },
  { id: 'judge/refusal-explained', specId: 'dnt/refusal-explained-and-stopped',
    question: 'When consent was refused, did the agent explain the consequence and stop, without re-asking?',
    passCriteria: 'One factual explanation of what is blocked; no renewed consent request; session preservation mentioned or implied.' },
  { id: 'judge/branching-provenance', specId: 'questionnaire/branching-provenance-explained',
    question: 'Did the agent explain that the new question follows from the earlier answer, clearly and briefly?',
    passCriteria: 'Names the triggering answer or its topic; one sentence; no invented medical reasoning.' },
  { id: 'judge/post-quote-change', specId: 'quote/post-quote-change-explained',
    question: 'Did the agent explain cancel-and-re-apply (pre-filled) correctly and get agreement before acting?',
    passCriteria: 'Explains immutability, the new-application path, pre-fill, and asks for agreement first.' },
  { id: 'judge/relay-without-promising', specId: 'policy/relay-without-promising',
    question: 'Did the agent relay the engine cancellation outcome without promising anything the engine did not return?',
    passCriteria: 'Outcome relayed verbatim in meaning; no invented refunds, timelines, or approvals.' },
]
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec/taxonomy-closure.meta.test.ts`. Note this test currently passes direction (b) because all legacy 14 taxonomy strings are members of the new outcome∪effect union; direction (a) passes via PENDING_SPEC_AMENDMENTS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(spec): taxonomy closure meta-test + judge rubric registry (F1.5)"`

### Task F1.6: Translate the engine-deterministic legality/consequence scenarios (pure core, snapshot literals)
**Files:**
- Create: __tests__/spec/helpers/spec-snapshots.ts
- Test: __tests__/spec/engine/quote-legality.spec.test.ts
- Test: __tests__/spec/engine/dnt-legality.spec.test.ts
- Test: __tests__/spec/engine/modify-answer-consequences.spec.test.ts
- Test: __tests__/spec/engine/generate-quote-outcomes.spec.test.ts
- Modify: docs/tools as wokflow scenarios/zeno_workflow.feature (remove @backlog from every id translated here)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Create the snapshot literal helper (NO mocked prisma — T12.D3 binding). DomainSnapshot is Block A's type; this helper builds full literals:
```ts
// __tests__/spec/helpers/spec-snapshots.ts
import type { DomainSnapshot } from '@/lib/engines/derive-and-expose' // Block A artifact

export function makeSnapshot(overrides: Partial<DomainSnapshot> = {}): DomainSnapshot {
  const base = {
    now: new Date('2026-07-01T10:00:00Z'),
    customer: { id: 'cust_1', identityTier: 'declared', age: 35,
      fields: { name: { state: 'declared' }, cnp: { state: 'declared' }, email: { state: 'declared' } } },
    consents: { gdpr_processing: 'granted', ai_disclosure: 'granted', marketing: 'withdrawn' },
    candidateProductId: 'protect',
    dnt: { valid: true, validUntil: new Date('2027-06-01T00:00:00Z'), productTypesCovered: ['LIFE'], activeSession: null },
    application: { id: 'app_1', status: 'IN_PROGRESS', productId: 'protect',
      selection: { tier: 'standard', level: 2, addon: false },
      questionnaire: { complete: true, openQuestionCode: null } },
    quote: null, schedule: null, policy: null,
    eligibility: { verdict: 'eligible', failedRules: [], missingFacts: [] },
    suitability: { verdict: 'suitable', mismatches: [] },
    circuitBreakers: {},
  } as unknown as DomainSnapshot
  return { ...base, ...overrides }
}
export const ISSUED_QUOTE = { id: 'q1', status: 'ISSUED', validUntil: new Date('2027-01-01T00:00:00Z'), disclosuresAcknowledged: true, premium: 120 }
```
(If Block A's final DomainSnapshot field names differ, adjust THIS literal only — assertions stay.)
- [ ] Step 2: Write the failing tests. Quote legality (representative — same pattern for every @engine legality scenario in @quote, @dnt, @payment, @policy, @contract exposure scenarios):
```ts
// __tests__/spec/engine/quote-legality.spec.test.ts
import { describe, it, expect } from 'vitest'
import { spec } from '@/lib/spec/registry'
import { toToolName } from '@/lib/spec/operations-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot, ISSUED_QUOTE } from '../helpers/spec-snapshots'

describe('Feature: Quote review and acceptance', () => {
  // "Then accept_quote returns rejected with reason quote_expired"
  it(spec('quote/expired-quote-cannot-be-accepted') + ' accept_quote blocked: quote_expired', () => {
    const { state, actions } = deriveAndExpose(makeSnapshot({
      quote: { ...ISSUED_QUOTE, validUntil: new Date('2026-06-30T00:00:00Z') },
    } as never))
    expect(state.phase).toBe('QUOTE')
    const accept = toToolName('accept_quote')
    expect(actions.available).not.toContain(accept)
    expect(actions.blocked.find((b) => b.action === accept)?.reason).toBe('quote_expired')
  })
  // "Then accept_quote is blocked with reason requires_disclosures ... then becomes available"
  it(spec('quote/disclosures-precede-acceptance') + ' requires_disclosures gate', () => {
    const accept = toToolName('accept_quote')
    const before = deriveAndExpose(makeSnapshot({ quote: { ...ISSUED_QUOTE, disclosuresAcknowledged: false } } as never))
    expect(before.actions.blocked.find((b) => b.action === accept)?.reason).toBe('requires_disclosures')
    const after = deriveAndExpose(makeSnapshot({ quote: ISSUED_QUOTE } as never))
    expect(after.actions.available).toContain(accept)
  })
})
```
The modify_answer Examples table imported from the AST (Examples-first workflow — a new row fails until the planner handles it):
```ts
// __tests__/spec/engine/modify-answer-consequences.spec.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { planModifyAnswer } from '@/lib/engines/consequence-planner' // Block C pure planner
import { makeSnapshot } from '../helpers/spec-snapshots'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const outline = parsed.scenarios.find((s) => s.tags.includes('@id:questionnaire/modify-answer-consequence'))!
const rows = outline.examples.filter((e) => !e.tags.includes('@backlog')).flatMap((e) => e.rows)

// question kind in the Examples table -> a concrete seeded question code per kind
const QUESTION_FOR: Record<string, string> = {
  'a neutral field': 'occupation', 'a branching field': 'smoker',
  'a gating field': 'bd_addon_interest', 'a dependency': 'income_source', 'a sensitive one': 'cnp',
}
describe(spec('questionnaire/modify-answer-consequence'), () => {
  it.each(rows)('row %#: %s -> %s', (questionKind, consequence) => {
    const code = QUESTION_FOR[questionKind]
    expect(code, `no question mapping for Examples kind "${questionKind}" — extend QUESTION_FOR`).toBeDefined()
    const plan = planModifyAnswer(makeSnapshot(), { questionCode: code, newAnswer: 'changed' })
    expect([plan.outcome, ...plan.effects]).toContain(consequence)
  })
})
```
The generate_quote outcome table (rows verified in the .feature lines 324-329: rejected|ineligible_age, rejected|compliance_block, referred|manual_underwriting, rejected|pending_external_check — the last row becomes pending in F3 per M10; this test reads outcome straight from the AST so the F3 row edit flips the expectation automatically):
```ts
// __tests__/spec/engine/generate-quote-outcomes.spec.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { planGenerateQuote } from '@/lib/engines/quote-lifecycle' // Block C/D pure gate
import { makeSnapshot } from '../helpers/spec-snapshots'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const outline = parsed.scenarios.find((s) => s.tags.includes('@id:quote_generation/generation-can-reject-or-refer'))!
const rows = outline.examples.filter((e) => !e.tags.includes('@backlog')).flatMap((e) => e.rows)

const SNAPSHOT_FOR: Record<string, () => ReturnType<typeof makeSnapshot>> = {
  ineligible_age: () => makeSnapshot({ eligibility: { verdict: 'ineligible', failedRules: [{ rule: 'age_max', reason: 'ineligible_age' }], missingFacts: [] } } as never),
  compliance_block: () => makeSnapshot({ suitability: { verdict: 'unsuitable', mismatches: [{ rule: 'demands_needs', reason: 'compliance_block' }] } } as never),
  manual_underwriting: () => makeSnapshot({ application: { id: 'app_1', status: 'IN_PROGRESS', productId: 'protect', selection: { tier: 'standard', level: 2, addon: true }, questionnaire: { complete: true, openQuestionCode: null }, flags: ['bd_referral'] } } as never),
  pending_external_check: () => makeSnapshot({ application: { id: 'app_1', status: 'IN_PROGRESS', productId: 'protect', selection: { tier: 'standard', level: 2, addon: false }, questionnaire: { complete: true, openQuestionCode: null }, pendingExternalCheck: true } as never),
}
describe(spec('quote_generation/generation-can-reject-or-refer'), () => {
  it.each(rows)('row %#: -> %s / %s', (outcome, reason) => {
    const make = SNAPSHOT_FOR[reason]
    expect(make, `no snapshot for reason "${reason}" — extend SNAPSHOT_FOR`).toBeDefined()
    const result = planGenerateQuote(make())
    expect(result.outcome).toBe(outcome)
    expect(result.reason).toBe(reason)
  })
})
```
Also write __tests__/spec/engine/dnt-legality.spec.test.ts the same way for the @engine DNT scenarios (pinned #12 predicates): `dnt/valid-dnt-skips-to-questionnaire` (valid covering DNT ⇒ subphase QUESTIONNAIRE, open_dnt_session NOT exposed), `dnt/no-valid-dnt-starts-session` (open app + no valid DNT ⇒ subphase DNT, open_dnt_session available), `dnt/second-active-session-refused` (activeSession present ⇒ open_dnt_session blocked reason session_already_active), `dnt/expiring-dnt-renewal-without-application` (no application + dnt.validUntil within window ⇒ open_dnt_session available — contradiction #12(b)), `dnt/withdrawn-consent-halts-processing` (consents.gdpr_processing='withdrawn' ⇒ every commit blocked with reason consent_withdrawn).
- [ ] Step 3: Run them, expect FAIL (engines reject the unimplemented expectations or scenarios are still tagged): `npx vitest run __tests__/spec/engine` — failures must be assertion failures against real Block A/C exports, not import errors; if an import fails, STOP and reconcile the Block A/C export name first.
- [ ] Step 4: Make them pass: these tests assert behavior Blocks A/C already shipped — fix the SNAPSHOT_FOR/QUESTION_FOR literals to the seeded data until green, never weaken assertions. Then remove @backlog from every id translated here in the .feature.
- [ ] Step 5: Run tests, expect PASS including traceability: `npx vitest run __tests__/spec`
- [ ] Step 6: Commit: `git add -A && git commit -m "test(spec): translate engine-deterministic scenarios to pure-core vitest (F1.6)"`

### Task F1.7: Translate the commit-ring scenarios (real test DB — idempotency, one-app-one-quote, cascade, concurrency)
**Files:**
- Test: __tests__/spec/commit-ring/idempotency.spec.test.ts
- Test: __tests__/spec/commit-ring/one-app-one-quote.spec.test.ts
- Test: __tests__/spec/commit-ring/cascade-invalidate.spec.test.ts
- Test: __tests__/spec/commit-ring/concurrency.spec.test.ts
- Modify: docs/tools as wokflow scenarios/zeno_workflow.feature (remove @backlog from translated ids)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests against the REAL test DB (truncate+seed via Block A's __tests__/helpers/test-db.ts; NO mocked prisma — T12.D3 binding). Representative file:
```ts
// __tests__/spec/commit-ring/idempotency.spec.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { spec } from '@/lib/spec/registry'
import { executeCommit } from '@/lib/engines/commit-gateway' // Block A gateway entrypoint
import { resetTestDb, seedFunnelToIssuedQuote } from '../../helpers/test-db' // Block A helper
import { prisma } from '@/lib/db'

const hasDb = !!process.env.TEST_DATABASE_URL

describe.skipIf(!hasDb)('Feature: agent is a client of the domain — commit ring', () => {
  beforeEach(async () => { await resetTestDb() })

  // "A committing action is idempotent on double-submit"
  it(spec('contract/idempotent-on-double-submit') + ' accept_quote twice = one effect, replay envelope', async () => {
    const { conversationId, quoteId, confirmToken } = await seedFunnelToIssuedQuote()
    const args = { quoteId, paymentOption: 'monthly', confirmToken }
    const first = await executeCommit({ actor: 'agent', tool: 'accept_quote', conversationId, args })
    const second = await executeCommit({ actor: 'agent', tool: 'accept_quote', conversationId, args })
    expect(first.outcome).toBe('applied')
    expect(second.outcome).toBe('applied') // ORIGINAL envelope returned (gateway order #8 step 2)
    const schedules = await prisma.paymentSchedule.findMany({ where: { quoteId } })
    expect(schedules).toHaveLength(1)
    const ledger = await prisma.commitLedger.findMany({ where: { tool: 'accept_quote', conversationId } })
    expect(ledger.map((r) => r.idempotencyDisposition).sort()).toEqual(['fresh', 'replay'])
  })

  it(spec('contract/conflicting-resubmit-rejected') + ' same target, different material args -> rejected(already_applied)', async () => {
    const { conversationId, quoteId, confirmToken } = await seedFunnelToIssuedQuote()
    await executeCommit({ actor: 'agent', tool: 'accept_quote', conversationId, args: { quoteId, paymentOption: 'monthly', confirmToken } })
    const conflict = await executeCommit({ actor: 'agent', tool: 'accept_quote', conversationId, args: { quoteId, paymentOption: 'annual', confirmToken } })
    expect(conflict.outcome).toBe('rejected')
    expect(conflict.reason).toBe('already_applied')
  })
})
```
Same pattern: one-app-one-quote (second generate_quote on the same application ⇒ replay of the original envelope, exactly one Quote row, DB unique constraint intact — `spec('lifecycle/one-application-one-quote')`); cascade-invalidate (modify a dependency answer ⇒ dependent Answer rows actually DELETED in Postgres, effect cascade_invalidate in the envelope and ledger row — `spec('questionnaire/modify-answer-consequence#ex4')` as the row-level registration); concurrency (`spec('contract/concurrent-gui-and-agent-consistent')`: `Promise.all` of an actor:'gui' and an actor:'agent' commit on the same conversation; per-conversation advisory lock (T2.D5) means exactly one 'fresh' ledger row, the loser gets the replay/rejected envelope, never two effects).
- [ ] Step 2: Run with the test DB, expect FAIL or PASS-as-shipped: `TEST_DATABASE_URL=postgres://... npx vitest run __tests__/spec/commit-ring` (PowerShell: `$env:TEST_DATABASE_URL='postgres://...'; npx vitest run __tests__/spec/commit-ring`). Any failure here is a REAL bug in the Block A gateway — fix there, never in the test.
- [ ] Step 3: Make green, then remove @backlog from the four translated ids in the .feature.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec` (commit-ring auto-skips without TEST_DATABASE_URL; CI sets it).
- [ ] Step 5: Commit: `git add -A && git commit -m "test(spec): commit-ring scenarios against real test DB (F1.7)"`

### Task F1.8: Shared conversation-assertion library over ConversationExport
**Files:**
- Create: lib/testing/conversation-assertions.ts
- Test: __tests__/lib/testing/conversation-assertions.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test with literal mini-exports:
```ts
// __tests__/lib/testing/conversation-assertions.test.ts
import { describe, it, expect } from 'vitest'
import {
  toolCallsByTurn, assertToolCalled, assertToolNeverCalled, assertToolOrder,
  phaseTimeline, assertNoPhaseRegression, assertNoNarrationViolations, assertNoPremiumBeforeQuote,
} from '@/lib/testing/conversation-assertions'
import type { ConversationExport } from '@/lib/debug/conversation-export'

function turn(i: number, over: Record<string, unknown> = {}) {
  return { traceId: `t${i}`, conversationId: 'c1', messageIndex: i, userMessage: 'u', language: 'ro',
    startedAt: 0, toolCalls: [], ...over } as never
}
function exp(turns: unknown[], messages: unknown[] = []): ConversationExport {
  return { exportedAt: 'x', conversationId: 'c1', conversation: {} as never,
    summary: { turns: turns.length, messages: messages.length, toolCalls: 0, toolsUsed: [] },
    messages: messages as never, turns: turns as never }
}
const call = (name: string) => ({ round: 0, toolCallId: name, name, args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } })

describe('conversation assertions', () => {
  it('tool sequence asserts', () => {
    const e = exp([turn(0, { toolCalls: [call('open_dnt_session')] }), turn(1, { toolCalls: [call('write_dnt_answer')] })])
    expect(toolCallsByTurn(e)).toEqual([['open_dnt_session'], ['write_dnt_answer']])
    expect(() => assertToolCalled(e, 'open_dnt_session')).not.toThrow()
    expect(() => assertToolNeverCalled(e, 'sign_dnt')).not.toThrow()
    expect(() => assertToolOrder(e, ['open_dnt_session', 'write_dnt_answer'])).not.toThrow()
    expect(() => assertToolOrder(e, ['write_dnt_answer', 'open_dnt_session'])).toThrow(/order/)
  })
  it('phase timeline + regression', () => {
    const e = exp([
      turn(0, { gate: { skipped: false, durationMs: 0, derivedState: { phase: 'DISCOVERY' } } }),
      turn(1, { gate: { skipped: false, durationMs: 0, derivedState: { phase: 'APPLICATION' } } }),
    ])
    expect(phaseTimeline(e)).toEqual(['DISCOVERY', 'APPLICATION'])
    expect(() => assertNoPhaseRegression(e)).not.toThrow()
  })
  it('narration-leak scan reads stored detector verdicts', () => {
    const bad = exp([turn(0, { toolNarration: { violations: [{ category: 'unchecked', matchedPhrase: 'am salvat' }] } })])
    expect(() => assertNoNarrationViolations(bad)).toThrow(/narration/)
  })
  it('premium-claim scan flags premium talk before any quote in state', () => {
    const e = exp(
      [turn(0, { gate: { skipped: false, durationMs: 0, derivedState: { phase: 'DISCOVERY', quote: null } } })],
      [{ id: 'm1', role: 'assistant', content: 'Prima ta lunară este 84 lei.', toolCalls: null, toolResults: null, createdAt: 'x' }])
    expect(() => assertNoPremiumBeforeQuote(e)).toThrow(/premium/)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/testing/conversation-assertions.test.ts`
- [ ] Step 3: Minimal implementation:
```ts
// lib/testing/conversation-assertions.ts
import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DebugTurn } from '@/lib/debug/reducer'

const PHASE_ORDER = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const

/** Single accessor for a turn's derived state — F2 repoints this to the
 * legality snapshot; every assert reads through it. */
export function turnState(t: DebugTurn): { phase?: string; quote?: unknown } | null {
  return ((t as { gate?: { derivedState?: unknown } }).gate?.derivedState ?? null) as never
}
export function toolCallsByTurn(e: ConversationExport): string[][] {
  return e.turns.map((t) => t.toolCalls.map((c) => c.name))
}
export function assertToolCalled(e: ConversationExport, tool: string): void {
  if (!toolCallsByTurn(e).flat().includes(tool)) throw new Error(`expected tool ${tool} to be called`)
}
export function assertToolNeverCalled(e: ConversationExport, tool: string): void {
  if (toolCallsByTurn(e).flat().includes(tool)) throw new Error(`tool ${tool} must never be called`)
}
export function assertToolOrder(e: ConversationExport, sequence: string[]): void {
  const flat = toolCallsByTurn(e).flat()
  let i = 0
  for (const name of flat) if (name === sequence[i]) i++
  if (i < sequence.length) throw new Error(`tool order violated: missing ${sequence[i]} (subsequence ${sequence.join(' -> ')})`)
}
export function phaseTimeline(e: ConversationExport): string[] {
  return e.turns.map((t) => turnState(t)?.phase).filter((p): p is string => !!p)
}
export function assertNoPhaseRegression(e: ConversationExport, allow: string[] = []): void {
  const tl = phaseTimeline(e)
  for (let i = 1; i < tl.length; i++) {
    if (PHASE_ORDER.indexOf(tl[i] as never) < PHASE_ORDER.indexOf(tl[i - 1] as never) && !allow.includes(tl[i])) {
      throw new Error(`phase regression ${tl[i - 1]} -> ${tl[i]} at turn ${i}`)
    }
  }
}
export function assertNoNarrationViolations(e: ConversationExport): void {
  for (const t of e.turns) {
    const v = (t.toolNarration as { violations?: unknown[] } | undefined)?.violations ?? []
    if (v.length > 0) throw new Error(`narration violations at messageIndex ${t.messageIndex}: ${JSON.stringify(v)}`)
  }
}
const PREMIUM_RE = /\b(prim[aă]|premium|rat[aă] lunar[aă])\b[^.]{0,40}?\d/i
export function assertNoPremiumBeforeQuote(e: ConversationExport): void {
  const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
  let quoteSeen = false
  let turnIdx = -1
  for (const m of e.messages) {
    if (m.role === 'user') turnIdx++
    const st = turnByIndex.get(turnIdx) ? turnState(turnByIndex.get(turnIdx)!) : null
    if (st && (st as { quote?: unknown }).quote) quoteSeen = true
    if (m.role === 'assistant' && !quoteSeen && PREMIUM_RE.test(m.content)) {
      throw new Error(`premium claim before quote: "${m.content.slice(0, 80)}"`)
    }
  }
}
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/testing/conversation-assertions.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(testing): shared conversation-assertion library over ConversationExport (F1.8)"`

### Task F1.9: Scripted live-sim generator (n-of-m), recorded fixtures, recorded-behavior spec tests, judge runner
**Files:**
- Create: lib/debug/load-export.ts (extract the export assembly from app/api/conversations/[id]/export/route.ts so scripts and the route share one loader)
- Modify: app/api/conversations/[id]/export/route.ts (delegate to loadConversationExport)
- Create: scripts/sims/spec-scenarios.ts
- Create: scripts/sims/run-spec-sims.ts
- Create: scripts/sims/run-judge.ts
- Create: __tests__/fixtures/exports/happy-path.export.json + dnt-refusal.export.json (recorded)
- Test: __tests__/spec/agent/recorded-behavior.spec.test.ts
- Modify: package.json (scripts += "sims:spec", "sims:judge")
- Modify: docs/tools as wokflow scenarios/zeno_workflow.feature (remove @backlog from agent-deterministic ids covered here)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing recorded-behavior test (fixtures do not exist yet):
```ts
// __tests__/spec/agent/recorded-behavior.spec.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { toToolName } from '@/lib/spec/operations-map'
import type { ConversationExport } from '@/lib/debug/conversation-export'
import {
  assertToolOrder, assertToolNeverCalled, assertNoNarrationViolations,
  assertNoPhaseRegression, assertNoPremiumBeforeQuote, toolCallsByTurn,
} from '@/lib/testing/conversation-assertions'

const load = (name: string): ConversationExport => JSON.parse(
  fs.readFileSync(path.join(process.cwd(), '__tests__/fixtures/exports', name), 'utf8'))

describe('agent behavior over recorded sims (T12.D4 — assertion substrate is the export)', () => {
  const happy = load('happy-path.export.json')
  it(spec('contract/failed-commit-never-narrated-as-success') + ' no narration violations on the happy path', () => {
    expect(() => assertNoNarrationViolations(happy)).not.toThrow()
  })
  it(spec('contract/never-advances-phase-by-narration') + ' phases only move forward and only via commits', () => {
    expect(() => assertNoPhaseRegression(happy)).not.toThrow()
  })
  it(spec('discovery/example-prices-only-from-product-data') + ' no premium claims before an issued quote', () => {
    expect(() => assertNoPremiumBeforeQuote(happy)).not.toThrow()
  })
  it(spec('dnt/walking-questions-one-at-a-time') + ' DNT tool order open -> write -> sign', () => {
    expect(() => assertToolOrder(happy, [toToolName('start_dnt_session'), toToolName('write_dnt_answer'), toToolName('sign_dnt')])).not.toThrow()
  })
  it(spec('payment/agent-never-handles-card-data') + ' no tool call carries card fields', () => {
    for (const t of happy.turns) for (const c of t.toolCalls) {
      expect(JSON.stringify(c.args)).not.toMatch(/card_number|cvv|pan\b/i)
    }
  })
  const refusal = load('dnt-refusal.export.json')
  it(spec('dnt/refused-consent-blocks-funnel') + ' after refusal no funnel commit is attempted', () => {
    const after = toolCallsByTurn(refusal).flat()
    expect(() => assertToolNeverCalled(refusal, toToolName('generate_quote'))).not.toThrow()
    expect(after.filter((n) => n === toToolName('sign_dnt')).length).toBeLessThanOrEqual(1)
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/spec/agent/recorded-behavior.spec.test.ts` — fixture files missing.
- [ ] Step 3: Implement the loader + generator. Loader extracts the existing route body (conversation select + turnDebug rows + messages -> buildConversationExport) into `lib/debug/load-export.ts` exporting `loadConversationExport(conversationId: string): Promise<ConversationExport | null>`; the route becomes a thin wrapper. Generator (verify-advance-flow.ts pattern — drives lib/chat/orchestrator.handleChatTurn directly, live LLM, real dev DB, question-aware regex answer picking):
```ts
// scripts/sims/spec-scenarios.ts
export interface SpecSimScenario {
  key: string
  opening: string[]                        // fixed opening script to convergence
  answerPolicy: 'valid' | 'refuse-consent' // pickAnswer strategy after convergence
  maxTurns: number
  asserts: string[]                        // names of assertion-fn checks run on the export
}
export const SPEC_SIM_SCENARIOS: SpecSimScenario[] = [
  { key: 'happy-path', opening: ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea'], answerPolicy: 'valid', maxTurns: 40,
    asserts: ['noNarrationViolations', 'noPhaseRegression', 'noPremiumBeforeQuote', 'dntOrder'] },
  { key: 'dnt-refusal', opening: ['buna', 'vreau o asigurare de viata', 'da'], answerPolicy: 'refuse-consent', maxTurns: 20,
    asserts: ['noNarrationViolations', 'noFunnelAfterRefusal'] },
  { key: 'quote-decline', opening: ['buna', 'vreau o asigurare de viata', 'da'], answerPolicy: 'valid', maxTurns: 40,
    asserts: ['noNarrationViolations', 'noPhaseRegression'] },
]
```
```ts
// scripts/sims/run-spec-sims.ts (skeleton of the real implementation)
// Usage: npx tsx scripts/sims/run-spec-sims.ts [trials=3] [passThreshold=2] [--record]
// Per scenario: run N trials; each trial creates a fresh customer+conversation,
// drives handleChatTurn with the opening script then pickAnswer (regex over the
// last assistant question — same picker as scripts/verify-advance-flow.ts),
// drains the SSE stream, then loads the ConversationExport via
// loadConversationExport(conversationId) and runs the scenario's asserts from
// lib/testing/conversation-assertions. Trial PASS = all asserts green.
// Scenario PASS = passes >= passThreshold of trials (n-of-m, T12.D4).
// Every export is written to artifacts/sims/<key>-<trial>.json; with --record
// the first PASSING export is copied to __tests__/fixtures/exports/<key>.export.json.
// Exit code 1 if any scenario fails its n-of-m.
```
Add npm scripts: `"sims:spec": "tsx scripts/sims/run-spec-sims.ts"`, `"sims:judge": "tsx scripts/sims/run-judge.ts"`. run-judge.ts: for each JUDGE_RUBRICS entry, find the newest artifacts/sims export for its scenario, render the transcript, call the Anthropic SDK (model from ZENO_JUDGE_MODEL env) with rubric.question + passCriteria, parse a strict PASS/FAIL + justification JSON, append to artifacts/judge/verdicts-<date>.json. NON-GATING: exit code is always 0; output is trend data.
- [ ] Step 4: Record the fixtures: `npm run sims:spec -- 3 2 --record` (live LLM + dev DB; n-of-m applies). Then run the recorded suite, expect PASS: `npx vitest run __tests__/spec/agent/recorded-behavior.spec.test.ts`. Remove @backlog from the ids registered in Step 1.
- [ ] Step 5: Run the full spec suite: `npx vitest run __tests__/spec` — traceability green with the reduced backlog count.
- [ ] Step 6: Commit: `git add -A && git commit -m "feat(testing): scripted sim generator (n-of-m), recorded fixtures, judge runner (F1.9)"`

### Task F1.10: Package verification
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Full unit suite: `npm test` — green (known exception policy: __tests__/lib/events/instrumentation.test.ts is documented flaky; PASS verdict allowed iff it is the sole failure AND passes in isolation: `npx vitest run __tests__/lib/events/instrumentation.test.ts`).
- [ ] Step 2: Spec suite with the commit ring: `$env:TEST_DATABASE_URL='<test-db-url>'; npx vitest run __tests__/spec` — green.
- [ ] Step 3: Live generators: `npm run sims:spec` — every scenario meets n-of-m (>=2/3).
- [ ] Step 4: Inspect artifacts/spec-coverage.json: scenarios=61; covered > 0; backlog count noted in the commit message as the Block F starting baseline.
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(spec): F1 verification — suite green, sims n-of-m, coverage baseline recorded"`


### ⚠ Binding errata for F1 (fidelity verifier — apply OVER the task text above)

1. **[F1.2/F1.4 — lib/spec/registry.ts scanSpecRegistrations + traceability.meta.test.ts orphan check]** The static regex scanner (CALL_RE over all __tests__/**/*.test.ts) scans __tests__/spec/registry.test.ts itself, which contains literal spec('NoSlash'), spec('upper/Case') (negative tests) and spec('not/counted'), spec('quote/expired-quote-cannot-be-accepted'), spec('dnt/signing-after-needs-analysis') inside writeFileSync fixture strings. These all become 'registrations', so F1.4's orphan assertion ('every registered id exists in the .feature') FAILS on 'NoSlash', 'upper/Case', 'not/counted' the moment it lands — contradicting F1.4 Step 3's 'expect PASS'. It also silently inflates the 'covered' metric and accidentally couples F1.3's id choices to fixture strings ('dnt/signing-after-needs-analysis' must be the exact id assigned to the line-202 signing scenario or it orphans too).
   **Fix:** In scanSpecRegistrations, exclude the registry/meta test files (e.g. skip files matching *.meta.test.ts and __tests__/spec/registry.test.ts, or scan only __tests__/spec/{engine,commit-ring,agent} + translation dirs). Alternatively build the registry.test.ts fixture strings so the regex cannot match (string concatenation: 'spe'+"c('not/counted')"), and use only ids that will exist in the .feature for the positive spec() examples. Update F1.4's Step 3 expectations accordingly.
2. **[F1.5 — taxonomy-closure.meta.test.ts direction (b) / lib/spec/taxonomy.ts PENDING_SPEC_AMENDMENTS]** Verified by grep: 'eligibility_recheck' appears ZERO times in zeno_workflow.feature (all other 13 legacy taxonomy strings appear; even 'unavailable' and 'pending' appear as standalone words). The closure assertion 'every union member appears in the .feature, modulo PENDING_SPEC_AMENDMENTS' therefore FAILS at F1.5 Step 4 (claimed PASS) on eligibility_recheck — and STILL fails after F3.2 empties the allowlist, because no F3 item adds eligibility_recheck to the .feature.
   **Fix:** Add 'eligibility_recheck' to the initial PENDING_SPEC_AMENDMENTS in F1.5, and add an F3.2 edit introducing it into the .feature (natural home per contradiction #4 rule 4: a Then-clause on the bd_medical/addon-ineligibility consequence, e.g. on the modify-answer outline or a gating-field scenario: 'Then the commit returns effect "eligibility_recheck" and the addon removal is surfaced'), then empty the allowlist as planned.
3. **[F1.3/F1.5/F1.9 — judge rubric specId 'dnt/refusal-explained-and-stopped' vs the single refusal scenario]** Internally contradictory: (a) F1.5's closure test demands judge scenarios in the .feature ↔ JUDGE_RUBRICS be 1:1, so 'dnt/refusal-explained-and-stopped' must be the @id of an @agent-judge-tagged scenario; (b) the .feature has exactly ONE refusal scenario ('Refused consent blocks the funnel', line 209) and F1.9 registers spec('dnt/refused-consent-blocks-funnel') against it, requiring THAT id to exist; (c) F1.3's meta-test demands exactly one @id and one primary class per scenario; (d) F1.3's note says 'its engine clause stays a separate @engine scenario' but no task adds a scenario, and adding one breaks the hard-coded 61-scenario assertions in F1.1 Step 2 and F1.4. Secondary fidelity issue vs T12.D2: tagging 'questionnaire/branching-provenance-explained', 'quote/post-quote-change-explained' and 'policy/relay-without-promising' @agent-judge-primary fully exempts their deterministic engine clauses (branching_metadata emission, cancel+get_last_application_info prefill, outside-window rule outcome) from any test obligation because F1.4 excludes judge scenarios entirely — T12.D2's binding recommendation is primary class + secondary assertion with discipline that secondary clauses are not silently dropped.
   **Fix:** Pick one consistent mechanism and write it into F1.3/F1.5: EITHER (preferred) keep one id per existing scenario — rubric specIds become the scenario's real id (e.g. 'dnt/refused-consent-blocks-funnel'), allow a scenario to be @engine/@agent primary AND carry a secondary @judge:<rubric-id> tag, and change F1.5's closure to match rubrics against @judge tags instead of @agent-judge-primary scenarios — this also restores the engine-clause obligations for the three mixed scenarios; OR add the split agent-judge scenarios to the .feature in F1.3 and update every 61-count assertion (F1.1, F1.4) in the same task.
4. **[F1.6 — generate-quote-outcomes.spec.test.ts (pending_external_check row) + F1.10 Step 1]** Sequencing contradiction: the test reads the outcome from the AST, which until F3.2 says 'rejected | pending_external_check' — but per binding M10 (and the draft's own assumption) Blocks C/D ship planGenerateQuote returning outcome 'pending' for that snapshot. The test is therefore RED from F1.6 until F3.2, and F1.6 Step 4 forbids weakening assertions, so F1.10 Step 1's 'npm test — green' is unsatisfiable. The escape hatch F1.3 offers (separate @backlog Examples block) doesn't work either: splitting the 4-row table breaks F1.1's pinned row-count assertion `.toEqual([4, 5])`, and tagging the whole block @backlog leaves it.each([]) with an empty test file (vitest errors on files with no tests).
   **Fix:** Perform the one-row spec amendment ('rejected'→'pending' on the pending_external_check row) in F1.3 or F1.6 itself — the log (M10 item 5) already authorizes it, F3.2 merely sequences the fold-back; keep the rest of F3.2 as-is. Also soften F1.1's `[4, 5]` Examples-row assertion (or co-locate it with a comment that any Examples-block split must update it) so the @backlog-Examples mechanism F1.3 describes is actually usable.
5. **[F1.2 lib/spec/operations-map.ts + F3 amendment checklist — payment recovery tools]** Fidelity violation of ratified T8.D4 (✅ single-ensure-payment-session, confirmed ratified by the 2026-06-12 'All panel recommendations ratified' entry and re-confirmed by M4's log entry 'payments adds ensure-payment-session renderer'): the operations map self-maps resume_payment→'resume_payment' and retry_payment→'retry_payment', i.e. to tools Block D will not ship. The .feature steps (lines 380-388: 'Zeno offers retry_payment', 'Zeno calls resume_payment') and catalog rows 118-119 use the old names, and F3's 11-item amendment checklist omits the T8.D4 fold-back entirely.
   **Fix:** In F1.2 map both operations to the implemented tool: `resume_payment: 'ensure_payment_session'`, `retry_payment: 'ensure_payment_session'` (mode comes back in the response per T8.D4). Add a checklist item (12) to F3 citing T8.D4: collapse catalog rows 118-119 into one ensure_payment_session commit row (response carries mode: started|resumed|retried; exposure: schedule with due/failed/abandoned installment), and optionally reword the two .feature Then-clauses — or explicitly note they keep speaking operation names via the map.
6. **[F1.9 Step 3 (run-spec-sims.ts), F4.4 Step 2 (diagnose-conversation.ts) + F4.4 Files list, F2.5 Step 1 test snippet]** Placeholder-rule violations: run-spec-sims.ts's 'implementation' code block is comments only ('skeleton of the real implementation') — no actual trial loop, pickAnswer reuse, SSE drain, export load, assert dispatch, or --record logic; F4.4's CLI body is likewise a comment block ('argument parsing + the three modes, ~80 lines'); F4.4's Files section omits Create: lib/diagnostics/report.ts although the test imports '@/lib/diagnostics/report' and Step 2 implements it; F2.5's added export test calls a `meta()` helper defined nowhere (the existing suite uses a CONVO literal).
   **Fix:** Provide real TypeScript for the load-bearing parts: run-spec-sims main loop (per-trial customer+conversation creation, opening-script drive via handleChatTurn + drain, pickAnswer regex hook imported/adapted from scripts/verify-advance-flow.ts, loadConversationExport call, assert-name→function dispatch table, n-of-m tally, --record copy) and the diagnose CLI's argv handling + three mode branches. Add 'Create: lib/diagnostics/report.ts' to F4.4 Files. In F2.5's test, replace meta() with the existing CONVO constant or define the helper inline.
7. **[F1 (cross-task) — unpinned cross-block symbols]** Several imports are guessed names/paths that exist neither in the pinned contracts nor in any Block F task: planModifyAnswer@lib/engines/consequence-planner (F1.6), planGenerateQuote@lib/engines/quote-lifecycle (F1.6), executeCommit@lib/engines/commit-gateway (F1.7), resetTestDb/seedFunnelToIssuedQuote@__tests__/helpers/test-db (F1.7 — note a SEED helper returning a valid state-fingerprinted confirmToken implies it must pre-call the gateway, which is nontrivial and unstated), CommitOutcome/CommitEffect@lib/engines/commit-contract (F1.5), ENGINE_VERSION@lib/engines/version ('NEW iff Block A did not ship it', F2.2), and the DomainSnapshot/deriveAndExpose module path lib/engines/derive-and-expose (pinned name, guessed path). F1.6 Step 3's 'STOP and reconcile' guard exists but only for engine tests.
   **Fix:** Add a cross-block import appendix to the F1/F2 overviews: one table of symbol → assumed path → owning block/package id, each marked confirmed-against-that-block's-draft or NEW. Specifically state in F1.7 that seedFunnelToIssuedQuote obtains the confirmToken by invoking the gateway once (requires_confirmation pre-flight), not by fabricating it.
8. **[F1.7 Step 2 — TEST_DATABASE_URL gating vs prisma from '@/lib/db']** The suite gates on process.env.TEST_DATABASE_URL but performs assertions through the app's prisma singleton (lib/db), which connects via DATABASE_URL. Unless the runner sets DATABASE_URL to the test DB (unstated), the gateway/helper would write one database while the assertions read another — or worse, the commit-ring tests would truncate the dev DB.
   **Fix:** State the wiring explicitly: either Block A's test-db helper exports the test-bound PrismaClient and ALL assertions in __tests__/spec/commit-ring import that client (never '@/lib/db'), or the documented invocation sets DATABASE_URL=$TEST_DATABASE_URL for the run (and resetTestDb refuses to run when the URL lacks a '_test' marker, as a dev-DB safety guard).

### ➕ Addendum tasks for F1 (binding — coverage-critic gaps)

### Note F1.ADD-1 (binding): the versioned typed ConversationExport contract (M8 pin 2, schemaVersion field) is OWNED HERE — F1 defines it before building the assertion library; F2 consumes it (do not re-version in F2). Closes critic O10.

## Package F2: Observability completion: per-turn legality snapshots, recompute-and-diff replay, invariant monitors, compliance evidence views, ConversationExport v2

**Execution slot:** 23 | **Depends on:** F1

**Goal:** Complete T14.D2/D3/D4 + the M8 pins on the existing TurnDebug chassis (lib/chat/debug.ts -> lib/debug/reducer.ts -> lib/chat/turn-debug-persistence.ts -> drawer): persist a per-turn legality snapshot (DerivedStateV3 + available/blocked + ENGINE_VERSION + ProductContent version stamps, redacted per T14.D5), upgrade replay to recompute-and-diff over deriveAndExpose (same-version diff = bug, cross-version = behavioral changelog), add the mechanical runtime invariant monitors as anomaly events + drawer badges, ship BOTH compliance evidence viewers (admin customer timeline + drawer Legality/Commit panels) over the Block A CommitLedger, and version the typed ConversationExport contract (schemaVersion 2) shared with F1's assertion library. Zero Prisma migrations: everything rides the TurnDebug Json payload (M8 pin 3: no TurnTrace schema change).

### Task F2.1: Legality snapshot debug event + redaction + reducer support
**Files:**
- Modify: lib/chat/debug.ts (DebugLegalityPayload + union member + buildLegalityPayload)
- Create: lib/debug/redact.ts
- Modify: lib/debug/reducer.ts (DebugTurn.legality + reduce case)
- Test: __tests__/lib/debug/legality-snapshot.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/lib/debug/legality-snapshot.test.ts
import { describe, it, expect } from 'vitest'
import { buildTurnDebugPayload } from '@/lib/debug/reducer'
import { redactSnapshot } from '@/lib/debug/redact'
import type { DebugEvent } from '@/lib/chat/debug'

const start: DebugEvent = { event: 'debug:turn_start', data: { traceId: 't1', conversationId: 'c1', messageIndex: 0, userMessage: 'u', language: 'ro' } }
const legality = (point: 'turn_start' | 'post_commit'): DebugEvent => ({
  event: 'debug:legality',
  data: { traceId: 't1', point, commitLedgerId: point === 'post_commit' ? 'led_1' : undefined,
    engineVersion: '3.0.0', contentVersions: { protect: 'pc_v4' },
    snapshot: { customer: { id: 'cust', cnp: '1900101...' } },
    state: { phase: 'APPLICATION', subphase: 'DNT' }, actions: { available: ['open_dnt_session'], blocked: [] } } as never,
})

describe('debug:legality event', () => {
  it('accumulates into DebugTurn.legality in order, turn_start first', () => {
    const turn = buildTurnDebugPayload([start, legality('turn_start'), legality('post_commit')])!
    expect(turn.legality).toHaveLength(2)
    expect(turn.legality![0].point).toBe('turn_start')
    expect(turn.legality![1].commitLedgerId).toBe('led_1')
    expect(turn.legality![0].engineVersion).toBe('3.0.0')
    expect(turn.legality![0].contentVersions).toEqual({ protect: 'pc_v4' }) // M8 pin 1
  })
})

describe('redactSnapshot (T14.D5)', () => {
  it('strips raw PII values from identity fields but keeps provenance states', () => {
    const red = redactSnapshot({ customer: { id: 'c', age: 35, cnp: '1900101123456', email: 'a@b.c',
      fields: { cnp: { state: 'verified', value: '1900101123456' } } } } as never) as never as Record<string, never>
    const s = JSON.stringify(red)
    expect(s).not.toContain('1900101123456')
    expect(s).not.toContain('a@b.c')
    expect(s).toContain('"state":"verified"')
    expect(s).toContain('"age":35') // derived facts stay — recompute needs them
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/debug/legality-snapshot.test.ts` — unknown event + missing module.
- [ ] Step 3: Minimal implementation. In lib/chat/debug.ts add:
```ts
export interface DebugLegalityPayload {
  traceId: string
  point: 'turn_start' | 'post_commit'
  commitLedgerId?: string
  engineVersion: string
  /** ProductContent version id(s) injected into this turn's prompt (M8 pin 1). */
  contentVersions: Record<string, string>
  /** REDACTED DomainSnapshot — input of deriveAndExpose, replayable. */
  snapshot: unknown
  state: DerivedStateV3
  actions: ExposedActions
}
// union += | { event: 'debug:legality'; data: DebugLegalityPayload }
```
(import DerivedStateV3/ExposedActions from Block A's lib/engines/derive-and-expose). lib/debug/redact.ts:
```ts
// lib/debug/redact.ts
const PII_KEYS = new Set(['cnp', 'email', 'phone', 'name', 'value'])
/** Defense-in-depth: DomainSnapshot is designed to carry derived facts, not raw
 * PII (T4-R2: tier/fields are provenance states; age is derived). This pass
 * removes any raw identity string that slipped in, preserving provenance. */
export function redactSnapshot(snapshot: unknown): unknown {
  const walk = (node: unknown, inIdentity: boolean): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, inIdentity))
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        const identityScope = inIdentity || k === 'customer' || k === 'identity' || k === 'fields'
        if (identityScope && PII_KEYS.has(k) && typeof v === 'string') out[k] = '[redacted]'
        else out[k] = walk(v, identityScope)
      }
      return out
    }
    return node
  }
  return walk(snapshot, false)
}
```
lib/debug/reducer.ts: `DebugTurn` gains `legality?: Omit<DebugLegalityPayload, 'traceId'>[]`; add the reduce case appending `{ ...rest }` in arrival order.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/debug/legality-snapshot.test.ts __tests__/lib/debug`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(debug): legality snapshot event + PII redaction + reducer support (F2.1)"`

### Task F2.2: Emit legality snapshots from the orchestrator (turn start + post-commit) with ENGINE_VERSION
**Files:**
- Create: lib/engines/version.ts (NEW iff Block A did not ship it — `export const ENGINE_VERSION = '3.0.0'`, bumped on every behavioral deriveAndExpose change)
- Modify: lib/chat/orchestrator.ts (record debug:legality at the turn-start deriveAndExpose call site and after each gateway commit round; payload built by a pure helper, snapshot passed through redactSnapshot)
- Modify: lib/chat/debug.ts (pure buildLegalityPayload helper, mirroring buildIdentityPayload)
- Test: __tests__/lib/chat/legality-emission.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test for the pure builder:
```ts
// __tests__/lib/chat/legality-emission.test.ts
import { describe, it, expect } from 'vitest'
import { buildLegalityPayload } from '@/lib/chat/debug'
import { ENGINE_VERSION } from '@/lib/engines/version'

describe('buildLegalityPayload', () => {
  it('stamps engine version, redacts the snapshot, carries state+actions verbatim', () => {
    const p = buildLegalityPayload({
      traceId: 't1', point: 'turn_start', contentVersions: { protect: 'pc_v4' },
      snapshot: { customer: { id: 'c', cnp: '1900101123456', fields: { cnp: { state: 'declared' } } } },
      state: { phase: 'DISCOVERY', subphase: null } as never,
      actions: { available: ['set_candidate_product'], blocked: [] },
    })
    expect(p.engineVersion).toBe(ENGINE_VERSION)
    expect(JSON.stringify(p.snapshot)).not.toContain('1900101123456')
    expect(p.actions.available).toContain('set_candidate_product')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/chat/legality-emission.test.ts`
- [ ] Step 3: Implement: lib/engines/version.ts; buildLegalityPayload = `{ ...input, engineVersion: ENGINE_VERSION, snapshot: redactSnapshot(input.snapshot) }`. Wire in orchestrator.ts: (a) where the turn's deriveAndExpose result is obtained (the Block A turn-start call site, the same place debug:gate currently records derivedState) call `recordDebugEvent(sink, { event: 'debug:legality', data: buildLegalityPayload({ point: 'turn_start', ... }) })` + `yield* debugYield(...)`; (b) after every gateway commit returns (CommitResult carries the post deriveAndExpose per contradiction #6 step 7) record a `point: 'post_commit'` event with `commitLedgerId` from the gateway result. contentVersions comes from the prompt-build context (Block E injects ProductContent; its version ids are on the turn context).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/chat/legality-emission.test.ts`. Runtime check: with the dev server running, send one chat message, then `npx tsx scripts/dump-conversation.ts <conversationId>` (existing script) or query: TurnDebug payload now contains `legality[0].point === 'turn_start'`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(debug): emit per-turn + post-commit legality snapshots with engine/content versions (F2.2)"`

### Task F2.3: Recompute-and-diff replay (lib + CLI + route + drawer button)
**Files:**
- Create: lib/debug/recompute-diff.ts
- Create: scripts/replay-conversation.ts
- Create: app/api/conversations/[id]/replay/route.ts (dev-only, mirrors the export route guard)
- Modify: components/debug/debug-drawer.tsx (Recompute button beside Download; shows diff count badge)
- Test: __tests__/lib/debug/recompute-diff.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/lib/debug/recompute-diff.test.ts
import { describe, it, expect } from 'vitest'
import { recomputeAndDiff } from '@/lib/debug/recompute-diff'

const entry = (over: Record<string, unknown> = {}) => ({
  point: 'turn_start', engineVersion: '3.0.0', contentVersions: {},
  snapshot: { marker: 'snap' },
  state: { phase: 'DISCOVERY', subphase: null },
  actions: { available: ['set_candidate_product'], blocked: [] }, ...over,
})
const turn = (legality: unknown[]) => ({ traceId: 't', conversationId: 'c', messageIndex: 0, userMessage: '', language: 'ro', startedAt: 0, toolCalls: [], legality }) as never

describe('recomputeAndDiff (T14.D2)', () => {
  it('same engine version + identical recomputation -> no diffs', () => {
    const derive = () => ({ state: { phase: 'DISCOVERY', subphase: null }, actions: { available: ['set_candidate_product'], blocked: [] } })
    expect(recomputeAndDiff([turn([entry()])], { currentEngineVersion: '3.0.0', derive: derive as never })).toEqual([])
  })
  it('same engine version + different output -> same_version_drift (a bug)', () => {
    const derive = () => ({ state: { phase: 'APPLICATION', subphase: 'DNT' }, actions: { available: [], blocked: [] } })
    const diffs = recomputeAndDiff([turn([entry()])], { currentEngineVersion: '3.0.0', derive: derive as never })
    expect(diffs).toHaveLength(1)
    expect(diffs[0].kind).toBe('same_version_drift')
    expect(diffs[0].stateDiff).toContain('phase: DISCOVERY -> APPLICATION')
    expect(diffs[0].actionsDiff.removedAvailable).toEqual(['set_candidate_product'])
  })
  it('different engine version -> cross_version_change (behavioral changelog, not a bug)', () => {
    const derive = () => ({ state: { phase: 'APPLICATION', subphase: 'DNT' }, actions: { available: [], blocked: [] } })
    const diffs = recomputeAndDiff([turn([entry({ engineVersion: '2.9.0' })])], { currentEngineVersion: '3.0.0', derive: derive as never })
    expect(diffs[0].kind).toBe('cross_version_change')
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/debug/recompute-diff.test.ts`
- [ ] Step 3: Minimal implementation:
```ts
// lib/debug/recompute-diff.ts
import type { DebugTurn } from './reducer'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'

export interface LegalityDiff {
  messageIndex: number
  point: string
  kind: 'same_version_drift' | 'cross_version_change'
  storedEngineVersion: string
  stateDiff: string[]
  actionsDiff: { addedAvailable: string[]; removedAvailable: string[]; blockedChanged: string[] }
}
type DeriveFn = (snapshot: unknown) => { state: Record<string, unknown>; actions: { available: string[]; blocked: { action: string; reason: string }[] } }

export function recomputeAndDiff(
  turns: DebugTurn[],
  opts: { currentEngineVersion: string; derive?: DeriveFn },
): LegalityDiff[] {
  const derive = opts.derive ?? (deriveAndExpose as unknown as DeriveFn)
  const diffs: LegalityDiff[] = []
  for (const t of turns) {
    for (const entry of (t.legality ?? [])) {
      const fresh = derive(entry.snapshot)
      const stored = { state: entry.state as never as Record<string, unknown>, actions: entry.actions }
      const stateDiff: string[] = []
      for (const key of new Set([...Object.keys(stored.state), ...Object.keys(fresh.state)])) {
        const a = JSON.stringify(stored.state[key]); const b = JSON.stringify(fresh.state[key])
        if (a !== b) stateDiff.push(`${key}: ${JSON.parse(a ?? 'null')} -> ${JSON.parse(b ?? 'null')}`)
      }
      const addedAvailable = fresh.actions.available.filter((x) => !stored.actions.available.includes(x))
      const removedAvailable = stored.actions.available.filter((x) => !fresh.actions.available.includes(x))
      const blockedChanged = JSON.stringify(stored.actions.blocked) === JSON.stringify(fresh.actions.blocked) ? [] : ['blocked set changed']
      if (stateDiff.length || addedAvailable.length || removedAvailable.length || blockedChanged.length) {
        diffs.push({
          messageIndex: t.messageIndex, point: entry.point,
          kind: entry.engineVersion === opts.currentEngineVersion ? 'same_version_drift' : 'cross_version_change',
          storedEngineVersion: entry.engineVersion,
          stateDiff, actionsDiff: { addedAvailable, removedAvailable, blockedChanged },
        })
      }
    }
  }
  return diffs
}
```
scripts/replay-conversation.ts: `npx tsx scripts/replay-conversation.ts <conversationId>` — loads turns via loadConversationExport, runs recomputeAndDiff with ENGINE_VERSION, prints a table (messageIndex | point | kind | summary), exit 1 iff any same_version_drift. Route: GET returns `{ engineVersion, diffs }` with the same isDev() 404 guard as the export route. Drawer: a "Recompute" button calling the route; badge shows `diffs.length` with red styling iff any kind === 'same_version_drift'.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/debug/recompute-diff.test.ts`. Runtime: `npx tsx scripts/replay-conversation.ts <id-from-F2.2-check>` prints zero same_version_drift rows.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(debug): recompute-and-diff replay over deriveAndExpose (F2.3)"`

### Task F2.4: Runtime invariant monitors -> anomalies + drawer badges
**Files:**
- Create: lib/monitors/turn-invariants.ts
- Modify: lib/chat/orchestrator.ts (assemble InvariantInput at turn end; append findings to DebugTurnEndPayload.anomalies; they flow into the existing turn:end ZenoEvent anomalies[])
- Modify: components/debug/turn-card.tsx (anomaly badge: count + worst severity color + invariant codes on hover)
- Test: __tests__/lib/monitors/turn-invariants.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/lib/monitors/turn-invariants.test.ts
import { describe, it, expect } from 'vitest'
import { evaluateTurnInvariants } from '@/lib/monitors/turn-invariants'

const base = {
  briefingRecommendedActions: [], availableActions: [],
  executorRejections: [], writingToolResults: [], ledgerDispositions: [], confirmTokenReissues: 0,
}
describe('evaluateTurnInvariants (T14.D3 — mechanical @contract subset)', () => {
  it('briefing-integrity: a recommended action missing from available_actions is CRITICAL (the live 10-tool regression class)', () => {
    const f = evaluateTurnInvariants({ ...base, briefingRecommendedActions: ['open_dnt_session'], availableActions: ['get_dnt_state'] })
    expect(f).toEqual([{ code: 'briefing_action_not_exposed', severity: 'critical', detail: { actions: ['open_dnt_session'] } }])
  })
  it('executor rejection of a non-exposed tool is a WARNING with the tool named', () => {
    const f = evaluateTurnInvariants({ ...base, executorRejections: [{ tool: 'generate_quote', reason: 'not_exposed' }] })
    expect(f[0]).toMatchObject({ code: 'executor_rejected_tool', severity: 'warning' })
  })
  it('a writing tool result without a commit envelope is CRITICAL', () => {
    const f = evaluateTurnInvariants({ ...base, writingToolResults: [{ tool: 'sign_dnt', hasEnvelope: false }] })
    expect(f[0]).toMatchObject({ code: 'envelope_missing', severity: 'critical', detail: { tools: ['sign_dnt'] } })
  })
  it('idempotent replays and confirm-token reissues are INFO counters', () => {
    const f = evaluateTurnInvariants({ ...base, ledgerDispositions: ['fresh', 'replay'], confirmTokenReissues: 1 })
    expect(f.map((x) => x.code).sort()).toEqual(['confirm_token_reissued', 'idempotent_replay'])
    expect(f.every((x) => x.severity === 'info')).toBe(true)
  })
  it('a clean turn yields no findings', () => {
    expect(evaluateTurnInvariants(base)).toEqual([])
  })
})
```
- [ ] Step 2: Run it, expect FAIL: `npx vitest run __tests__/lib/monitors/turn-invariants.test.ts`
- [ ] Step 3: Minimal implementation:
```ts
// lib/monitors/turn-invariants.ts
export interface InvariantInput {
  briefingRecommendedActions: string[]
  availableActions: string[]
  executorRejections: { tool: string; reason: string }[]
  writingToolResults: { tool: string; hasEnvelope: boolean }[]
  ledgerDispositions: ('fresh' | 'replay')[]
  confirmTokenReissues: number
}
export interface InvariantFinding {
  code: 'briefing_action_not_exposed' | 'executor_rejected_tool' | 'envelope_missing' | 'idempotent_replay' | 'confirm_token_reissued'
  severity: 'info' | 'warning' | 'critical'
  detail: Record<string, unknown>
}
export function evaluateTurnInvariants(i: InvariantInput): InvariantFinding[] {
  const out: InvariantFinding[] = []
  const missing = i.briefingRecommendedActions.filter((a) => !i.availableActions.includes(a))
  if (missing.length) out.push({ code: 'briefing_action_not_exposed', severity: 'critical', detail: { actions: missing } })
  if (i.executorRejections.length) out.push({ code: 'executor_rejected_tool', severity: 'warning', detail: { rejections: i.executorRejections } })
  const bare = i.writingToolResults.filter((r) => !r.hasEnvelope).map((r) => r.tool)
  if (bare.length) out.push({ code: 'envelope_missing', severity: 'critical', detail: { tools: bare } })
  const replays = i.ledgerDispositions.filter((d) => d === 'replay').length
  if (replays) out.push({ code: 'idempotent_replay', severity: 'info', detail: { count: replays } })
  if (i.confirmTokenReissues > 0) out.push({ code: 'confirm_token_reissued', severity: 'info', detail: { count: i.confirmTokenReissues } })
  return out
}
```
Orchestrator wiring: at turn end, assemble InvariantInput from the turn context (briefing recommended actions come from Block E's machine-readable briefing; availableActions from the turn-start deriveAndExpose; rejections/envelopes/dispositions from the gateway results collected this turn), map findings to the existing Anomaly shape (`{ type: 'behavioral', severity, message: code, metadata: detail }` — severity 'warning'→'warning', 'critical'→'critical', 'info'→'info') and append to DebugTurnEndPayload.anomalies, which already flows into the turn:end ZenoEvent and TurnDebug. Drawer: turn-card.tsx renders an anomaly chip (`{count} ⚠` colored by worst severity, title = codes joined).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/monitors/turn-invariants.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(monitors): runtime invariant monitors as turn anomalies + drawer badges (F2.4)"`

### Task F2.5: ConversationExport v2 — versioned typed contract + ledger rows + assertion-library upgrade
**Files:**
- Modify: lib/debug/conversation-export.ts (schemaVersion: 2; ledger: CommitLedgerExportRow[]; turns carry legality via DebugTurn)
- Modify: lib/debug/load-export.ts (query commitLedger rows for the conversation, ordered by createdAt)
- Modify: lib/testing/conversation-assertions.ts (turnState prefers legality snapshots; new assertEveryCommitHasLedgerRow + assertNoBlockedActionExecuted)
- Test: __tests__/lib/debug/conversation-export.test.ts (extend existing suite)
- Test: __tests__/lib/testing/conversation-assertions.test.ts (extend)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing tests:
```ts
// __tests__/lib/debug/conversation-export.test.ts — added cases
import { buildConversationExport, EXPORT_SCHEMA_VERSION } from '@/lib/debug/conversation-export'

it('stamps schemaVersion 2 and carries ledger rows sorted by createdAt (M8 pin 2)', () => {
  const out = buildConversationExport({
    exportedAt: 'x', conversation: meta(), messages: [], turns: [],
    ledger: [
      { id: 'l2', tool: 'sign_dnt', actor: 'agent', outcome: 'applied', effects: ['advance_phase'], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:05:00Z' },
      { id: 'l1', tool: 'open_dnt_session', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:01:00Z' },
    ],
  })
  expect(out.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
  expect(out.schemaVersion).toBe(2)
  expect(out.ledger.map((l) => l.id)).toEqual(['l1', 'l2'])
})
```
```ts
// __tests__/lib/testing/conversation-assertions.test.ts — added cases
it('turnState prefers the legality snapshot over the legacy gate field', () => {
  const t = turn(0, {
    gate: { skipped: false, durationMs: 0, derivedState: { phase: 'DISCOVERY' } },
    legality: [{ point: 'turn_start', engineVersion: '3.0.0', contentVersions: {}, snapshot: {}, state: { phase: 'APPLICATION', subphase: 'DNT' }, actions: { available: [], blocked: [] } }],
  })
  expect(turnState(t as never)?.phase).toBe('APPLICATION')
})
it('assertNoBlockedActionExecuted flags a ledger commit that was blocked at turn start', () => {
  const t = turn(0, { legality: [{ point: 'turn_start', engineVersion: '3.0.0', contentVersions: {}, snapshot: {}, state: { phase: 'QUOTE' }, actions: { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' }] } }] })
  const e = { ...exp([t]), schemaVersion: 2, ledger: [{ id: 'l1', tool: 'accept_quote', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'QUOTE', phaseTo: 'PAYMENT', idempotencyDisposition: 'fresh', targetRef: 'q1', createdAt: 'x' }] }
  expect(() => assertNoBlockedActionExecuted(e as never)).toThrow(/blocked/)
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/debug/conversation-export.test.ts __tests__/lib/testing/conversation-assertions.test.ts`
- [ ] Step 3: Implement: add `export const EXPORT_SCHEMA_VERSION = 2 as const`, `schemaVersion: typeof EXPORT_SCHEMA_VERSION` and `ledger: CommitLedgerExportRow[]` (typed mirror of the Block A CommitLedger row: id, tool, actor, outcome, effects, reasonCode, phaseFrom, phaseTo, idempotencyDisposition, targetRef, createdAt) to ConversationExport; buildConversationExport sorts ledger by createdAt; load-export.ts queries `prisma.commitLedger.findMany({ where: { conversationId } })`. Assertion lib: turnState = `t.legality?.find(l => l.point === 'turn_start')?.state ?? t.gate?.derivedState ?? null`; `assertEveryCommitHasLedgerRow(e)` (every writing toolCall whose result.success matches one ledger row by tool within the turn — throws naming the bare tool); `assertNoBlockedActionExecuted(e)` (no ledger row with outcome 'applied' whose tool was in that turn's turn_start blocked list).
- [ ] Step 4: Re-record the two fixtures at v2 so the recorded suite asserts the new contract: `npm run sims:spec -- 3 2 --record`, then `npx vitest run __tests__/spec/agent __tests__/lib/testing __tests__/lib/debug` — PASS.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(debug): ConversationExport v2 — schemaVersion + commit ledger + legality-aware assertions (F2.5)"`

### Task F2.6: Compliance evidence views — admin customer timeline + drawer Legality/Commit panels (T14.D4: BOTH)
**Files:**
- Create: lib/compliance/evidence-timeline.ts (pure view-model builder)
- Create: app/admin/(protected)/customers/[customerId]/evidence/page.tsx (server component, direct prisma reads)
- Create: components/debug/sections/legality-section.tsx
- Create: components/debug/sections/commit-timeline-section.tsx
- Modify: components/debug/turn-card.tsx (render LegalitySection per turn)
- Modify: components/debug/debug-drawer.tsx (Commit timeline panel fed from the v2 export's ledger)
- Test: __tests__/lib/compliance/evidence-timeline.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test for the pure builder:
```ts
// __tests__/lib/compliance/evidence-timeline.test.ts
import { describe, it, expect } from 'vitest'
import { buildEvidenceTimeline } from '@/lib/compliance/evidence-timeline'

describe('buildEvidenceTimeline (T14.D4/D5 — references, never raw PII)', () => {
  it('merges ledger, consents, disclosures and verifications into one sorted timeline', () => {
    const tl = buildEvidenceTimeline({
      ledger: [{ id: 'l1', tool: 'sign_dnt', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:05:00Z' }],
      consents: [{ kind: 'gdpr_processing', action: 'granted', scope: null, sourceCommitId: 'l1', createdAt: '2026-07-01T10:05:00Z' }],
      disclosures: [{ kind: 'ipid', contentVersion: 'pc_v4', language: 'ro', createdAt: '2026-07-01T11:00:00Z' }],
      verifications: [{ field: 'cnp', state: 'verified', evidenceRecordId: 'ev_1', createdAt: '2026-07-01T12:00:00Z' }],
    })
    expect(tl.map((e) => e.kind)).toEqual(['commit', 'consent', 'disclosure', 'verification'])
    expect(tl[2].label).toContain('ipid')
    expect(tl[2].label).toContain('pc_v4') // content version in force — M8 pin 1
    expect(JSON.stringify(tl)).not.toMatch(/\d{13}/) // no raw CNP anywhere
  })
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/compliance/evidence-timeline.test.ts`
- [ ] Step 3: Implement: `buildEvidenceTimeline(input) -> { at: string; kind: 'commit'|'consent'|'disclosure'|'verification'; label: string; refs: Record<string,string> }[]` sorted by `at` (stable on tie by input order: ledger, consents, disclosures, verifications); labels are code-built strings (e.g. `sign_dnt applied (agent)`, `gdpr_processing granted`, `disclosure ipid v=pc_v4 lang=ro`, `cnp -> verified (evidence ev_1)`) — field NAMES and provenance states only, never values (T14.D5). Admin page: server component queries commitLedger/consentEvent/disclosureAck/verification rows by customerId, renders the timeline list grouped by day. Drawer panels: LegalitySection renders turn.legality entries (available as green chips, blocked as red chips with reason code, engine + content versions in a footer); CommitTimelineSection renders the v2 export's ledger rows chronologically with outcome/effects/disposition.
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/compliance/evidence-timeline.test.ts`. Manual runtime check: `npm run dev`, open /admin/customers/<seeded-customer-id>/evidence (renders timeline) and the chat debug drawer (Legality chips visible per turn).
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(compliance): evidence timeline — admin customer view + drawer legality/commit panels (F2.6)"`

### Task F2.7: Package verification
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npm test` — green (instrumentation-flake policy as in F1.10).
- [ ] Step 2: Live turn check: `npm run dev`, drive 3 chat turns incl. one commit; verify in the drawer: legality chips per turn, anomaly badge absent on clean turns, Download yields schemaVersion 2 JSON with ledger[].
- [ ] Step 3: Replay: `npx tsx scripts/replay-conversation.ts <that-conversation-id>` — zero same_version_drift diffs. Then locally flip a deriveAndExpose rule (do not commit), rerun, observe a same_version_drift finding, revert.
- [ ] Step 4: Recorded suite still green with v2 fixtures: `npx vitest run __tests__/spec`
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(debug): F2 verification — legality snapshots, replay diff, monitors, evidence views live"`


### ⚠ Binding errata for F2 (fidelity verifier — apply OVER the task text above)

1. **[F2 package depends_on + F2.6 model references]** F2.depends_on = [F1,A1,A,B0,E], but F2.6's evidence timeline queries DisclosureAck rows (Block D's disclosures/document-registry work, T7.D2/M9 inventory) and verification/evidence records (Block B identity, T4-R3 evidence pipeline). Neither B nor D is declared, and the prisma model names used in the page ('disclosureAck', 'verification') are guesses not pinned anywhere.
   **Fix:** Add 'B' and 'D' to F2.depends_on (or split F2.6 out with its own deps), and add a note to F2.6 Step 3 to reconcile the exact Prisma model/field names against Block B's verification-evidence migration and Block D's DisclosureAck migration before writing the page queries.
2. **[F2.2/F2.5/F4.3 — commitLedgerId provenance and the ledger↔turn join]** The pinned CommitResult has no ledger-row id field and the pinned CommitLedger row has no traceId/messageIndex, yet: F2.2 records `commitLedgerId` on post_commit legality entries 'from the gateway result'; F2.5's assertEveryCommitHasLedgerRow and F4.3's blocked_action_attempted/missing_consequences join ledger rows to turns 'by tool within the turn' — a join the pinned data cannot express deterministically (tool name is ambiguous across turns; createdAt-vs-startedAt windows are unspecified).
   **Fix:** Pin the mechanism explicitly: state in F2.2 that the gateway's return surface must expose the written ledger row id alongside CommitResult (coordinate with Block A; mark as NEW if absent), then make F2.5/F4.3 join exclusively via the post_commit legality entries' commitLedgerId (turn → legality[post_commit].commitLedgerId → ledger row), falling back to tool-name-within-conversation only for pre-F2 history. Update the F2.5/F4.3 test literals to carry the linking ids.
3. **[F1.9 Step 3 (run-spec-sims.ts), F4.4 Step 2 (diagnose-conversation.ts) + F4.4 Files list, F2.5 Step 1 test snippet]** Placeholder-rule violations: run-spec-sims.ts's 'implementation' code block is comments only ('skeleton of the real implementation') — no actual trial loop, pickAnswer reuse, SSE drain, export load, assert dispatch, or --record logic; F4.4's CLI body is likewise a comment block ('argument parsing + the three modes, ~80 lines'); F4.4's Files section omits Create: lib/diagnostics/report.ts although the test imports '@/lib/diagnostics/report' and Step 2 implements it; F2.5's added export test calls a `meta()` helper defined nowhere (the existing suite uses a CONVO literal).
   **Fix:** Provide real TypeScript for the load-bearing parts: run-spec-sims main loop (per-trial customer+conversation creation, opening-script drive via handleChatTurn + drain, pickAnswer regex hook imported/adapted from scripts/verify-advance-flow.ts, loadConversationExport call, assert-name→function dispatch table, n-of-m tally, --record copy) and the diagnose CLI's argv handling + three mode branches. Add 'Create: lib/diagnostics/report.ts' to F4.4 Files. In F2.5's test, replace meta() with the existing CONVO constant or define the helper inline.

## Package F3: Spec fold-back: apply every logged amendment to zeno_tool_catalog.md + zeno_workflow.feature, delete duplicate copies

**Execution slot:** 24 | **Depends on:** F1

**Goal:** Make the two surviving spec documents (zeno_workflow.feature + zeno_tool_catalog.md) say what was actually decided. Apply the explicit amendment checklist enumerated from the resolution log, with the F1 meta-suite (traceability + taxonomy closure) as the forcing function for every .feature edit, and a string-level catalog lint test for the .md. Delete the duplicate zeno_workflow.md / zeno_workflow.docx / zeno_tool_catalog.docx so exactly two sources remain. Amendment checklist (each item cites its log entry): (1) set_application requires_identity row -> tiered identity model: identity hard-gates accept_quote, not application; soft channel-verification offer at set_application [Contradiction #1 + T4-R6]. (2) Consequence taxonomy table -> outcome+effects split; taxonomy += unavailable ({retryable}) and pending; 'returned by every commit' singular wording -> CommitResult outcome + effects[] [M10 + critic note 9]. (3) generate_quote Examples row 'rejected | pending_external_check' -> 'pending | pending_external_check'; application HOLDS and generate_quote re-exposes when the check clears [M10]. (4) DNT table 9 -> 6 tools (get_dnt_state absorbs get_dnt_session_details; open_dnt_session replaces start_dnt_session+update_dnt; write_dnt_answer absorbs modify_dnt_answer) [Contradiction #7]. (5) DNT 'Exposed when' column rewritten to customer-scoped predicates incl. renewal-without-application [Contradiction #12]. (6) get_policy_status enum += pending_submission, submitted; .feature 'First successful payment issues the policy automatically' redefined: issue = create-in-PENDING_SUBMISSION, agent language gated until ACTIVE [Contradiction #5]. (7) request_cancellation gains the automatic-refund effect in the free-look/pre-activation paths [Contradiction #5]. (8) get_application_list + get_quote_list rows dropped; get_customer_info -> get_customer_profile; get_open_items contract per M2 [M2]. (9) Per-phase tool tables demoted to documentation grouping — exposure is predicates over the full snapshot [Contradiction #12]. (10) Assumptions block: 'flat (non-branching)' DNT -> visibility-only branching, consequence-machinery still excluded [T3 ratified recommendation, amendment recorded in the assumptions block]; sign_dnt noted as the sole consent-CAPTURING commit appending ConsentEvent rows [Contradiction #2]. (11) Caller-supplied identity inputs (user_id, session/identity args) removed — actor is server-resolved [T4.D5 + critic note 5].

### Task F3.1: Catalog amendments with a string-level lint test
**Files:**
- Test: __tests__/spec/catalog-amendments.test.ts
- Modify: docs/tools as wokflow scenarios/zeno_tool_catalog.md (amendment items 1, 2, 4, 5, 6, 7, 8, 9, 10, 11)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing lint test pinning every amendment as a presence/absence assertion:
```ts
// __tests__/spec/catalog-amendments.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const md = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_tool_catalog.md'), 'utf8')

describe('zeno_tool_catalog.md reflects every logged spec amendment', () => {
  it('(2) taxonomy split into outcome + effects and includes unavailable/pending', () => {
    expect(md).toMatch(/outcome/i)
    expect(md).toMatch(/effects/i)
    expect(md).toMatch(/\bunavailable\b/)
    expect(md).toMatch(/\bpending\b/)
    expect(md).not.toMatch(/returned by every commit\)/) // singular-consequence framing retired
  })
  it('(4)(5) DNT surface is the pinned 6-tool set with customer-scoped exposure', () => {
    expect(md).toMatch(/open_dnt_session/)
    expect(md).not.toMatch(/\bstart_dnt_session\b/)
    expect(md).not.toMatch(/\bupdate_dnt\b/)
    expect(md).not.toMatch(/\bmodify_dnt_answer\b/)
    expect(md).not.toMatch(/\bget_dnt_session_details\b/)
    expect(md).toMatch(/expiring|renewal/i) // renewal-without-application exposure
  })
  it('(1) identity hard-gates acceptance, not application', () => {
    expect(md).toMatch(/accept_quote[^\n]*verified/i)
    expect(md).not.toMatch(/candidate set \*\*and\*\* customer identified/)
  })
  it('(6)(7) policy lifecycle states + refund effect present', () => {
    expect(md).toMatch(/pending_submission/)
    expect(md).toMatch(/\bsubmitted\b/)
    expect(md).toMatch(/refund/i)
  })
  it('(8) dropped list reads are gone; profile read renamed', () => {
    expect(md).not.toMatch(/get_application_list/)
    expect(md).not.toMatch(/get_quote_list/)
    expect(md).toMatch(/get_customer_profile/)
  })
  it('(9) per-phase tables demoted to documentation grouping', () => {
    expect(md).toMatch(/documentation grouping|grouping only|not the exposure rule/i)
  })
  it('(10) assumptions: visibility-only DNT branching + sign_dnt appends ConsentEvent', () => {
    expect(md).toMatch(/visibility-only/i)
    expect(md).toMatch(/ConsentEvent/)
  })
  it('(11) no caller-supplied identity inputs survive', () => {
    expect(md).not.toMatch(/\| *user_id *\|/)
    expect(md).not.toMatch(/session\/identity/)
  })
})
```
- [ ] Step 2: Run it, expect FAIL on every assertion: `npx vitest run __tests__/spec/catalog-amendments.test.ts`
- [ ] Step 3: Edit the catalog. Concretely: split the taxonomy table into 'Commit outcomes' (9 rows incl. `unavailable` — "infrastructure failure; state unchanged; {retryable, retryAfter?}; never narrated as a business rejection" and `pending` — "recorded, result unknown (external check, settlement gap); re-exposed when resolved") and 'Commit effects' (7 rows), header text: "every commit returns a CommitResult: one outcome + zero or more effects". Rewrite the DNT section to the six tools with the #12 'Exposed when' predicates verbatim (get_dnt_state: product in focus OR customer has any Dnt; get_dnt_questions: product type in focus or active session; get_dnt_next_question: active session; open_dnt_session: open application lacking valid DNT for its product type OR customer DNT expired/expiring within config window — renewal needs NO application; write_dnt_answer: active session + pending question; sign_dnt: session finished). set_application row: exposure 'candidate set' only; returns soft channel-verification offer; note 'identity hard gate: verified channel at accept_quote; documents per product verificationRequirements before initiate_payment'. get_policy_status enum -> pending_submission/submitted/active/lapsed/cancelled. request_cancellation consequences += 'automatic full refund executed by the payment module (free-look / pre-activation)'. Cross-cutting table: get_customer_info -> get_customer_profile; drop get_application_list/get_quote_list; add get_open_items contract {kind, refId, age, nextAction} with nextAction required to map to an exposed tool. Add one sentence above the phase sections: "Phase headings below are documentation grouping ONLY — exposure is computed by predicates over the full customer+conversation snapshot." Remove user_id/session/identity input columns (actor server-resolved). Assumptions block: flatness -> "DNT questions use visibility-only branching (no consequence machinery)"; add "sign_dnt is the sole consent-capturing commit; it appends ConsentEvent rows (gdpr_processing, ai_disclosure)".
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec/catalog-amendments.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "docs(spec): fold all logged amendments into zeno_tool_catalog.md (F3.1)"`

### Task F3.2: .feature amendments under the meta-suite (taxonomy strings, tool renames, policy-issue redefinition, pending row)
**Files:**
- Modify: docs/tools as wokflow scenarios/zeno_workflow.feature
- Modify: lib/spec/taxonomy.ts (empty PENDING_SPEC_AMENDMENTS)
- Modify: __tests__/spec/engine/generate-quote-outcomes.spec.test.ts (pending_external_check snapshot now expects outcome 'pending' — the expectation flows from the AST row automatically; only the SNAPSHOT_FOR comment changes)
- Modify: __tests__/spec/parse-workflow-feature.test.ts (update counts iff scenarios were added)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Make the closure test the failing gate: empty the allowlist in lib/spec/taxonomy.ts (`export const PENDING_SPEC_AMENDMENTS: readonly string[] = []`).
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/spec/taxonomy-closure.meta.test.ts` — "union members the spec never mentions: unavailable, pending".
- [ ] Step 3: Edit the .feature: (a) generate_quote Examples row `| rejected | pending_external_check |` -> `| pending  | pending_external_check |`; (b) the @contract outage scenario's Then-clauses now name `unavailable` explicitly ("Then the commit returns \"unavailable\" with {retryable} and state is unchanged"); (c) tool renames via the operations map's source names: start_dnt_session -> open_dnt_session (scenarios 'No valid DNT...', 'refuses to create a second active session'), update_dnt -> open_dnt_session ('An expired DNT is updated and re-signed', 'update_dnt refuses while a new-type session is active' — reworded to 'open_dnt_session picks the update type'), modify_dnt_answer -> write_dnt_answer ('Changing a DNT answer just saves the new answer'), get_dnt_session_details -> get_dnt_state ('Reporting DNT progress'); (d) payment feature: 'First successful payment issues the policy automatically' Then-clauses -> 'Then the payment module creates the policy in "pending_submission"' + 'And Zeno describes it as paid and being processed, never as in force' [#5]; (e) header assumptions comment updated to match the amended catalog. Update lib/spec/operations-map.ts: the renamed source keys remain as aliases (one line each, already present) — no test churn by construction.
- [ ] Step 4: Run the whole meta-suite + engine translations, expect PASS: `npx vitest run __tests__/spec` (the AST-driven outcome test now demands 'pending' from planGenerateQuote — if Block C/D shipped it as 'pending' per M10, green; any failure here is a real engine/spec mismatch to resolve on the engine side).
- [ ] Step 5: Commit: `git add -A && git commit -m "docs(spec): amend zeno_workflow.feature — pending/unavailable, 6-tool DNT names, policy-issue redefinition (F3.2)"`

### Task F3.3: Delete duplicate spec copies, guard the two-source rule
**Files:**
- Delete: docs/tools as wokflow scenarios/zeno_workflow.md, docs/tools as wokflow scenarios/zeno_workflow.docx, docs/tools as wokflow scenarios/zeno_tool_catalog.docx (delete from the source folder in the main checkout too — they were never committed)
- Test: __tests__/spec/catalog-amendments.test.ts (extend with the two-source guard)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing guard:
```ts
// appended to __tests__/spec/catalog-amendments.test.ts
it('exactly two spec sources exist: the .feature and the catalog .md (duplicates deleted)', () => {
  const dir = path.join(process.cwd(), 'docs/tools as wokflow scenarios')
  expect(fs.readdirSync(dir).sort()).toEqual(['zeno_tool_catalog.md', 'zeno_workflow.feature'])
})
```
- [ ] Step 2: Run, expect FAIL (duplicates present in the folder): `npx vitest run __tests__/spec/catalog-amendments.test.ts`
- [ ] Step 3: Delete the three duplicates: `rm "docs/tools as wokflow scenarios/zeno_workflow.md" "docs/tools as wokflow scenarios/zeno_workflow.docx" "docs/tools as wokflow scenarios/zeno_tool_catalog.docx"` (and the same three from the untracked main-checkout folder so they cannot be re-vendored).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/spec/catalog-amendments.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "docs(spec): delete duplicate spec copies — .feature + catalog .md are the two sources (F3.3)"`

### Task F3.4: Package verification
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Full spec meta-suite: `npx vitest run __tests__/spec` — traceability, tags, taxonomy closure (allowlist now empty), catalog lint all green.
- [ ] Step 2: Full suite: `npm test` — green (flake policy).
- [ ] Step 3: Confirm artifacts/spec-coverage.json backlog count did NOT increase versus the F1.10 baseline (renames must not have orphaned registrations — the orphan check enforces this mechanically).
- [ ] Step 4: Commit: `git add -A && git commit -m "chore(spec): F3 verification — spec fold-back complete, meta-suite green"`


### ⚠ Binding errata for F3 (fidelity verifier — apply OVER the task text above)

1. **[F1.2 lib/spec/operations-map.ts + F3 amendment checklist — payment recovery tools]** Fidelity violation of ratified T8.D4 (✅ single-ensure-payment-session, confirmed ratified by the 2026-06-12 'All panel recommendations ratified' entry and re-confirmed by M4's log entry 'payments adds ensure-payment-session renderer'): the operations map self-maps resume_payment→'resume_payment' and retry_payment→'retry_payment', i.e. to tools Block D will not ship. The .feature steps (lines 380-388: 'Zeno offers retry_payment', 'Zeno calls resume_payment') and catalog rows 118-119 use the old names, and F3's 11-item amendment checklist omits the T8.D4 fold-back entirely.
   **Fix:** In F1.2 map both operations to the implemented tool: `resume_payment: 'ensure_payment_session'`, `retry_payment: 'ensure_payment_session'` (mode comes back in the response per T8.D4). Add a checklist item (12) to F3 citing T8.D4: collapse catalog rows 118-119 into one ensure_payment_session commit row (response carries mode: started|resumed|retried; exposure: schedule with due/failed/abandoned installment), and optionally reword the two .feature Then-clauses — or explicitly note they keep speaking operation names via the map.
2. **[F3.1 Step 2 — 'expect FAIL on every assertion']** Minor overclaim: several assertions already pass against the current catalog (e.g. /outcome/i, /effects/i, and all the not.toMatch absence checks that only become meaningful after the edit are mixed with presence checks that genuinely fail). Verified present today and correctly targeted: 'candidate set **and** customer identified' (line 55), 'returned by every commit)' (line 14), '| user_id |' (line 71), 'session/identity' (line 37), and pending_submission/refund genuinely absent — so the test file as a whole does fail, but not 'on every assertion'.
   **Fix:** Reword Step 2 to 'expect FAIL (presence assertions for the not-yet-applied amendments fail; absence assertions may pass already)' so the executor doesn't chase phantom reds. No code change needed.

### ➕ Addendum tasks for F3 (binding — coverage-critic gaps)

### Note F3.ADD-1 (binding): extend the fold-back checklist with critic notes #10 (Stripe-only framing → document the three-provider reality), #11 (finished-but-unsigned DNT session amendability — resolved by the #7 six-tool surface; amend the .feature line), #12 (resume_application R/C typing — pin as R read in the catalog). Closes G15.

## Package F4: Conversation triage tooling (LAST): pure diagnostics catalog + diagnose-conversation CLI + Claude Code skill + runbook

**Execution slot:** 25 | **Depends on:** F2

**Goal:** Rebuild the T14.D6 design against the FINAL shapes (the validated prototype was deliberately removed; the log entry is the spec): a unit-tested pure check catalog in lib/diagnostics/ running over ConversationExport v2 (v1 checks: briefing_tool_not_exposed, tool_call_failed, tool_call_without_result, turn_not_ended, funnel_stalled, phase_regression, state_snapshot_inconsistent, duplicate_turn_debug, anomalies_reported, latency_outlier, repeated_assistant_message, ended_pre_closing; v2 checks: blocked_action_attempted, missing_consequences, recompute_drift), a scripts/diagnose-conversation.ts CLI with single/batch/CI modes, the .claude/skills/diagnose-conversation skill encoding verify-from-source discipline and the ratchet rule, and the docs/debugging-conversations.md runbook for the drawer -> checker -> skill stack.

### Task F4.1: Diagnostics core — types, runner, first six checks
**Files:**
- Create: lib/diagnostics/types.ts
- Create: lib/diagnostics/checks-basic.ts
- Create: lib/diagnostics/index.ts (CHECK_CATALOG + runDiagnostics)
- Test: __tests__/lib/diagnostics/checks-basic.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (literal exports only — pure seam):
```ts
// __tests__/lib/diagnostics/checks-basic.test.ts
import { describe, it, expect } from 'vitest'
import { runDiagnostics, CHECK_CATALOG } from '@/lib/diagnostics'
import type { ConversationExport } from '@/lib/debug/conversation-export'

function makeExport(over: Partial<ConversationExport> = {}): ConversationExport {
  return { schemaVersion: 2, exportedAt: 'x', conversationId: 'c1',
    conversation: { id: 'c1', status: 'ACTIVE' } as never,
    summary: { turns: 0, messages: 0, toolCalls: 0, toolsUsed: [] },
    messages: [], turns: [], ledger: [], ...over } as never
}
const legality = (state: Record<string, unknown>, actions = { available: [], blocked: [] }) =>
  [{ point: 'turn_start', engineVersion: '3.0.0', contentVersions: {}, snapshot: {}, state, actions }]
const turn = (i: number, over: Record<string, unknown> = {}) => ({
  traceId: `t${i}`, conversationId: 'c1', messageIndex: i, userMessage: 'u', language: 'ro',
  startedAt: 0, endedAt: 1, toolCalls: [], totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 900, anomalies: [] }, ...over,
}) as never

describe('basic diagnostic checks', () => {
  it('tool_call_failed flags a failed tool result with turn + tool evidence', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: false, durationMs: 5, cached: false, error: 'boom' } }] })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'tool_call_failed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 0, evidence: { tool: 'sign_dnt', error: 'boom' } })
  })
  it('tool_call_without_result flags a call missing its result', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'get_dnt_state', args: {}, partition: 'readOnly' }] })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'tool_call_without_result')).toBe(true)
  })
  it('turn_not_ended flags a turn without endedAt/totals', () => {
    const e = makeExport({ turns: [turn(0, { endedAt: undefined, totals: undefined })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'turn_not_ended')).toBe(true)
  })
  it('phase_regression flags POLICY -> QUOTE without a cancelling commit', () => {
    const e = makeExport({ turns: [
      turn(0, { legality: legality({ phase: 'POLICY' }) }),
      turn(1, { legality: legality({ phase: 'QUOTE' }) }),
    ] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'phase_regression')).toMatchObject({ severity: 'error', turn: 1 })
  })
  it('duplicate_turn_debug flags two turns with the same messageIndex', () => {
    const e = makeExport({ turns: [turn(0), turn(0)] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'duplicate_turn_debug')).toBe(true)
  })
  it('anomalies_reported relays persisted turn anomalies', () => {
    const e = makeExport({ turns: [turn(0, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 1, anomalies: [{ type: 'behavioral', severity: 'critical', message: 'briefing_action_not_exposed', metadata: {} }] } })] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'anomalies_reported')?.severity).toBe('error')
  })
  it('a clean conversation yields zero findings and the catalog is closed over unique ids', () => {
    expect(runDiagnostics(makeExport({ turns: [turn(0)] as never }))).toEqual([])
    const ids = CHECK_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/diagnostics/checks-basic.test.ts`
- [ ] Step 3: Minimal implementation:
```ts
// lib/diagnostics/types.ts
import type { ConversationExport } from '@/lib/debug/conversation-export'
export type FindingSeverity = 'error' | 'warn' | 'info'
export interface Finding { checkId: string; severity: FindingSeverity; turn: number | null; evidence: Record<string, unknown> }
export interface DiagnosticCheck { id: string; description: string; run(e: ConversationExport): Finding[] }
export const PHASE_ORDER = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const
export function turnPhase(t: { legality?: { point: string; state: { phase?: string } }[] }): string | null {
  return t.legality?.find((l) => l.point === 'turn_start')?.state.phase ?? null
}
```
```ts
// lib/diagnostics/checks-basic.ts — each check is a small pure function; excerpt:
import type { DiagnosticCheck, Finding } from './types'
import { PHASE_ORDER, turnPhase } from './types'

export const toolCallFailed: DiagnosticCheck = {
  id: 'tool_call_failed', description: 'A tool call returned success=false',
  run: (e) => e.turns.flatMap((t) => t.toolCalls
    .filter((c) => c.result && c.result.success === false)
    .map((c): Finding => ({ checkId: 'tool_call_failed', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name, error: c.result?.error ?? null } }))),
}
export const toolCallWithoutResult: DiagnosticCheck = {
  id: 'tool_call_without_result', description: 'A tool call has no recorded result',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.filter((c) => !c.result)
    .map((c): Finding => ({ checkId: 'tool_call_without_result', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name } }))),
}
export const turnNotEnded: DiagnosticCheck = {
  id: 'turn_not_ended', description: 'Turn has no endedAt/totals — stream died mid-turn',
  run: (e) => e.turns.filter((t) => !t.endedAt || !t.totals)
    .map((t): Finding => ({ checkId: 'turn_not_ended', severity: 'error', turn: t.messageIndex, evidence: {} })),
}
export const phaseRegression: DiagnosticCheck = {
  id: 'phase_regression', description: 'Derived phase moved backwards without a cancelling commit',
  run: (e) => {
    const out: Finding[] = []
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    for (let i = 1; i < ordered.length; i++) {
      const prev = turnPhase(ordered[i - 1] as never); const cur = turnPhase(ordered[i] as never)
      if (!prev || !cur) continue
      const cancelled = e.ledger.some((l) => ['cancel_application', 'cancel_quote', 'request_cancellation'].includes(l.tool) && l.outcome === 'applied')
      if (PHASE_ORDER.indexOf(cur as never) < PHASE_ORDER.indexOf(prev as never) && !cancelled) {
        out.push({ checkId: 'phase_regression', severity: 'error', turn: ordered[i].messageIndex, evidence: { from: prev, to: cur } })
      }
    }
    return out
  },
}
export const duplicateTurnDebug: DiagnosticCheck = {
  id: 'duplicate_turn_debug', description: 'Two TurnDebug rows share a messageIndex',
  run: (e) => {
    const seen = new Map<number, number>()
    e.turns.forEach((t) => seen.set(t.messageIndex, (seen.get(t.messageIndex) ?? 0) + 1))
    return [...seen].filter(([, n]) => n > 1).map(([idx]): Finding => ({ checkId: 'duplicate_turn_debug', severity: 'warn', turn: idx, evidence: {} }))
  },
}
export const anomaliesReported: DiagnosticCheck = {
  id: 'anomalies_reported', description: 'Runtime invariant monitors fired during the turn',
  run: (e) => e.turns.flatMap((t) => ((t.totals?.anomalies ?? []) as { severity: string; message: string }[])
    .map((a): Finding => ({ checkId: 'anomalies_reported', severity: a.severity === 'critical' ? 'error' : 'warn', turn: t.messageIndex, evidence: { anomaly: a.message } }))),
}
```
```ts
// lib/diagnostics/index.ts
import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DiagnosticCheck, Finding } from './types'
import * as basic from './checks-basic'
export const CHECK_CATALOG: DiagnosticCheck[] = Object.values(basic)
export function runDiagnostics(e: ConversationExport, catalog: DiagnosticCheck[] = CHECK_CATALOG): Finding[] {
  return catalog.flatMap((c) => c.run(e))
}
export type { Finding, DiagnosticCheck } from './types'
```
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/diagnostics/checks-basic.test.ts`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(diagnostics): core types + runner + six basic checks (F4.1)"`

### Task F4.2: Behavioral v1 checks — briefing_tool_not_exposed, funnel_stalled, state_snapshot_inconsistent, latency_outlier, repeated_assistant_message, ended_pre_closing
**Files:**
- Create: lib/diagnostics/checks-behavioral.ts
- Modify: lib/diagnostics/index.ts (catalog += behavioral checks)
- Test: __tests__/lib/diagnostics/checks-behavioral.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test (same literal-export helpers as F4.1; the load-bearing predicates):
```ts
// __tests__/lib/diagnostics/checks-behavioral.test.ts — predicate-pinning excerpts
it('briefing_tool_not_exposed: briefing recommends an action absent from available_actions', () => {
  const e = makeExport({ turns: [turn(0, {
    prompt: { briefingRecommendedActions: ['open_dnt_session'] },
    legality: legality({ phase: 'APPLICATION' }, { available: ['get_dnt_state'], blocked: [] }),
  })] as never })
  expect(runDiagnostics(e).find((x) => x.checkId === 'briefing_tool_not_exposed')).toMatchObject({ severity: 'error', evidence: { actions: ['open_dnt_session'] } })
})
it('funnel_stalled: >=4 consecutive turns, same phase, zero commits', () => {
  const turns = [0, 1, 2, 3].map((i) => turn(i, { legality: legality({ phase: 'APPLICATION' }) }))
  expect(runDiagnostics(makeExport({ turns: turns as never, ledger: [] })).some((x) => x.checkId === 'funnel_stalled')).toBe(true)
})
it('state_snapshot_inconsistent: phase QUOTE while state.quote is null', () => {
  const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'QUOTE', quote: null }) })] as never })
  expect(runDiagnostics(e).some((x) => x.checkId === 'state_snapshot_inconsistent')).toBe(true)
})
it('latency_outlier: latencyMs > 30000', () => {
  const e = makeExport({ turns: [turn(0, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 31000, anomalies: [] } })] as never })
  expect(runDiagnostics(e).find((x) => x.checkId === 'latency_outlier')?.severity).toBe('warn')
})
it('repeated_assistant_message: consecutive assistant messages with trigram similarity > 0.85 (deflection-loop class)', () => {
  const m = (id: string, content: string) => ({ id, role: 'assistant', content, toolCalls: null, toolResults: null, createdAt: 'x' })
  const e = makeExport({ messages: [m('1', 'Vrei să îți explic pachetul Standard sau Optim?'), m('2', 'Vrei să îți explic pachetul Standard sau Optim?')] as never })
  expect(runDiagnostics(e).some((x) => x.checkId === 'repeated_assistant_message')).toBe(true)
})
it('ended_pre_closing: conversation inactive while phase is pre-PAYMENT is INFO', () => {
  const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'APPLICATION' }) })] as never })
  expect(runDiagnostics(e).find((x) => x.checkId === 'ended_pre_closing')?.severity).toBe('info')
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/diagnostics/checks-behavioral.test.ts`
- [ ] Step 3: Implement in lib/diagnostics/checks-behavioral.ts. Pinned predicates: briefing_tool_not_exposed — `prompt.briefingRecommendedActions` minus the turn_start available set, severity error (proven check class: hit 9/9 conversations in the removed prototype's live batch run); funnel_stalled — sliding window of >=4 consecutive ended turns with identical turnPhase AND no ledger row in that messageIndex range, severity warn, evidence {fromTurn, toTurn, phase}; state_snapshot_inconsistent — phase/predicate mismatches per the #10 derivation table (QUOTE requires state.quote, PAYMENT requires state.schedule, POLICY requires state.policy, APPLICATION requires state.application), severity error; latency_outlier — totals.latencyMs > 30000, warn; repeated_assistant_message — trigram-set Jaccard similarity of consecutive assistant messages > 0.85 (helper `trigramSimilarity(a, b)` exported for reuse), warn; ended_pre_closing — last turn's phase ∈ {DISCOVERY, APPLICATION, QUOTE}, info (the batch mode interprets it on conversations inactive past the --since window).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/diagnostics`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(diagnostics): behavioral v1 checks incl. briefing-exposure + deflection-loop detectors (F4.2)"`

### Task F4.3: v2 envelope/legality checks — blocked_action_attempted, missing_consequences, recompute_drift
**Files:**
- Create: lib/diagnostics/checks-envelope.ts
- Modify: lib/diagnostics/index.ts (catalog += envelope checks)
- Test: __tests__/lib/diagnostics/checks-envelope.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test:
```ts
// __tests__/lib/diagnostics/checks-envelope.test.ts — excerpts
it('blocked_action_attempted: an applied ledger commit whose tool was blocked at turn start', () => {
  const e = makeExport({
    turns: [turn(0, { legality: legality({ phase: 'QUOTE' }, { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' }] }) })] as never,
    ledger: [{ id: 'l1', tool: 'accept_quote', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'QUOTE', phaseTo: 'PAYMENT', idempotencyDisposition: 'fresh', targetRef: 'q1', createdAt: 'x' }] as never,
  })
  expect(runDiagnostics(e).find((x) => x.checkId === 'blocked_action_attempted')).toMatchObject({ severity: 'error', evidence: { tool: 'accept_quote', reason: 'requires_disclosures' } })
})
it('missing_consequences: a successful writing tool call with no ledger row in its turn', () => {
  const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }] })] as never, ledger: [] })
  expect(runDiagnostics(e).find((x) => x.checkId === 'missing_consequences')).toMatchObject({ severity: 'error', evidence: { tool: 'sign_dnt' } })
})
it('recompute_drift: same-engine-version recomputation disagrees with the stored derivation', () => {
  const drifting = () => ({ state: { phase: 'APPLICATION' }, actions: { available: [], blocked: [] } })
  const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'QUOTE', quote: {} }) })] as never })
  const f = runDiagnostics(e, undefined, { derive: drifting as never, currentEngineVersion: '3.0.0' })
  expect(f.find((x) => x.checkId === 'recompute_drift')?.severity).toBe('error')
})
```
- [ ] Step 2: Run, expect FAIL: `npx vitest run __tests__/lib/diagnostics/checks-envelope.test.ts`
- [ ] Step 3: Implement: blocked_action_attempted joins ledger rows to their turn's turn_start blocked list (match by tool name; severity error, evidence {tool, reason}); missing_consequences flags partition==='writing' calls with result.success and no same-turn ledger row for that tool; recompute_drift wraps lib/debug/recompute-diff.recomputeAndDiff and maps every kind==='same_version_drift' diff to an error finding (cross_version_change -> info). Extend `runDiagnostics(e, catalog?, opts?: { derive?; currentEngineVersion? })` to thread the recompute options (defaults: real deriveAndExpose + ENGINE_VERSION).
- [ ] Step 4: Run tests, expect PASS: `npx vitest run __tests__/lib/diagnostics`
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(diagnostics): v2 envelope/legality checks incl. recompute drift (F4.3)"`

### Task F4.4: diagnose-conversation CLI — single, batch, CI modes
**Files:**
- Create: scripts/diagnose-conversation.ts
- Modify: package.json (scripts += "diagnose": "tsx scripts/diagnose-conversation.ts")
- Test: __tests__/lib/diagnostics/report-format.test.ts (the pure formatter)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing test for the pure report formatter (the CLI stays a thin shell):
```ts
// __tests__/lib/diagnostics/report-format.test.ts
import { describe, it, expect } from 'vitest'
import { formatFindingsTable, summarize } from '@/lib/diagnostics/report'

const findings = [
  { checkId: 'tool_call_failed', severity: 'error' as const, turn: 2, evidence: { tool: 'sign_dnt' } },
  { checkId: 'latency_outlier', severity: 'warn' as const, turn: 5, evidence: { latencyMs: 31000 } },
]
it('renders a stable table and a severity summary', () => {
  const table = formatFindingsTable('c1', findings)
  expect(table).toContain('tool_call_failed')
  expect(table).toContain('turn 2')
  expect(summarize(findings)).toEqual({ error: 1, warn: 1, info: 0 })
})
```
- [ ] Step 2: Run, expect FAIL, then implement lib/diagnostics/report.ts (formatFindingsTable: fixed-width rows `severity | checkId | turn N | evidence JSON`; summarize: counts by severity) and the CLI:
```ts
// scripts/diagnose-conversation.ts
// Usage:
//   npx tsx scripts/diagnose-conversation.ts <conversationId> [--json]
//   npx tsx scripts/diagnose-conversation.ts --all --since=7   (batch triage over conversations active in the last 7 days)
//   npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims [--json]   (CI mode over exported sim JSON files — no DB)
// Single/batch load via loadConversationExport(id) (real DB); --dir reads ConversationExport files from disk.
// Output: per-conversation findings table + final summary; --json prints the raw findings array.
// Exit code: 1 iff any finding has severity 'error' (the CI gate), else 0.
import 'dotenv/config'
import fs from 'node:fs'
import { prisma } from '@/lib/db'
import { loadConversationExport } from '@/lib/debug/load-export'
import { runDiagnostics } from '@/lib/diagnostics'
import { formatFindingsTable, summarize } from '@/lib/diagnostics/report'
// argument parsing + the three modes, ~80 lines, no business logic — all decisions live in lib/diagnostics
```
- [ ] Step 3: Run tests, expect PASS: `npx vitest run __tests__/lib/diagnostics/report-format.test.ts`
- [ ] Step 4: Runtime check (dev DB): `npx tsx scripts/diagnose-conversation.ts --all --since=7` — runs over recent conversations, prints tables, exits per the gate; and CI mode over the F1 sims: `npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims`.
- [ ] Step 5: Commit: `git add -A && git commit -m "feat(diagnostics): diagnose-conversation CLI — single/batch/CI modes (F4.4)"`

### Task F4.5: /diagnose-conversation skill + debugging runbook
**Files:**
- Create: .claude/skills/diagnose-conversation/SKILL.md
- Create: docs/debugging-conversations.md
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write SKILL.md with this exact procedure (T14.D6 layer 2): (1) run `npx tsx scripts/diagnose-conversation.ts <id> --json` and treat its findings as ground truth — NEVER diagnose from conversation prose (verify-from-source discipline: query the DB and read recorded state first); (2) for each flagged turn pull the raw TurnDebug payload + ledger rows + legality snapshots and the relevant DB rows; (3) root-cause into the codebase, classifying as prompt-content / engine-rule / handler-bug / tool-exposure / data-seed / llm-behavior; (4) write the report to docs/debug-reports/<date>-<conversationId>.md with sections What happened / Where (file:line) / Why / Concrete fix / Prevention; (5) RATCHET RULE (mandatory exit criterion): if the investigation surfaced an issue class the checker missed, add a new deterministic check to lib/diagnostics/ TEST-FIRST before closing — the catalog only grows.
- [ ] Step 2: Write docs/debugging-conversations.md — the three-level stack: debug drawer (live, per-turn legality chips + anomaly badges + recompute button), checker CLI (deterministic, single/batch/CI), /diagnose-conversation skill (root-cause report); the evidence rule ("never diagnose from conversation prose; recorded state is the evidence"); where artifacts live (TurnDebug, CommitLedger, artifacts/sims, docs/debug-reports); the flake policy and n-of-m conventions; how recompute-and-diff distinguishes bug (same version) from changelog (cross version).
- [ ] Step 3: Verify the skill invokes cleanly: run `/diagnose-conversation <a-dev-conversation-id>` in a Claude Code session; it must execute the CLI, pull raw rows for at least one finding, and produce docs/debug-reports/<date>-<id>.md.
- [ ] Step 4: Commit: `git add -A && git commit -m "docs(diagnostics): diagnose-conversation skill + debugging runbook (F4.5)"`

### Task F4.6: Package verification
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx vitest run __tests__/lib/diagnostics` — all check unit tests green.
- [ ] Step 2: `npm test` — full suite green (flake policy).
- [ ] Step 3: Live batch run: `npx tsx scripts/diagnose-conversation.ts --all --since=14` over the dev DB — completes, findings plausible; spot-verify ONE finding from source (open the TurnDebug payload and confirm the evidence — verify-from-source).
- [ ] Step 4: CI mode over sims: `npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims` — exit 0 expected on the recorded green runs.
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(diagnostics): F4 verification — catalog green, live batch + CI modes proven"`


### ⚠ Binding errata for F4 (fidelity verifier — apply OVER the task text above)

1. **[F4.2 — briefing_tool_not_exposed check (lib/diagnostics/checks-behavioral.ts)]** The check reads `t.prompt.briefingRecommendedActions`, a field defined nowhere: DebugPromptPayload (lib/chat/debug.ts:51-61) has no such field, no Block F task adds it, and F2.4 only consumes briefing actions transiently at turn end (into InvariantInput) without persisting them on the turn's prompt payload. On real exports the check would never fire — the unit test only passes because the literal stuffs the field in.
   **Fix:** In F2.2 or F2.4, extend DebugPromptPayload with `briefingRecommendedActions: string[]` (sourced from Block E's machine-readable briefing at prompt build) so it persists through reducer→TurnDebug→export, and cite it as a Block E dependency; alternatively have the diagnostics check consume the persisted F2.4 anomaly ('briefing_action_not_exposed' in totals.anomalies) instead of recomputing from the prompt.
2. **[F4.3 — runDiagnostics default recompute options vs F4.1/F4.2 tests]** F4.3 extends runDiagnostics with defaults 'real deriveAndExpose + ENGINE_VERSION'. Every F4.1/F4.2 test that includes legality entries fabricates garbage snapshots ({} / {marker:'snap'}) with engineVersion '3.0.0' (likely equal to the real ENGINE_VERSION) — once F4.3 lands, those earlier tests invoke the REAL deriveAndExpose on invalid DomainSnapshots, which will throw (crashing the whole runDiagnostics call and failing unrelated assertions) or emit spurious same_version_drift findings (breaking 'a clean conversation yields zero findings' for any future test with legality entries).
   **Fix:** Make recompute_drift opt-in: run it only when opts.derive (or an explicit { recompute: true }) is provided — the CLI and F4.3's test pass it, F4.1/F4.2 tests don't; or wrap the derive call in try/catch mapping failure to an explicit 'recompute_failed' info finding and revisit the F4.1/F4.2 literals to use distinct engineVersion strings ('test-x') so default recompute classifies them cross_version (info), never error.
3. **[F2.2/F2.5/F4.3 — commitLedgerId provenance and the ledger↔turn join]** The pinned CommitResult has no ledger-row id field and the pinned CommitLedger row has no traceId/messageIndex, yet: F2.2 records `commitLedgerId` on post_commit legality entries 'from the gateway result'; F2.5's assertEveryCommitHasLedgerRow and F4.3's blocked_action_attempted/missing_consequences join ledger rows to turns 'by tool within the turn' — a join the pinned data cannot express deterministically (tool name is ambiguous across turns; createdAt-vs-startedAt windows are unspecified).
   **Fix:** Pin the mechanism explicitly: state in F2.2 that the gateway's return surface must expose the written ledger row id alongside CommitResult (coordinate with Block A; mark as NEW if absent), then make F2.5/F4.3 join exclusively via the post_commit legality entries' commitLedgerId (turn → legality[post_commit].commitLedgerId → ledger row), falling back to tool-name-within-conversation only for pre-F2 history. Update the F2.5/F4.3 test literals to carry the linking ids.
4. **[F1.9 Step 3 (run-spec-sims.ts), F4.4 Step 2 (diagnose-conversation.ts) + F4.4 Files list, F2.5 Step 1 test snippet]** Placeholder-rule violations: run-spec-sims.ts's 'implementation' code block is comments only ('skeleton of the real implementation') — no actual trial loop, pickAnswer reuse, SSE drain, export load, assert dispatch, or --record logic; F4.4's CLI body is likewise a comment block ('argument parsing + the three modes, ~80 lines'); F4.4's Files section omits Create: lib/diagnostics/report.ts although the test imports '@/lib/diagnostics/report' and Step 2 implements it; F2.5's added export test calls a `meta()` helper defined nowhere (the existing suite uses a CONVO literal).
   **Fix:** Provide real TypeScript for the load-bearing parts: run-spec-sims main loop (per-trial customer+conversation creation, opening-script drive via handleChatTurn + drain, pickAnswer regex hook imported/adapted from scripts/verify-advance-flow.ts, loadConversationExport call, assert-name→function dispatch table, n-of-m tally, --record copy) and the diagnose CLI's argv handling + three mode branches. Add 'Create: lib/diagnostics/report.ts' to F4.4 Files. In F2.5's test, replace meta() with the existing CONVO constant or define the helper inline.

## Package F5: Final validation: full gauntlet over the finished system

**Execution slot:** 26 | **Depends on:** F4

**Goal:** Prove the whole transformation end to end with evidence, never assertions: full unit suite green; live scripted sims meet n-of-m; the four pathology scripts stay green (M13 acceptance criterion d); the gherkin coverage report is published with a committed backlog baseline and a monotonic-decrease guard; one full happy-path live sim runs discovery -> policy on the new engine with the assertion library and DB checks green; and the triage batch over all sim conversations reports zero error-severity findings.

### Task F5.1: Full unit + meta suite
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npm test` — green. Known-flake policy: __tests__/lib/events/instrumentation.test.ts may flake (~1/3, timing/cache race); a run counts as PASS iff it is the ONLY failure AND `npx vitest run __tests__/lib/events/instrumentation.test.ts` passes in isolation. Any other failure blocks.
- [ ] Step 2: Commit-ring with the test DB: `$env:TEST_DATABASE_URL='<test-db-url>'; npx vitest run __tests__/spec` — green.
- [ ] Step 3: Record the outcome (counts, duration) in the final PR/commit description — evidence before assertions.

### Task F5.2: Live scripted sims (n-of-m) + e2e scenarios
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npm run sims:spec -- 3 2` — every scenario passes >=2/3 trials; exports land in artifacts/sims/.
- [ ] Step 2: `npm run test:e2e` against a running dev server (`npm run dev` on :3001 per vitest.e2e.config.ts) — the five legacy e2e scenarios pass on the new engine; failures here are real regressions, not test debt.
- [ ] Step 3: Judge trends (non-gating, informational): `npm run sims:judge` — verdicts written to artifacts/judge/; record the pass ratio.

### Task F5.3: Pathology scripts 1-4 (M13 criterion d)
**Files:**
- Modify: none (verification only)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: `npx tsx scripts/verify-pathology1.ts` — PASS per its built-in verdict.
- [ ] Step 2: `npx tsx scripts/verify-pathology2.ts 3` — no DEFLECT loop; ADVANCE turns present.
- [ ] Step 3: `npx tsx scripts/verify-pathology3.ts` and `npx tsx scripts/verify-pathology4.ts` — PASS.
- [ ] Step 4: If any pathology regressed: stop, run /diagnose-conversation on the failing conversation id, root-cause per the skill (the sections rework had M13 acceptance criteria; a regression here means dropped prompt content — check the old-section -> new-section mapping notes), fix in the owning block's surface, re-run.

### Task F5.4: Gherkin coverage report + committed backlog baseline with monotonic guard
**Files:**
- Create: docs/spec-coverage-baseline.json (committed snapshot: {scenarios, covered, backlog: {count, ids}})
- Test: __tests__/spec/backlog-ratchet.meta.test.ts
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Write the failing ratchet test:
```ts
// __tests__/spec/backlog-ratchet.meta.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'

describe('@backlog ratchet (T12 risk: backlog must not become a permanent escape hatch)', () => {
  it('current backlog count <= committed baseline (decrease the baseline when you translate, never silently grow it)', () => {
    const parsed = parseWorkflowFeature(fs.readFileSync(
      path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
    const current = parsed.scenarios.filter((s) => s.tags.includes('@backlog')).length
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs/spec-coverage-baseline.json'), 'utf8'))
    expect(current).toBeLessThanOrEqual(baseline.backlog.count)
  })
})
```
- [ ] Step 2: Run, expect FAIL (baseline file missing): `npx vitest run __tests__/spec/backlog-ratchet.meta.test.ts`
- [ ] Step 3: Generate and commit the baseline: `npx vitest run __tests__/spec/traceability.meta.test.ts` then `cp artifacts/spec-coverage.json docs/spec-coverage-baseline.json` (trim to scenarios/covered/backlog fields). Re-run the ratchet test — PASS.
- [ ] Step 4: Publish the numbers in the final summary: scenarios=61, cases=68, covered, backlog count + ids, judge=6 — the backlog list is the explicit, reviewed residue, not silent debt.
- [ ] Step 5: Commit: `git add -A && git commit -m "test(spec): backlog ratchet — committed baseline, monotonic decrease enforced (F5.4)"`

### Task F5.5: Full happy-path live sim discovery -> policy + triage batch with zero errors
**Files:**
- Modify: scripts/sims/spec-scenarios.ts (extend the happy-path scenario through payment + policy if F1.9 stopped at quote: answerPolicy drives accept_quote confirmation, mock-provider payment, policy PENDING_SUBMISSION verification)
**Steps (checkboxes, bite-sized, TDD):**
- [ ] Step 1: Extend the happy-path scenario asserts: phaseTimeline ends ['...','QUOTE','PAYMENT','POLICY']-compatible (POLICY reached via the mock payment provider's first successful payment creating Policy PENDING_SUBMISSION per contradiction #5); DB checks after the run: Application completed, Quote accepted, PaymentSchedule settled first installment, Policy PENDING_SUBMISSION, ledger contains accept_quote with effects ['advance_phase'].
- [ ] Step 2: Run it live: `npm run sims:spec -- 3 2` — happy-path reaches POLICY in >=2/3 trials. On failure: this is exactly the deadlock-class signal only live sims catch (advance-flow precedent) — diagnose with the skill, fix in the owning block, re-run.
- [ ] Step 3: Triage batch over ALL sim conversations: `npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims` — exit 0, ZERO error-severity findings. Any error finding blocks sign-off: root-cause via /diagnose-conversation, fix, apply the ratchet rule if the checker missed a class, re-run F5.2 -> F5.5.
- [ ] Step 4: Final full sweep in one sitting and record outputs: `npm test` && `$env:TEST_DATABASE_URL='<url>'; npx vitest run __tests__/spec` && `npm run sims:spec` && `npx tsx scripts/verify-pathology1.ts` (2,3,4) && `npx tsx scripts/diagnose-conversation.ts --dir=artifacts/sims`.
- [ ] Step 5: Commit: `git add -A && git commit -m "chore(release): F5 final validation — suite, sims n-of-m, pathologies, coverage baseline, zero-error triage"`


### ⚠ Binding errata for F5 (fidelity verifier — apply OVER the task text above)

1. **[F5.2 Step 2 — npm run test:e2e ('failures here are real regressions, not test debt')]** Verified: e2e/lib/db-verifier.ts:60-77 asserts Conversation.status === 'COMPLETED', and the harness asserts other pre-transformation shapes. Binding contradiction #11 retires COMPLETED (enum becomes ACTIVE|ARCHIVED; nothing in the funnel sets conversation status), so the five legacy e2e scenarios MUST fail on the new engine for spec-compliant reasons. No Block F task (nor any cited other-block artifact) migrates e2e/lib/* to the final shapes, making F5.2 Step 2 unexecutable as written.
   **Fix:** Either add a task (in F1.9's scope, where the sim harness is consolidated, or as F5.2a) migrating e2e/lib/db-verifier.ts + scenarios to the final shapes (Conversation stays ACTIVE; completion asserted via domain events per #11 rule 3 — Quote accepted, Policy PENDING_SUBMISSION, ledger rows; new phase vocabulary), or drop the legacy e2e gate from F5.2 and rely on the spec sims + recorded suite, recording the e2e retirement explicitly.

---

# Appendix 1 — Coverage-critic report (how the structural fixes map)

All 16 coverage gaps are closed by the addendum tasks above; the 11 ordering problems by the execution-order table + ownership rulings; the 9 cross-block inconsistencies by rulings 6–7 in "How to execute". Original findings, for traceability:

## Coverage gaps → owners
- G1: T13.D8 (ratified): retirement of get_current_state and get_application_status (inject compact DerivedState instead) is unowned by any package; the fact-check correction also requires the flagsForReview surface to survive into DerivedStateV3/openItems, which no package claims (closest owners: A1/A3).
- G2: T13.D1 (ratified) questionnaire tool surface: no package registers write_question_answer or modify_answer (or renames save_application_answer); B4's action-adapter bullet explicitly KEEPS save_application_answer, contradicting the ratified per-domain split. The standalone get_next_question read (T13 Table 2 new-build, carrier of T6.D4 branching_metadata) is also unowned — C1 owns the write-path machinery but never names the tool surface.
- G3: check_bd_eligibility elimination (T6.D5 / T13.D7, ratified): no retire bullet in C1 (which absorbs its rule via ELIGIBILITY edges) or anywhere else; B4 retires set_answer/change_selection/switch_product only.
- G4: set_candidate_product reshape (T13 Table 1 #6: drop confidence param, add addon_ids[]) — unowned.
- G5: profile_extractor + summarizer dead-stub elimination (T13 Table 1 #30/#31) — A5's 'phantom seed tools' covers seed-granted unregistered tools, not these two registered stubs; unowned as written.
- G6: T4-R6 / contradiction #1: the soft channel-verification offer at set_application ('save your progress') is a logged behavior with no owner — B4 (set_application) and B3 (verification) both omit it.
- G7: Contradiction #1 new build item — the per-commit identity-requirements table itself (rows: generate_quote -> declared + CNP-or-DOB; accept_quote -> verified_channel; initiate_payment -> verified_channel + product docs; earlier commits -> anonymous/declared): appears only in B3's TITLE; B3's migrations carry only Product.verificationRequirements (document requirements). The tier-rows artifact has no concrete migration/module owner, yet A3 consumes the mechanism, D2 depends on it ('B-identity'), and E3 adds rows to 'B's table'. Must be made explicit in B3.
- G8: M10.3/M10.4: degraded-mode exposure (circuit-breaker state as deriveAndExpose input, blocked_actions reason temporarily_unavailable, escalate_to_human as always-exposed floor) and the reads-may-retry/commits-never executor policy are not claimed by A1/A2/A3 — A2 only maps circuit/timeout to the 'unavailable' outcome.
- G9: T12.D3 binding seam: the real-test-DB harness does not exist today (verified — no __tests__/**/test-db.ts anywhere; existing integration tests are mocked-prisma), yet A2, B1, B2, B3 all reference adding tables to its truncate list as if it exists, at two different paths. No package owns CREATING the truncate+seed test-DB helper.
- G10: M1.4 documentation rule: 'the 2026-05-29 SSOT spec is AMENDED with the provenance model — no second spec' — unowned; F3 only covers zeno_workflow.feature + zeno_tool_catalog.md.
- G11: M5: WorkItemKind ALERT_FLAG has no producer in any package; and M5.3's reject-path 'customer notified via M2 machinery' — E2 invokes an 'outbound notifier' but the M2 outbound machinery is E4, which depends on E2; the notifier primitive E2 consumes is unowned.
- G12: M4 / T4-R3 identity renderers: show_document_upload uiAction and the in-chat OTP entry surface are assigned to the identity package by M4 but B3 never claims them (it only registers request_document_upload / start+confirm_channel_verification).
- G13: collect_customer_field (kept per T13.D4): re-pointing it through the B0 CustomerProfile service and removing its isAnonymous=false flip (identity tier is DERIVED, never stored — T4-R2) is unowned; B0 retires update_customer_profile only.
- G14: M6 rule 1 GUI leg: rendering ReasonCodes via translations.ts keys-per-code is not claimed (A3 covers blocked affordances with engine reason but not the translation-key layer). Minor.
- G15: F3 fold-back checklist omissions: critic notes #10 (Stripe-only framing vs three live providers), #11 (finished-but-unsigned DNT session amendability — substantively resolved by the #7 six-tool surface but the .feature line isn't in the checklist), #12 (resume_application R/C typing ambiguity) are not in F3's 11-item list, though the 'Spec doc fixes to fold back' section directs amending all 12 critic findings. Minor.
- G16: T3.D5 residue: withdraw_consent marking the signed Dnt WITHDRAWN — B1 builds withdraw_consent before Dnt exists (B2 adds DntStatus.WITHDRAWN); the linkage task is unowned. Minor.

## Ordering problems
- O1: CYCLE B4 <-> C1: B4.depends_on includes C1 and C1.depends_on includes B4. Compounded by contradictory Answer migrations: C1 creates a partial unique on (questionId, conversationId) WHERE status='ACTIVE' while B4 drops Answer.conversationId and re-keys to (questionId, applicationId) — whichever lands second invalidates the other's migration. Resolve by picking one direction (likely B4 re-key first, C1's active-unique keyed on applicationId) and rewriting C1's migration bullets accordingly.
- O2: CYCLE D1 <-> E2: D1 depends on E2 (WorkItem model + createWorkItem) while E2 depends on D1 (referred-outcome wiring). Split E2 so the WorkItem model/interface lands before D1; the referral wiring either stays in E2 without the D1 edge or moves into D1.
- O3: CYCLE C3 -> D2 -> D1 -> C3: C3 needs D2's Document registry for the suitability report; D1 needs C3's evaluateSuitability for the generate_quote gate; D2 needs D1. Fix: C3 drops the D2 dependency and owns only the pure engine + verdict + SuitabilityWarningAck; report-generation-at-issuance moves to the registry side (D4 already claims it — see double-claim).
- O4: CYCLE B3 -> E2 -> D1 -> C3 -> D2 -> B3 (D2's 'B-identity' dependency is B3; B3 depends on E2 for document_review WorkItems and on C1 for mutation events). Together with the other cycles, packages B3/B4/C1/C3/D1/D2/E2 form a mutually-unbuildable knot as declared — the graph is NOT acyclic and needs explicit untangling (model-before-wiring splits).
- O5: Consent-truth flip split across TWO packages violates M9's binding 'coupled flips land in ONE package' and contradiction #2's 'switched in the SAME coordinated change as the sign_dnt fold': A2 creates ConsentEvent and drops Customer.gdprConsentAt/gdprConsentScope/aiDisclosureAcknowledgedAt, while the sign_dnt capture fold + retirement of record_gdpr_consent/acknowledge_ai_disclosure land later in B1 — leaving a window with the old capture tools writing dropped columns (or no capture path at all). The flip belongs wholly in B1 (or A2 must absorb the fold).
- O6: Stale-file edits sequenced after their deletion with no ordering edges: B1 and B4 instruct removing tools from lib/chat/default-tools.ts, which A3 deletes; B1/B2/B4 instruct updating prisma/seeds/seed-skill-packs.ts and D1 instructs editing prisma/seeds/seed-workflows.ts, both deleted by A5. B1/B2/B4 depend only on A1/A2 (not A3/A5), so these edits race the deletions; given A5 is late-Block-A and B–D follow, the bullets are dead-on-arrival. Either add explicit depends_on/ordering or drop the bullets.
- O7: A5's mandatory salvage audit (M12) ports still-true pack guidance into phase sections AND versioned ProductContent, but ProductContent only exists after E1 and there is no A5->E1 handoff or edge — salvaged selling content has no destination when A5 executes.
- O8: E4's open-item kind 'policy in PENDING_SUBMISSION/SUBMITTED' must emit a nextAction mapping to a currently-exposed tool; the policy read surface (get_policy_info) lands in D4, but E4 has no D4 dependency.
- O9: E2 depends_on E1 with no consumed E1 artifact — a spurious edge that needlessly tightens the graph and (via the E2->D1 reverse edge) participates in the cycles.
- O10: F1 builds the shared ConversationExport assertion library before F2 versions the contract to schemaVersion 2 (F2 depends on F1); F4 then asserts over v2 — the retrofit direction should be acknowledged or the contract-versioning pin (M8 pin 2) pulled into F1. Minor.
- O11: Binding rules otherwise satisfied: A1 atomic and first (no deps); B0 early (A1 only) and correctly blocking B2/B3/B4; policy-creation flip + conversation-status change correctly welded into the single D2 package (incl. narrow accept per contradiction #11's 'lands together' rule); dead-config cleanup A5 after A3/A4; F4 last among build items with F5 (validation-only) after it.

## Cross-block inconsistencies
- X1: ConsentEvent is defined by TWO packages with different shapes: A2 (kind/action as String, plus an @@index and relation) and B1 (ConsentKind/ConsentAction enums, append-only). Both also drop the same three Customer consent columns and both add ConsentEvent to a test-db truncate list. One owner required (per M9 this is B1, with A2 consuming the pinned ConsentEvent contract).
- X2: ApplicationStatus ownership confusion: B4's migrations own the enum with the exact T5.D6 set (OPEN/PAUSED/REFERRED/COMPLETED/CANCELLED); D1 says 'coordinate with Block C's T5.D6 status set' (wrong block); E2 says 'Depends on C1's ApplicationStatus extension (REFERRED, DECLINED in the T5.D6 set)' — wrong owner (B4, not C1) AND invents DECLINED, which is not in the ratified set. E2's reject path ('terminates the application with the underwriter reason') therefore has no defined terminal status — must be reconciled with B4's enum.
- X3: Suitability report at quote issuance is claimed by BOTH C3 ('generated at quote issuance ... via D2's Document registry') and D4 ('retimed to quote issuance and stored in the Document registry'); one owner needed (resolving this also breaks the C3->D2 cycle).
- X4: Answer aggregate end-state contradiction: C1's migration keys the active-revision partial unique on (questionId, conversationId) while B4's migration drops conversationId and keys @@unique([questionId, applicationId]) — same artifact, incompatible shapes, claimed by two packages that also depend on each other.
- X5: depends_on referencing style is inconsistent and ambiguous: D2 names 'B-identity' instead of B3; D1/D2/D4 use prose-annotated dependencies while A/B/C/E/F use bare package ids — the orchestrator cannot mechanically resolve 'B-identity'.
- X6: DEFAULT_DISCOVERY_TOOLS has two fates: A3 deletes lib/chat/default-tools.ts outright, while B1 and B4 still instruct removing individual tools 'from DEFAULT_DISCOVERY_TOOLS' as if the file survives.
- X7: Pinned tool-surface naming used inconsistently: B4 keeps save_application_answer in the action-adapter while the ratified T13.D1/Table-2 vocabulary is write_question_answer/modify_answer; similarly B2 correctly uses the pinned #7 names (open_dnt_session/write_dnt_answer) but no package reconciles the questionnaire side.
- X8: Test-DB helper path mismatch: A2 cites __tests__/integration/helpers/test-db.ts, B1 cites __tests__/helpers/test-db.ts, B2/B3 cite 'test-db TABLES' — the file does not exist in the repo at either path (verified), so the packages disagree about the path of an artifact none of them creates.
- X9: Minor citation drift: B1 cites lib/tools/registry.ts:1042-1117 for the consent-tool registrations; actual registerTool calls are at lines 1091 and 1109 (verified) — line-anchored bullets should be re-verified at task-writing time.

## Critic notes

Method: read the entire Resolved-decisions log (lines 2021-2318), every T1-T13 decision-point section (the log ratified all ✅ recommendations, so non-overridden ones are binding), the T13 tool tables + fact-check corrections, the suggested-order/spec-fixes sections, and spot-checked file claims against the worktree (no test-db helper exists; default-tools.ts and seed-skill-packs.ts/seed-workflows.ts exist and are slated for deletion by A3/A5; registry consent-tool line numbers drifted). Headline finding: the dependency graph is NOT acyclic — four interlocking cycles knot B3/B4/C1/C3/D1/D2/E2; the standard fix is model-before-wiring splits (WorkItem model before D1; B4 Answer re-key before C1; suitability-report generation moved out of C3; D2's 'B-identity' need reduced to the requirements-table artifact). Second headline: the consent-truth flip is split across A2 and B1, violating the binding one-package coupled-flip rule (the policy-creation and conversation-status flips are correctly atomic in D2). Coverage is otherwise strong: all 12 contradictions, T14, M1-M13 dispositions, the M9 new-table/enum inventory, and the F3 amendment checklist map cleanly; the gaps listed are mostly ratified-but-unplaced tool dispositions (T13.D1/D8, check_bd_eligibility, set_candidate_product reshape), the identity-requirements rows artifact, degraded-mode exposure (M10.4), and the unowned real-test-DB harness that the binding T12.D3 seam presupposes.
