# Zeno Quick-Win Fixes — Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Run all commands from the Zeno repo root** (`C:\github\zeno`). Branch: `feat/zeno-state-navigation`.

**Goal:** Ship the low-risk, independently-testable fixes that end the worst behaviors in the audited transcript — endless re-confirmation, re-asking already-chosen package/level/addon, fabricated pre-quote prices, "home → not available", and the dead-end "ofertare nu este disponibilă" — without introducing new architecture.

**Architecture:** Pure, surgical changes to existing units. One new tiny serializer module, one new alias module, targeted edits to `start_application`, `resolveProductRef`, `loadProductContext`/`shapeProductInfo`, the orchestrator's tool-result push, and the main-chat seed prompt. Each task is test-first and committed independently.

**Tech Stack:** Next.js, TypeScript, Prisma, vitest. Tests live in `__tests__/**/*.test.ts`; run with `npx vitest run <path>`. DB is mocked via `vi.mock('@/lib/db')` with per-method spies and a dynamic `await import()` of the subject AFTER the mocks.

**Companion doc:** the design + full root-cause analysis is in `docs/superpowers/specs/2026-06-02-zeno-state-navigation-design.md`. This Plan A is the spec's "prompt-only/low-risk first wave"; the structural `deriveState` + navigation tools are **Plan B** (separate).

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `lib/chat/tool-result-serializer.ts` (new) | Serialize a `ToolResult` for the model, including `confirmation` | 1 |
| `lib/chat/orchestrator.ts` (modify ~1018-1029, ~1418-1427) | Use the serializer at both tool-result push sites | 1 |
| `lib/tools/handlers/application-handlers.ts` (modify `startApplication`) | Accept + persist `tierCode`/`levelCode`/`includesAddon`; upsert their answers | 2 |
| `lib/tools/registry.ts` (modify `start_application` registration) | Expose the new params to the model | 2 |
| `lib/chat/context-loaders.ts` + `lib/tools/shape-product-info.ts` (modify) | Stop emitting per-level/per-addon specific premiums | 3 |
| `lib/products/aliases.ts` (new) | RO/EN term aliases + diacritic stripper | 4 |
| `lib/tools/resolve-product.ts` (modify name block) | Diacritic-insensitive + alias fallback | 4 |
| `prisma/seeds/seed-agents.ts` (modify main-chat prompt) | Pass selections to `start_application`; honest tool-error handling; auto-`generate_quote` at completion | 5 |

**Spec-bug coverage:** §2.1 re-asking → Tasks 2 + 5; §2.2 no-quote → Tasks 2 + 5; §2.3 confirmation-hell → Task 1; §2.4 fabricated price → Task 3; §2.5 catalog/synonym → Task 4. (Structural §4.1-4.4 deriveState/tools/wiring = Plan B.)

---

### Task 1: Feed the tool-result `confirmation` field back to the model

**Files:**
- Create: `lib/chat/tool-result-serializer.ts`
- Create: `__tests__/lib/chat/tool-result-serializer.test.ts`
- Modify: `lib/chat/orchestrator.ts` (~1018-1029 synthetic path and ~1418-1427 standard path)

**Problem:** The orchestrator serializes tool results as JSON for the model at two sites but omits `confirmation`, so the model never learns a choice was bound and re-confirms endlessly. Extract a pure helper, unit-test it, then use it at both sites.

- [ ] **Step 1: Write the failing test.** Create `__tests__/lib/chat/tool-result-serializer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('serializeToolResultForModel', () => {
  it('includes confirmation when present on success', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const toolResult = {
      success: true,
      data: { answerId: 'ans-123' },
      confirmation: { category: 'save' as const, label: 'Answer saved', value: 'apartment: 80 mp', timestamp: '2026-06-02T10:30:00Z' },
    }
    const parsed = JSON.parse(serializeToolResultForModel(toolResult))
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ answerId: 'ans-123' })
    expect(parsed.confirmation).toEqual({ category: 'save', label: 'Answer saved', value: 'apartment: 80 mp', timestamp: '2026-06-02T10:30:00Z' })
  })

  it('omits confirmation when not present', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({ success: true, data: { answerId: 'ans-123' }, message: 'Done' }))
    expect(parsed.confirmation).toBeUndefined()
    expect(parsed.message).toBe('Done')
  })

  it('includes error and omits data on failure', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({ success: false, error: 'Validation failed: missing required field' }))
    expect(parsed.success).toBe(false)
    expect(parsed.error).toBe('Validation failed: missing required field')
    expect(parsed.data).toBeUndefined()
  })

  it('keeps success, message, data, and confirmation together', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({
      success: true, data: { quoteId: 'q-456' }, message: 'Quote calculated',
      confirmation: { category: 'quote' as const, label: 'Premium calculated', value: '245 RON/month', timestamp: '2026-06-02T10:31:00Z' },
    }))
    expect(Object.keys(parsed).sort()).toEqual(['confirmation', 'data', 'message', 'success'].sort())
    expect(parsed.confirmation.category).toBe('quote')
  })
})
```

- [ ] **Step 2: Run it; confirm it fails.** `npx vitest run __tests__/lib/chat/tool-result-serializer.test.ts` → FAIL (module does not exist).

- [ ] **Step 3: Implement the helper.** Create `lib/chat/tool-result-serializer.ts`:

```typescript
import type { ToolResult } from '@/lib/tools/types'

/**
 * Serialize a ToolResult for transmission to the model. Includes success, data,
 * error, message, and confirmation (if present). The confirmation field is
 * critical: it tells the model what side effect was performed, preventing
 * re-confirmation loops.
 */
export function serializeToolResultForModel(toolResult: ToolResult): string {
  const payload: Record<string, unknown> = { success: toolResult.success }
  if (toolResult.data !== undefined) payload.data = toolResult.data
  if (toolResult.error !== undefined) payload.error = toolResult.error
  if (toolResult.message !== undefined) payload.message = toolResult.message
  if (toolResult.confirmation !== undefined) payload.confirmation = toolResult.confirmation
  return JSON.stringify(payload)
}
```

- [ ] **Step 4: Run it; confirm it passes.** `npx vitest run __tests__/lib/chat/tool-result-serializer.test.ts` → all 4 PASS.

- [ ] **Step 5: Wire it into the orchestrator (both sites).** Add the static import near the other imports at the top of `lib/chat/orchestrator.ts`:

```typescript
import { serializeToolResultForModel } from './tool-result-serializer'
```

Then at the **synthetic path (~1018-1029)** replace the `content: JSON.stringify({ success, data, error, message })` object with `content: serializeToolResultForModel(pipelineResult.toolResult)`, and do the identical replacement at the **standard path (~1418-1427)**. Both become:

```typescript
messages.push({
  role: 'tool',
  content: serializeToolResultForModel(pipelineResult.toolResult),
  toolCallId: tc.id,
})
```

(Do NOT use a dynamic `await import` inside the loop — use the static top-of-file import.)

- [ ] **Step 6: Run the chat suite for regressions.** `npx vitest run __tests__/lib/chat/` → all PASS. If an existing orchestrator test asserts the old JSON shape, update it to expect `confirmation` to be present when the mocked tool result includes one.

- [ ] **Step 7: Commit.**

```bash
git add lib/chat/tool-result-serializer.ts __tests__/lib/chat/tool-result-serializer.test.ts lib/chat/orchestrator.ts
git commit -m "feat(chat): include tool-result confirmation in the model-facing payload

Extract serializeToolResultForModel() and use it at both tool-result push
sites so the model sees the confirmation field and stops re-confirming.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Make `start_application` accept and persist the conversational selection (tier/level/addon)

**Files:**
- Modify: `lib/tools/handlers/application-handlers.ts` (`startApplication`, ~29-143; reuses the PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST resolution at ~301-323)
- Modify: `lib/tools/registry.ts` (`start_application` registration, ~652-667)
- Create: `__tests__/lib/tools/handlers/application-handlers.test.ts`

**Problem:** Re-asking happens because conversational selections are never recorded before the questionnaire. Extend `start_application` to accept optional `{ tierCode?, levelCode?, includesAddon? }`, resolve to IDs, set them on the `Application`, and upsert `Answer` rows for the three selection questions so `getNextQuestion` skips them. Invalid codes return a clear error (never silent null).

- [ ] **Step 1: Write the failing test.** Create `__tests__/lib/tools/handlers/application-handlers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaApplicationCreateSpy = vi.fn()
const prismaApplicationFindUniqueSpy = vi.fn()
const prismaConversationFindUniqueSpy = vi.fn()
const prismaConversationUpdateSpy = vi.fn()
const prismaPricingTierFindFirstSpy = vi.fn()
const prismaPricingLevelFindFirstSpy = vi.fn()
const prismaQuestionFindFirstSpy = vi.fn()
const prismaAnswerUpsertSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    application: { create: (...a: unknown[]) => prismaApplicationCreateSpy(...a), findUnique: (...a: unknown[]) => prismaApplicationFindUniqueSpy(...a), update: vi.fn() },
    conversation: { findUnique: (...a: unknown[]) => prismaConversationFindUniqueSpy(...a), update: (...a: unknown[]) => prismaConversationUpdateSpy(...a) },
    pricingTier: { findFirst: (...a: unknown[]) => prismaPricingTierFindFirstSpy(...a) },
    pricingLevel: { findFirst: (...a: unknown[]) => prismaPricingLevelFindFirstSpy(...a) },
    question: { findFirst: (...a: unknown[]) => prismaQuestionFindFirstSpy(...a) },
    answer: { upsert: (...a: unknown[]) => prismaAnswerUpsertSpy(...a) },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({ getNextQuestion: vi.fn(), validateAnswer: vi.fn(), checkForFlags: vi.fn(), calculateProgress: vi.fn() }))
vi.mock('@/lib/engines/question-groups', () => ({ resolveGroupCodes: vi.fn(), resolveActiveProductId: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ trackProductSelected: vi.fn() }))
vi.mock('./insight-bump', () => ({ bumpInsightOnAnswer: vi.fn() }))

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')
const { resolveGroupCodes } = await import('@/lib/engines/question-groups')
const { getNextQuestion, calculateProgress } = await import('@/lib/engines/questionnaire-engine')

const CONTEXT = { conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const } as unknown as Parameters<typeof startApplication>[1]

function mockHappyPathPreamble() {
  prismaConversationFindUniqueSpy.mockResolvedValueOnce({ id: 'conv-1', dntSignedAt: new Date('2026-01-01'), dntValidUntil: null, productId: 'prod-1', candidateProductId: null })
  prismaApplicationFindUniqueSpy.mockResolvedValueOnce(null)
  vi.mocked(resolveGroupCodes).mockResolvedValueOnce(['application_basic'])
  vi.mocked(calculateProgress).mockResolvedValueOnce({ answered: 0, total: 10, percentage: 0 })
}

describe('startApplication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates application with tierId/levelId/includesAddon and upserts the 3 selection answers', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-1', code: 'standard', productId: 'prod-1' })
    prismaPricingLevelFindFirstSpy.mockResolvedValueOnce({ id: 'level-1', code: 'level_2', tierId: 'tier-1' })
    prismaApplicationCreateSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', status: 'OPEN', tierId: 'tier-1', levelId: 'level-1', includesAddon: true })
    prismaQuestionFindFirstSpy
      .mockResolvedValueOnce({ id: 'q-package', code: 'PACKAGE_CHOICE' })
      .mockResolvedValueOnce({ id: 'q-level', code: 'PREMIUM_LEVEL' })
      .mockResolvedValueOnce({ id: 'q-addon', code: 'BD_ADDON_INTEREST' })
    prismaAnswerUpsertSpy.mockResolvedValue({ id: 'ans-1' })
    vi.mocked(getNextQuestion).mockResolvedValueOnce({ question: { id: 'q-age', code: 'AGE', text: { ro: 'Vârsta?', en: 'Age?' }, type: 'text', options: null, helpText: null } as never, progress: { answered: 3, total: 10 } })

    const result = await startApplication({ tierCode: 'standard', levelCode: 'level_2', includesAddon: true }, CONTEXT)

    expect(result.success).toBe(true)
    expect(prismaApplicationCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tierId: 'tier-1', levelId: 'level-1', includesAddon: true }) }))
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledTimes(3)
  })

  it('returns error when tierCode does not resolve', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce(null)
    const result = await startApplication({ tierCode: 'invalid', levelCode: 'level_2', includesAddon: false }, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/tier.*not found/i)
    expect(prismaApplicationCreateSpy).not.toHaveBeenCalled()
  })

  it('returns error when levelCode does not resolve', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-1', code: 'standard' })
    prismaPricingLevelFindFirstSpy.mockResolvedValueOnce(null)
    const result = await startApplication({ tierCode: 'standard', levelCode: 'invalid', includesAddon: false }, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/level.*not found/i)
    expect(prismaApplicationCreateSpy).not.toHaveBeenCalled()
  })

  it('legacy: no args → no selection upserts, nulls on application', async () => {
    mockHappyPathPreamble()
    prismaApplicationCreateSpy.mockResolvedValueOnce({ id: 'app-1', status: 'OPEN', tierId: null, levelId: null, includesAddon: false })
    vi.mocked(getNextQuestion).mockResolvedValueOnce({ question: { id: 'q-package', code: 'PACKAGE_CHOICE', text: { ro: 'Pachet?', en: 'Package?' }, type: 'select', options: [], helpText: null } as never, progress: { answered: 0, total: 10 } })
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(true)
    expect(prismaAnswerUpsertSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it; confirm it fails.** `npx vitest run __tests__/lib/tools/handlers/application-handlers.test.ts` → FAIL (args not accepted).

- [ ] **Step 3: Extend the `start_application` registration** in `lib/tools/registry.ts` (~652-667) — add to `parameters.properties`:

```typescript
tierCode: { type: 'string', description: 'Optional. Pricing tier code (e.g. "standard", "optim") the customer already chose conversationally. Resolves to Application.tierId and records the PACKAGE_CHOICE answer so it is not re-asked.' },
levelCode: { type: 'string', description: 'Optional. Pricing level code (e.g. "level_2") within the tier. Requires tierCode. Resolves to Application.levelId and records the PREMIUM_LEVEL answer.' },
includesAddon: { type: 'boolean', description: 'Optional. Whether the customer chose the add-on. Sets Application.includesAddon and records the BD_ADDON_INTEREST answer.' },
```

- [ ] **Step 4: Implement.** Replace `startApplication` in `lib/tools/handlers/application-handlers.ts` (~29-143):

```typescript
export const startApplication: ToolHandler = async (args, context) => {
  try {
    const tierCode = args.tierCode as string | undefined
    const levelCode = args.levelCode as string | undefined
    const includesAddon = args.includesAddon as boolean | undefined

    const conv = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { dntSignedAt: true, dntValidUntil: true, productId: true, candidateProductId: true },
    })
    const dntValid = !!conv?.dntSignedAt && (!conv.dntValidUntil || conv.dntValidUntil > new Date())
    if (!dntValid) return { success: false, error: 'DNT must be signed before starting an application.' }

    const existing = await prisma.application.findUnique({ where: { conversationId: context.conversationId } })
    if (existing && existing.status === 'OPEN') {
      return { success: true, data: { alreadyExists: true, applicationId: existing.id }, message: 'An open application already exists for this conversation.' }
    }

    const productId: string | null = context.product?.id ?? conv?.productId ?? conv?.candidateProductId ?? null
    if (!productId) return { success: false, error: 'No product selected. Call set_candidate_product first or pass an explicit productId.' }

    let tierId: string | null = null
    if (tierCode) {
      const tier = await prisma.pricingTier.findFirst({ where: { productId, code: tierCode } })
      if (!tier) return { success: false, error: `Pricing tier "${tierCode}" not found for this product. Provide a valid tier code.` }
      tierId = tier.id
    }

    let levelId: string | null = null
    if (levelCode) {
      if (!tierId) return { success: false, error: 'levelCode requires tierCode to be provided first.' }
      const level = await prisma.pricingLevel.findFirst({ where: { tierId, code: levelCode } })
      if (!level) return { success: false, error: `Pricing level "${levelCode}" not found for the selected tier. Provide a valid level code.` }
      levelId = level.id
    }

    const codes = await resolveGroupCodes(productId, 'application')
    const progress = await calculateProgress(codes, context.conversationId)

    const application = await prisma.application.create({
      data: {
        conversationId: context.conversationId,
        customerId: context.customerId,
        productId,
        tierId,
        levelId,
        includesAddon: includesAddon ?? false,
        status: 'OPEN',
        currentQuestionIndex: 0,
        totalQuestions: progress.total,
      },
    })

    // Record the conversational selections as Answers so getNextQuestion skips them.
    const recordSelection = async (questionCode: string, value: string) => {
      const q = await prisma.question.findFirst({ where: { code: questionCode, group: { code: { in: codes } } } })
      if (!q) return
      await prisma.answer.upsert({
        where: { questionId_conversationId: { questionId: q.id, conversationId: context.conversationId } },
        create: { questionId: q.id, conversationId: context.conversationId, value },
        update: { value, answeredAt: new Date() },
      })
    }
    if (tierCode) await recordSelection('PACKAGE_CHOICE', tierCode)
    if (levelCode) await recordSelection('PREMIUM_LEVEL', levelCode)
    if (includesAddon !== undefined) await recordSelection('BD_ADDON_INTEREST', String(includesAddon))

    if (context.product?.id !== productId) {
      await prisma.conversation.update({ where: { id: context.conversationId }, data: { productId } })
    }

    const result = await getNextQuestion(codes, context.conversationId)
    if (!result) return { success: false, error: 'No application questions configured.' }

    const lang = context.language ?? 'ro'
    const q = result.question
    const text = q.text as { en: string; ro: string }
    return {
      success: true,
      data: {
        applicationStarted: true,
        applicationId: application.id,
        currentQuestion: { id: q.id, code: q.code, text: text[lang], helpText: q.helpText ? (q.helpText as { en: string; ro: string })[lang] : null, type: q.type, options: q.options },
        progress: result.progress,
      },
      message: 'Application started.',
      uiAction: { type: 'show_question', payload: { question: { id: q.id, code: q.code, text: q.text as { en: string; ro: string }, helpText: q.helpText as { en: string; ro: string } | null, type: q.type, options: q.options }, progress: result.progress, groupType: 'application' } as unknown as Record<string, unknown> },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

- [ ] **Step 5: Run; confirm all 4 pass.** `npx vitest run __tests__/lib/tools/handlers/application-handlers.test.ts` → PASS. Then `npx vitest run __tests__/lib/tools/handlers/` → no regressions.

- [ ] **Step 6: Commit.**

```bash
git add lib/tools/handlers/application-handlers.ts lib/tools/registry.ts __tests__/lib/tools/handlers/application-handlers.test.ts
git commit -m "feat(application): start_application accepts and records tier/level/addon

Resolve tierCode/levelCode to ids, set them on the Application at creation, and
upsert PACKAGE_CHOICE/PREMIUM_LEVEL/BD_ADDON_INTEREST answers so the questionnaire
no longer re-asks choices made conversationally. Invalid codes return a clear error.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Note:** the prompt must instruct the agent to pass these args — that is Task 5.

---

### Task 3: Suppress per-level / per-addon specific premiums from product discovery context

**Files:**
- Create: `__tests__/lib/chat/context-loaders.test.ts`
- Create: `__tests__/lib/tools/shape-product-info.test.ts`
- Modify: `lib/chat/context-loaders.ts` (`loadProductContext`, per-level emit ~268-272 and addon premium emit ~290-295)
- Modify: `lib/tools/shape-product-info.ts` (`ShapedLevel` ~112-118, `ShapedAddon` ~126-133, mapping ~205-233)

**Problem:** The model states fabricated specific prices (290/350/640 RON) before any quote because per-level `premiumAnnual` is baked into context and `get_product_info`. Show only the product `premiumRange` (or a "see quote" note); specific numbers come only from `generate_quote`.

- [ ] **Step 1: Write the failing `loadProductContext` test.** Create `__tests__/lib/chat/context-loaders.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueSpy = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { product: { findUnique: (...a: unknown[]) => findUniqueSpy(...a) } } }))
const { loadProductContext } = await import('@/lib/chat/context-loaders')

describe('loadProductContext', () => {
  beforeEach(() => vi.clearAllMocks())
  it('omits per-level premium numbers when pricingTiers exist', async () => {
    findUniqueSpy.mockResolvedValueOnce({
      id: 'prod-1', code: 'protect', name: { en: 'Protect', ro: 'Protect' }, description: { en: 'x', ro: 'x' },
      insuranceType: 'LIFE', subType: 'TERM', features: [], premiumRange: { en: '290-640 RON/yr', ro: '290-640 RON/an' },
      pricingTiers: [{ name: { en: 'Basic', ro: 'Bază' }, isActive: true, orderIndex: 0, levels: [
        { name: { en: 'Level 1', ro: 'Nivel 1' }, premiumAnnual: 290, currency: 'RON', isActive: true },
        { name: { en: 'Level 2', ro: 'Nivel 2' }, premiumAnnual: 350, currency: 'RON', isActive: true },
      ] }], addons: [],
    })
    const result = await loadProductContext('prod-1', 'en')
    expect(result).not.toBeNull()
    expect(result).not.toMatch(/\d+\s*RON\/year/)
    expect(result).toContain('Pricing:')
  })
})
```

- [ ] **Step 2: Write the failing `shapeProductInfo` test.** Create `__tests__/lib/tools/shape-product-info.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
const { shapeProductInfo } = await import('@/lib/tools/shape-product-info')

describe('shapeProductInfo', () => {
  it('removes premiumAnnual from shaped levels', () => {
    const shaped = shapeProductInfo({
      code: 'protect', name: { en: 'P', ro: 'P' }, description: { en: 'x', ro: 'x' }, insuranceType: 'LIFE',
      pricingTiers: [{ code: 'basic', name: { en: 'Basic', ro: 'Bază' }, levels: [{ code: 'l1', name: { en: 'L1', ro: 'N1' }, premiumAnnual: 290, currency: 'RON' }] }], addons: [],
    } as never)
    for (const pkg of shaped.packages) for (const level of pkg.levels) expect(level).not.toHaveProperty('premiumAnnual')
  })
  it('removes premiums from shaped addons', () => {
    const shaped = shapeProductInfo({
      code: 'protect', name: { en: 'P', ro: 'P' }, description: { en: 'x', ro: 'x' }, insuranceType: 'LIFE', pricingTiers: [],
      addons: [{ code: 'ci', name: { en: 'CI', ro: 'CI' }, description: { en: 'x', ro: 'x' }, pricingRules: [{ minAge: 18, maxAge: 65, premiumAnnual: 50, currency: 'RON' }] }],
    } as never)
    for (const addon of shaped.addons) for (const premium of (addon as { premiums?: unknown[] }).premiums ?? []) expect(premium).not.toHaveProperty('premiumAnnual')
  })
})
```

- [ ] **Step 3: Run both; confirm they fail.** `npx vitest run __tests__/lib/chat/context-loaders.test.ts __tests__/lib/tools/shape-product-info.test.ts` → FAIL (premiums still emitted).

- [ ] **Step 4: Edit `lib/tools/shape-product-info.ts`.** Remove `premiumAnnual: number` from the `ShapedLevel` interface (~112-118). Remove the `premiums` array from the `ShapedAddon` interface (~126-133). In the mapping (~205-233), drop the `premiumAnnual: level.premiumAnnual,` line from the level map and delete the entire `premiums` construction + the `premiums,` property from the addon return. (Keep coverages, names, codes, currency, waitingPeriod.)

- [ ] **Step 5: Edit `lib/chat/context-loaders.ts` `loadProductContext`.** Replace the per-level emit (~262-274) with a premiumRange-or-note block:

```typescript
if (product.pricingTiers.length > 0) {
  parts.push('')
  parts.push('Pricing:')
  if (product.premiumRange) {
    const range = typeof product.premiumRange === 'string'
      ? product.premiumRange
      : ((product.premiumRange as unknown as LocalizedText)[language] ?? 'See quote for exact pricing')
    parts.push(`Premium range: ${range}`)
  } else {
    parts.push('Exact pricing is available only via generate_quote, after the application is complete.')
  }
}
```

And delete the addon age-band premium emit (~290-295) — keep the addon name, coverages, and waiting period; remove the `${age} = ${rule.premiumAnnual} RON/year` lines.

- [ ] **Step 6: Run the new tests; confirm pass.** `npx vitest run __tests__/lib/chat/context-loaders.test.ts __tests__/lib/tools/shape-product-info.test.ts` → PASS.

- [ ] **Step 7: Guard against other consumers.** Run `git grep -n "premiumAnnual" lib app` and confirm no non-quote code reads `ShapedLevel.premiumAnnual` or `ShapedAddon.premiums`. Fix any that do (the quote path reads `PricingLevel.premiumAnnual` directly from the DB, not from the shaped object, so it is unaffected). Run `npx vitest run __tests__/lib/tools/` to confirm `get_product_info` tests still pass.

- [ ] **Step 8: Commit.**

```bash
git add __tests__/lib/chat/context-loaders.test.ts __tests__/lib/tools/shape-product-info.test.ts lib/chat/context-loaders.ts lib/tools/shape-product-info.ts
git commit -m "fix(pricing): stop leaking per-level premiums into discovery context

loadProductContext and shapeProductInfo no longer emit specific per-level/per-addon
premiums; they show only the product premiumRange. Specific prices now come solely
from generate_quote, fixing fabricated pre-quote prices.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tolerant product resolution (diacritic-insensitive + alias fallback)

**Files:**
- Create: `lib/products/aliases.ts`
- Create: `__tests__/lib/products/aliases.test.ts`
- Modify: `lib/tools/resolve-product.ts` (after the name block ~56-67)
- Create: `__tests__/lib/tools/resolve-product-tolerant.test.ts`

**Problem:** Exact substring + "only if exactly one match" makes "home" → "property/locuință" fail and return `null` → the agent says "not available". Add a diacritic stripper, an alias map, and a fallback in `resolveProductRef`.

- [ ] **Step 1: Write the failing pure-unit test.** Create `__tests__/lib/products/aliases.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
const { stripDiacritics, lookupAlias } = await import('@/lib/products/aliases')

describe('stripDiacritics', () => {
  it('maps Romanian diacritics to ASCII', () => {
    expect(stripDiacritics('locuință')).toBe('locuinta')
    expect(stripDiacritics('LOCUINȚĂ')).toBe('LOCUINTA')
    expect(stripDiacritics('ă î â ș ț')).toBe('a i a s t')
  })
  it('is idempotent and leaves non-Latin unchanged', () => {
    expect(stripDiacritics(stripDiacritics('viață'))).toBe('viata')
    expect(stripDiacritics('日本')).toBe('日本')
  })
})

describe('lookupAlias', () => {
  it('resolves home/casa/locuință → property', () => {
    expect(lookupAlias('home')?.productCode).toBe('property')
    expect(lookupAlias('casa')?.productCode).toBe('property')
    expect(lookupAlias('locuință')?.productCode).toBe('property')
  })
  it('resolves life/auto aliases and is case-insensitive', () => {
    expect(lookupAlias('viață')?.insuranceType).toBe('life')
    expect(lookupAlias('mașină')?.insuranceType).toBe('auto')
    expect(lookupAlias('HOME')).toEqual(lookupAlias('home'))
  })
  it('returns null for unknown terms', () => {
    expect(lookupAlias('nonsense')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it; confirm it fails.** `npx vitest run __tests__/lib/products/aliases.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/products/aliases.ts`:**

```typescript
/**
 * Maps customer-friendly terms (en/ro, with/without diacritics) to product codes /
 * insurance types, so product lookup tolerates synonyms. Extend ALIASES freely.
 */
export function stripDiacritics(input: string): string {
  if (typeof input !== 'string') return ''
  const map: Record<string, string> = { 'ă': 'a', 'Ă': 'A', 'î': 'i', 'Î': 'I', 'â': 'a', 'Â': 'A', 'ș': 's', 'Ș': 'S', 'ț': 't', 'Ț': 'T' }
  return input.split('').map((c) => map[c] ?? c).join('')
}

export interface AliasLookupResult { productCode: string; insuranceType: string }

const ALIASES: Record<string, AliasLookupResult> = {
  home: { productCode: 'property', insuranceType: 'property' },
  property: { productCode: 'property', insuranceType: 'property' },
  casa: { productCode: 'property', insuranceType: 'property' },
  locuinta: { productCode: 'property', insuranceType: 'property' },
  household: { productCode: 'property', insuranceType: 'property' },
  life: { productCode: 'LIFE', insuranceType: 'life' },
  viata: { productCode: 'LIFE', insuranceType: 'life' },
  protectie: { productCode: 'LIFE', insuranceType: 'life' },
  auto: { productCode: 'auto', insuranceType: 'auto' },
  car: { productCode: 'auto', insuranceType: 'auto' },
  masina: { productCode: 'auto', insuranceType: 'auto' },
  vehicul: { productCode: 'auto', insuranceType: 'auto' },
  health: { productCode: 'health', insuranceType: 'health' },
  sanatate: { productCode: 'health', insuranceType: 'health' },
  medical: { productCode: 'health', insuranceType: 'health' },
}

export function lookupAlias(customerInput: string): AliasLookupResult | null {
  if (typeof customerInput !== 'string' || customerInput.trim().length === 0) return null
  return ALIASES[stripDiacritics(customerInput.trim().toLowerCase())] ?? null
}
```

- [ ] **Step 4: Run it; confirm pass.** `npx vitest run __tests__/lib/products/aliases.test.ts` → PASS.

- [ ] **Step 5: Write the failing tolerant resolution test.** Create `__tests__/lib/tools/resolve-product-tolerant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueSpy = vi.fn()
const findFirstSpy = vi.fn()
const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { product: { findUnique: (...a: unknown[]) => findUniqueSpy(...a), findFirst: (...a: unknown[]) => findFirstSpy(...a), findMany: (...a: unknown[]) => findManySpy(...a) } } }))
const { resolveProductRef } = await import('@/lib/tools/resolve-product')

describe('resolveProductRef – tolerant', () => {
  beforeEach(() => { findUniqueSpy.mockReset(); findFirstSpy.mockReset(); findManySpy.mockReset() })

  it('resolves "home" via alias to property', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)   // exact code
    findFirstSpy.mockResolvedValueOnce(null)    // case-insensitive code
    findManySpy.mockResolvedValueOnce([])       // name substring
    findFirstSpy.mockResolvedValueOnce(null)    // diacritic-normalized code
    findFirstSpy.mockResolvedValueOnce({ id: 'p-prop', code: 'property' }) // alias retry
    const ref = await resolveProductRef({ productCode: 'home' })
    expect(ref).toEqual({ id: 'p-prop', code: 'property', matchedBy: 'alias' })
  })

  it('resolves "locuință" via diacritic-normalized code', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)
    findFirstSpy.mockResolvedValueOnce(null)
    findManySpy.mockResolvedValueOnce([])
    findFirstSpy.mockResolvedValueOnce({ id: 'p-prop', code: 'locuinta' }) // diacritic-normalized hit
    const ref = await resolveProductRef({ productCode: 'locuință' })
    expect(ref).toEqual({ id: 'p-prop', code: 'locuinta', matchedBy: 'code-normalized' })
  })

  it('returns null when nothing matches', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)
    findFirstSpy.mockResolvedValueOnce(null)
    findManySpy.mockResolvedValueOnce([])
    findFirstSpy.mockResolvedValueOnce(null) // diacritic
    const ref = await resolveProductRef({ productCode: 'nonsense' })
    expect(ref).toBeNull()
  })
})
```

- [ ] **Step 6: Run it; confirm fail.** `npx vitest run __tests__/lib/tools/resolve-product-tolerant.test.ts` → FAIL.

- [ ] **Step 7: Extend `resolveProductRef`** in `lib/tools/resolve-product.ts`. Add `import { stripDiacritics, lookupAlias } from '@/lib/products/aliases'`, add `'alias'` to the `MatchedBy` union, and insert after the existing `byName` block (before the final `return null`):

```typescript
    // Diacritic-insensitive code match (e.g. "locuință" -> "locuinta")
    const stripped = stripDiacritics(rawCode.toLowerCase())
    if (stripped !== rawCode.toLowerCase()) {
      const dia = await prisma.product.findFirst({
        where: { code: { equals: stripped, mode: 'insensitive' } },
        select: { id: true, code: true },
      })
      if (dia) return { id: dia.id, code: dia.code, matchedBy: 'code-normalized' }
    }

    // Alias fallback (e.g. "home"/"casa" -> property; "viata" -> LIFE)
    const alias = lookupAlias(rawCode)
    if (alias) {
      const byAlias = await prisma.product.findFirst({
        where: { code: { equals: alias.productCode, mode: 'insensitive' } },
        select: { id: true, code: true },
      })
      if (byAlias) return { id: byAlias.id, code: byAlias.code, matchedBy: 'alias' }
    }
```

> If the test's diacritic case overlaps the alias case, keep the ordering above (diacritic first, then alias) — the test mocks reflect that order. Update `MatchedBy` to `'id' | 'code-exact' | 'code-normalized' | 'name' | 'alias'`.

- [ ] **Step 8: Run; confirm pass + no regressions.** `npx vitest run __tests__/lib/tools/resolve-product*.test.ts __tests__/lib/products/aliases.test.ts` → all PASS.

- [ ] **Step 9: Commit.**

```bash
git add lib/products/aliases.ts lib/tools/resolve-product.ts __tests__/lib/products/aliases.test.ts __tests__/lib/tools/resolve-product-tolerant.test.ts
git commit -m "feat(products): tolerant resolution via diacritics + alias map

resolveProductRef now strips Romanian diacritics and consults an alias map
(home/casa/locuință->property, viață->LIFE, mașină->auto) before giving up,
so customer synonyms no longer yield a dead-end 'not available'.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Follow-up (Plan B):** on a genuine miss, handlers should return `listAvailableProductRefs()` as a choice menu rather than `null`. Tracked in Plan B.

---

### Task 5: Prompt fixes — pass selections, stop swallowing errors, drive the quote

**Files:**
- Modify: `prisma/seeds/seed-agents.ts` (main-chat `systemPrompt`: line ~56 error handling; lines ~91-97 ADVANCING TO THE OFFER)
- Modify: `__tests__/prisma/seeds/main-chat-constraints.test.ts`

**Problem:** Three behaviors to encode in the main-chat prompt: pass `tierCode/levelCode/includesAddon` to `start_application` at convergence; on a tool error, read+fix the precondition instead of claiming "not available"; the moment the application is complete, call `generate_quote`.

> **After this task, re-seed** so the DB Agent row picks up the new prompt: run the project seed command (e.g. `npx prisma db seed` or the script in `package.json`).

- [ ] **Step 1: Write the failing assertions.** Append to `__tests__/prisma/seeds/main-chat-constraints.test.ts`:

```typescript
it('requires passing tier/level/addon to start_application', () => {
  const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
  expect(mainChat?.systemPrompt).toMatch(/tierCode.*levelCode.*includesAddon/i)
  expect(mainChat?.systemPrompt).toMatch(/not.*re-?asked/i)
})
it('requires honest tool-error handling (no silent "not available")', () => {
  const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
  expect(mainChat?.systemPrompt).toMatch(/success:\s*false/i)
  expect(mainChat?.systemPrompt).toMatch(/read the error/i)
})
it('requires generate_quote immediately on completion', () => {
  const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
  expect(mainChat?.systemPrompt).toMatch(/isComplete|readyForQuote/i)
  expect(mainChat?.systemPrompt).toMatch(/generate_quote/i)
})
```

- [ ] **Step 2: Run; confirm fail.** `npx vitest run __tests__/prisma/seeds/main-chat-constraints.test.ts` → 3 new assertions FAIL.

- [ ] **Step 3: Edit the convergence sequence** (seed-agents.ts ~line 95). Append to the tool-sequence sentence: `... sign_dnt → start_application (CRITICAL: pass the chosen tierCode, levelCode and includesAddon so they are NOT re-asked in the questionnaire) → save_application_answer (one per reply) → generate_quote. Do NOT re-ask tier/level/addon — they are bound at start_application time.`

- [ ] **Step 4: Replace the graceful-degradation line** (seed-agents.ts ~line 56) with honest error handling:

```
- If a tool returns success: false with an error, do NOT tell the customer the information "is not available". Read the error — it usually names a missing precondition (e.g. an application must be started, or a consent signed). Address that precondition by calling the right prerequisite tool, then retry. Only if it is genuinely unfixable, surface it honestly and offer to retry — never swallow a tool error and claim data is unavailable.
```

- [ ] **Step 5: Add the completion rule** after the ADVANCING TO THE OFFER block (~line 97):

```
- COMPLETION RULE: the moment save_application_answer returns isComplete/readyForQuote, your VERY NEXT action is generate_quote, then present the real premium. NEVER end with "ofertare nu este disponibilă"; if generate_quote errors, apply the error-handling rule above and retry.
```

- [ ] **Step 6: Run; confirm all pass.** `npx vitest run __tests__/prisma/seeds/main-chat-constraints.test.ts` → all PASS (new + existing).

- [ ] **Step 7: Re-seed and commit.**

```bash
npx prisma db seed   # or the project's seed command, to apply the new prompt to the Agent row
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts
git commit -m "fix(prompt): pass selections to start_application, honest tool errors, drive quote

Main-chat prompt now: passes tier/level/addon to start_application (no re-asking),
reads+fixes tool-error preconditions instead of claiming data unavailable, and calls
generate_quote the moment the application completes.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all 5 tasks)

- [ ] Run the full suite: `npx vitest run` → all green.
- [ ] Manual runtime check (per repo CLAUDE.md — do not ship on "it compiles"): start the app, run the transcript scenario — say "vreau asigurare de locuință", converge on Standard/Nivel II + add-on, proceed. Confirm: the catalog is searched (no premature "not available"), package/level/addon are NOT re-asked in the questionnaire, no specific price is stated before the quote, and the flow ends with a real `generate_quote` premium — not "ofertare nu este disponibilă".

## Self-review (writing-plans)

- **Spec coverage:** §2.1→T2+T5, §2.2→T2+T5, §2.3→T1, §2.4→T3, §2.5→T4. Structural §4.1-4.4 (deriveState, get_current_state, set_answer, change_selection, switch_product, preview_product_requirements, phase→sections wiring, retire gate) are intentionally **out of scope → Plan B**.
- **Placeholder scan:** none — every step has real code/commands.
- **Type/name consistency:** `serializeToolResultForModel`, `startApplication({tierCode,levelCode,includesAddon})`, `stripDiacritics`/`lookupAlias`, `MatchedBy` includes `'alias'`. Task 5's prompt references the same `start_application` args as Task 2. Consistent.
- **Known assumptions to verify at execution time (tests will catch):** exact `loadProductContext` signature and the `ShapedLevel`/`ShapedAddon` field names; that `getNextQuestion` skips a question once an `Answer` row exists (confirmed in the engine); the `start_application` registration line range; the project seed command name.
