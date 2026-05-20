# Zeno State Grounding Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prepend an explicit, always-included "current system state" section to every prompt so the LLM always knows what's actually true (workflow, application, product, consent) — preventing the agent from inferring positive state from silence.

**Architecture:** A pure `loadStateGrounding` function in `lib/chat/context-loaders.ts` formats workflow / application / product / consent state into a labelled section using `✓` for present and `✗` for absent. The section sits between `constraints` and `capabilityManifest` (priority 2.5, `alwaysInclude: true`). Customer schema gains three consent-tracking fields populated by tools in a later sub-project.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7, Vitest. Spec: `docs/superpowers/specs/2026-05-20-zeno-state-grounding-design.md`.

---

## File Structure

**Create:**
- `prisma/migrations/<timestamp>_add-customer-consent-tracking/migration.sql` — migration adding the three Customer fields.
- `__tests__/lib/chat/state-grounding.test.ts` — unit tests for `loadStateGrounding`.

**Modify:**
- `prisma/schema.prisma` — add `gdprConsentAt`, `gdprConsentScope`, `aiDisclosureAcknowledgedAt` to `Customer`.
- `lib/chat/turn-context.ts` — extend `TurnContextCustomer` with consent fields, extend `TurnContextConversation.product` with `code` and `name`, update queries.
- `__tests__/lib/chat/turn-context.test.ts` — extend the base fixture.
- `lib/chat/context-loaders.ts` — add `loadStateGrounding` pure function + thread it through `loadAllSections`.
- `lib/chat/prompt-builder.ts` — add `stateGrounding: string` to `PromptSections` and a new `SECTION_REGISTRY` entry at priority 2.5.
- `lib/chat/orchestrator.ts` — pass the new state-grounding inputs (application, product code/name, customer consent fields) into `loadAllSections`.
- `prisma/seeds/seed-agents.ts` — append the state-grounding-reference rule to `main-chat` constraints.

**Run after merging:**
- `npx prisma migrate dev` (or equivalent) to apply the schema migration locally.
- `npx tsx scripts/reseed-agents.ts` to push the updated constraint to the DB.

---

## Task 1: Schema migration — add consent fields to Customer

**Files:**
- Modify: `prisma/schema.prisma:266-293`
- Create: `prisma/migrations/<auto-named>_add-customer-consent-tracking/migration.sql`

- [x] **Step 1: Edit the schema**

In `prisma/schema.prisma`, locate the `Customer` model (line 266). Add the three fields immediately after the existing `updatedAt` field (line 282), before the relation list:

```prisma
model Customer {
  // ... existing fields up through updatedAt ...
  updatedAt          DateTime  @updatedAt

  gdprConsentAt              DateTime?
  gdprConsentScope           String?
  aiDisclosureAcknowledgedAt DateTime?

  conversations     Conversation[]
  // ... rest of relations ...
}
```

- [x] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add-customer-consent-tracking`
Expected: Prisma creates a new migration directory under `prisma/migrations/` with a timestamp-prefixed name. The migration SQL contains three `ALTER TABLE "Customer" ADD COLUMN ...` statements. The migration is then applied to the local database.

- [x] **Step 3: Verify the columns exist**

Create `scripts/check-customer-consent-columns.ts`:

```ts
import { config } from 'dotenv'
config()
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Customer' AND column_name IN ('gdprConsentAt', 'gdprConsentScope', 'aiDisclosureAcknowledgedAt')`,
    )
    console.log(result.map((r) => r.column_name).sort())
    if (result.length !== 3) {
      console.error(`Expected 3 columns, found ${result.length}`)
      process.exit(1)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
```

Run: `npx tsx scripts/check-customer-consent-columns.ts`
Expected: prints `[ 'aiDisclosureAcknowledgedAt', 'gdprConsentAt', 'gdprConsentScope' ]`.

- [x] **Step 4: Clean up the verification script**

Run: `rm scripts/check-customer-consent-columns.ts`

- [x] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Customer consent tracking fields

Adds gdprConsentAt, gdprConsentScope, and aiDisclosureAcknowledgedAt
to the Customer model. Foundation for state grounding (subsystem A)
and the consent tools introduced in subsystem C."
```

---

## Task 2: Extend turn-context to carry consent fields and product code/name

**Files:**
- Modify: `lib/chat/turn-context.ts:14-46, 48-54, 88, 121-130, 157-167, 172-186`
- Modify: `__tests__/lib/chat/turn-context.test.ts:19-40` (and downstream fixtures)

- [x] **Step 1: Extend TurnContextCustomer in lib/chat/turn-context.ts**

Replace the `TurnContextCustomer` interface (lines 48-54):

```ts
export interface TurnContextCustomer {
  name: string | null
  dateOfBirth: Date | null
  extractedProfile: Record<string, unknown>
  language: string
  isAnonymous: boolean
  gdprConsentAt: Date | null
  gdprConsentScope: string | null
  aiDisclosureAcknowledgedAt: Date | null
}
```

- [x] **Step 2: Extend TurnContextConversation.product**

Replace the `product: { id: string } | null` line (line 21) with:

```ts
  product: { id: string; code: string; name: unknown } | null
```

(`name` is typed as `unknown` because the Product model stores names as `Json` localized text — `unknown` makes the consumer cast explicitly.)

- [x] **Step 3: Update the product include**

In the `loadTurnContext` function, find the `product: { select: { id: true } }` line (88) and replace with:

```ts
        product: { select: { id: true, code: true, name: true } },
```

- [x] **Step 4: Update the customer query**

In the customer `findUnique` `select` (lines 122-129), add the three consent fields:

```ts
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true,
        dateOfBirth: true,
        extractedProfile: true,
        language: true,
        isAnonymous: true,
        gdprConsentAt: true,
        gdprConsentScope: true,
        aiDisclosureAcknowledgedAt: true,
      },
    }),
```

- [x] **Step 5: Update the customer shaping block**

Replace lines 172-186 with:

```ts
  const customer: TurnContextCustomer = rawCustomer
    ? {
        name: rawCustomer.name ?? null,
        dateOfBirth: rawCustomer.dateOfBirth ?? null,
        extractedProfile: (rawCustomer.extractedProfile as Record<string, unknown>) ?? {},
        language: rawCustomer.language,
        isAnonymous: rawCustomer.isAnonymous,
        gdprConsentAt: rawCustomer.gdprConsentAt ?? null,
        gdprConsentScope: rawCustomer.gdprConsentScope ?? null,
        aiDisclosureAcknowledgedAt: rawCustomer.aiDisclosureAcknowledgedAt ?? null,
      }
    : {
        name: null,
        dateOfBirth: null,
        extractedProfile: {},
        language: 'ro',
        isAnonymous: true,
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      }
```

- [x] **Step 6: Update the test fixtures in __tests__/lib/chat/turn-context.test.ts**

Read `__tests__/lib/chat/turn-context.test.ts` end-to-end. Locate every spot where:
- A customer fixture is created with `prisma.customer.findUnique` mocked → add the three new fields (set to `null`).
- A product fixture appears as `product: { id: 'prod-1' }` → expand to `product: { id: 'prod-1', code: 'PROD-1', name: { ro: 'Produs 1', en: 'Product 1' } }`.

Add a new test asserting the new fields make it through:

```ts
it('threads customer consent fields and product code/name through', async () => {
  // re-use the base fixture path; assert the resulting TurnContext has
  // gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null,
  // and conversation.product.code === 'PROD-1'.
  // ...
})
```

- [x] **Step 7: Run the turn-context test file**

Run: `npm test -- __tests__/lib/chat/turn-context.test.ts`
Expected: PASS — all existing tests plus the new one pass.

- [x] **Step 8: Commit**

```bash
git add lib/chat/turn-context.ts __tests__/lib/chat/turn-context.test.ts
git commit -m "feat(chat): turn-context carries consent fields and product code/name

Extends TurnContextCustomer with gdprConsentAt, gdprConsentScope, and
aiDisclosureAcknowledgedAt. Extends TurnContextConversation.product with
code and localized name. Both are inputs for the state grounding loader."
```

---

## Task 3: Implement loadStateGrounding

**Files:**
- Modify: `lib/chat/context-loaders.ts` (add new function near the other loaders)
- Create: `__tests__/lib/chat/state-grounding.test.ts`

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/chat/state-grounding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadStateGrounding } from '@/lib/chat/context-loaders'

const emptyState = {
  workflowSession: null,
  application: null,
  product: null,
  customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
} as const

describe('loadStateGrounding', () => {
  it('returns the all-negative form when no state is present', () => {
    const result = loadStateGrounding(emptyState)
    expect(result).toContain('=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===')
    expect(result).toContain('✗ No workflow is active')
    expect(result).toContain('✗ No application has been started')
    expect(result).toContain('✗ No product is selected')
    expect(result).toContain('✗ GDPR consent has NOT been granted by this customer')
    expect(result).toContain('✗ AI disclosure has NOT been acknowledged by this customer')
    expect(result).toContain('You cannot claim to have completed any of these')
  })

  it('returns positive lines for fields that are populated', () => {
    const result = loadStateGrounding({
      workflowSession: {
        currentStep: { code: 'dnt_questionnaire', name: 'DNT Questionnaire' },
        status: 'ACTIVE',
      },
      application: {
        id: 'APP-12345',
        status: 'IN_PROGRESS',
        currentQuestionIndex: 5,
        totalQuestions: 14,
      },
      product: { code: 'LIFE-PRO', name: 'Asigurare Viață Premium' },
      customer: {
        gdprConsentAt: new Date('2026-05-20T12:48:00.000Z'),
        gdprConsentScope: 'data_processing_for_quote',
        aiDisclosureAcknowledgedAt: new Date('2026-05-20T12:45:00.000Z'),
      },
    })

    expect(result).toContain('✓ Active workflow: dnt_questionnaire (DNT Questionnaire)')
    expect(result).toContain('✓ Active application: APP-12345 (question 5/14)')
    expect(result).toContain('✓ Selected product: LIFE-PRO — Asigurare Viață Premium')
    expect(result).toContain('✓ GDPR consent: Granted at 2026-05-20')
    expect(result).toContain('for data_processing_for_quote')
    expect(result).toContain('✓ AI disclosure: Acknowledged at 2026-05-20')
  })

  it('renders mixed states per-line correctly', () => {
    const result = loadStateGrounding({
      workflowSession: null,
      application: null,
      product: { code: 'LIFE-PRO', name: 'Asigurare Viață Premium' },
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    })

    expect(result).toContain('✗ No workflow is active')
    expect(result).toContain('✗ No application has been started')
    expect(result).toContain('✓ Selected product: LIFE-PRO — Asigurare Viață Premium')
    expect(result).toContain('✗ GDPR consent has NOT been granted by this customer')
  })

  it('handles non-string product name shapes by stringifying defensively', () => {
    const result = loadStateGrounding({
      workflowSession: null,
      application: null,
      product: { code: 'LIFE-PRO', name: { ro: 'Asigurare Viață Premium', en: 'Premium Life' } as unknown },
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    })

    expect(result).toMatch(/✓ Selected product: LIFE-PRO — /)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/state-grounding.test.ts`
Expected: FAIL — `loadStateGrounding` is not exported from `@/lib/chat/context-loaders`.

- [x] **Step 3: Implement loadStateGrounding in lib/chat/context-loaders.ts**

Add the function near the other loaders (e.g. after `loadAgentIdentity` around line 60). Also add a helper for the localized product name. Append at an appropriate location in the file:

```ts
/**
 * Load the state grounding section — names the current system state explicitly
 * (✓ / ✗ per fact) so the agent never has to infer reality from silence.
 *
 * Pure function. All inputs come from already-loaded turn context.
 * See docs/superpowers/specs/2026-05-20-zeno-state-grounding-design.md.
 */
export interface StateGroundingInput {
  workflowSession: {
    currentStep: { code: string; name: string }
    status: string
  } | null
  application: {
    id: string
    status: string
    currentQuestionIndex: number | null
    totalQuestions: number | null
  } | null
  product: { code: string; name: unknown } | null
  customer: {
    gdprConsentAt: Date | null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: Date | null
  }
}

function pickProductName(name: unknown): string {
  if (typeof name === 'string') return name
  if (name && typeof name === 'object') {
    const obj = name as Record<string, unknown>
    if (typeof obj.ro === 'string') return obj.ro
    if (typeof obj.en === 'string') return obj.en
  }
  return 'product'
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

export function loadStateGrounding(input: StateGroundingInput): string {
  const lines: string[] = []
  lines.push('=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===')

  if (input.workflowSession) {
    const s = input.workflowSession
    lines.push(`✓ Active workflow: ${s.currentStep.code} (${s.currentStep.name})`)
  } else {
    lines.push('✗ No workflow is active')
  }

  if (input.application) {
    const a = input.application
    const progress = (a.currentQuestionIndex != null && a.totalQuestions != null)
      ? ` (question ${a.currentQuestionIndex}/${a.totalQuestions})`
      : ''
    lines.push(`✓ Active application: ${a.id}${progress}`)
  } else {
    lines.push('✗ No application has been started')
  }

  if (input.product) {
    lines.push(`✓ Selected product: ${input.product.code} — ${pickProductName(input.product.name)}`)
  } else {
    lines.push('✗ No product is selected')
  }

  if (input.customer.gdprConsentAt) {
    const when = formatDate(input.customer.gdprConsentAt)
    const scope = input.customer.gdprConsentScope ?? 'unspecified scope'
    lines.push(`✓ GDPR consent: Granted at ${when} for ${scope}`)
  } else {
    lines.push('✗ GDPR consent has NOT been granted by this customer')
  }

  if (input.customer.aiDisclosureAcknowledgedAt) {
    const when = formatDate(input.customer.aiDisclosureAcknowledgedAt)
    lines.push(`✓ AI disclosure: Acknowledged at ${when}`)
  } else {
    lines.push('✗ AI disclosure has NOT been acknowledged by this customer')
  }

  lines.push('')
  lines.push('You cannot claim to have completed any of these. To change state, call the matching tool and wait for its success.')

  return lines.join('\n')
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- __tests__/lib/chat/state-grounding.test.ts`
Expected: PASS — 4 tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/chat/context-loaders.ts __tests__/lib/chat/state-grounding.test.ts
git commit -m "feat(chat): add loadStateGrounding pure function

Builds the '=== CURRENT SYSTEM STATE ===' section listing workflow,
application, product, and consent state as ✓/✗ lines so the agent
always knows what is and is not true."
```

---

## Task 4: Add stateGrounding to PromptSections and section registry

**Files:**
- Modify: `lib/chat/prompt-builder.ts:24-37, 67-83`
- Modify: `__tests__/lib/chat/prompt-builder.test.ts` (find applicable describe block)

- [x] **Step 1: Write the failing test**

Open `__tests__/lib/chat/prompt-builder.test.ts`. Find the file's existing test for SECTION_REGISTRY ordering or section inclusion. Add a new test at the end:

```ts
describe('stateGrounding section (subsystem A)', () => {
  it('appears after constraints and before capabilityManifest when populated', () => {
    const sections = {
      agentIdentity: 'You are Zeno.',
      capabilityManifest: 'I can use list_products.',
      constraints: 'Be honest.',
      complianceGuidance: null,
      situationalBriefing: null,
      customerMemory: null,
      agentKnowledge: null,
      customerContext: null,
      coachingBriefing: null,
      workflowInstructions: null,
      questionnaireContext: null,
      productContext: null,
      stateGrounding: '=== CURRENT SYSTEM STATE ===\n✗ No workflow is active',
    }
    const result = buildPrompt(sections as any, { requiredSections: [], excludedSections: [], confidence: 1.0 })

    const ai = result.prompt.indexOf('You are Zeno.')
    const constraints = result.prompt.indexOf('Be honest.')
    const stateGrounding = result.prompt.indexOf('=== CURRENT SYSTEM STATE ===')
    const manifest = result.prompt.indexOf('I can use list_products.')

    expect(ai).toBeGreaterThanOrEqual(0)
    expect(constraints).toBeGreaterThan(ai)
    expect(stateGrounding).toBeGreaterThan(constraints)
    expect(manifest).toBeGreaterThan(stateGrounding)
  })

  it('is always included even when gate excludes everything else', () => {
    const sections = {
      agentIdentity: 'You are Zeno.',
      capabilityManifest: null,
      constraints: null,
      complianceGuidance: null,
      situationalBriefing: null,
      customerMemory: null,
      agentKnowledge: null,
      customerContext: null,
      coachingBriefing: null,
      workflowInstructions: null,
      questionnaireContext: null,
      productContext: null,
      stateGrounding: '=== CURRENT SYSTEM STATE ===\n✗ No workflow is active',
    }
    const result = buildPrompt(sections as any, {
      requiredSections: [],
      excludedSections: ['stateGrounding'],
      confidence: 1.0,
    })

    expect(result.prompt).toContain('=== CURRENT SYSTEM STATE ===')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/lib/chat/prompt-builder.test.ts -t "stateGrounding"`
Expected: FAIL — `stateGrounding` not part of PromptSections / section registry.

- [x] **Step 3: Add stateGrounding to PromptSections**

In `lib/chat/prompt-builder.ts`, extend the interface (lines 24-37):

```ts
export interface PromptSections {
  agentIdentity: string | null
  capabilityManifest: string | null
  constraints: string | null
  stateGrounding: string | null
  complianceGuidance: string | null
  situationalBriefing: string | null
  customerMemory: string | null
  agentKnowledge: string | null
  customerContext: string | null
  coachingBriefing: string | null
  workflowInstructions: string | null
  questionnaireContext: string | null
  productContext: string | null
}
```

- [x] **Step 4: Add the section registry entry**

In `lib/chat/prompt-builder.ts`, find the `SECTION_REGISTRY` array (line 67). Insert the new entry between `constraints` (priority 2) and `capabilityManifest` (priority 3):

```ts
const SECTION_REGISTRY: SectionConfig[] = [
  // STABLE PREFIX — rarely changes within a conversation
  { key: 'agentIdentity',       priority: 1,  layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'constraints',         priority: 2,  layer: 'constitution', alwaysInclude: true,  prefix: 'CRITICAL CONSTRAINTS:' },
  { key: 'stateGrounding',      priority: 2.5,layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'capabilityManifest',  priority: 3,  layer: 'constitution', alwaysInclude: false, prefix: 'WHAT I CAN DO:' },
  // ... rest unchanged ...
]
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npm test -- __tests__/lib/chat/prompt-builder.test.ts -t "stateGrounding"`
Expected: PASS — both new tests pass.

- [x] **Step 6: Run the full prompt-builder test file**

Run: `npm test -- __tests__/lib/chat/prompt-builder.test.ts`
Expected: PASS — no regressions.

- [x] **Step 7: Commit**

```bash
git add lib/chat/prompt-builder.ts __tests__/lib/chat/prompt-builder.test.ts
git commit -m "feat(prompt): add stateGrounding section at priority 2.5

State grounding sits between constraints and capabilityManifest in the
constitution layer with alwaysInclude=true. Section content is supplied
by loadStateGrounding from real DB state."
```

---

## Task 5: Wire loadStateGrounding into loadAllSections + orchestrator

**Files:**
- Modify: `lib/chat/context-loaders.ts:704-768`
- Modify: `lib/chat/orchestrator.ts:490-525`
- Modify: `__tests__/lib/chat/context-loaders.test.ts` (if it asserts the returned PromptSections shape)

- [x] **Step 1: Extend loadAllSections inputs**

In `lib/chat/context-loaders.ts`, find `loadAllSections` (line 704). Extend its params interface to include the new fields:

```ts
export async function loadAllSections(params: {
  agentConfig: { systemPrompt: string | null; constraints: string | null }
  allowedTools: string[]
  productId: string | null
  conversationId: string
  customerId: string
  workflowSession: WorkflowSessionData | null
  workflowStepCode: string | null
  situationalBriefing: string | null
  language: 'en' | 'ro'
  prefetchedCustomer?: PrefetchedCustomer
  // NEW — required by state grounding
  stateGroundingInput: import('./context-loaders').StateGroundingInput
}): Promise<PromptSections> {
```

Inside the function, add the synchronous call:

```ts
  // Synchronous loaders
  const agentIdentity = loadAgentIdentity(agentConfig.systemPrompt)
  const capabilityManifest = loadCapabilityManifest(allowedTools)
  const constraints = loadConstraints(agentConfig.constraints)
  const workflowInstructions = loadWorkflowInstructions(workflowSession)
  const stateGrounding = loadStateGrounding(params.stateGroundingInput)  // NEW
```

And in the return object, include `stateGrounding`:

```ts
  return {
    agentIdentity,
    capabilityManifest,
    constraints,
    stateGrounding,  // NEW
    complianceGuidance: null,
    situationalBriefing,
    customerMemory,
    agentKnowledge,
    customerContext,
    coachingBriefing,
    workflowInstructions,
    questionnaireContext,
    productContext,
  }
```

- [x] **Step 2: Update the orchestrator to pass stateGroundingInput**

In `lib/chat/orchestrator.ts`, find the `loadAllSections` call (around line 490). Before the call, build the input:

```ts
      const stateGroundingInput = {
        workflowSession: turnCtx.conversation.workflowSession
          ? {
              currentStep: {
                code: turnCtx.conversation.workflowSession.currentStep.code,
                name: turnCtx.conversation.workflowSession.currentStep.name,
              },
              status: turnCtx.conversation.workflowSession.workflowId ? 'ACTIVE' : 'UNKNOWN',
            }
          : null,
        application: turnCtx.conversation.application
          ? {
              id: state.conversationId, // application doesn't expose id in turnCtx — use conversationId as a stable proxy
              status: turnCtx.conversation.application.status,
              currentQuestionIndex: turnCtx.conversation.application.currentQuestionIndex,
              totalQuestions: turnCtx.conversation.application.totalQuestions,
            }
          : null,
        product: turnCtx.conversation.product
          ? { code: turnCtx.conversation.product.code, name: turnCtx.conversation.product.name }
          : null,
        customer: {
          gdprConsentAt: turnCtx.customer.gdprConsentAt,
          gdprConsentScope: turnCtx.customer.gdprConsentScope,
          aiDisclosureAcknowledgedAt: turnCtx.customer.aiDisclosureAcknowledgedAt,
        },
      }
```

Note on `application.id`: the existing `TurnContextConversation.application` shape does NOT expose the application id (only status, currentQuestionIndex, totalQuestions). If exposing it later is needed for richer grounding, extend `TurnContextConversation.application` similarly to what we did for product. For now, use a placeholder identifier — change `id: state.conversationId` to `id: 'application'` to make the placeholder explicit and not misleading. The grounding line will read `✓ Active application: application (question N/M)`, which is accurate enough until application id is threaded through later.

Then pass it to `loadAllSections`:

```ts
      sections = await loadAllSections({
        agentConfig: { systemPrompt: agentConfig.systemPrompt, constraints: agentConfig.constraints },
        allowedTools: stepAllowedTools,
        productId: state.productId,
        conversationId: state.conversationId,
        customerId: state.customerId,
        workflowSession: workflowSessionData,
        workflowStepCode: state.workflowStepCode,
        situationalBriefing: null,
        language: state.language,
        prefetchedCustomer: turnCtx.customer,
        stateGroundingInput,  // NEW
      })
```

Also: the minimal fallback at line 511-524 needs `stateGrounding: null` added — but per the spec, state grounding is `alwaysInclude: true`, so the fallback should ALSO include a basic grounding (so the agent isn't blind even on fallback). Update the fallback to:

```ts
      sections = {
        agentIdentity: agentConfig.systemPrompt,
        capabilityManifest: null,
        constraints: agentConfig.constraints,
        stateGrounding: loadStateGrounding(stateGroundingInput),  // never null
        complianceGuidance: null,
        situationalBriefing: null,
        customerMemory: null,
        agentKnowledge: null,
        customerContext: null,
        coachingBriefing: null,
        workflowInstructions: null,
        questionnaireContext: null,
        productContext: null,
      }
```

Add the import at the top of orchestrator.ts:

```ts
import { loadAllSections, loadStateGrounding, type WorkflowSessionData } from './context-loaders'
```

- [x] **Step 3: Update existing context-loaders tests**

Open `__tests__/lib/chat/context-loaders.test.ts`. Find any test that calls `loadAllSections` and adapt the call site by adding a sensible `stateGroundingInput`:

```ts
stateGroundingInput: {
  workflowSession: null,
  application: null,
  product: null,
  customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
},
```

Add a new test asserting the section appears in the returned PromptSections:

```ts
it('returns a stateGrounding section in the PromptSections', async () => {
  // ... mock setup (see existing tests for shape) ...
  const sections = await loadAllSections({
    // ... existing args ...
    stateGroundingInput: {
      workflowSession: null,
      application: null,
      product: null,
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    },
  })
  expect(sections.stateGrounding).toContain('=== CURRENT SYSTEM STATE ===')
  expect(sections.stateGrounding).toContain('✗ No workflow is active')
})
```

- [x] **Step 4: Run the chat test suite**

Run: `npm test -- __tests__/lib/chat/`
Expected: PASS — all tests in the directory pass.

- [x] **Step 5: Commit**

```bash
git add lib/chat/context-loaders.ts lib/chat/orchestrator.ts __tests__/lib/chat/context-loaders.test.ts
git commit -m "feat(chat): loadAllSections returns stateGrounding; orchestrator threads consent state

The orchestrator now builds a StateGroundingInput from the turn context
(workflow, application, product, customer consent fields) and passes it
into loadAllSections, which calls loadStateGrounding and returns the
formatted section in the PromptSections object."
```

---

## Task 6: Add state-grounding-reference constraint rule

**Files:**
- Modify: `prisma/seeds/seed-agents.ts:355-361`
- Modify: `__tests__/prisma/seeds/main-chat-constraints.test.ts`

- [x] **Step 1: Add the new constraint**

In `prisma/seeds/seed-agents.ts`, find the `main-chat` constraints array. Add at the end:

```ts
    constraints: JSON.stringify([
      // ... existing rules ...
      'Refer to the CURRENT SYSTEM STATE section as ground truth. If a fact is marked ✗, you cannot claim it is true. To change a state from ✗ to ✓, you must call the matching tool successfully — its confirmation will be rendered for the customer automatically. Do not perform actions that contradict the listed state.',
    ]),
```

- [x] **Step 2: Update the constraint test**

In `__tests__/prisma/seeds/main-chat-constraints.test.ts`, add:

```ts
it('includes the CURRENT SYSTEM STATE grounding rule', () => {
  const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
  const parsed = JSON.parse(mainChat!.constraints as string)
  expect(parsed).toEqual(
    expect.arrayContaining([
      expect.stringContaining('CURRENT SYSTEM STATE'),
    ]),
  )
})
```

- [x] **Step 3: Run the test**

Run: `npm test -- __tests__/prisma/seeds/main-chat-constraints.test.ts`
Expected: PASS — three tests pass (the two existing plus the new one).

- [x] **Step 4: Reseed the DB**

Run: `npx tsx scripts/reseed-agents.ts`
Expected: console output `Agent "main-chat" (main-chat) upserted`.

- [x] **Step 5: Commit**

```bash
git add prisma/seeds/seed-agents.ts __tests__/prisma/seeds/main-chat-constraints.test.ts
git commit -m "feat(agents): add CURRENT SYSTEM STATE grounding rule to main-chat constraints

Agent must treat the state grounding section as ground truth — facts
marked ✗ cannot be claimed in prose. Required companion to subsystem A's
prompt section."
```

---

## Task 7: Full test sweep + mark plan complete

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — full suite passes with no regressions.

- [x] **Step 2: Mark all checkboxes in this plan as completed**

Replace every `- [x]` with `- [x]` in this file.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-20-zeno-state-grounding.md
git commit -m "docs(plans): mark subsystem A plan complete"
```
