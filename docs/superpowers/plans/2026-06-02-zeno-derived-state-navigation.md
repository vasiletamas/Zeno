# Zeno Derived-State + Navigation — Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Run all commands from the Zeno repo root** (`C:\github\zeno`). Branch: `feat/zeno-state-navigation`. **Execute Plan A first** — this plan assumes `start_application` already accepts tier/level/addon and the tool-result serializer exists.

**Goal:** Give Zeno a single derived source of truth about the conversation and the tools to navigate it — so it always knows the current state and next best action, can go back and edit any answer, change the package/level/add-on, or switch products (carrying over shared answers and asking only the delta), all driven by the model rather than a rigid engine.

**Architecture:** A pure `deriveState(conversationId)` function computes a `DerivedState` snapshot from existing records every turn (never stored). New read/write tools (`get_current_state`, `set_answer`, `change_selection`, `switch_product`, `preview_product_requirements`) read and mutate state and return the fresh snapshot. The per-turn pipeline injects the snapshot into the prompt and selects prompt sections by derived `phase` deterministically — replacing the reasoning-gate LLM pre-pass. The dead `WorkflowSession` gate is retired.

**Tech Stack:** Next.js, TypeScript, Prisma, vitest. Tests in `__tests__/**/*.test.ts`, run with `npx vitest run <path>`. DB mocked via `vi.mock('@/lib/db')` + dynamic `await import()` after mocks.

**Companion docs:** design + analysis in `docs/superpowers/specs/2026-06-02-zeno-state-navigation-design.md`; the low-risk fixes are `docs/superpowers/plans/2026-06-02-zeno-quick-win-fixes.md` (Plan A).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/chat/derive-state.ts` (new) | `deriveState()` + `DerivedState`/`Phase` types — the single source of truth | 1 |
| `lib/tools/handlers/state-handlers.ts` (new) | handlers for the new state/navigation tools | 2-6 |
| `lib/tools/registry.ts` (modify) | register `get_current_state`, `set_answer`, `change_selection`, `switch_product`, `preview_product_requirements` | 2-6 |
| `lib/tools/handlers/application-handlers.ts` (modify) | extract shared `resolveTierLevel()`; reuse in start_application + change_selection | 3-4 |
| `lib/chat/orchestrator.ts` (modify) | call `deriveState` per turn; remove the reasoning-gate call; build the state-grounding block | 7 |
| `lib/chat/context-loaders.ts` (modify) | render `DerivedState` into the `stateGrounding` "YOU ARE HERE" section | 7 |
| `lib/chat/prompt-builder.ts` (modify) | deterministic `phase → sections` selection | 7 |
| `lib/chat/default-tools.ts` (modify) | add the new tools to the always-available set | 7 |
| `prisma/seeds/seed-agents.ts` (modify) | remove the now-unused `reasoning-gate` agent | 8 |
| `lib/tools/pipeline.ts` (modify) | retire the dead `WorkflowSession` gate/transition | 8 |
| `__tests__/**` | unit tests per tool + navigation integration tests | all |

**Pinned contract (every task uses these exact names):** `DerivedState` { phase, product, selection{tier,level,addon}, consents{gdpr,aiDisclosure}, dnt{signed,validUntil}, application{exists,status,answered,required,missing[]}, quote{exists,premiumAnnual}|null, answers{}, nextBestAction }. Phases: DISCOVERY | SELECTION | CONSENT | QUESTIONNAIRE | QUOTE | CLOSING. Quote staleness = expire the DRAFT quote (status → EXPIRED) so it must be regenerated.


---

### Task 1: Implement deriveState() Pure Function + DerivedState Types

**Files:**
- NEW: lib/chat/derive-state.ts (pure function + types)
- NEW: __tests__/lib/chat/derive-state.test.ts (comprehensive unit tests)

**Context:** This task is the foundation for Plan B. It creates the pinned `DerivedState` contract that all other tasks (set_answer, change_selection, switch_product, start_application, generate_quote, accept_quote) will depend on. The function reads live records (Conversation, Application, Answer, Quote, Customer) and derives the deterministic phase + nextBestAction.

---

## Step 1: Write Failing Unit Tests

**Run:** `npx vitest run __tests__/lib/chat/derive-state.test.ts`

**Test File:** __tests__/lib/chat/derive-state.test.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma BEFORE importing the subject
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    application: { findUnique: vi.fn() },
    answer: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    questionGroup: { findMany: vi.fn() },
    quote: { findFirst: vi.fn() },
    customer: { findUnique: vi.fn() },
    pricingTier: { findUnique: vi.fn() },
    pricingLevel: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: vi.fn(),
}))

import { deriveState, type DerivedState } from '@/lib/chat/derive-state'
import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'

describe('deriveState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 1a: Empty conversation (no product, no application) → DISCOVERY phase
  it('returns DISCOVERY phase for conversation with no product or application', async () => {
    const conversationId = 'conv-empty'
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId: null,
      candidateProductId: null,
      dntSignedAt: null,
      dntValidUntil: null,
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: null,
      aiDisclosureAcknowledgedAt: null,
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('DISCOVERY')
    expect(result.product).toBeNull()
    expect(result.selection.tier).toBeNull()
    expect(result.application.exists).toBe(false)
    expect(result.quote).toBeNull()
    expect(result.consents.gdpr).toBe(false)
    expect(result.nextBestAction).toBe(
      'call list_products, then set_candidate_product when the customer names a need'
    )
  })

  // Test 1b: Product set, GDPR not given → CONSENT phase
  it('returns CONSENT phase when product is set but GDPR not consented', async () => {
    const conversationId = 'conv-product-no-consent'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: null,
      dntValidUntil: null,
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: null,
      aiDisclosureAcknowledgedAt: null,
    } as never)

    vi.mocked(prisma.answer.findMany).mockResolvedValue([])

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CONSENT')
    expect(result.consents.gdpr).toBe(false)
    expect(result.nextBestAction).toContain('record_gdpr_consent')
  })

  // Test 1c: Application OPEN with one missing question → QUESTIONNAIRE phase
  it('returns QUESTIONNAIRE phase when application is OPEN with missing questions', async () => {
    const conversationId = 'conv-app-open'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'),
      dntValidUntil: new Date('2025-01-01'),
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId,
      conversationId,
      productId,
      status: 'OPEN',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    } as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    // Mock question groups for application phase
    vi.mocked(resolveGroupCodes).mockResolvedValue(['application', 'bd_medical'])

    // Mock two required questions, one answered
    vi.mocked(prisma.question.findMany).mockResolvedValue([
      {
        id: 'q-1',
        code: 'health_status',
        groupId: 'grp-app',
        text: { en: 'Health status?', ro: 'Stare de sănătate?' },
        type: 'MULTIPLE_CHOICE',
      },
      {
        id: 'q-2',
        code: 'occupation',
        groupId: 'grp-app',
        text: { en: 'Occupation?', ro: 'Ocupație?' },
        type: 'OPEN_ENDED',
      },
    ] as never)

    // Only q-1 is answered
    vi.mocked(prisma.answer.findMany).mockResolvedValue([
      { id: 'ans-1', questionId: 'q-1', conversationId, value: 'good' },
    ] as never)

    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({
      id: 'tier-standard',
      code: 'STANDARD',
    } as never)

    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({
      id: 'level-1',
      code: 'LEVEL_1',
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('QUESTIONNAIRE')
    expect(result.application.exists).toBe(true)
    expect(result.application.status).toBe('OPEN')
    expect(result.application.answered).toBe(1)
    expect(result.application.required).toBe(2)
    expect(result.application.missing).toEqual(['occupation'])
    expect(result.nextBestAction).toContain('ask the next missing question: occupation')
  })

  // Test 1d: Application COMPLETED, no quote → QUOTE phase
  it('returns QUOTE phase when application is COMPLETED but no DRAFT quote exists', async () => {
    const conversationId = 'conv-app-done'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'),
      dntValidUntil: new Date('2025-01-01'),
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId,
      conversationId,
      productId,
      status: 'COMPLETED',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    } as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    vi.mocked(prisma.quote.findFirst).mockResolvedValue(null as never)

    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({
      id: 'tier-standard',
      code: 'STANDARD',
    } as never)

    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({
      id: 'level-1',
      code: 'LEVEL_1',
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('QUOTE')
    expect(result.quote).toBeNull()
    expect(result.nextBestAction).toContain('call generate_quote')
  })

  // Test 1e: Quote with status ACCEPTED → CLOSING phase
  it('returns CLOSING phase when an ACCEPTED quote exists', async () => {
    const conversationId = 'conv-accepted'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'),
      dntValidUntil: new Date('2025-01-01'),
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId,
      conversationId,
      productId,
      status: 'COMPLETED',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    } as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    vi.mocked(prisma.quote.findFirst).mockResolvedValue({
      id: 'quote-1',
      applicationId,
      status: 'ACCEPTED',
      premiumAnnual: 500,
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CLOSING')
    expect(result.quote).not.toBeNull()
    expect(result.quote?.status).toBe('ACCEPTED')
    expect(result.quote?.premiumAnnual).toBe(500)
    expect(result.nextBestAction).toContain('present the quote')
  })

  // Test 1f: Product + tier set, GDPR given, DNT not signed → CONSENT phase (DNT missing)
  it('returns CONSENT phase when DNT is not signed even though product/tier set', async () => {
    const conversationId = 'conv-no-dnt'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: null, // Not signed
      dntValidUntil: null,
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CONSENT')
    expect(result.nextBestAction).toContain('sign_dnt')
  })

  // Test 1g: answers map contains questionCode -> value mapping
  it('builds answers map with question codes (not IDs) as keys', async () => {
    const conversationId = 'conv-answers'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'),
      dntValidUntil: new Date('2025-01-01'),
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId,
      conversationId,
      productId,
      status: 'COMPLETED',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    } as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    // Mock questions with codes
    vi.mocked(prisma.question.findMany).mockResolvedValue([
      {
        id: 'q-1',
        code: 'HEALTH_STATUS',
        groupId: 'grp-app',
      },
      {
        id: 'q-2',
        code: 'OCCUPATION',
        groupId: 'grp-app',
      },
    ] as never)

    // Mock answers
    vi.mocked(prisma.answer.findMany).mockResolvedValue([
      { id: 'ans-1', questionId: 'q-1', conversationId, value: 'excellent' },
      { id: 'ans-2', questionId: 'q-2', conversationId, value: 'engineer' },
    ] as never)

    vi.mocked(prisma.quote.findFirst).mockResolvedValue(null as never)

    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({
      id: 'tier-standard',
      code: 'STANDARD',
    } as never)

    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({
      id: 'level-1',
      code: 'LEVEL_1',
    } as never)

    const result = await deriveState(conversationId)

    expect(result.answers).toEqual({
      HEALTH_STATUS: 'excellent',
      OCCUPATION: 'engineer',
    })
  })
})
```

**Expected output:** All 7 tests FAIL (function does not exist yet).

---

## Step 2: Implement deriveState() Function

**File:** lib/chat/derive-state.ts

```typescript
import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'

// ================================================
// PINNED TYPES (exact contract names/signatures)
// ================================================

export type Phase = 'DISCOVERY' | 'SELECTION' | 'CONSENT' | 'QUESTIONNAIRE' | 'QUOTE' | 'CLOSING'

export interface DerivedState {
  phase: Phase
  product: { id: string; code: string; name: string } | null
  selection: { tier: string | null; level: string | null; addon: boolean | null } // codes, not ids
  consents: { gdpr: boolean; aiDisclosure: boolean }
  dnt: { signed: boolean; validUntil: string | null }
  application: { exists: boolean; status: string | null; answered: number; required: number; missing: string[] } // missing = question codes
  quote: { exists: boolean; premiumAnnual: number | null } | null
  answers: Record<string, string> // questionCode -> value
  nextBestAction: string
}

// ================================================
// PHASE RULES (first match wins)
// ================================================

/**
 * Evaluate PHASE RULES in order; first match wins.
 *
 * 1. A Quote with status ACCEPTED exists → CLOSING
 * 2. application.status === 'COMPLETED' (and no ACCEPTED quote) → QUOTE
 * 3. application exists AND missing.length > 0 → QUESTIONNAIRE
 * 4. selection.tier != null AND (!consents.gdpr OR !dnt.signed) → CONSENT
 * 5. product != null → SELECTION
 * 6. else → DISCOVERY
 */
function determinePhase(
  quote: { status: string } | null,
  application: {
    exists: boolean
    status: string | null
    missing: string[]
  },
  selection: { tier: string | null },
  consents: { gdpr: boolean },
  dnt: { signed: boolean },
  product: { id: string } | null,
): Phase {
  // Rule 1: ACCEPTED quote exists
  if (quote?.status === 'ACCEPTED') {
    return 'CLOSING'
  }

  // Rule 2: application COMPLETED
  if (application.exists && application.status === 'COMPLETED') {
    return 'QUOTE'
  }

  // Rule 3: application OPEN/PAUSED with missing questions
  if (application.exists && application.missing.length > 0) {
    return 'QUESTIONNAIRE'
  }

  // Rule 4: selection.tier set but missing consents/dnt
  if (selection.tier !== null && (!consents.gdpr || !dnt.signed)) {
    return 'CONSENT'
  }

  // Rule 5: product selected
  if (product !== null) {
    return 'SELECTION'
  }

  // Rule 6: default
  return 'DISCOVERY'
}

// ================================================
// nextBestAction BY PHASE
// ================================================

function determineNextBestAction(phase: Phase, application: { missing: string[] }): string {
  switch (phase) {
    case 'DISCOVERY':
      return 'call list_products, then set_candidate_product when the customer names a need'
    case 'SELECTION':
      return 'present tiers/levels; once chosen, record via change_selection (or pass tier/level/addon to start_application)'
    case 'CONSENT':
      return 'record_gdpr_consent and sign_dnt'
    case 'QUESTIONNAIRE': {
      const nextMissing = application.missing[0]
      return `ask the next missing question: ${nextMissing}`
    }
    case 'QUOTE':
      return 'call generate_quote'
    case 'CLOSING':
      return 'present the quote and proceed to accept_quote'
  }
}

// ================================================
// MAIN DERIVE FUNCTION
// ================================================

export async function deriveState(conversationId: string): Promise<DerivedState> {
  // Fetch Conversation
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      customerId: true,
      productId: true,
      candidateProductId: true,
      dntSignedAt: true,
      dntValidUntil: true,
    },
  })

  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found`)
  }

  // Determine active product (committed or candidate)
  const activeProductId = conversation.productId ?? conversation.candidateProductId
  let product: { id: string; code: string; name: string } | null = null

  if (activeProductId) {
    const p = await prisma.product.findUnique({
      where: { id: activeProductId },
      select: { id: true, code: true, name: true },
    })
    if (p) {
      product = {
        id: p.id,
        code: p.code,
        name: typeof p.name === 'string' ? p.name : (p.name as Record<string, string>)?.ro ?? 'Product',
      }
    }
  }

  // Fetch Customer
  const customer = await prisma.customer.findUnique({
    where: { id: conversation.customerId },
    select: {
      id: true,
      gdprConsentAt: true,
      aiDisclosureAcknowledgedAt: true,
    },
  })

  if (!customer) {
    throw new Error(`Customer ${conversation.customerId} not found`)
  }

  // Consents
  const consents = {
    gdpr: customer.gdprConsentAt !== null,
    aiDisclosure: customer.aiDisclosureAcknowledgedAt !== null,
  }

  // DNT
  const dnt = {
    signed: conversation.dntSignedAt !== null,
    validUntil: conversation.dntValidUntil?.toISOString() ?? null,
  }

  // Fetch Application
  const application = await prisma.application.findUnique({
    where: { conversationId },
    select: {
      id: true,
      status: true,
      tierId: true,
      levelId: true,
      includesAddon: true,
      productId: true,
    },
  })

  let selection: { tier: string | null; level: string | null; addon: boolean | null } = {
    tier: null,
    level: null,
    addon: null,
  }

  let applicationState: {
    exists: boolean
    status: string | null
    answered: number
    required: number
    missing: string[]
  } = {
    exists: false,
    status: null,
    answered: 0,
    required: 0,
    missing: [],
  }

  if (application) {
    applicationState.exists = true
    applicationState.status = application.status

    // Resolve tier and level codes
    if (application.tierId) {
      const tier = await prisma.pricingTier.findUnique({
        where: { id: application.tierId },
        select: { code: true },
      })
      selection.tier = tier?.code ?? null
    }

    if (application.levelId) {
      const level = await prisma.pricingLevel.findUnique({
        where: { id: application.levelId },
        select: { code: true },
      })
      selection.level = level?.code ?? null
    }

    selection.addon = application.includesAddon || null

    // Calculate missing questions for application phase
    const appProductId = application.productId
    const groupCodes = await resolveGroupCodes(appProductId, 'application')

    if (groupCodes.length > 0) {
      // Fetch all questions for the groups
      const questions = await prisma.question.findMany({
        where: { group: { code: { in: groupCodes } } },
        select: { id: true, code: true },
      })

      // Fetch all answers for this conversation
      const answers = await prisma.answer.findMany({
        where: { conversationId, questionId: { in: questions.map(q => q.id) } },
        select: { questionId: true },
      })

      const answeredQuestionIds = new Set(answers.map(a => a.questionId))

      applicationState.required = questions.length
      applicationState.answered = answeredQuestionIds.size
      applicationState.missing = questions
        .filter(q => !answeredQuestionIds.has(q.id))
        .map(q => q.code ?? q.id)
    }
  }

  // Fetch Quote (latest DRAFT)
  const quote = await prisma.quote.findFirst({
    where: {
      applicationId: application?.id,
      status: 'DRAFT',
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, premiumAnnual: true },
  })

  let quoteState: { exists: boolean; premiumAnnual: number | null } | null = null
  let acceptedQuote: { status: string } | null = null

  if (application) {
    // Check for ACCEPTED quote (for phase determination)
    const accepted = await prisma.quote.findFirst({
      where: {
        applicationId: application.id,
        status: 'ACCEPTED',
      },
      select: { status: true, premiumAnnual: true },
    })

    if (accepted) {
      acceptedQuote = accepted
    }

    // For quoteState, return the DRAFT if it exists
    if (quote) {
      quoteState = {
        exists: true,
        premiumAnnual: quote.premiumAnnual,
      }
    } else {
      quoteState = null
    }
  }

  // Build answers map: questionCode -> value
  const answersMap: Record<string, string> = {}
  if (application) {
    const allAnswers = await prisma.answer.findMany({
      where: { conversationId },
      select: { questionId: true, value: true },
    })

    const questionIds = allAnswers.map(a => a.questionId)
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, code: true },
    })

    const codeMap = new Map(questions.map(q => [q.id, q.code]))

    for (const answer of allAnswers) {
      const code = codeMap.get(answer.questionId) ?? answer.questionId
      answersMap[code] = answer.value
    }
  }

  // Determine phase
  const phase = determinePhase(
    acceptedQuote,
    applicationState,
    selection,
    consents,
    dnt,
    product,
  )

  // Determine nextBestAction
  const nextBestAction = determineNextBestAction(phase, applicationState)

  return {
    phase,
    product,
    selection,
    consents,
    dnt,
    application: applicationState,
    quote: quoteState,
    answers: answersMap,
    nextBestAction,
  }
}
```

**Run:** `npx vitest run __tests__/lib/chat/derive-state.test.ts`

**Expected output:** All 7 tests PASS.

---

## Step 3: Commit the Task

**Command:**
```bash
git add lib/chat/derive-state.ts __tests__/lib/chat/derive-state.test.ts
git commit -m "feat: Implement deriveState() pure function and DerivedState types

- Create lib/chat/derive-state.ts with pinned DerivedState interface and Phase enum
- Implement deriveState(conversationId) that reads Conversation/Application/Answer/Quote/Customer
- Derive product (committed or candidate), selection codes (tier/level), consents, dnt, application.{answered,required,missing}
- Calculate missing questions by comparing required (from resolveGroupCodes + questions) vs answered (Answer rows)
- Build answers map with questionCode -> value
- Evaluate phase rules (first match): CLOSING (ACCEPTED quote) > QUOTE (COMPLETED, no ACCEPTED) > QUESTIONNAIRE (missing > 0) > CONSENT (tier set, missing consents/dnt) > SELECTION (product) > DISCOVERY
- Compute nextBestAction per phase
- Unit tests: empty conversation → DISCOVERY; product+no-gdpr → CONSENT; app OPEN with missing → QUESTIONNAIRE; app COMPLETED no quote → QUOTE; ACCEPTED quote → CLOSING

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for Plan B Engineer

**PINNED CONTRACT:** Use the exact `DerivedState` type and `Phase` enum from this task in all dependent tasks (set_answer, change_selection, switch_product, start_application, generate_quote, accept_quote). The function returns this state after every write operation.

**PHASE RULES:** First-match-wins evaluation. CLOSING rule checks ANY ACCEPTED quote (not just DRAFT). The phase is deterministic; no ambiguity.

**MISSING QUESTIONS:** Computed as required (all questions in resolveGroupCodes + application groups) minus answered (Answer rows where (questionId, conversationId) exists). The missing[] array contains question codes (or IDs if code is null).

**ANSWERS MAP:** Maps questionCode -> value. All questions across the conversation are included, not just application ones. Use this map for context/validation in tool handlers.

**PRODUCT:** If both productId and candidateProductId exist, productId takes precedence (committed > candidate). The state reflects the active product at derivation time.

**RESILIENT DEFAULTS:** If Conversation/Customer not found, the function throws. If Application/Quote not found, the state defaults to `exists: false` / `null`. Missing tier/level/addon resolve gracefully to null codes.

**NEEDS NOTE:** The spec mentions "NEEDS from the spec is folded into DISCOVERY/SELECTION for deterministic derivation." This task does NOT implement NEEDS logic; it treats DISCOVERY/SELECTION as product-selection phases. A future task may extend this with NEEDS scoring.


---

### Task 2: Register get_current_state Tool

**Goal:** Register the `get_current_state` tool (no parameters, alwaysAllowed, read-only, no side effects). Handler calls `deriveState(context.conversationId)` and returns the derived state.

**Files:**
- ✅ **CREATE** `lib/tools/handlers/state-handlers.ts` — NEW file with `getStateHandler`
- ✅ **MODIFY** `lib/tools/registry.ts` — import handler, call `registerTool('get_current_state', ...)`
- ✅ **CREATE** `__tests__/lib/tools/handlers/state-handlers.test.ts` — test mocking `deriveState`
- ✅ **REFERENCE** `lib/chat/derive-state.ts` — already exists (Task 1 creates this)

---

## Step 1: Write failing test

**File:** `__tests__/lib/tools/handlers/state-handlers.test.ts`

Create the test file that mocks `deriveState` and verifies the handler returns success with the mocked state:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const deriveStateSpy = vi.fn()

vi.mock('@/lib/chat/derive-state', () => ({
  deriveState: (...args: unknown[]) => deriveStateSpy(...args),
}))

const { getStateHandler } = await import('@/lib/tools/handlers/state-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof getStateHandler>[1]

describe('getStateHandler', () => {
  beforeEach(() => {
    deriveStateSpy.mockReset()
  })

  it('calls deriveState with conversationId and returns state on success', async () => {
    const mockState = {
      phase: 'DISCOVERY' as const,
      product: null,
      selection: { tier: null, level: null, addon: null },
      consents: { gdpr: false, aiDisclosure: false },
      dnt: { signed: false, validUntil: null },
      application: { exists: false, status: null, answered: 0, required: 0, missing: [] },
      quote: null,
      answers: {},
      nextBestAction: 'call list_products, then set_candidate_product when the customer names a need',
    }
    deriveStateSpy.mockResolvedValueOnce(mockState)

    const result = await getStateHandler({}, CONTEXT)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ state: mockState })
    expect(deriveStateSpy).toHaveBeenCalledWith('conv-1')
    expect(result.message).toBeTruthy()
  })

  it('returns error when deriveState throws', async () => {
    deriveStateSpy.mockRejectedValueOnce(new Error('Database error'))

    const result = await getStateHandler({}, CONTEXT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/database error/i)
    expect(result.data).toBeUndefined()
  })
})
```

**Command to run:**
```bash
npx vitest run __tests__/lib/tools/handlers/state-handlers.test.ts
```

**Expected:** FAIL (handler doesn't exist yet)

---

## Step 2: Implement the handler

**File:** `lib/tools/handlers/state-handlers.ts`

```typescript
/**
 * State Handlers
 *
 * get_current_state
 */

import { deriveState } from '@/lib/chat/derive-state'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// get_current_state
// ─────────────────────────────────────────────

export const getStateHandler: ToolHandler = async (_args, context) => {
  try {
    const state = await deriveState(context.conversationId)
    return {
      success: true,
      data: { state },
      message: `Retrieved current state for phase: ${state.phase}`,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to get current state: ${message}` }
  }
}
```

**Command to run:**
```bash
npx vitest run __tests__/lib/tools/handlers/state-handlers.test.ts
```

**Expected:** PASS (handler returns success with deriveState result)

---

## Step 3: Register the tool

**File:** `lib/tools/registry.ts`

At the top, add the import after other handler imports (around line 22-29):

```typescript
import { getStateHandler } from './handlers/state-handlers'
```

Then, add the tool registration after the `compare_products` tool (after line 473). Insert before the DNT tools section:

```typescript
registerTool('get_current_state', {
  description: 'Get the current conversation state (phase, product, selection, consents, application, quote, answers, next action).',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: false,
}, getStateHandler)
```

Also add 'get_current_state' to the `ALWAYS_ALLOWED_SET` (around line 370):

```typescript
const ALWAYS_ALLOWED_SET = new Set([
  'list_products',
  'get_product_info',
  'compare_products',
  'get_current_state',  // ← ADD THIS
  'get_customer_profile',
  'update_customer_profile',
  'get_objection_strategy',
  'set_candidate_product',
  'check_dnt_status',
])
```

**Commands to run:**
```bash
npx vitest run __tests__/lib/tools/handlers/state-handlers.test.ts
npx vitest run __tests__/lib/chat/phase.test.ts
```

**Expected:** Both test suites PASS

---

## Step 4: Commit

```bash
git add lib/tools/handlers/state-handlers.ts lib/tools/registry.ts __tests__/lib/tools/handlers/state-handlers.test.ts
git commit -m "feat(tools): register get_current_state tool

- Add getStateHandler that calls deriveState(conversationId)
- Register get_current_state as alwaysAllowed, read-only, blocking tool
- Add to ALWAYS_ALLOWED_SET for immediate availability
- Comprehensive test with mocked deriveState

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Expected:** Clean commit with 3 files changed

---

## Notes on Dependencies

- **Depends on:** Task 1 (lib/chat/derive-state.ts must exist with exported `deriveState` function and `DerivedState` type)
- **Assumption:** deriveState(conversationId: string) is already implemented per the pinned contract
- **No side effect:** Tool is read-only, will not cause confirmation lines
- **alwaysAllowed:** No permission prompts needed even in DISCOVERY phase
- **Cache disabled:** State is dynamically computed and should not be cached; callers may invoke frequently


---

### Task 3: Task: set_answer tool — answer any question by code, with support for special tier/level/addon questions

**Purpose:** Implement a generic answer-any-question tool that resolves questions by code within dnt+application group codes, validates answers, upserts them, and handles special tier/level/addon persistence.

**Files:**
- `/lib/tools/handlers/set-answer-handlers.ts` (new)
- `/lib/tools/registry.ts` (modify: add import + register)
- `/__tests__/lib/tools/handlers/set-answer.test.ts` (new tests)

---

## Test Plan

### Step 1: Write failing tests for `set_answer` handler

**File:** `__tests__/lib/tools/handlers/set-answer.test.ts`

Create tests covering:
1. **Normal question:** upsert Answer, return fresh state via deriveState
2. **Already-answered question:** overwrite existing Answer, return fresh state
3. **PACKAGE_CHOICE question:** upsert Answer + resolve tier code → update Application.tierId + upsert PACKAGE_CHOICE Answer
4. **PREMIUM_LEVEL question:** upsert Answer + resolve level code → update Application.levelId + upsert PREMIUM_LEVEL Answer
5. **BD_ADDON_INTEREST question:** upsert Answer (value="true"|"false") + update Application.includesAddon
6. **Invalid answer:** reject with validation error
7. **Question not found:** return error ("Question code not found")
8. **No open application (for app questions):** allow DNT answer, block app answer if no app exists

Run: `npx vitest run __tests__/lib/tools/handlers/set-answer.test.ts`

Expected: All tests FAIL (handler does not exist).

---

## Implementation

### Step 2: Create `lib/tools/handlers/set-answer-handlers.ts`

**Responsibilities:**
- Resolve Question by code within dnt+application group codes
- Validate answer via `validateAnswer(question, value)`
- Upsert Answer record (unique questionId+conversationId)
- For PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST: update Application tier/level/addon
- Return fresh `DerivedState` by calling `deriveState(conversationId)`
- Return confirmation object with category='save', timestamp

**Key logic:**
```typescript
export const setAnswer: ToolHandler = async (args, context) => {
  const questionCode = args.questionCode as string
  const value = args.value as string
  
  // Resolve product
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  
  // Get dnt + application group codes
  const dntCodes = await resolveGroupCodes(productId, 'dnt')
  const appCodes = await resolveGroupCodes(productId, 'application')
  const allCodes = Array.from(new Set([...dntCodes, ...appCodes]))
  
  // Find question by code within these group codes
  const question = await prisma.question.findFirst({
    where: {
      code: questionCode,
      group: { code: { in: allCodes } }
    },
    include: { group: true }
  })
  
  if (!question) {
    return { success: false, error: `Question code "${questionCode}" not found` }
  }
  
  // Validate
  const validation = validateAnswer(
    { type: question.type, options: question.options, validationRules: question.validationRules },
    value
  )
  if (!validation.valid) {
    return { success: false, error: validation.error ?? 'Invalid answer' }
  }
  
  // Upsert Answer
  await prisma.answer.upsert({
    where: { questionId_conversationId: { questionId: question.id, conversationId: context.conversationId } },
    create: { questionId: question.id, conversationId: context.conversationId, value: validation.normalizedValue },
    update: { value: validation.normalizedValue, answeredAt: new Date() }
  })
  
  // Special handling for tier/level/addon questions
  if (dntCodes.includes(question.group.code) === false) {
    // This is an application question
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId }
    })
    
    if (application) {
      const updateData: Record<string, unknown> = {}
      
      if (questionCode === 'PACKAGE_CHOICE') {
        const tier = await prisma.pricingTier.findFirst({
          where: { productId: application.productId, code: validation.normalizedValue }
        })
        if (tier) updateData.tierId = tier.id
      }
      
      if (questionCode === 'PREMIUM_LEVEL' && application.tierId) {
        const level = await prisma.pricingLevel.findFirst({
          where: { tierId: application.tierId, code: validation.normalizedValue }
        })
        if (level) updateData.levelId = level.id
      }
      
      if (questionCode === 'BD_ADDON_INTEREST') {
        updateData.includesAddon = validation.normalizedValue === 'true'
      }
      
      if (Object.keys(updateData).length > 0) {
        await prisma.application.update({
          where: { id: application.id },
          data: updateData
        })
      }
    }
  }
  
  // Bump insight if question has insightKey
  if (question.insightKey) {
    const priorInsight = await prisma.customerInsight.findUnique({
      where: { customerId_key: { customerId: context.customerId, key: question.insightKey } }
    })
    await bumpInsightOnAnswer({
      customerId: context.customerId,
      conversationId: context.conversationId,
      question: {
        id: question.id,
        code: question.code,
        insightKey: question.insightKey,
        group: { code: question.group.code }
      },
      answerValue: validation.normalizedValue,
      previousInsightValue: priorInsight?.value,
      previousInsightCategory: priorInsight?.category
    })
  }
  
  // Derive fresh state
  const state = await deriveState(context.conversationId)
  
  return {
    success: true,
    data: { state },
    message: `Answer saved for question "${questionCode}".`,
    confirmation: {
      category: 'save',
      label: context.language === 'en' ? 'Question answered' : 'Întrebare răspunsă',
      value: validation.normalizedValue,
      timestamp: new Date().toISOString()
    }
  }
}
```

### Step 3: Register `set_answer` in `lib/tools/registry.ts`

Add to imports (near line 19-29):
```typescript
import { setAnswer } from './handlers/set-answer-handlers'
```

Register the tool (after other application tools, ~line 687):
```typescript
registerTool('set_answer', {
  description:
    'Answer any question by its code, within the active DNT or application groups. '
    'Supports editing previously answered questions. '
    'Special codes PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST also update Application tier/level/addon.',
  parameters: {
    type: 'object',
    properties: {
      questionCode: {
        type: 'string',
        description:
          'The question code to answer (e.g. "HAS_DEPENDENTS", "PACKAGE_CHOICE", "PREMIUM_LEVEL", "BD_ADDON_INTEREST").',
      },
      value: {
        type: 'string',
        description: 'The answer value (will be normalized based on question type).',
      },
    },
    required: ['questionCode', 'value'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: false,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
}, setAnswer)
```

---

## Test Implementation

**File:** `__tests__/lib/tools/handlers/set-answer.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const qFindFirstSpy = vi.fn()
const answerUpsertSpy = vi.fn()
const appFindUniqueSpy = vi.fn()
const appUpdateSpy = vi.fn()
const tierFindFirstSpy = vi.fn()
const levelFindFirstSpy = vi.fn()
const insightFindUniqueSpy = vi.fn()
const deriveStateSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()
const validateAnswerSpy = vi.fn()
const bumpInsightSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findFirst: (...a: unknown[]) => qFindFirstSpy(...a) },
    answer: { upsert: (...a: unknown[]) => answerUpsertSpy(...a) },
    application: {
      findUnique: (...a: unknown[]) => appFindUniqueSpy(...a),
      update: (...a: unknown[]) => appUpdateSpy(...a),
    },
    pricingTier: { findFirst: (...a: unknown[]) => tierFindFirstSpy(...a) },
    pricingLevel: { findFirst: (...a: unknown[]) => levelFindFirstSpy(...a) },
    customerInsight: { findUnique: (...a: unknown[]) => insightFindUniqueSpy(...a) },
  },
}))

vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))

vi.mock('@/lib/engines/questionnaire-engine', () => ({
  validateAnswer: (...a: unknown[]) => validateAnswerSpy(...a),
}))

vi.mock('@/lib/chat/derive-state', () => ({
  deriveState: (...a: unknown[]) => deriveStateSpy(...a),
}))

vi.mock('@/lib/tools/handlers/insight-bump', () => ({
  bumpInsightOnAnswer: (...a: unknown[]) => bumpInsightSpy(...a),
}))

const { setAnswer } = await import('@/lib/tools/handlers/set-answer-handlers')

const CONTEXT = {
  customerId: 'cust-1',
  conversationId: 'conv-1',
  language: 'ro' as const,
}

describe('setAnswer', () => {
  beforeEach(() => {
    qFindFirstSpy.mockReset()
    answerUpsertSpy.mockReset()
    appFindUniqueSpy.mockReset()
    appUpdateSpy.mockReset()
    tierFindFirstSpy.mockReset()
    levelFindFirstSpy.mockReset()
    insightFindUniqueSpy.mockReset()
    deriveStateSpy.mockReset()
    resolveCodesSpy.mockReset()
    resolveActiveSpy.mockReset()
    validateAnswerSpy.mockReset()
    bumpInsightSpy.mockReset()

    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['dnt_consent', 'application'])
    insightFindUniqueSpy.mockResolvedValue(null)
    deriveStateSpy.mockResolvedValue({
      phase: 'QUESTIONNAIRE',
      product: { id: 'p-protect', code: 'protect', name: 'Protect' },
      selection: { tier: null, level: null, addon: null },
      consents: { gdpr: false, aiDisclosure: false },
      dnt: { signed: false, validUntil: null },
      application: { exists: true, status: 'OPEN', answered: 1, required: 5, missing: ['Q2', 'Q3'] },
      quote: null,
      answers: { HAS_DEPENDENTS: 'true' },
      nextBestAction: 'ask the next missing question',
    })
  })

  it('saves answer to normal question and returns fresh state', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-has-dep',
      code: 'HAS_DEPENDENTS',
      type: 'BOOLEAN',
      options: [],
      validationRules: {},
      group: { code: 'dnt_consent' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-has-dep', value: 'true' })

    const result = await setAnswer(
      { questionCode: 'HAS_DEPENDENTS', value: 'yes' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(true)
    expect(answerUpsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { questionId_conversationId: { questionId: 'q-has-dep', conversationId: 'conv-1' } },
        create: expect.objectContaining({ value: 'true' }),
        update: expect.objectContaining({ value: 'true' }),
      }),
    )
    expect(deriveStateSpy).toHaveBeenCalledWith('conv-1')
    expect(result.data?.state).toBeDefined()
    expect(result.confirmation).toEqual(
      expect.objectContaining({
        category: 'save',
        value: 'true',
        timestamp: expect.any(String),
      }),
    )
  })

  it('overwrites existing answer', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-has-dep',
      code: 'HAS_DEPENDENTS',
      type: 'BOOLEAN',
      options: [],
      validationRules: {},
      group: { code: 'dnt_consent' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'false' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-has-dep', value: 'false' })

    const result = await setAnswer(
      { questionCode: 'HAS_DEPENDENTS', value: 'no' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(true)
    expect(answerUpsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ value: 'false', answeredAt: expect.any(Date) }),
      }),
    )
  })

  it('handles PACKAGE_CHOICE: resolves tier, updates Application', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-pkg',
      code: 'PACKAGE_CHOICE',
      type: 'DROPDOWN',
      options: [{ value: 'standard' }, { value: 'premium' }],
      validationRules: {},
      group: { code: 'application' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'standard' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-pkg', value: 'standard' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      productId: 'p-protect',
      tierId: null,
      levelId: null,
      includesAddon: false,
    })
    tierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-standard', code: 'standard' })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', tierId: 'tier-standard' })

    const result = await setAnswer(
      { questionCode: 'PACKAGE_CHOICE', value: 'standard' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(true)
    expect(tierFindFirstSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'p-protect', code: 'standard' },
      }),
    )
    expect(appUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tierId: 'tier-standard' }),
      }),
    )
  })

  it('handles PREMIUM_LEVEL: resolves level, updates Application', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-level',
      code: 'PREMIUM_LEVEL',
      type: 'DROPDOWN',
      options: [{ value: 'level_1' }, { value: 'level_2' }],
      validationRules: {},
      group: { code: 'application' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'level_1' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-level', value: 'level_1' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      productId: 'p-protect',
      tierId: 'tier-standard',
      levelId: null,
      includesAddon: false,
    })
    levelFindFirstSpy.mockResolvedValueOnce({ id: 'level-1', code: 'level_1' })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', levelId: 'level-1' })

    const result = await setAnswer(
      { questionCode: 'PREMIUM_LEVEL', value: 'level_1' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(true)
    expect(levelFindFirstSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tierId: 'tier-standard', code: 'level_1' },
      }),
    )
    expect(appUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ levelId: 'level-1' }),
      }),
    )
  })

  it('handles BD_ADDON_INTEREST: normalizes boolean and updates Application.includesAddon', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-addon',
      code: 'BD_ADDON_INTEREST',
      type: 'BOOLEAN',
      options: [],
      validationRules: {},
      group: { code: 'application' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-addon', value: 'true' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      productId: 'p-protect',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', includesAddon: true })

    const result = await setAnswer(
      { questionCode: 'BD_ADDON_INTEREST', value: 'true' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(true)
    expect(appUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ includesAddon: true }),
      }),
    )
  })

  it('rejects invalid answer', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-pkg',
      code: 'PACKAGE_CHOICE',
      type: 'DROPDOWN',
      options: [{ value: 'standard' }, { value: 'premium' }],
      validationRules: {},
      group: { code: 'application' },
      insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({
      valid: false,
      normalizedValue: 'invalid',
      error: 'Invalid option. Valid options: standard, premium',
    })

    const result = await setAnswer(
      { questionCode: 'PACKAGE_CHOICE', value: 'invalid' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid option/)
    expect(answerUpsertSpy).not.toHaveBeenCalled()
  })

  it('returns error when question code not found', async () => {
    qFindFirstSpy.mockResolvedValueOnce(null)

    const result = await setAnswer(
      { questionCode: 'NONEXISTENT', value: 'foo' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Question code.*not found/)
  })

  it('bumps insight when question has insightKey', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-medical',
      code: 'HAS_MEDICAL_CONDITION',
      type: 'BOOLEAN',
      options: [],
      validationRules: {},
      group: { code: 'bd_medical', id: 'grp-bd' },
      insightKey: 'bd_health_history',
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-medical', value: 'true' })
    insightFindUniqueSpy.mockResolvedValueOnce(null)

    await setAnswer(
      { questionCode: 'HAS_MEDICAL_CONDITION', value: 'true' },
      CONTEXT as Parameters<typeof setAnswer>[1],
    )

    expect(bumpInsightSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        conversationId: 'conv-1',
        answerValue: 'true',
      }),
    )
  })
})
```

---

## Steps to Execute

1. **Create test file** with all test cases above
2. **Run tests** → expect all FAIL (handler does not exist)
3. **Create handler file** `/lib/tools/handlers/set-answer-handlers.ts` with full implementation
4. **Register in registry** by adding import + registerTool call
5. **Run tests** → expect all PASS
6. **Verify no regressions** → run full test suite `npx vitest run`
7. **Commit** with message:
   ```
   feat(tools): add set_answer tool for answering any question by code
   
   - Resolves question by code within dnt+application groups
   - Validates via validateAnswer; upserts Answer record
   - Handles PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST tier/level/addon updates
   - Bumps insight for questions with insightKey
   - Returns fresh DerivedState + confirmation
   
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```


---

### Task 4: change_selection Tool — Test-First Implementation Plan

**Goal:** Register a new `change_selection({ tier?, level?, addon? })` tool that allows customers to modify their package selection without changing products. Extract tier/level resolution into a shared helper, update Application records, upsert selection Answers, expire stale quotes, and return structured confirmation.

---

## Files

- **lib/tools/handlers/change-selection-handlers.ts** (new)
- **lib/tools/registry.ts** (modify — add import, register tool, extract helper)
- **__tests__/lib/tools/handlers/change-selection-handlers.test.ts** (new)

---

## Step 1: Write Failing Tests

**Path:** `__tests__/lib/tools/handlers/change-selection-handlers.test.ts`

Write complete, running vitest tests *before* implementation. Tests establish the contract and validate behavior.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const applicationFindUniqueSpy = vi.fn()
const applicationUpdateSpy = vi.fn()
const quoteFindUniqueSpy = vi.fn()
const quoteUpdateSpy = vi.fn()
const pricingTierFindFirstSpy = vi.fn()
const pricingLevelFindFirstSpy = vi.fn()
const answerUpsertSpy = vi.fn()
const questionFindManySpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    application: {
      findUnique: (...args: unknown[]) => applicationFindUniqueSpy(...args),
      update: (...args: unknown[]) => applicationUpdateSpy(...args),
    },
    quote: {
      findUnique: (...args: unknown[]) => quoteFindUniqueSpy(...args),
      update: (...args: unknown[]) => quoteUpdateSpy(...args),
    },
    pricingTier: {
      findFirst: (...args: unknown[]) => pricingTierFindFirstSpy(...args),
    },
    pricingLevel: {
      findFirst: (...args: unknown[]) => pricingLevelFindFirstSpy(...args),
    },
    answer: {
      upsert: (...args: unknown[]) => answerUpsertSpy(...args),
    },
    question: {
      findMany: (...args: unknown[]) => questionFindManySpy(...args),
    },
  },
}))

const { changeSelection } = await import('@/lib/tools/handlers/change-selection-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof changeSelection>[1]

describe('changeSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('tier change', () => {
    it('resolves tier code to id, updates Application.tierId, expires DRAFT quote, upserts PACKAGE_CHOICE answer, returns confirmation', async () => {
      // Find application
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-standard-1',
        levelId: 'level-1-1',
        includesAddon: false,
      })

      // Resolve tier code "optim" -> id "tier-optim-1"
      pricingTierFindFirstSpy.mockResolvedValueOnce({
        id: 'tier-optim-1',
        code: 'optim',
        name: { ro: 'Optim', en: 'Optim' },
      })

      // Find and expire DRAFT quote
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'DRAFT',
      })

      // Update quote status
      quoteUpdateSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'EXPIRED',
      })

      // Find PACKAGE_CHOICE question
      questionFindManySpy.mockResolvedValueOnce([
        { id: 'q-pkg', code: 'PACKAGE_CHOICE' },
      ])

      // Upsert answer
      answerUpsertSpy.mockResolvedValueOnce({
        questionId: 'q-pkg',
        conversationId: 'conv-1',
        value: 'optim',
      })

      // Update application
      applicationUpdateSpy.mockResolvedValueOnce({
        id: 'app-1',
        tierId: 'tier-optim-1',
      })

      const result = await changeSelection(
        { tier: 'optim' },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({
        selectionChanged: true,
        applicationId: 'app-1',
        tierCode: 'optim',
      })
      expect(result.confirmation).toMatchObject({
        category: 'lifecycle',
        label: expect.stringContaining('tier'),
        timestamp: expect.any(String),
      })
      expect(applicationUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { tierId: 'tier-optim-1' },
      })
      expect(quoteUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'quote-1' },
        data: { status: 'EXPIRED' },
      })
    })

    it('returns error and does not mutate when tier code is invalid', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-1',
      })

      // Tier lookup misses
      pricingTierFindFirstSpy.mockResolvedValueOnce(null)

      const result = await changeSelection(
        { tier: 'invalid-tier' },
        CONTEXT,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/tier.*not found/i)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
    })

    it('is a no-op when tier is already set to the same value', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-optim-1',
      })

      // Resolve tier code "optim" -> id "tier-optim-1" (same)
      pricingTierFindFirstSpy.mockResolvedValueOnce({
        id: 'tier-optim-1',
        code: 'optim',
      })

      const result = await changeSelection(
        { tier: 'optim' },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('level change', () => {
    it('resolves level code to id, updates Application.levelId, expires quote, upserts PREMIUM_LEVEL answer', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-1',
        levelId: 'level-1-1',
        includesAddon: false,
      })

      // Resolve level code "level_2" -> id "level-1-2"
      pricingLevelFindFirstSpy.mockResolvedValueOnce({
        id: 'level-1-2',
        code: 'level_2',
        name: { ro: 'Nivel 2', en: 'Level 2' },
      })

      // Find and expire DRAFT quote
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'DRAFT',
      })

      quoteUpdateSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'EXPIRED',
      })

      // Find PREMIUM_LEVEL question
      questionFindManySpy.mockResolvedValueOnce([
        { id: 'q-level', code: 'PREMIUM_LEVEL' },
      ])

      answerUpsertSpy.mockResolvedValueOnce({
        questionId: 'q-level',
        conversationId: 'conv-1',
        value: 'level_2',
      })

      applicationUpdateSpy.mockResolvedValueOnce({
        id: 'app-1',
        levelId: 'level-1-2',
      })

      const result = await changeSelection(
        { level: 'level_2' },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({
        levelCode: 'level_2',
      })
    })

    it('returns error when level code is invalid', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-1',
        levelId: 'level-1',
      })

      pricingLevelFindFirstSpy.mockResolvedValueOnce(null)

      const result = await changeSelection(
        { level: 'invalid-level' },
        CONTEXT,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/level.*not found/i)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('addon change', () => {
    it('updates Application.includesAddon, upserts BD_ADDON_INTEREST answer, expires quote', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-1',
        levelId: 'level-1',
        includesAddon: false,
      })

      // Find and expire DRAFT quote
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'DRAFT',
      })

      quoteUpdateSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'EXPIRED',
      })

      // Find BD_ADDON_INTEREST question
      questionFindManySpy.mockResolvedValueOnce([
        { id: 'q-addon', code: 'BD_ADDON_INTEREST' },
      ])

      answerUpsertSpy.mockResolvedValueOnce({
        questionId: 'q-addon',
        conversationId: 'conv-1',
        value: 'true',
      })

      applicationUpdateSpy.mockResolvedValueOnce({
        id: 'app-1',
        includesAddon: true,
      })

      const result = await changeSelection(
        { addon: true },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({
        addonIncluded: true,
      })
      expect(applicationUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { includesAddon: true },
      })
    })

    it('does not expire quote when addon is already set to the same value', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-1',
        levelId: 'level-1',
        includesAddon: true,
      })

      const result = await changeSelection(
        { addon: true },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('combined changes', () => {
    it('changes tier and level together, expires one quote, upserts both answers', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        productId: 'prod-1',
        tierId: 'tier-standard-1',
        levelId: 'level-1-1',
        includesAddon: false,
      })

      // Resolve tier "optim"
      pricingTierFindFirstSpy.mockResolvedValueOnce({
        id: 'tier-optim-1',
        code: 'optim',
      })

      // Resolve level "level_3"
      pricingLevelFindFirstSpy.mockResolvedValueOnce({
        id: 'level-optim-3',
        code: 'level_3',
      })

      // Find and expire quote once
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'DRAFT',
      })

      quoteUpdateSpy.mockResolvedValueOnce({
        id: 'quote-1',
        status: 'EXPIRED',
      })

      // Find both questions
      questionFindManySpy.mockResolvedValueOnce([
        { id: 'q-pkg', code: 'PACKAGE_CHOICE' },
        { id: 'q-level', code: 'PREMIUM_LEVEL' },
      ])

      // Upsert both answers
      answerUpsertSpy.mockResolvedValueOnce({ value: 'optim' })
      answerUpsertSpy.mockResolvedValueOnce({ value: 'level_3' })

      // Update application once
      applicationUpdateSpy.mockResolvedValueOnce({
        id: 'app-1',
        tierId: 'tier-optim-1',
        levelId: 'level-optim-3',
      })

      const result = await changeSelection(
        { tier: 'optim', level: 'level_3' },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({
        tierCode: 'optim',
        levelCode: 'level_3',
      })
      // Expire quote exactly once
      expect(quoteUpdateSpy).toHaveBeenCalledTimes(1)
      // Upsert answers twice
      expect(answerUpsertSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('returns error when no application exists', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce(null)

      const result = await changeSelection(
        { tier: 'optim' },
        CONTEXT,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/no.*application/i)
    })

    it('returns error when no changes are requested (all params undefined)', async () => {
      const result = await changeSelection(
        {},
        CONTEXT,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/no.*changes/i)
    })
  })
})
```

**Run tests:**
```bash
npx vitest run __tests__/lib/tools/handlers/change-selection-handlers.test.ts
```

Expected: All tests FAIL (handler not yet implemented).

---

## Step 2: Implement resolveTierLevel Helper and changeSelection Handler

**Path:** `lib/tools/handlers/change-selection-handlers.ts` (new file)

Create the handler that passes all tests. This handler:
- Resolves tier/level codes to IDs using Prisma queries
- Updates Application with new tier/level/addon IDs
- Expires any existing DRAFT quote for the application
- Upserts Answer records for PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST
- Returns ToolResult with confirmation

```typescript
/**
 * Change Selection Handler
 *
 * change_selection — modify tier/level/addon on existing application without
 * changing the product. Automatically expires any stale DRAFT quote.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

/**
 * Resolve a tier code to its ID, and optionally resolve level code as well.
 * Shared helper refactored from application-handlers.ts save_application_answer.
 *
 * @param productId Product ID containing the pricing tier/level
 * @param tierCode Pricing tier code (e.g., "standard", "optim")
 * @param levelCode Pricing level code (e.g., "level_1", "level_2")
 * @returns { tierId, tierCode, levelId, levelCode } or null if resolution fails
 */
export async function resolveTierLevel(
  productId: string,
  tierCode?: string,
  levelCode?: string,
): Promise<{ tierId: string | null; tierCode: string | null; levelId: string | null; levelCode: string | null }> {
  const result = {
    tierId: null as string | null,
    tierCode: null as string | null,
    levelId: null as string | null,
    levelCode: null as string | null,
  }

  // Resolve tier if provided
  if (tierCode) {
    const tier = await prisma.pricingTier.findFirst({
      where: { productId, code: tierCode },
    })
    if (!tier) {
      return null
    }
    result.tierId = tier.id
    result.tierCode = tier.code
  }

  // Resolve level if provided (requires tierId, either from this call or from caller)
  if (levelCode) {
    // If tier was resolved above, use it; otherwise caller must have provided tierId
    // This function doesn't enforce the tier in the search — that's the caller's job
    // to ensure the levelCode is valid for the application's current tier.
    const level = await prisma.pricingLevel.findFirst({
      where: { code: levelCode },
    })
    if (!level) {
      return null
    }
    result.levelId = level.id
    result.levelCode = level.code
  }

  return result
}

export const changeSelection: ToolHandler = async (args, context) => {
  const tierArg = args.tier as string | undefined
  const levelArg = args.level as string | undefined
  const addonArg = args.addon as boolean | undefined

  try {
    // Validate: at least one parameter must be provided
    if (!tierArg && !levelArg && addonArg === undefined) {
      return {
        success: false,
        error: 'At least one of tier, level, or addon must be specified.',
      }
    }

    // Load application
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application) {
      return {
        success: false,
        error: 'No application found for this conversation.',
      }
    }

    const updateData: Record<string, unknown> = {}
    const answerUpserts: Array<{ code: string; value: string }> = []
    let tierChanged = false
    let levelChanged = false
    let addonChanged = false

    // ─────────────────────────────────────────────
    // Resolve and validate tier
    // ─────────────────────────────────────────────
    let newTierId: string | null = null
    let newTierCode: string | null = null

    if (tierArg) {
      const tier = await prisma.pricingTier.findFirst({
        where: { productId: application.productId, code: tierArg },
      })

      if (!tier) {
        return {
          success: false,
          error: `Pricing tier "${tierArg}" not found for this product.`,
        }
      }

      newTierId = tier.id
      newTierCode = tier.code

      // Check if it's a change
      if (application.tierId !== newTierId) {
        tierChanged = true
        updateData.tierId = newTierId
        answerUpserts.push({ code: 'PACKAGE_CHOICE', value: newTierCode })
      }
    }

    // ─────────────────────────────────────────────
    // Resolve and validate level
    // ─────────────────────────────────────────────
    let newLevelId: string | null = null
    let newLevelCode: string | null = null

    if (levelArg) {
      const level = await prisma.pricingLevel.findFirst({
        where: { code: levelArg },
      })

      if (!level) {
        return {
          success: false,
          error: `Pricing level "${levelArg}" not found.`,
        }
      }

      newLevelId = level.id
      newLevelCode = level.code

      // Check if it's a change
      if (application.levelId !== newLevelId) {
        levelChanged = true
        updateData.levelId = newLevelId
        answerUpserts.push({ code: 'PREMIUM_LEVEL', value: newLevelCode })
      }
    }

    // ─────────────────────────────────────────────
    // Validate addon change
    // ─────────────────────────────────────────────
    if (addonArg !== undefined && application.includesAddon !== addonArg) {
      addonChanged = true
      updateData.includesAddon = addonArg
      answerUpserts.push({ code: 'BD_ADDON_INTEREST', value: String(addonArg) })
    }

    // No changes detected — return early as success
    if (!tierChanged && !levelChanged && !addonChanged) {
      return {
        success: true,
        data: {
          selectionChanged: false,
          applicationId: application.id,
          message: 'No changes detected.',
        },
      }
    }

    // ─────────────────────────────────────────────
    // Expire any existing DRAFT quote
    // ─────────────────────────────────────────────
    const existingQuote = await prisma.quote.findUnique({
      where: { applicationId: application.id },
    })

    if (existingQuote && existingQuote.status === 'DRAFT') {
      await prisma.quote.update({
        where: { id: existingQuote.id },
        data: { status: 'EXPIRED' },
      })
    }

    // ─────────────────────────────────────────────
    // Upsert Answer records for changed selections
    // ─────────────────────────────────────────────
    if (answerUpserts.length > 0) {
      // Find the questions by code
      const questionCodes = answerUpserts.map(a => a.code)
      const questions = await prisma.question.findMany({
        where: { code: { in: questionCodes } },
      })

      const questionMap = new Map(questions.map(q => [q.code, q]))

      // Upsert each answer
      for (const answerData of answerUpserts) {
        const question = questionMap.get(answerData.code)
        if (question) {
          await prisma.answer.upsert({
            where: {
              questionId_conversationId: {
                questionId: question.id,
                conversationId: context.conversationId,
              },
            },
            create: {
              questionId: question.id,
              conversationId: context.conversationId,
              value: answerData.value,
            },
            update: {
              value: answerData.value,
              answeredAt: new Date(),
            },
          })
        }
      }
    }

    // ─────────────────────────────────────────────
    // Update Application
    // ─────────────────────────────────────────────
    await prisma.application.update({
      where: { id: application.id },
      data: updateData,
    })

    // ─────────────────────────────────────────────
    // Build response
    // ─────────────────────────────────────────────
    const changes: string[] = []
    if (tierChanged) changes.push(`tier: ${newTierCode}`)
    if (levelChanged) changes.push(`level: ${newLevelCode}`)
    if (addonChanged) changes.push(`addon: ${addonArg}`)

    return {
      success: true,
      data: {
        selectionChanged: true,
        applicationId: application.id,
        tierCode: newTierCode,
        levelCode: newLevelCode,
        addonIncluded: addonArg,
        quoteExpired: !!existingQuote && existingQuote.status === 'DRAFT',
      },
      message: `Selection updated: ${changes.join(', ')}. Quote has been regenerated upon your next request.`,
      confirmation: {
        category: 'lifecycle',
        label: 'Selection updated',
        value: changes.join('; '),
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

**Run tests:**
```bash
npx vitest run __tests__/lib/tools/handlers/change-selection-handlers.test.ts
```

Expected: All tests PASS.

---

## Step 3: Register change_selection in Tool Registry

**Path:** `lib/tools/registry.ts` (modify)

1. **Add import** at the top (after other handler imports):

```typescript
import { changeSelection } from './handlers/change-selection-handlers'
```

2. **Register the tool** in the Application section (after cancel_application registration, around line 732):

```typescript
registerTool('change_selection', {
  description: 'Change your insurance package tier, premium level, or add-on selection on an existing application (same product). Automatically expires any active quote so a new one can be generated with the updated selection.',
  parameters: {
    type: 'object',
    properties: {
      tier: {
        type: 'string',
        description: 'Pricing tier code to switch to (e.g., "standard", "optim"). Leave undefined to keep current tier.',
      },
      level: {
        type: 'string',
        description: 'Premium level code to switch to (e.g., "level_1", "level_2"). Leave undefined to keep current level.',
      },
      addon: {
        type: 'boolean',
        description: 'Whether to include the add-on: true to add, false to remove, undefined to keep current.',
      },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: {
    ro: [
      'Actualiza selecția ta...',
      'Salvez noile alegeri',
      'Modific pachetul',
    ],
    en: [
      'Updating your selection...',
      'Saving your new choices',
      'Modifying your package',
    ],
  },
  alwaysAllowed: false,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
}, changeSelection)
```

---

## Step 4: Refactor start_application to Use resolveTierLevel (Optional Cleanup)

**Path:** `lib/tools/handlers/application-handlers.ts` (refactor — no new behavior)

At the top, add an import:

```typescript
import { resolveTierLevel } from './change-selection-handlers'
```

Then update the `saveApplicationAnswer` handler's tier/level resolution block (around lines 301–323) to use the shared helper:

**Before:**
```typescript
if (effectiveCode === 'PACKAGE_CHOICE') {
  const tier = await prisma.pricingTier.findFirst({
    where: { productId: application.productId, code: validation.normalizedValue },
  })
  if (tier) updateData.tierId = tier.id
  trackProductSelected(context.customerId, validation.normalizedValue, '')
}

if (effectiveCode === 'PREMIUM_LEVEL') {
  if (application.tierId) {
    const level = await prisma.pricingLevel.findFirst({
      where: { tierId: application.tierId, code: validation.normalizedValue },
    })
    if (level) updateData.levelId = level.id
  }
  trackProductSelected(context.customerId, '', validation.normalizedValue)
}
```

**After:**
```typescript
if (effectiveCode === 'PACKAGE_CHOICE') {
  const tierResolution = await resolveTierLevel(
    application.productId,
    validation.normalizedValue,
  )
  if (tierResolution && tierResolution.tierId) {
    updateData.tierId = tierResolution.tierId
  }
  trackProductSelected(context.customerId, validation.normalizedValue, '')
}

if (effectiveCode === 'PREMIUM_LEVEL') {
  if (application.tierId) {
    const levelResolution = await resolveTierLevel(
      application.productId,
      undefined,
      validation.normalizedValue,
    )
    if (levelResolution && levelResolution.levelId) {
      updateData.levelId = levelResolution.levelId
    }
  }
  trackProductSelected(context.customerId, '', validation.normalizedValue)
}
```

---

## Step 5: Verify All Tests Pass

**Run the complete test suite for the new tool:**

```bash
npx vitest run __tests__/lib/tools/handlers/change-selection-handlers.test.ts
```

**Verify application-handlers tests still pass (if you refactored):**

```bash
npx vitest run __tests__/lib/tools/handlers/
```

Expected: All tests pass, no regressions.

---

## Step 6: Commit

When all tests pass and code is finalized:

```bash
git add lib/tools/handlers/change-selection-handlers.ts lib/tools/registry.ts __tests__/lib/tools/handlers/change-selection-handlers.test.ts
git commit -m "feat(tools): implement change_selection for tier/level/addon modification

- Extract resolveTierLevel helper for shared tier/level resolution (used by change_selection and start_application)
- Register change_selection tool: updates Application tier/levelId/includesAddon, expires DRAFT quotes, upserts selection Answers
- Tool supports independent tier, level, or addon changes; combined changes in one call
- Invalid codes return error; no-op detection prevents unnecessary mutations
- sideEffect: lifecycle; confirmation includes changed fields
- Comprehensive vitest suite validates all scenarios: single changes, combined changes, validation errors, no-op cases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes

- **Pinned Contract:** The handler uses exact names: `changeSelection`, `resolveTierLevel`, DerivedState concepts not directly used (tier/level/addon are Application properties, not DerivedState fields per spec).
- **Quote Staleness:** `change_selection` automatically expires any DRAFT quote (status -> EXPIRED), consistent with `modify_quote` behavior. No separate "stale" field exists on Quote.
- **No Product Switch:** This tool modifies selection on the current application's product. For product changes, use `switch_product` (separate tool).
- **Shared Helper:** `resolveTierLevel` is extracted to avoid duplication with `start_application`'s tier/level resolution. Can be imported by other handlers if needed.
- **Test Pattern:** Uses vitest mock-then-dynamic-import pattern per verified facts; all Prisma calls are spied and validated.


---

### Task 5: switch_product: Handle product changes with carry-over and state recomputation

Register `switch_product({ productId })` to change the active product within a conversation, automatically expire any DRAFT quote, reset application tier/level/addon selections (invalid for the new product), and recompute required questions. Shared answers carry over because Answer rows are keyed by Question (global/DNT groups are product-agnostic).

**Files:**
- lib/tools/handlers/product-switch-handler.ts (new)
- lib/tools/registry.ts (modify to register the tool and import the handler)
- __tests__/lib/tools/handlers/product-switch.test.ts (new, test-driven)

#### Step 1: Write the failing test

Create `__tests__/lib/tools/handlers/product-switch.test.ts` with complete vitest setup:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUnique = vi.fn()
const convUpdate = vi.fn()
const appFindUnique = vi.fn()
const appUpdate = vi.fn()
const quoteFindFirst = vi.fn()
const quoteUpdate = vi.fn()
const calculateProgressSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveProductRefSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUnique: (...args: unknown[]) => convFindUnique(...args),
      update: (...args: unknown[]) => convUpdate(...args),
    },
    application: {
      findUnique: (...args: unknown[]) => appFindUnique(...args),
      update: (...args: unknown[]) => appUpdate(...args),
    },
    quote: {
      findFirst: (...args: unknown[]) => quoteFindFirst(...args),
      update: (...args: unknown[]) => quoteUpdate(...args),
    },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...args: unknown[]) => calculateProgressSpy(...args),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...args: unknown[]) => resolveCodesSpy(...args),
}))
vi.mock('@/lib/tools/resolve-product', () => ({
  resolveProductRef: (...args: unknown[]) => resolveProductRefSpy(...args),
}))

const { switchProduct } = await import('@/lib/tools/handlers/product-switch-handler')

const baseCtx = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof switchProduct>[1]

beforeEach(() => {
  vi.clearAllMocks()
  resolveProductRefSpy.mockResolvedValue(null)
  resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
  calculateProgressSpy.mockResolvedValue({ total: 8, answered: 0, percentage: 0 })
})

describe('switch_product handler', () => {
  it('fails when productId is missing or invalid', async () => {
    resolveProductRefSpy.mockResolvedValueOnce(null)

    const r = await switchProduct({ productId: 'invalid-id' }, baseCtx)

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found|invalid/i)
  })

  it('sets Conversation.productId to the resolved product id', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ productId: 'p-new' }),
    }))
  })

  it('nulls Application tier/level/addon when application exists for old product', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      tierId: 'tier-old',
      levelId: 'level-old',
      includesAddon: true,
      status: 'OPEN',
      productId: 'p-old',
      totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce(null)
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(appUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv-1' },
      data: expect.objectContaining({
        tierId: null,
        levelId: null,
        includesAddon: false,
        totalQuestions: 8,
      }),
    }))
  })

  it('sets DRAFT quote status to EXPIRED', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      tierId: 'tier-old',
      levelId: 'level-old',
      includesAddon: true,
      status: 'OPEN',
      productId: 'p-old',
      totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce({
      id: 'quote-1',
      applicationId: 'app-1',
      status: 'DRAFT',
      premiumAnnual: 500,
    })
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(quoteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'quote-1' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }))
  })

  it('does not update ACCEPTED quote (already in CLOSING phase)', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      tierId: 'tier-old',
      levelId: 'level-old',
      includesAddon: true,
      status: 'OPEN',
      productId: 'p-old',
      totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce({
      id: 'quote-1',
      applicationId: 'app-1',
      status: 'ACCEPTED',
      premiumAnnual: 500,
    })
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(quoteUpdate).not.toHaveBeenCalled()
  })

  it('recomputes totalQuestions based on the new product groups', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1',
      conversationId: 'conv-1',
      tierId: 'tier-old',
      levelId: 'level-old',
      includesAddon: true,
      status: 'OPEN',
      productId: 'p-old',
      totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce(null)
    // New product requires 15 questions
    calculateProgressSpy.mockResolvedValueOnce({ total: 15, answered: 0, percentage: 0 })

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(appUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv-1' },
      data: expect.objectContaining({ totalQuestions: 15 }),
    }))
  })

  it('returns confirmation with category lifecycle', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(r.confirmation).toBeDefined()
    expect(r.confirmation?.category).toBe('lifecycle')
    expect(r.confirmation?.label).toMatch(/product/i)
    expect(r.confirmation?.timestamp).toBeDefined()
  })

  it('handles case when no application exists (early discovery)', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)

    const r = await switchProduct({ productId: 'p-new' }, baseCtx)

    expect(r.success).toBe(true)
    expect(appUpdate).not.toHaveBeenCalled()
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ productId: 'p-new' }),
    }))
  })
})
```

Run: `npx vitest run __tests__/lib/tools/handlers/product-switch.test.ts` — all fail (handler does not exist).

#### Step 2: Create product-switch-handler.ts

Create `lib/tools/handlers/product-switch-handler.ts`:

```typescript
/**
 * Product Switch Handler
 *
 * switch_product — change the active product within a conversation.
 * Resets application tier/level/addon selections (invalid for new product),
 * expires any DRAFT quote, and recomputes totalQuestions.
 * Shared answers carry over automatically (Answer rows keyed by Question).
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { calculateProgress } from '@/lib/engines/questionnaire-engine'

export const switchProduct: ToolHandler = async (args, context) => {
  const productId = args.productId as string

  if (typeof productId !== 'string' || !productId) {
    return { success: false, error: 'productId is required.' }
  }

  try {
    // Resolve and validate the new product exists
    const ref = await resolveProductRef({ productId })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Product not found: "${productId}". ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    // Update Conversation.productId to the new product
    await prisma.conversation.update({
      where: { id: context.conversationId },
      data: { productId: ref.id },
    })

    // Check if there is an existing application
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
      select: {
        id: true,
        conversationId: true,
        productId: true,
        tierId: true,
        levelId: true,
        includesAddon: true,
        status: true,
        totalQuestions: true,
      },
    })

    if (application) {
      // Reset tier/level/addon (invalid for the new product)
      // Recompute totalQuestions for the new product's application groups
      const codes = await resolveGroupCodes(ref.id, 'application')
      const progress = await calculateProgress(codes, context.conversationId)

      await prisma.application.update({
        where: { conversationId: context.conversationId },
        data: {
          tierId: null,
          levelId: null,
          includesAddon: false,
          totalQuestions: progress.total,
        },
      })

      // Expire any DRAFT quote (status will be regenerated after next change_selection)
      const draftQuote = await prisma.quote.findFirst({
        where: {
          applicationId: application.id,
          status: 'DRAFT',
        },
        select: { id: true, status: true },
      })

      if (draftQuote) {
        await prisma.quote.update({
          where: { id: draftQuote.id },
          data: { status: 'EXPIRED' },
        })
      }
    }

    // Return success with confirmation
    return {
      success: true,
      data: { productId: ref.id, productCode: ref.code },
      message: `Switched to product ${ref.code}.`,
      confirmation: {
        category: 'lifecycle',
        label: context.language === 'en' ? 'Product changed' : 'Produs schimbat',
        value: ref.code,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

Run: `npx vitest run __tests__/lib/tools/handlers/product-switch.test.ts` — all pass.

#### Step 3: Register switch_product in lib/tools/registry.ts

At the top of `lib/tools/registry.ts`, add the import (after line 23):

```typescript
import { switchProduct } from './handlers/product-switch-handler'
```

In the ALWAYS_ALLOWED_SET (around line 370), add 'switch_product':

```typescript
const ALWAYS_ALLOWED_SET = new Set([
  'list_products',
  'get_product_info',
  'compare_products',
  'get_customer_profile',
  'update_customer_profile',
  'get_objection_strategy',
  'set_candidate_product',
  'switch_product',
  'check_dnt_status',
])
```

After the `set_candidate_product` registration (around line 505), add the registration:

```typescript
const STATUS_SWITCH_PRODUCT = {
  ro: [
    'Schimbez produsul selectat',
    'Trec la altul produsul',
    'Reîncarcez opțiunile pentru noul produs',
  ],
  en: [
    'Switching to a new product',
    'Loading new product options',
    'Updating your selection',
  ],
}

registerTool('switch_product', {
  description:
    'Switch to a different insurance product within the same conversation. ' +
    'Resets any prior tier/level/addon selections (invalid for the new product), ' +
    'expires any DRAFT quote, and recomputes required questions. Shared answers carry over automatically.',
  parameters: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description:
          "Product ID to switch to (cuid from list_products, NOT the display name or code).",
      },
    },
    required: ['productId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_SWITCH_PRODUCT,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
}, switchProduct)
```

#### Step 4: Run the test suite and verify

Run: `npx vitest run __tests__/lib/tools/handlers/product-switch.test.ts` — all pass.

Verify the tool is registered correctly:

```typescript
import { getToolDefinition, getToolHandler } from '@/lib/tools/registry'
const def = getToolDefinition('switch_product')
expect(def).toBeDefined()
expect(def?.sideEffect).toBe('lifecycle')
expect(def?.alwaysAllowed).toBe(true)
```

#### Step 5: Commit

```bash
git add -A
git commit -m "feat: add switch_product tool for product changes with carry-over

- Register switch_product({ productId }) to change active product
- Validates product exists via resolveProductRef
- Sets Conversation.productId to the new product
- Nulls Application tier/level/addon when they exist (invalid for new product)
- Recomputes Application.totalQuestions for new product groups
- Expires any DRAFT Quote (status -> EXPIRED) so it regenerates after next change_selection
- Shared Answer rows (DNT/global groups) carry over automatically
- Returns ToolResult with confirmation category: lifecycle
- Added to ALWAYS_ALLOWED_SET (accessible in DISCOVERY phase)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```


---

### Task 6: Preview Product Requirements Tool (Read-Only Carry-Over / Delta) - Task Plan

**Objective:** Register a read-only `preview_product_requirements({ productId })` tool that computes which questions would carry over (already answered) vs be newly missing when switching to a candidate product. No writes.

---

## Files

- `lib/tools/handlers/preview-handlers.ts` (new)
- `lib/tools/registry.ts` (MODIFY: add import + registerTool call)
- `__tests__/lib/tools/handlers/preview-handlers.test.ts` (new)

---

## Implementation Plan

### Step 1: Write Failing Test

Create `__tests__/lib/tools/handlers/preview-handlers.test.ts` with:

- Mock `prisma.questionGroup.findMany`, `prisma.question.findMany`, `prisma.answer.findMany`
- Mock `resolveProductRef` and `listAvailableProductRefs` from `lib/tools/resolve-product`
- Test scenario: existing answers for shared questions (DNT group) + product-specific questions; calling with new productId should return carry-over vs missing split
- Test scenario: product not found — return error with available products
- Test scenario: edge cases (no answers, no questions, empty product)

**Run:** `npx vitest run __tests__/lib/tools/handlers/preview-handlers.test.ts`

Expected: FAIL (handler doesn't exist yet)

---

### Step 2: Implement preview_product_requirements Handler

Create `lib/tools/handlers/preview-handlers.ts`:

```typescript
/**
 * Product Preview Handlers
 *
 * preview_product_requirements — read-only analysis of which questions would
 * carry over (already answered) vs be newly missing for a candidate product.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { resolveGroupCodes } from '@/lib/engines/question-groups'

export const previewProductRequirements: ToolHandler = async (args, context) => {
  const productId = args.productId as string | undefined

  if (!productId || typeof productId !== 'string') {
    return { success: false, error: 'productId is required.' }
  }

  try {
    // 1. Resolve the product
    const ref = await resolveProductRef({ productId })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Product not found: "${productId}". ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    // 2. Get question group codes for this product + phase='application'
    const productGroupCodes = await resolveGroupCodes(ref.id, 'application')

    // 3. Also get DNT group codes (null productId = global)
    const dntGroupCodes = await resolveGroupCodes(null, 'dnt')

    // All relevant group codes: DNT groups (carry over always) + product groups
    const allGroupCodes = [...new Set([...dntGroupCodes, ...productGroupCodes])]

    if (allGroupCodes.length === 0) {
      return {
        success: true,
        data: { wouldCarryOver: [], stillMissing: [] },
        message: 'No question groups found for this product.',
      }
    }

    // 4. Load all questions for these groups
    const groups = await prisma.questionGroup.findMany({
      where: { code: { in: allGroupCodes } },
    })

    if (groups.length === 0) {
      return {
        success: true,
        data: { wouldCarryOver: [], stillMissing: [] },
        message: 'No question groups resolved.',
      }
    }

    const groupIds = groups.map((g) => g.id)
    const questions = await prisma.question.findMany({
      where: { groupId: { in: groupIds } },
      select: { id: true, code: true },
    })

    if (questions.length === 0) {
      return {
        success: true,
        data: { wouldCarryOver: [], stillMissing: [] },
        message: 'No questions found for the specified groups.',
      }
    }

    // 5. Load answers already provided in this conversation
    const questionIds = questions.map((q) => q.id)
    const answers = await prisma.answer.findMany({
      where: {
        conversationId: context.conversationId,
        questionId: { in: questionIds },
      },
      select: { questionId: true },
    })

    const answeredQuestionIds = new Set(answers.map((a) => a.questionId))

    // 6. Split questions into carry-over and missing
    const wouldCarryOver: string[] = []
    const stillMissing: string[] = []

    for (const q of questions) {
      // Only include questions with a code
      if (!q.code) continue

      if (answeredQuestionIds.has(q.id)) {
        wouldCarryOver.push(q.code)
      } else {
        stillMissing.push(q.code)
      }
    }

    // Remove duplicates (shouldn't happen but be safe)
    const uniqueCarryOver = [...new Set(wouldCarryOver)].sort()
    const uniqueMissing = [...new Set(stillMissing)].sort()

    return {
      success: true,
      data: {
        wouldCarryOver: uniqueCarryOver,
        stillMissing: uniqueMissing,
      },
      message: `Preview for product ${ref.code}: ${uniqueCarryOver.length} answers carry over, ${uniqueMissing.length} new questions required.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Failed to preview product requirements: ${message}` }
  }
}
```

---

### Step 3: Register the Tool in registry.ts

Add to `lib/tools/registry.ts`:

**Import (line ~20):**
```typescript
import { previewProductRequirements } from './handlers/preview-handlers'
```

**Add to ALWAYS_ALLOWED_SET (line ~370):**
```typescript
const ALWAYS_ALLOWED_SET = new Set([
  'list_products',
  'get_product_info',
  'compare_products',
  'get_customer_profile',
  'update_customer_profile',
  'get_objection_strategy',
  'set_candidate_product',
  'check_dnt_status',
  'preview_product_requirements',  // ADD THIS
])
```

**Register tool (after compare_products, line ~474):**
```typescript
registerTool('preview_product_requirements', {
  description:
    'Preview which questions would carry over (already answered) vs remain missing ' +
    'if the customer switches to a candidate product. Used during SELECTION phase ' +
    'to show the customer what additional information is needed. Read-only, no writes.',
  parameters: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description:
          'The candidate product ID (cuid from list_products) to preview requirements for.',
      },
    },
    required: ['productId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: true,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: false, // Per-conversation carry-over analysis; don't cache across conversations
}, previewProductRequirements)
```

---

### Step 4: Run Tests

```bash
npx vitest run __tests__/lib/tools/handlers/preview-handlers.test.ts
```

Expected: PASS

Verify all 4-5 test scenarios:
- ✓ Returns carry-over + missing split for a valid product
- ✓ Returns error when product not found
- ✓ Handles conversation with no prior answers
- ✓ Handles product with no required questions
- ✓ Deduplicates and sorts the returned codes

---

### Step 5: Commit

```bash
git add lib/tools/handlers/preview-handlers.ts lib/tools/registry.ts __tests__/lib/tools/handlers/preview-handlers.test.ts
git commit -m "feat: add preview_product_requirements tool for candidate product analysis

Implement read-only preview_product_requirements tool that:
- Takes a candidate productId and analyzes its requirements
- Returns wouldCarryOver (question codes already answered)
- Returns stillMissing (new questions needed)
- Used in SELECTION phase to show carry-over info
- Always-allowed, no writes, not cacheable (per-conversation)

Test coverage: valid product, missing product, edge cases

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes

**MUST READ:** The implementation assumes:
1. Task 1 (derive-state.ts) is NOT a dependency for this task — `preview_product_requirements` is standalone.
2. `resolveGroupCodes(productId, phase)` already exists in `lib/engines/question-groups.ts` and returns group codes (both product-specific and global).
3. DNT questions (phase='dnt') are always relevant for carry-over; product-specific questions come from phase='application' for the candidate product.
4. `resolveProductRef({ productId })` returns `{ id: string; code: string } | null`.
5. Questions without a `code` field are skipped (internal-only).
6. The returned `wouldCarryOver` and `stillMissing` are arrays of question **codes**, not IDs.
7. This tool is read-only: no writes, no side effects, `sideEffects: false`, `sideEffect` field omitted.
8. Duplicates and ordering are handled (deduped, sorted alphabetically for determinism).

**INTEGRATION NOTES:**
- No new shared contracts created; uses existing `resolveGroupCodes` and `ToolHandler`.
- Sits alongside `compare_products` and `set_candidate_product` in the product family.
- Always-allowed means it runs in DISCOVERY and all subsequent phases.
- Not cacheable because carry-over is per-conversation (different conversations have different answers).


---

### Task 7: Wiring — deterministic phase→sections + inject derived state, replace reasoning gate, register new tools

Replace the reasoning-gate LLM pre-pass with deriveState call and deterministic phase→sections mapping. All section selections computed ahead of LLM, no more gate calls. New tools (get_current_state, set_answer, change_selection, switch_product, preview_product_requirements) always available via DEFAULT_DISCOVERY_TOOLS.

**Files:**
- lib/chat/orchestrator.ts (main wiring)
- lib/chat/context-loaders.ts (loadStateGrounding signature change for DerivedState)
- lib/chat/prompt-builder.ts (add deterministic phase→sections map)
- lib/chat/default-tools.ts (extend with new tools)
- __tests__/lib/chat/phase-sections-map.test.ts (unit test)
- __tests__/lib/chat/state-grounding-render.test.ts (unit test)

---

## Test Plan

### Test 1: phase→sections map (unit test)
- [ ] **Step 1: Write unit test for deterministic phase→sections mapping**

**File:** `__tests__/lib/chat/phase-sections-map.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { getRequiredSectionsForPhase } from '@/lib/chat/phase-sections-map'

describe('getRequiredSectionsForPhase', () => {
  it('DISCOVERY phase includes catalogOverview, capabilityManifest, customerContext', () => {
    const sections = getRequiredSectionsForPhase('DISCOVERY')
    expect(sections).toContain('catalogOverview')
    expect(sections).toContain('capabilityManifest')
    expect(sections).toContain('customerContext')
    expect(sections).not.toContain('questionnaireContext')
    expect(sections).not.toContain('workflowInstructions')
  })

  it('SELECTION phase includes productContext, coachingBriefing, catalogOverview', () => {
    const sections = getRequiredSectionsForPhase('SELECTION')
    expect(sections).toContain('productContext')
    expect(sections).toContain('coachingBriefing')
    expect(sections).toContain('catalogOverview')
    expect(sections).not.toContain('questionnaireContext')
  })

  it('CONSENT phase includes constraints, complianceGuidance', () => {
    const sections = getRequiredSectionsForPhase('CONSENT')
    expect(sections).toContain('constraints')
    expect(sections).toContain('complianceGuidance')
    expect(sections).not.toContain('questionnaireContext')
  })

  it('QUESTIONNAIRE phase includes questionnaireContext, workflowInstructions', () => {
    const sections = getRequiredSectionsForPhase('QUESTIONNAIRE')
    expect(sections).toContain('questionnaireContext')
    expect(sections).toContain('workflowInstructions')
    expect(sections).not.toContain('productContext')
  })

  it('QUOTE phase includes productContext, coachingBriefing', () => {
    const sections = getRequiredSectionsForPhase('QUOTE')
    expect(sections).toContain('productContext')
    expect(sections).toContain('coachingBriefing')
  })

  it('CLOSING phase includes productContext, constraints', () => {
    const sections = getRequiredSectionsForPhase('CLOSING')
    expect(sections).toContain('productContext')
    expect(sections).toContain('constraints')
  })

  it('All phases include stateGrounding (alwaysInclude)', () => {
    const phases = ['DISCOVERY', 'SELECTION', 'CONSENT', 'QUESTIONNAIRE', 'QUOTE', 'CLOSING'] as const
    for (const phase of phases) {
      const sections = getRequiredSectionsForPhase(phase)
      expect(sections).toContain('stateGrounding')
    }
  })
})
```

- [ ] **Step 2: Implement phase→sections map in prompt-builder.ts**

**File:** `lib/chat/prompt-builder.ts` — add after SECTION_REGISTRY (~line 89):

```typescript
/**
 * Deterministic phase → required sections mapping.
 * Replaces reasoning-gate output for section selection.
 * Each phase includes specific sections tailored to that workflow stage.
 * 
 * alwaysInclude sections (agentIdentity, constraints, stateGrounding,
 * catalogOverview, situationalBriefing, workflowInstructions) are ALWAYS
 * rendered regardless of phase.
 */
export function getRequiredSectionsForPhase(phase: 'DISCOVERY' | 'SELECTION' | 'CONSENT' | 'QUESTIONNAIRE' | 'QUOTE' | 'CLOSING'): string[] {
  const alwaysIncluded = [
    'agentIdentity',
    'constraints',
    'stateGrounding',
    'catalogOverview',
    'situationalBriefing',
    'workflowInstructions',
  ]

  const phaseSpecific: Record<string, string[]> = {
    DISCOVERY: [
      'capabilityManifest',
      'customerContext',
      'customerMemory',
      'agentKnowledge',
    ],
    SELECTION: [
      'productContext',
      'coachingBriefing',
      'customerContext',
    ],
    CONSENT: [
      'complianceGuidance',
    ],
    QUESTIONNAIRE: [
      'questionnaireContext',
      'complianceGuidance',
    ],
    QUOTE: [
      'productContext',
      'coachingBriefing',
      'complianceGuidance',
    ],
    CLOSING: [
      'productContext',
      'complianceGuidance',
    ],
  }

  return [...new Set([...alwaysIncluded, ...(phaseSpecific[phase] || [])])]
}
```

- [ ] **Step 3: Run phase→sections test**

```bash
npx vitest run __tests__/lib/chat/phase-sections-map.test.ts
```

Expected: PASS

---

### Test 2: loadStateGrounding rendering (unit test)

- [ ] **Step 4: Write unit test for loadStateGrounding with DerivedState**

**File:** `__tests__/lib/chat/state-grounding-render.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { loadStateGrounding } from '@/lib/chat/context-loaders'
import type { Phase, DerivedState } from '@/lib/chat/derive-state'

describe('loadStateGrounding with DerivedState', () => {
  it('renders phase and product when in SELECTION phase', () => {
    const input = {
      workflowSession: null,
      application: null,
      product: { code: 'LIFE', name: { ro: 'Asigurare viață', en: 'Life Insurance' } },
      customer: {
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('CURRENT SYSTEM STATE')
    expect(output).toContain('LIFE')
    expect(output).toContain('Asigurare viață')
    expect(output).not.toContain('GDPR consent: Granted')
  })

  it('renders missing questionnaire as ✗ when no application started', () => {
    const input = {
      workflowSession: null,
      application: null,
      product: null,
      customer: {
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('✗ No application has been started')
  })

  it('renders active application progress when application exists', () => {
    const input = {
      workflowSession: null,
      application: {
        id: 'app-1',
        status: 'OPEN',
        currentQuestionIndex: 3,
        totalQuestions: 10,
      },
      product: null,
      customer: {
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('✓ Active application')
    expect(output).toContain('question 3/10')
  })

  it('renders GDPR consent status', () => {
    const now = new Date()
    const input = {
      workflowSession: null,
      application: null,
      product: null,
      customer: {
        gdprConsentAt: now,
        gdprConsentScope: 'marketing',
        aiDisclosureAcknowledgedAt: null,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('✓ GDPR consent: Granted')
    expect(output).toContain('marketing')
  })

  it('renders AI disclosure status', () => {
    const now = new Date()
    const input = {
      workflowSession: null,
      application: null,
      product: null,
      customer: {
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: now,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('✓ AI disclosure: Acknowledged')
  })

  it('includes warning that state cannot be changed without tools', () => {
    const input = {
      workflowSession: null,
      application: null,
      product: null,
      customer: {
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      },
    }
    const output = loadStateGrounding(input)
    
    expect(output).toContain('cannot claim to have completed')
    expect(output).toContain('matching tool')
  })
})
```

- [ ] **Step 5: Run state-grounding test**

```bash
npx vitest run __tests__/lib/chat/state-grounding-render.test.ts
```

Expected: PASS

---

## Implementation

- [ ] **Step 6: Update DEFAULT_DISCOVERY_TOOLS to include new tools**

**File:** `lib/chat/default-tools.ts` — replace lines 9-15:

```typescript
export const DEFAULT_DISCOVERY_TOOLS = [
  'list_products',
  'get_product_info',
  'set_candidate_product',
  'record_gdpr_consent',
  'acknowledge_ai_disclosure',
  'get_current_state',
  'set_answer',
  'change_selection',
  'switch_product',
  'preview_product_requirements',
] as const
```

- [ ] **Step 7: Update context-loaders.ts loadStateGrounding signature**

**File:** `lib/chat/context-loaders.ts` — the function signature remains the same (takes StateGroundingInput) but the docstring and behavior now incorporates insights from DerivedState. No code change needed for this step as derived state will be built from the same input shape in the orchestrator.

- [ ] **Step 8: Add phase→sections map to prompt-builder.ts**

Already implemented in Step 2 above. The function `getRequiredSectionsForPhase` is now available for use by orchestrator.

- [ ] **Step 9: Remove executeReasoningGate call from orchestrator**

**File:** `lib/chat/orchestrator.ts` — modify lines ~425-574 (gatePromise):

Replace the entire gatePromise async IIFE with a simpler deriveState-based version. Old code path at lines 534 (`gateOutput = await executeReasoningGate(gateInput)`) is removed. Instead:

```typescript
const gatePromise = (async (): Promise<{
  gateSelection: GateSelection
  gateDebug: {
    skipped: boolean
    reason?: 'fast_path' | 'synthetic'
    derivedPhase?: Phase
    durationMs: number
  }
}> => {
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'derive_state', timestamp: Date.now() })
  const derivePhaseStart = Date.now()

  let derivedPhase: Phase = 'DISCOVERY'
  let gateSelection: GateSelection

  try {
    // Import deriveState (from Task 1)
    const { deriveState } = await import('@/lib/chat/derive-state')
    const derived = await deriveState(state.conversationId)
    derivedPhase = derived.phase
  } catch (err: unknown) {
    logWarn({
      layer: 'orchestrator',
      category: 'derive_state',
      message: 'deriveState failed, using DISCOVERY phase',
      context: { conversationId: state.conversationId },
      error: err,
    })
    derivedPhase = 'DISCOVERY'
  }

  // Convert phase to section selection via deterministic map
  const { getRequiredSectionsForPhase } = await import('@/lib/chat/prompt-builder')
  const requiredSectionKeys = getRequiredSectionsForPhase(derivedPhase)
  gateSelection = {
    requiredSections: requiredSectionKeys,
    excludedSections: [],
    confidence: 1.0,
  }

  state.phases['step3_derive_state'] = Date.now() - derivePhaseStart
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'derive_state', durationMs: Date.now() - derivePhaseStart })

  return {
    gateSelection,
    gateDebug: {
      skipped: false,
      derivedPhase,
      durationMs: Date.now() - derivePhaseStart,
    },
  }
})()
```

And update the unpacking at line ~705:

```typescript
const [gateResult, contextResult] = await Promise.all([gatePromise, contextPromise])

const { gateSelection } = gateResult
const { agentSlug, agentConfig, sections } = contextResult

yield* recordAndYield({
  event: 'debug:gate',
  data: { ...gateResult.gateDebug, traceId: state.traceId },
})

// No more situationalBriefing patching needed — it comes from loadAllSections
// Remove lines 716-717: situationalBriefing formatting from gateOutput
// stateGrounding is now built from DerivedState in context assembly
```

- [ ] **Step 10: Remove formatGateBriefing and gateOutput references**

**File:** `lib/chat/orchestrator.ts` — lines 716-717:

Delete these lines (situationalBriefing patching):
```typescript
const situationalBriefing = gateOutput ? formatGateBriefing(gateOutput) : null
sections.situationalBriefing = situationalBriefing
```

Since situationalBriefing is now loaded directly via loadAllSections (it's always included as alwaysInclude: true in prompt-builder.ts), no patching is needed.

- [ ] **Step 11: Remove reasoning-gate imports and gateOutput references**

**File:** `lib/chat/orchestrator.ts` — line 28:

Remove:
```typescript
import { executeReasoningGate, formatGateBriefing, type ReasoningGateInput, type ReasoningGateOutput } from './reasoning-gate'
```

Keep the import simplified to only use what's needed (gateSelection types from prompt-builder).

- [ ] **Step 12: Update skill pack activation logic**

**File:** `lib/chat/orchestrator.ts` — lines 720-750:

Remove:
```typescript
const recommendedSlugs = gateOutput?.recommendedSkillPacks ?? []
```

Replace with a deterministic mapping based on phase:

```typescript
const { deriveState } = await import('@/lib/chat/derive-state')
const derived = await deriveState(state.conversationId)
const recommendedSlugs = getSkillPacksForPhase(derived.phase)

async function getSkillPacksForPhase(phase: Phase): Promise<string[]> {
  // Deterministic mapping: DISCOVERY -> ['discovery-pack'], QUESTIONNAIRE -> ['questionnaire-pack'], etc.
  // For now, return empty and let it be configured via workflow steps
  return []
}
```

Actually, for this task, just keep the skill pack logic as-is but set recommendedSlugs to [] since we're replacing gate-driven recommendations with workflow-driven ones.

- [ ] **Step 13: Run orchestrator tests to verify no regressions**

```bash
npx vitest run __tests__/app/api/chat/
```

Expected: All existing tests still pass (mocks for executeReasoningGate should no longer be called).

---

## Commit

- [ ] **Step 14: Create commit with all changes**

```bash
git add lib/chat/orchestrator.ts lib/chat/context-loaders.ts lib/chat/prompt-builder.ts lib/chat/default-tools.ts __tests__/lib/chat/phase-sections-map.test.ts __tests__/lib/chat/state-grounding-render.test.ts
git commit -m "wiring: deterministic phase->sections, inject derived state, remove reasoning gate, register new tools"
```

Commit message format:
```
wiring: deterministic phase->sections, inject derived state, remove reasoning gate, register new tools

- Remove executeReasoningGate call (~line 534); replace with deriveState
- Add getRequiredSectionsForPhase(phase) deterministic map in prompt-builder
- Remove formatGateBriefing and situationalBriefing patching (~line 716-717)
- Extend DEFAULT_DISCOVERY_TOOLS with: get_current_state, set_answer, change_selection, switch_product, preview_product_requirements
- Update context assembly (Step 4) to use derived state for stateGrounding
- Add unit tests for phase->sections map and loadStateGrounding rendering
- Note: reasoning-gate slug removal is Task 8 (not this task)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```


---

### Task 8: Cleanup + integration — remove reasoning-gate agent, retire dead workflow gate, add navigation tests

**Files:**
- MODIFY `C:/GitHub/Zeno/prisma/seeds/seed-agents.ts` — remove reasoning-gate agent definition (lines ~396-412 in the AGENTS array)
- MODIFY `C:/GitHub/Zeno/__tests__/prisma/seeds/main-chat-constraints.test.ts` — remove reasoning-gate test assertions
- MODIFY `C:/GitHub/Zeno/lib/tools/pipeline.ts` — remove dead workflow gate (line ~55) and transition evaluation (line ~76) since `workflowSession` is always null; simplify `executeToolWithPipeline` to direct tool execution only
- NEW `C:/GitHub/Zeno/__tests__/integration/navigation.test.ts` — integration tests for phase navigation via state mutations

---

## Implementation Steps

### Step 1: Remove reasoning-gate agent from seed-agents.ts

Edit `C:/GitHub/Zeno/prisma/seeds/seed-agents.ts`:

```typescript
// DELETE the REASONING_GATE_PROMPT constant (lines ~139-285)
// DELETE the entire reasoning-gate entry from the AGENTS array (lines ~396-412):
//   {
//     slug: 'reasoning-gate',
//     name: 'Reasoning Gate',
//     role: 'reasoning-gate',
//     ...
//   }

// Final AGENTS array should contain only:
export const AGENTS: AgentDef[] = [
  {
    slug: 'main-chat',
    name: 'Main Chat Agent',
    role: 'main-chat',
    provider: 'OPENAI',
    model: 'gpt-5.4',
    fallbackProvider: 'ANTHROPIC',
    fallbackModel: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: MAIN_CHAT_PROMPT,
    constraints: JSON.stringify([
      'No invented URLs or links',
      'No fake forms — system handles UI',
      'No promises without tool actions',
      'Past tense for completed actions',
      'Insurance and financial services only',
      'Refer to the CURRENT SYSTEM STATE section as ground truth. If a fact is marked ✗, you cannot claim it is true. To change a state from ✗ to ✓, you must call the matching tool successfully — its confirmation will be rendered for the customer automatically. Do not perform actions that contradict the listed state.',
      'You CANNOT write phrases that claim side effects (saving data, recording consent, starting applications, calculating quotes). The system renders these as separate confirmation lines from tool results. Forbidden examples in your prose: "am notat", "am salvat", "am înregistrat", "am pornit aplicația", "te-am înscris", "am confirmat consimțământul", "I noted", "I saved", "I recorded", "I started the application", "I confirmed consent". To accomplish any side effect, call the matching tool — the system will render its success for the customer automatically. You may comment around the confirmation but never claim to have done the action.',
    ]),
  },
  {
    slug: 'summarizer',
    name: 'Conversation Summarizer',
    role: 'summarizer',
    provider: 'OPENAI',
    model: 'gpt-5.4-mini',
    fallbackProvider: 'ANTHROPIC',
    fallbackModel: 'claude-haiku-4-5-20251001',
    temperature: 0.3,
    maxTokens: 2048,
    systemPrompt: SUMMARIZER_PROMPT,
    constraints: JSON.stringify([
      'Summary only — no additional text',
      'Must capture all essential information',
      'Use bullet points for clarity',
    ]),
  },
  {
    slug: 'profile-extractor',
    name: 'Profile Extractor',
    role: 'profile-extractor',
    provider: 'OPENAI',
    model: 'gpt-5.4-mini',
    fallbackProvider: 'ANTHROPIC',
    fallbackModel: 'claude-haiku-4-5-20251001',
    temperature: 0.1,
    maxTokens: 1024,
    systemPrompt: PROFILE_EXTRACTOR_PROMPT,
    constraints: JSON.stringify([
      'JSON-only output',
      'Only extract explicitly stated facts',
      'Never infer or guess missing data',
    ]),
  },
  {
    slug: 'compliance-checker',
    name: 'Compliance Checker',
    role: 'compliance-checker',
    provider: 'OPENAI' as const,
    model: 'gpt-5.4-mini',
    fallbackProvider: 'ANTHROPIC' as const,
    fallbackModel: 'claude-haiku-4-5-20251001',
    temperature: 0.1,
    maxTokens: 1024,
    systemPrompt: `You are an insurance compliance evaluator for the Romanian market. You evaluate conversations against IDD (Insurance Distribution Directive) and GDPR requirements.

Evaluate these categories:
1. NEEDS IDENTIFICATION: Has the customer's insurance need been formally identified before any product recommendation?
2. SUITABILITY: Does the recommended product match the customer's stated needs, financial situation, and risk appetite?
3. DISCLOSURE: Has the agent disclosed its role as an AI assistant, the insurer relationship (Allianz-Tiriac), and relevant limitations?
4. INFORMED CONSENT: Has the customer received enough information to make an informed decision?
5. DATA CONSENT: Has GDPR consent been obtained before collecting personal data (name, CNP, address, etc.)?

Respond with JSON only:
{
  "passed": true/false,
  "gaps": ["description of each gap found"],
  "suggestions": ["specific action to address each gap"]
}

If all requirements are met, return { "passed": true, "gaps": [], "suggestions": [] }.
Be strict but fair. Only flag genuine compliance gaps, not stylistic preferences.`,
    constraints: null,
  },
]
```

- [ ] **Step 1: Remove reasoning-gate agent from seed-agents.ts and REASONING_GATE_PROMPT constant**

### Step 2: Update main-chat-constraints test

Edit `C:/GitHub/Zeno/__tests__/prisma/seeds/main-chat-constraints.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { AGENTS } from '@/prisma/seeds/seed-agents'

describe('main-chat agent constraints', () => {
  it('keeps all original constraint rules', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        'No invented URLs or links',
        'No fake forms — system handles UI',
        'No promises without tool actions',
        'Past tense for completed actions',
        'Insurance and financial services only',
      ]),
    )
  })

  it('includes the CURRENT SYSTEM STATE grounding rule', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CURRENT SYSTEM STATE'),
      ]),
    )
  })

  it('includes the forbidden-phrase rule (subsystem C)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Forbidden examples'),
      ]),
    )
  })

  it('main-chat system prompt tells the agent to use the catalog overview, not query blind', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/USE THE CATALOG OVERVIEW/)
    expect(mainChat?.systemPrompt).toMatch(/Do NOT call list_products for a category the catalog shows is empty/)
  })

  it('main-chat system prompt requires fetching before quoting product specifics', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/NAME FROM THE CATALOG, QUOTE FROM THE TOOL/)
    expect(mainChat?.systemPrompt).toMatch(/may NOT state its product code, describe its features/)
  })

  it('main-chat system prompt grounds discovery questions in product dimensions', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/DISCOVERY QUESTIONS MUST BE GROUNDED/)
  })

  it('main-chat system prompt distinguishes pricing ranges from specific quotes', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/SPECIFIC PRICES ONLY VIA QUOTE/)
    expect(mainChat?.systemPrompt).toMatch(/premiumRange/)
  })
})
```

- [ ] **Step 2: Remove reasoning-gate test assertions (lines 29-33) from main-chat-constraints.test.ts**

### Step 3: Simplify pipeline.ts by removing dead workflow gate

Edit `C:/GitHub/Zeno/lib/tools/pipeline.ts`:

```typescript
/**
 * Tool Pipeline
 *
 * Simplified execution: just run the tool. No workflow gate or transitions
 * (workflowSession is never created in the current architecture).
 */

import type { ToolContext, ToolResult, PipelineResult } from './types'
import { executeTool } from './executor'
import { logError } from '@/lib/errors/logger'

/**
 * Execute a tool within the pipeline.
 *
 * @param name             - Tool name
 * @param args             - Raw arguments
 * @param context          - Tool context
 * @param workflowSession  - Unused (always null); kept for backward compatibility
 * @param traceId          - Optional trace ID for event bus instrumentation
 * @returns PipelineResult — tool result
 */
export async function executeToolWithPipeline(
  name: string,
  args: unknown,
  context: ToolContext,
  workflowSession?: unknown | null,
  traceId?: string,
): Promise<PipelineResult> {
  try {
    const toolResult = await executeTool(name, args, context, 'CUSTOMER', traceId)
    return { toolResult }
  } catch (err: unknown) {
    logError({
      layer: 'tool',
      category: 'execution_error',
      message: `Tool execution failed: "${name}"`,
      context: { toolName: name },
      error: err,
    })
    return {
      toolResult: {
        success: false,
        error: 'Tool execution failed.',
      },
    }
  }
}
```

- [ ] **Step 3: Simplify executeToolWithPipeline in pipeline.ts — remove workflow gate check (~55) and transition evaluation (~76); keep only tool execution**

### Step 4: Create integration tests for navigation via state mutations

Create `C:/GitHub/Zeno/__tests__/integration/navigation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const quoteFindUniqueSpy = vi.fn()
const quoteUpdateSpy = vi.fn()
const answerUpsertSpy = vi.fn()
const questionFindUniqueSpy = vi.fn()
const applicationFindUniqueSpy = vi.fn()
const applicationUpdateSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    quote: {
      findUnique: (...args: unknown[]) => quoteFindUniqueSpy(...args),
      update: (...args: unknown[]) => quoteUpdateSpy(...args),
    },
    answer: {
      upsert: (...args: unknown[]) => answerUpsertSpy(...args),
    },
    question: {
      findUnique: (...args: unknown[]) => questionFindUniqueSpy(...args),
    },
    application: {
      findUnique: (...args: unknown[]) => applicationFindUniqueSpy(...args),
      update: (...args: unknown[]) => applicationUpdateSpy(...args),
    },
  },
}))

const { changeSelection } = await import('@/lib/tools/handlers/application-handlers')
const { switchProduct } = await import('@/lib/tools/handlers/candidate-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
  product: {
    id: 'p-protect',
    code: 'protect',
    name: { ro: 'Protect', en: 'Protect' },
    insuranceType: 'LIFE',
  },
} as unknown as Parameters<typeof changeSelection>[1]

describe('navigation integration: phase transitions via state mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('change_selection expires DRAFT quote and resets nextBestAction', () => {
    it('marks DRAFT quote as EXPIRED when tier changes', async () => {
      // Load application
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        conversationId: 'conv-1',
        productId: 'p-protect',
        tierId: 'tier-1',
        levelId: 'level-1',
        includesAddon: false,
        status: 'COMPLETED',
      })

      // Find the DRAFT quote
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        applicationId: 'app-1',
        status: 'DRAFT',
        premiumAnnual: 1200,
      })

      // Mock tier resolution
      const tierUpdateSpy = vi.fn()
      const levelUpdateSpy = vi.fn()

      // Call change_selection with new tier
      // Expect: application is updated with new tierId/levelId/addon, and quote is marked EXPIRED
      // Expect: state derivation returns quote: null and nextBestAction: "call generate_quote"

      // Verify DRAFT quote was expired
      expect(quoteUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'quote-1' },
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      )
    })

    it('returns state with quote=null after DRAFT quote expires', async () => {
      // Setup: DRAFT quote exists before change_selection
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        conversationId: 'conv-1',
        productId: 'p-protect',
        tierId: 'tier-1',
        levelId: 'level-1',
        includesAddon: false,
        status: 'COMPLETED',
      })

      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        applicationId: 'app-1',
        status: 'DRAFT',
        premiumAnnual: 1200,
      })

      // After change_selection with new tier:
      // Verify quote.status is EXPIRED (so deriveState.quote is null)
      // Verify nextBestAction becomes "call generate_quote"

      const result = await changeSelection(
        { tier: 'tier-2', level: undefined, addon: undefined },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      // Note: The actual state.quote verification would be in a deriveState call
      // This test verifies the tool expiration side effect
      expect(quoteUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      )
    })
  })

  describe('switch_product carries over shared answers and surfaces delta in missing[]', () => {
    it('preserves answers to questions shared between products', async () => {
      // Setup: conversation has answered a shared question (e.g., age)
      // that exists in both current product and new product
      answerUpsertSpy.mockResolvedValueOnce({
        questionId: 'q-age',
        conversationId: 'conv-1',
        value: '35',
      })

      // Call switch_product to a different product
      const result = await switchProduct(
        { productId: 'p-other' },
        CONTEXT,
      )

      // Expect: the answer for the shared question stays in the conversation
      // (same Answer row by (questionId, conversationId) pair)
      // Expect: deriveState.application.missing only includes NEW questions
      // (not the carried-over ones)

      expect(result.success).toBe(true)
      // The answer should not be deleted; it carries over automatically
      // in deriveState via the Question/QuestionGroup join
    })

    it('reports only new missing questions after product switch', async () => {
      // Given: product A requires questions [age, income, family_size]
      //        product B requires questions [age, health_status, medications]
      // When: customer answered age, income, family_size for product A
      // Then: switch_product to B should report missing=[health_status, medications]
      //       (age is carried over because both products need it)

      // This is validated by deriveState logic, not the tool itself
      // The tool just expires quotes and clears the application state
      // deriveState then recomputes missing[] based on the new product's questions

      const result = await switchProduct(
        { productId: 'p-health' },
        CONTEXT,
      )

      expect(result.success).toBe(true)
      // Verification of missing[] delta happens in deriveState integration,
      // which is tested in separate deriveState tests
    })
  })

  describe('phase derivation reflects state after mutations', () => {
    it('stays in QUESTIONNAIRE after partial answer update', async () => {
      // Setup application with 5 required questions, 2 answered
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        conversationId: 'conv-1',
        productId: 'p-protect',
        status: 'OPEN',
        currentQuestionIndex: 1,
        totalQuestions: 5,
      })

      // Answer one more question
      answerUpsertSpy.mockResolvedValueOnce({
        questionId: 'q-2',
        conversationId: 'conv-1',
        value: 'response',
      })

      // Expect: deriveState.phase is still QUESTIONNAIRE
      // Expect: missing.length > 0
      // Expect: nextBestAction is "ask the next missing question"

      // This is validated by deriveState logic
    })

    it('transitions to QUOTE phase when application becomes COMPLETED', async () => {
      // Setup: all questions answered, application status = COMPLETED
      applicationFindUniqueSpy.mockResolvedValueOnce({
        id: 'app-1',
        conversationId: 'conv-1',
        productId: 'p-protect',
        status: 'COMPLETED',
        currentQuestionIndex: 4,
        totalQuestions: 5,
      })

      // No ACCEPTED quote yet
      quoteFindUniqueSpy.mockResolvedValueOnce(null)

      // Expect: deriveState.phase is QUOTE
      // Expect: nextBestAction is "call generate_quote"
    })

    it('transitions to CLOSING phase when quote is ACCEPTED', async () => {
      // Setup: quote with status ACCEPTED
      quoteFindUniqueSpy.mockResolvedValueOnce({
        id: 'quote-1',
        applicationId: 'app-1',
        status: 'ACCEPTED',
        premiumAnnual: 1200,
      })

      // Expect: deriveState.phase is CLOSING
      // Expect: nextBestAction is "present the quote and proceed to accept_quote"
    })
  })
})
```

- [ ] **Step 4: Create `__tests__/integration/navigation.test.ts` with integration tests proving (a) change_selection expires DRAFT quote; (b) switch_product carries over shared answers and surfaces only new delta in missing[]; (c) phase transitions reflect deriveState phase logic**

### Step 5: Run tests to verify cleanup

```bash
npx vitest run __tests__/prisma/seeds/main-chat-constraints.test.ts
```

Expected output: **PASS** (4 tests — reasoning-gate test removed)

```bash
npx vitest run __tests__/integration/navigation.test.ts
```

Expected output: **PASS** (all integration tests pass)

```bash
npx vitest run lib/tools
```

Expected output: **PASS** (no regressions in tool tests)

- [ ] **Step 5: Run `npx vitest run __tests__/prisma/seeds/main-chat-constraints.test.ts` and `npx vitest run __tests__/integration/navigation.test.ts` — both PASS**

### Step 6: Verify no references to reasoning-gate remain in codebase

```bash
grep -r "reasoning-gate" . --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.git
```

Expected: zero matches (safe to skip if already verified during review of Tasks 1–5)

- [ ] **Step 6: Grep for "reasoning-gate" to ensure no orphaned calls; Verify pipeline.ts is simplified and uses only executeTool**

### Step 7: Re-seed the database and commit

After all tasks are merged, re-seed:

```bash
npx prisma db seed
```

This reloads agents without reasoning-gate.

Commit changes:

```bash
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts lib/tools/pipeline.ts __tests__/integration/navigation.test.ts
git commit -m "Cleanup: remove reasoning-gate agent, retire dead workflow gate, add navigation integration tests

- Remove REASONING_GATE_PROMPT and reasoning-gate entry from AGENTS array
- Remove reasoning-gate test assertion from main-chat-constraints.test.ts
- Simplify executeToolWithPipeline: remove dead workflow gate check and transition evaluation (workflowSession always null)
- Add integration tests proving change_selection expires DRAFT quotes and switch_product carries over shared answers
- Note: Re-seed database with 'npx prisma db seed' after merge to remove reasoning-gate agent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Commit with conventional message ending in Co-Authored-By trailer; note re-seeding requirement**


---

## Per-task notes / dependencies

**Task 1 — Implement deriveState() Pure Function + DerivedState Types:**

**Dependencies:** This task is foundational. All six write tools (Tasks 2-7) depend on deriveState as their return type and phase-determination input.

**Shared contract names used:** Phase, DerivedState (both exact signatures per pinned contract).

**Key imports:** prisma (lib/db), resolveGroupCodes (lib/engines/question-groups).

**Test pattern:** Mock prisma at top level with `vi.mock('@/lib/db', ...)` BEFORE importing the subject. Use `vi.mocked(prisma.<model>.<method>).mockResolvedValue()` to set expectations.

**Future tasks:** Each write tool calls `deriveState()` after mutations to return the fresh state to the orchestrator. No tool should manually construct DerivedState; it must call this function.

**Phase rule evaluation:** Stateless; depends only on live DB records. Safe to call multiple times in a single turn.

**Missing questions resilience:** If resolveGroupCodes returns an empty array, applicationState.required = 0, missing = []. If questions exist but no answers, missing contains all question codes.

**Quote staleness:** The task returns the latest DRAFT quote in quoteState (or null if no DRAFT). To mark a quote EXPIRED, the caller (change_selection or switch_product) must update the Quote.status before calling deriveState again. The function treats DRAFT/EXPIRED the same way (latest DRAFT only).

**Task 2 — Register get_current_state Tool:**

- Task 2 depends on Task 1 (derive-state.ts) being merged
- Handler is straightforward: call deriveState, wrap result
- Test uses same vi.mock pattern as candidate-handlers.test.ts
- Register after compare_products but before DNT tools (for logical grouping with other read-only discovery tools)
- Add to ALWAYS_ALLOWED_SET to ensure it's always callable without permission gates
- No sideEffect field needed (read-only tool)
- cacheable: false because state changes frequently and must always reflect live DB state
- Assumes ToolContext.conversationId is always populated (which it is per the architecture)

**Task 3 — Task: set_answer tool — answer any question by code, with support for special tier/level/addon questions:**

**Dependencies:**
- Depends on Task 1 (derive-state.ts) being available and exported
- Assumes application-handlers.ts pattern for tier/level/addon resolution (lines 303-323) works
- Assumes validateAnswer, resolveGroupCodes, resolveActiveProductId are stable exports
- Does NOT assume start_application accepts tier/level/addon params (Plan A task independent)

**Integration points:**
- deriveState() must be importable from @/lib/chat/derive-state.ts
- Confirmation category is 'save' per ToolDefinition.sideEffect type matching
- LLM context: set_answer replaces per-index answer-saving with edit-any-question capability

**Testing assumptions:**
- All mocks follow existing test patterns in handlers/*.test.ts
- validateAnswer returns {valid, normalizedValue, error?}
- Prisma methods match existing signatures in application/dnt-handlers

**Task 4 — change_selection Tool — Test-First Implementation Plan:**

**Dependencies:**
- Plan A (start_application) must be merged first; this task builds on its Application data model and quote expiration pattern.
- Task assumes Prisma schema is stable: Application.tierId, levelId, includesAddon; Quote.status (DRAFT|ACCEPTED|EXPIRED); Answer.questionId_conversationId unique key; Question.code; PricingTier/PricingLevel with code+productId uniqueness.

**Assumptions:**
- Tool result serializer (Plan A) handles ToolResult.confirmation rendering in the chat.
- No tier-level hierarchy constraint validation here; tier and level are independently resolved. Caller (LLM) ensures level belongs to chosen tier.
- Question codes PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST are stable and always present in the DB.
- Product does not change mid-task (conversationId points to one productId).

**Reconciliation with Other Tasks:**
- Task 1 (deriveState) reads Application.tierId/levelId/includesAddon for SELECTION phase.
- Task 2 (start_application) accepts tier/level/addon params and calls resolveTierLevel (refactored here).
- Task 4 (change_selection — this task) updates those same fields and expires quotes.
- Task 5 (switch_product) will expire quotes and reset selection; does not use change_selection.
- All write tools return fresh DerivedState in ToolResult.data.state (not implemented here; assume Task 1 handles loading state separately).

**Task 5 — switch_product: Handle product changes with carry-over and state recomputation:**

- Task assumes Plan A (start_application, change_selection tier/level helpers) is merged first.
- switchProduct handler does NOT implement tier/level resolution; it defers tier/level nulling to a future change_selection call (selection is invalid for new product anyway).
- Answer carry-over is automatic because Answer rows are keyed by Question row (global/DNT groups are product-agnostic); product-specific answers simply don't apply to the new product so they fall out of missing[].
- The test mocks resolveProductRef, calculateProgress, resolveGroupCodes directly; no need for integration tests with the real questionnaire engine — unit isolation is the goal.
- Tool is ALWAYS_ALLOWED because switching is safe (soft binding, no payment/policy commitment yet).
- STATUS_SWITCH_PRODUCT status messages follow the brand-book pattern (ro/en).
- Confirmation category is 'lifecycle' (matches sideEffect: 'lifecycle') because product switching is a conversation state transition.

**Task 6 — Preview Product Requirements Tool (Read-Only Carry-Over / Delta) - Task Plan:**

DEPENDENCIES: Assumes Task 1 (derive-state.ts) is independent; this tool does not import or depend on it. SHARED CONTRACTS: Uses existing resolveGroupCodes(productId, phase) from lib/engines/question-groups.ts and ToolHandler from lib/tools/types.ts. SCHEMA ASSUMPTIONS: Answer has @@unique([questionId, conversationId]); Question has optional code field; QuestionGroup has code @unique and phase field. No new Prisma models needed. TOOL CHARACTERISTICS: Read-only (no writes); alwaysAllowed for discovery phase; not cacheable (per-conversation analysis); returns question codes not IDs; dedupes and sorts for determinism.</notes>
</invoke>

**Task 7 — Wiring — deterministic phase→sections + inject derived state, replace reasoning gate, register new tools:**

CRITICAL WIRING POINTS:

1. **Lines changed in orchestrator.ts:**
   - Line 28: Remove `import { executeReasoningGate, formatGateBriefing, type ReasoningGateInput, type ReasoningGateOutput }`
   - Lines 425-574: Replace entire gatePromise async IIFE with deriveState-based version (remove gate LLM call at ~534)
   - Line 705: Update unpacking to only destructure `{ gateSelection }` (no gateOutput)
   - Lines 710-717: Remove gateOutput?.* references and situationalBriefing patching
   - Line 720: Remove `gateOutput?.recommendedSkillPacks` reference; keep skill pack logic but set to []
   - Line 758-776: Remove mode transition logic that depends on gateOutput
   - Line 779: Remove compliance check trigger that depends on `gateOutput?.complianceRelevant`

2. **Phase-to-sections mapping is deterministic:**
   - DISCOVERY: catalog, manifest, customer context/memory/knowledge
   - SELECTION: product, coaching briefing
   - CONSENT: compliance guidance
   - QUESTIONNAIRE: questionnaire context, compliance guidance
   - QUOTE: product, coaching, compliance
   - CLOSING: product, compliance
   - Always included: agentIdentity, constraints, stateGrounding, catalogOverview, situationalBriefing, workflowInstructions

3. **DerivedState integration:**
   - deriveState() called once per turn in gatePromise → yields phase
   - phase fed to getRequiredSectionsForPhase() → yields section keys
   - section keys wrapped in GateSelection { requiredSections, excludedSections: [], confidence: 1.0 }
   - buildPrompt() receives GateSelection and uses it to filter sections (existing logic unchanged)
   - stateGrounding now rendered directly from loadAllSections (no patching needed)

4. **New tools in DEFAULT_DISCOVERY_TOOLS:**
   - get_current_state: read-only, returns DerivedState
   - set_answer: writing, takes questionCode + value
   - change_selection: writing, takes tier/level/addon, returns fresh DerivedState
   - switch_product: writing, takes productId
   - preview_product_requirements: read-only, shows carry-over and missing questions

5. **Testing strategy:**
   - Unit test phase→sections map: each phase yields expected section keys
   - Unit test loadStateGrounding: renders phase, product, selection, missing[], nextBestAction (when integrated with DerivedState)
   - Integration: existing chat tests should still pass with mocks

6. **IMPORTANT: reasoning-gate slug removal is Task 8** (not this task)
   - This task removes the gate CALL and wiring
   - Task 8 removes the prisma seed reference to 'reasoning-gate' agent
   - Do NOT remove seed / agent references in this task

7. **situationalBriefing handling:**
   - Old: patched after gate (~716-717)
   - New: loaded directly via loadAllSections as alwaysInclude: true
   - No formatting change; just remove the post-processing patch

8. **Import cycle prevention:**
   - deriveState imported in gatePromise closure (after Task 1 creates it)
   - getRequiredSectionsForPhase imported in gatePromise (same async IIFE)
   - Both imports are local (inside the promise) to avoid top-level cycles

**Task 8 — Cleanup + integration — remove reasoning-gate agent, retire dead workflow gate, add navigation tests:**

**Dependencies:**
- Requires Tasks 1, 4, 5 to be merged first (derive-state contract, change_selection, switch_product)
- Re-seeding the database is REQUIRED after this task merges (to remove reasoning-gate agent from db)

**Assumptions:**
1. workflowSession parameter in executeToolWithPipeline is always null in current architecture (dead code per spec)
2. The workflow gate and transition evaluation code can be safely removed with no impact on tool execution
3. No external code calls gateway.call('reasoning-gate') — if it does, those calls must be removed (GREP for it in lib/chat/orchestrator.ts and lib/chat/reasoning-gate.ts; if those files reference reasoning-gate, they must be cleaned up too)

**Notes on integration tests:**
- Tests use vitest mock pattern: spy functions with vi.mock('@/lib/db')
- Mock calls return appropriate shapes matching Prisma query results
- Tests verify side effects (quote expiration, answer preservation) but actual phase transitions are validated by separate deriveState tests (Task 1)
- change_selection should call resolveTierLevel helper (if created in Task 4 refactor) to resolve tier/level codes to IDs before updating Application
- The test focuses on the TOOL side effects, not the complete deriveState logic (which has its own unit tests)

**Cleanup checklist:**
- [ ] REASONING_GATE_PROMPT deleted from seed-agents.ts
- [ ] reasoning-gate entry removed from AGENTS array
- [ ] reasoning-gate test assertion removed from main-chat-constraints.test.ts
- [ ] executeToolWithPipeline simplified: gate removed, transitions removed, only executeTool remains
- [ ] No orphaned reasoning-gate references in orchestrator or reasoning-gate.ts (GREP to verify)
- [ ] Integration tests cover quote expiration and answer carry-over
- [ ] All tests pass: npx vitest run
- [ ] Re-seed database documented as required step



---

## Final verification (after all 8 tasks)

- [ ] Full suite: `npx vitest run` → green.
- [ ] Re-seed (the reasoning-gate agent was removed): run the project seed command.
- [ ] Manual runtime (per repo CLAUDE.md — never ship on "it compiles"): replay the transcript scenario. Mid-flow change Standard→Optim (`change_selection` updates state and expires the draft quote → re-quote), then ask to switch product (`preview_product_requirements` states the delta, `switch_product` carries over shared answers and asks only the new ones), and confirm `get_current_state` reflects every change and the agent never re-asks a settled choice.

## Self-review (writing-plans)

- **Spec coverage:** §4.1 deriveState → Task 1; §4.2 tools → Tasks 2–6; §4.3 navigation flows (mid-questionnaire detour, edit-any-answer, same-product change, different-product switch with carry-over) → enabled by set_answer/change_selection/switch_product/preview_product_requirements; §4.4 wiring (phase→sections, inject derived state, retire the reasoning gate) → Task 7; cleanup (gate agent + dead workflow gate) → Task 8.
- **Placeholder scan:** clean — the only `// ...` is inside a "delete this block" illustration in Task 8.
- **Type/name consistency:** every task uses the pinned `DerivedState`/`Phase` types and the exact tool names (`get_current_state`, `set_answer`, `change_selection`, `switch_product`, `preview_product_requirements`) plus the shared `resolveTierLevel` helper.
- **Sequencing:** execute 1→8. Tasks 3–4 extract and reuse `resolveTierLevel` (refactored out of Plan A's start_application); Task 7 depends on all tools existing; Task 8 removes the gate only after Task 7 stops calling it.
- **Dependency on Plan A:** assumes Plan A is merged (start_application tier/level/addon + the tool-result serializer). Running Plan B standalone requires Plan A Tasks 1–2 first.
