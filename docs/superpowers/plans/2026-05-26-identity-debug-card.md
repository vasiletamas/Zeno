# Identity & Stored-Context Debug Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a developer-only debug card rendered above the Gate section in each TurnCard that shows the cookie-resolved identity, Customer row fields, consent state, and CustomerInsight memory loaded for that turn — with client-side diff highlighting between consecutive turns.

**Architecture:** A new `debug:identity` SSE event emitted once per turn by the orchestrator (gated by `isDev() && debugEnabled`). The structured `memory` payload is sourced from a pre-fetched `CustomerInsight[]` that is also threaded into `loadAllSections → loadCustomerMemory` so total DB query count stays unchanged. The reducer attaches the payload to the matching `DebugTurn`. A new `IdentitySection` React component reads `turn.identity` and the previous turn's identity, runs a pure `diffIdentity` helper, and renders the card with yellow-highlight annotations on changed fields.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Prisma 7, vitest 4 (node env, no jsdom). Spec lives at `docs/superpowers/specs/2026-05-26-identity-debug-card-design.md`.

---

## File Structure

**Modify:**
- `lib/chat/context-loaders.ts` — extract `loadCustomerInsights`, make `loadCustomerMemory` accept optional pre-fetched insights, thread `preloadedInsights` through `loadAllSections`.
- `lib/chat/debug.ts` — add `DebugIdentityPayload`, extend `DebugEvent`, add `buildIdentityPayload()` pure helper.
- `lib/chat/orchestrator.ts` — in dev+debug mode, pre-fetch insights once, emit `debug:identity`, pass insights into `loadAllSections`.
- `lib/debug/reducer.ts` — add `identity` to `DebugTurn`, add reducer case for `debug:identity`.
- `components/debug/turn-card.tsx` — render `<IdentitySection>` above `<GateSection>`.

**Create:**
- `components/debug/sections/identity-section.tsx` — the card.
- `components/debug/sections/identity-diff.ts` — pure diff helper.
- `__tests__/lib/chat/debug-identity.test.ts` — unit test for `buildIdentityPayload`.
- `__tests__/lib/chat/customer-memory-preload.test.ts` — regression test that `loadCustomerMemory` accepts preloaded insights.
- `__tests__/components/debug/identity-diff.test.ts` — unit test for `diffIdentity`.

---

## Task 1: Extract `loadCustomerInsights` and make `loadCustomerMemory` accept preloaded rows

**Files:**
- Modify: `lib/chat/context-loaders.ts:739-780`
- Test: `__tests__/lib/chat/customer-memory-preload.test.ts`

This is a refactor with two new behaviours: (a) calling `loadCustomerMemory(customerId, preloadedInsights)` must use the preloaded array and skip the DB; (b) calling `loadCustomerInsights(customerId)` returns the raw rows.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/chat/customer-memory-preload.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: {
      findMany: (...args: unknown[]) => findManySpy(...args),
    },
  },
}))

const { loadCustomerMemory, loadCustomerInsights } = await import('@/lib/chat/context-loaders')

const sampleInsight = {
  id: 'i1',
  customerId: 'c1',
  category: 'preferences',
  key: 'language',
  value: 'ro',
  confidence: 0.9,
  lastConfirmedAt: new Date('2026-05-20T12:00:00Z'),
  createdAt: new Date('2026-05-20T12:00:00Z'),
  updatedAt: new Date('2026-05-20T12:00:00Z'),
} as const

describe('loadCustomerMemory — preloaded insights', () => {
  it('uses preloaded insights and does not query the DB', async () => {
    findManySpy.mockClear()
    const text = await loadCustomerMemory('c1', [sampleInsight])
    expect(findManySpy).not.toHaveBeenCalled()
    expect(text).toContain('language: ro')
    expect(text).toContain('preferences:')
  })

  it('falls back to querying when no preloaded insights are passed', async () => {
    findManySpy.mockClear()
    findManySpy.mockResolvedValueOnce([sampleInsight])
    const text = await loadCustomerMemory('c1')
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(text).toContain('language: ro')
  })

  it('returns null when preloaded insights is an empty array', async () => {
    findManySpy.mockClear()
    const text = await loadCustomerMemory('c1', [])
    expect(findManySpy).not.toHaveBeenCalled()
    expect(text).toBeNull()
  })
})

describe('loadCustomerInsights', () => {
  it('returns raw rows from prisma.customerInsight.findMany', async () => {
    findManySpy.mockClear()
    findManySpy.mockResolvedValueOnce([sampleInsight])
    const rows = await loadCustomerInsights('c1')
    expect(rows).toEqual([sampleInsight])
    expect(findManySpy).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
    })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npx vitest run __tests__/lib/chat/customer-memory-preload.test.ts
```

Expected: FAIL because `loadCustomerInsights` does not exist and `loadCustomerMemory` ignores the second arg.

- [ ] **Step 3: Implement the refactor**

Open `lib/chat/context-loaders.ts`. Find the existing `loadCustomerMemory` at line 739. Replace it with:

```ts
/**
 * Raw `CustomerInsight` row type as returned by Prisma's findMany.
 * Exposed so callers (orchestrator debug path) can pre-fetch once.
 */
export type RawCustomerInsight = Awaited<
  ReturnType<typeof prisma.customerInsight.findMany>
>[number]

/**
 * Fetch the raw CustomerInsight rows for a customer, ordered by confidence
 * then recency. Exposed so the orchestrator's debug path can pre-fetch
 * once and then pass the array into both loadCustomerMemory (for prompt
 * text) and the debug:identity event (for the structured payload).
 */
export async function loadCustomerInsights(
  customerId: string,
): Promise<RawCustomerInsight[]> {
  return prisma.customerInsight.findMany({
    where: { customerId },
    orderBy: [
      { confidence: 'desc' },
      { lastConfirmedAt: 'desc' },
    ],
  })
}

/**
 * Load customer memory section.
 * Queries CustomerInsight table (or uses preloaded rows if provided) and
 * formats insights by category. Marks insights older than 30 days as
 * (unverified).
 */
export async function loadCustomerMemory(
  customerId: string,
  preloadedInsights?: RawCustomerInsight[],
): Promise<string | null> {
  const insights = preloadedInsights ?? (await loadCustomerInsights(customerId))

  if (insights.length === 0) return null

  const now = Date.now()
  const byCategory = new Map<string, string[]>()

  for (const insight of insights) {
    const isStale = now - insight.lastConfirmedAt.getTime() > STALE_THRESHOLD_MS
    const staleMark = isStale ? ' (unverified)' : ''
    const line = `- ${insight.key}: ${insight.value}${staleMark}`

    const existing = byCategory.get(insight.category) ?? []
    existing.push(line)
    byCategory.set(insight.category, existing)
  }

  const parts: string[] = []
  for (const [category, lines] of byCategory) {
    parts.push(`${category}:`)
    parts.push(...lines)
  }

  const text = parts.join('\n')

  const tokens = estimateTokens(text, 'en')
  if (tokens > MAX_MEMORY_TOKENS) {
    const truncated = parts.slice(0, Math.ceil(parts.length * (MAX_MEMORY_TOKENS / tokens)))
    return truncated.join('\n')
  }

  return text
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npx vitest run __tests__/lib/chat/customer-memory-preload.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```
git add lib/chat/context-loaders.ts __tests__/lib/chat/customer-memory-preload.test.ts
git commit -m "refactor(context-loaders): extract loadCustomerInsights, accept preloaded rows"
```

---

## Task 2: Thread `preloadedInsights` through `loadAllSections`

**Files:**
- Modify: `lib/chat/context-loaders.ts:833-883` (the `loadAllSections` inline params type, its destructuring, and the `loadCustomerMemory` call inside `Promise.all`)

`loadAllSections` uses an inline params type (no named interface). We add one optional field, destructure it, and forward it to `loadCustomerMemory` so the existing memory formatter reuses already-loaded rows when provided.

- [ ] **Step 1: Add `preloadedInsights` to the inline params type**

In `lib/chat/context-loaders.ts`, find the `loadAllSections` signature (line 833) and append the field to the params type. Replace:

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
  stateGroundingInput: StateGroundingInput
}): Promise<PromptSections> {
```

with:

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
  stateGroundingInput: StateGroundingInput
  preloadedInsights?: RawCustomerInsight[]
}): Promise<PromptSections> {
```

- [ ] **Step 2: Destructure `preloadedInsights`**

Just below the signature (lines 846-858), the function destructures `params`. Replace:

```ts
  const {
    agentConfig,
    allowedTools,
    productId,
    conversationId,
    customerId,
    workflowSession,
    workflowStepCode,
    situationalBriefing,
    language,
    prefetchedCustomer,
    stateGroundingInput,
  } = params
```

with:

```ts
  const {
    agentConfig,
    allowedTools,
    productId,
    conversationId,
    customerId,
    workflowSession,
    workflowStepCode,
    situationalBriefing,
    language,
    prefetchedCustomer,
    stateGroundingInput,
    preloadedInsights,
  } = params
```

- [ ] **Step 3: Forward `preloadedInsights` to `loadCustomerMemory`**

In the same function (line 882), change:

```ts
    loadCustomerMemory(customerId),
```

to:

```ts
    loadCustomerMemory(customerId, preloadedInsights),
```

- [ ] **Step 4: Type-check and run the test suite**

```
npx tsc --noEmit
npm test
```

Expected: type-check clean; all existing tests PASS. Default behaviour is unchanged — when `preloadedInsights` is `undefined`, `loadCustomerMemory` queries as before (verified by the regression test added in Task 1).

- [ ] **Step 5: Commit**

```
git add lib/chat/context-loaders.ts
git commit -m "feat(context-loaders): thread preloadedInsights through loadAllSections"
```

---

## Task 3: Add `DebugIdentityPayload` type and `buildIdentityPayload()` helper

**Files:**
- Modify: `lib/chat/debug.ts`
- Test: `__tests__/lib/chat/debug-identity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/chat/debug-identity.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildIdentityPayload } from '@/lib/chat/debug'
import type { TurnContextCustomer } from '@/lib/chat/turn-context'
import type { RawCustomerInsight } from '@/lib/chat/context-loaders'

function makeCustomer(overrides: Partial<TurnContextCustomer> = {}): TurnContextCustomer {
  return {
    name: null,
    dateOfBirth: null,
    extractedProfile: {},
    language: 'ro',
    isAnonymous: true,
    gdprConsentAt: null,
    gdprConsentScope: null,
    aiDisclosureAcknowledgedAt: null,
    ...overrides,
  }
}

const baseArgs = {
  traceId: 't1',
  conversationId: 'conv1',
  messageIndex: 0,
  customerId: 'cust1',
}

describe('buildIdentityPayload', () => {
  afterEach(() => vi.useRealTimers())

  it('builds a payload with the expected shape', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z'))
    const customer = makeCustomer({
      name: 'Ana',
      dateOfBirth: new Date('1992-01-10T00:00:00Z'),
      extractedProfile: { occupation: 'engineer' },
      isAnonymous: false,
      gdprConsentAt: new Date('2026-05-26T10:00:00Z'),
      gdprConsentScope: 'sales',
      aiDisclosureAcknowledgedAt: new Date('2026-05-26T10:14:00Z'),
    })
    const insights: RawCustomerInsight[] = [
      {
        id: 'i1',
        customerId: 'cust1',
        category: 'preferences',
        key: 'language',
        value: 'ro',
        confidence: 0.9,
        lastConfirmedAt: new Date('2026-05-20T12:00:00Z'),
        createdAt: new Date('2026-05-20T12:00:00Z'),
        updatedAt: new Date('2026-05-20T12:00:00Z'),
      } as RawCustomerInsight,
    ]

    const payload = buildIdentityPayload({ ...baseArgs, customer, insights })

    expect(payload).toEqual({
      traceId: 't1',
      conversationId: 'conv1',
      messageIndex: 0,
      identity: { cookieId: 'cust1', isAnonymous: false },
      customer: {
        name: 'Ana',
        age: 34,
        language: 'ro',
        extractedProfile: { occupation: 'engineer' },
      },
      consent: {
        gdprConsentAt: '2026-05-26T10:00:00.000Z',
        gdprConsentScope: 'sales',
        aiDisclosureAcknowledgedAt: '2026-05-26T10:14:00.000Z',
      },
      memory: [
        {
          id: 'i1',
          kind: 'preferences',
          text: 'language: ro',
          createdAt: '2026-05-20T12:00:00.000Z',
        },
      ],
    })
  })

  it('returns age=null when dateOfBirth is null', () => {
    const customer = makeCustomer()
    const payload = buildIdentityPayload({ ...baseArgs, customer, insights: [] })
    expect(payload.customer.age).toBeNull()
  })

  it('returns memory=[] when insights is empty', () => {
    const customer = makeCustomer()
    const payload = buildIdentityPayload({ ...baseArgs, customer, insights: [] })
    expect(payload.memory).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npx vitest run __tests__/lib/chat/debug-identity.test.ts
```

Expected: FAIL because `buildIdentityPayload` is not exported from `@/lib/chat/debug`.

- [ ] **Step 3: Implement the payload type, event variant, and helper**

In `lib/chat/debug.ts`, after the `DebugTurnEndPayload` interface (around line 88) and before the `DebugEvent` union, add:

```ts
export interface DebugIdentityMemoryEntry {
  id: string
  kind: string
  text: string
  createdAt: string
}

export interface DebugIdentityPayload {
  traceId: string
  conversationId: string
  messageIndex: number
  identity: {
    cookieId: string
    isAnonymous: boolean
  }
  customer: {
    name: string | null
    age: number | null
    language: string
    extractedProfile: Record<string, unknown>
  }
  consent: {
    gdprConsentAt: string | null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: string | null
  }
  memory: DebugIdentityMemoryEntry[]
}
```

Extend the `DebugEvent` union (currently lines 94-100):

```ts
export type DebugEvent =
  | { event: 'debug:turn_start'; data: DebugTurnStartPayload }
  | { event: 'debug:identity'; data: DebugIdentityPayload }
  | { event: 'debug:gate'; data: DebugGatePayload }
  | { event: 'debug:prompt'; data: DebugPromptPayload }
  | { event: 'debug:tool_call'; data: DebugToolCallPayload }
  | { event: 'debug:tool_result'; data: DebugToolResultPayload }
  | { event: 'debug:turn_end'; data: DebugTurnEndPayload }
```

At the bottom of `lib/chat/debug.ts`, after the `isDev()` function, add the helper and its required imports at the top of the file:

Add imports (near the existing `import type` lines at the top):

```ts
import type { TurnContextCustomer } from './turn-context'
import type { RawCustomerInsight } from './context-loaders'
```

Add at the bottom of the file:

```ts
// ==============================================
// IDENTITY PAYLOAD BUILDER
// ==============================================

function computeAge(dateOfBirth: Date | null, now: Date): number | null {
  if (!dateOfBirth) return null
  let age = now.getFullYear() - dateOfBirth.getFullYear()
  const monthDiff = now.getMonth() - dateOfBirth.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())
  ) {
    age--
  }
  return age
}

export interface BuildIdentityPayloadInput {
  traceId: string
  conversationId: string
  messageIndex: number
  customerId: string
  customer: TurnContextCustomer
  insights: RawCustomerInsight[]
}

/**
 * Pure helper: assemble the debug:identity payload from already-loaded
 * customer + insight data. Tested directly; called from the orchestrator
 * only when isDev() && debugEnabled.
 */
export function buildIdentityPayload(
  input: BuildIdentityPayloadInput,
): DebugIdentityPayload {
  const now = new Date()
  return {
    traceId: input.traceId,
    conversationId: input.conversationId,
    messageIndex: input.messageIndex,
    identity: {
      cookieId: input.customerId,
      isAnonymous: input.customer.isAnonymous,
    },
    customer: {
      name: input.customer.name,
      age: computeAge(input.customer.dateOfBirth, now),
      language: input.customer.language,
      extractedProfile: input.customer.extractedProfile,
    },
    consent: {
      gdprConsentAt: input.customer.gdprConsentAt
        ? input.customer.gdprConsentAt.toISOString()
        : null,
      gdprConsentScope: input.customer.gdprConsentScope,
      aiDisclosureAcknowledgedAt: input.customer.aiDisclosureAcknowledgedAt
        ? input.customer.aiDisclosureAcknowledgedAt.toISOString()
        : null,
    },
    memory: input.insights.map((i) => ({
      id: i.id,
      kind: i.category,
      text: `${i.key}: ${i.value}`,
      createdAt: i.createdAt.toISOString(),
    })),
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npx vitest run __tests__/lib/chat/debug-identity.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```
git add lib/chat/debug.ts __tests__/lib/chat/debug-identity.test.ts
git commit -m "feat(debug): DebugIdentityPayload type + buildIdentityPayload helper"
```

---

## Task 4: Emit `debug:identity` from the orchestrator

**Files:**
- Modify: `lib/chat/orchestrator.ts` (after the `turnCtx = await resolveConversation()` block around line 232, and the `loadAllSections` call around line 528)

The orchestrator pre-fetches insights once (only when `isDev() && debugEnabled`), emits the event, and passes the same insights into `loadAllSections` so memory formatting reuses them.

- [ ] **Step 1: Add the import and the pre-fetch + emit block**

In `lib/chat/orchestrator.ts`, ensure these imports exist (the first two are already present; add the rest):

```ts
import { loadAllSections, loadStateGrounding, type WorkflowSessionData, type StateGroundingInput } from './context-loaders'
import { loadCustomerInsights, type RawCustomerInsight } from './context-loaders'
import { debugYield, isDev, buildIdentityPayload } from './debug'
```

(If the existing `./context-loaders` import line already imports types you need, merge the new names into it rather than duplicating.)

Locate the line where `turnCtx` is assigned from `resolveConversation()` (around line 232). Immediately after the `try { turnCtx = ... } catch { ... }` block ends and `turnCtx` is in scope, add:

```ts
  // Pre-fetch raw insights when in dev+debug so we can both emit the
  // structured identity event AND pass them into loadAllSections without
  // a second DB query.
  let preloadedInsights: RawCustomerInsight[] | undefined
  if (isDev() && debugEnabled) {
    preloadedInsights = await loadCustomerInsights(state.customerId!)
    yield* debugYield(isDev(), debugEnabled, {
      event: 'debug:identity',
      data: buildIdentityPayload({
        traceId: state.traceId,
        conversationId: state.conversationId!,
        messageIndex: state.messageCount,
        customerId: state.customerId!,
        customer: turnCtx.customer,
        insights: preloadedInsights,
      }),
    })
  }
```

- [ ] **Step 2: Pass `preloadedInsights` into the `loadAllSections` call**

Locate the `loadAllSections({ ... })` call around line 528. Add `preloadedInsights` to the config object passed in:

```ts
sections = await loadAllSections({
  // ...existing config fields stay unchanged...
  preloadedInsights,
})
```

(The exact existing config shape lives in `loadAllSections`'s signature in `context-loaders.ts` — the field was added there in Task 2.)

- [ ] **Step 3: Type-check the whole project**

```
npx tsc --noEmit
```

Expected: no type errors. If a type error mentions the `loadAllSections` config, double-check Task 2 was completed (the optional field must exist in the interface).

- [ ] **Step 4: Run the full test suite**

```
npm test
```

Expected: all tests still PASS. We have not broken any existing behaviour — the new branch is gated on `isDev() && debugEnabled`, which is `false` in the test environment unless explicitly set.

- [ ] **Step 5: Commit**

```
git add lib/chat/orchestrator.ts
git commit -m "feat(orchestrator): emit debug:identity event, pre-fetch insights once"
```

---

## Task 5: Extend the reducer to attach `identity` to the matching turn

**Files:**
- Modify: `lib/debug/reducer.ts`

- [ ] **Step 1: Add `identity` to `DebugTurn`**

In `lib/debug/reducer.ts`, add to the imports at the top:

```ts
import type {
  DebugEvent,
  DebugGatePayload,
  DebugIdentityPayload,
  DebugPromptPayload,
  DebugToolResultPayload,
  DebugTurnEndPayload,
} from '@/lib/chat/debug'
```

In the `DebugTurn` interface (around line 28), add the field:

```ts
export interface DebugTurn {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  language: 'en' | 'ro'
  startedAt: number
  identity?: Omit<DebugIdentityPayload, 'traceId'>
  gate?: Omit<DebugGatePayload, 'traceId'>
  prompt?: Omit<DebugPromptPayload, 'traceId'>
  toolCalls: DebugTurnToolCall[]
  endedAt?: number
  totals?: Omit<DebugTurnEndPayload, 'traceId'>
}
```

- [ ] **Step 2: Add the reducer case**

In the same file, inside the `switch (event.event)` block (after the `debug:turn_start` case and before `debug:gate`), add:

```ts
    case 'debug:identity': {
      const { traceId, ...rest } = event.data
      return updateTurn(state, traceId, (t) => ({ ...t, identity: rest }))
    }
```

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```
git add lib/debug/reducer.ts
git commit -m "feat(debug-reducer): handle debug:identity, attach to matching turn"
```

---

## Task 6: Create the pure `diffIdentity` helper

**Files:**
- Create: `components/debug/sections/identity-diff.ts`
- Test: `__tests__/components/debug/identity-diff.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/debug/identity-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { diffIdentity } from '@/components/debug/sections/identity-diff'
import type { DebugTurn } from '@/lib/debug/reducer'

function makeIdentity(overrides: Partial<NonNullable<DebugTurn['identity']>> = {}): NonNullable<DebugTurn['identity']> {
  return {
    conversationId: 'conv1',
    messageIndex: 0,
    identity: { cookieId: 'cust1', isAnonymous: true },
    customer: {
      name: null,
      age: null,
      language: 'ro',
      extractedProfile: {},
    },
    consent: {
      gdprConsentAt: null,
      gdprConsentScope: null,
      aiDisclosureAcknowledgedAt: null,
    },
    memory: [],
    ...overrides,
  }
}

describe('diffIdentity', () => {
  it('returns zero changes when previous is null (first turn)', () => {
    const current = makeIdentity()
    const r = diffIdentity(current, null)
    expect(r.changes).toBe(0)
    expect(r.scalarDiffs.size).toBe(0)
    expect(r.newMemoryIds.size).toBe(0)
  })

  it('flags a changed extractedProfile leaf', () => {
    const previous = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const current = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: { familySize: 3 } },
    })
    const r = diffIdentity(current, previous)
    expect(r.scalarDiffs.get('customer.extractedProfile.familySize')).toEqual({
      now: 3,
      was: null,
    })
    expect(r.changes).toBe(1)
  })

  it('flags a new memory insight by id', () => {
    const previous = makeIdentity({ memory: [] })
    const current = makeIdentity({
      memory: [
        { id: 'new1', kind: 'preferences', text: 'language: ro', createdAt: '2026-05-26T10:00:00.000Z' },
      ],
    })
    const r = diffIdentity(current, previous)
    expect(r.newMemoryIds.has('new1')).toBe(true)
    expect(r.changes).toBe(1)
  })

  it('flags a flipped consent timestamp', () => {
    const previous = makeIdentity()
    const current = makeIdentity({
      consent: {
        gdprConsentAt: '2026-05-26T10:00:00.000Z',
        gdprConsentScope: 'sales',
        aiDisclosureAcknowledgedAt: null,
      },
    })
    const r = diffIdentity(current, previous)
    expect(r.scalarDiffs.has('consent.gdprConsentAt')).toBe(true)
    expect(r.scalarDiffs.has('consent.gdprConsentScope')).toBe(true)
    expect(r.changes).toBe(2)
  })

  it('treats null and undefined as equal for scalar comparison', () => {
    const previous = makeIdentity({
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const current = makeIdentity({
      // simulate a profile key that was explicitly undefined; should not register as changed vs null
      customer: { name: null, age: null, language: 'ro', extractedProfile: {} },
    })
    const r = diffIdentity(current, previous)
    expect(r.changes).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```
npx vitest run __tests__/components/debug/identity-diff.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `diffIdentity`**

Create `components/debug/sections/identity-diff.ts`:

```ts
import type { DebugTurn } from '@/lib/debug/reducer'

type Identity = NonNullable<DebugTurn['identity']>

export interface IdentityDiffResult {
  changes: number
  scalarDiffs: Map<string, { now: unknown; was: unknown }>
  newMemoryIds: Set<string>
}

function equalish(a: unknown, b: unknown): boolean {
  // Collapse null/undefined to a single 'not set' value for comparison.
  const an = a === undefined ? null : a
  const bn = b === undefined ? null : b
  return an === bn
}

function diffScalars(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  pathPrefix: string,
  out: Map<string, { now: unknown; was: unknown }>,
): void {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)])
  for (const k of keys) {
    const path = `${pathPrefix}.${k}`
    const now = current[k]
    const was = previous[k]
    if (!equalish(now, was)) {
      out.set(path, { now: now ?? null, was: was ?? null })
    }
  }
}

export function diffIdentity(
  current: Identity,
  previous: Identity | null,
): IdentityDiffResult {
  const scalarDiffs = new Map<string, { now: unknown; was: unknown }>()
  const newMemoryIds = new Set<string>()

  if (previous === null) {
    return { changes: 0, scalarDiffs, newMemoryIds }
  }

  // Identity scalars
  diffScalars(
    current.identity as unknown as Record<string, unknown>,
    previous.identity as unknown as Record<string, unknown>,
    'identity',
    scalarDiffs,
  )

  // Customer scalars (excluding extractedProfile, handled separately)
  const { extractedProfile: curProfile, ...curCust } = current.customer
  const { extractedProfile: prevProfile, ...prevCust } = previous.customer
  diffScalars(
    curCust as Record<string, unknown>,
    prevCust as Record<string, unknown>,
    'customer',
    scalarDiffs,
  )

  // extractedProfile — shallow per-leaf
  diffScalars(
    curProfile ?? {},
    prevProfile ?? {},
    'customer.extractedProfile',
    scalarDiffs,
  )

  // Consent scalars
  diffScalars(
    current.consent as unknown as Record<string, unknown>,
    previous.consent as unknown as Record<string, unknown>,
    'consent',
    scalarDiffs,
  )

  // Memory — new insights by id
  const prevIds = new Set(previous.memory.map((m) => m.id))
  for (const m of current.memory) {
    if (!prevIds.has(m.id)) newMemoryIds.add(m.id)
  }

  return {
    changes: scalarDiffs.size + newMemoryIds.size,
    scalarDiffs,
    newMemoryIds,
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```
npx vitest run __tests__/components/debug/identity-diff.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```
git add components/debug/sections/identity-diff.ts __tests__/components/debug/identity-diff.test.ts
git commit -m "feat(debug-ui): pure diffIdentity helper with unit tests"
```

---

## Task 7: Create the `IdentitySection` React component

**Files:**
- Create: `components/debug/sections/identity-section.tsx`

No unit test here — the component is pure presentational. Behaviour is covered by the `diffIdentity` test (Task 6) and the manual verification step (Task 9).

- [ ] **Step 1: Create the component**

Create `components/debug/sections/identity-section.tsx`:

```tsx
import type { DebugTurn } from '@/lib/debug/reducer'
import { diffIdentity, type IdentityDiffResult } from './identity-diff'

interface Props {
  identity: DebugTurn['identity']
  previousIdentity: DebugTurn['identity'] | null
}

export function IdentitySection({ identity, previousIdentity }: Props) {
  if (!identity) {
    return <p className="text-xs text-gray-500">No identity data yet.</p>
  }
  const diff = diffIdentity(identity, previousIdentity ?? null)

  return (
    <div className="space-y-2 text-xs font-mono">
      {diff.changes > 0 && (
        <p className="text-[10px] text-amber-700">
          [{diff.changes} change{diff.changes === 1 ? '' : 's'} this turn]
        </p>
      )}

      <Group title="Identity">
        <Row label="cookieId" path="identity.cookieId" diff={diff}>
          <CookieIdValue value={identity.identity.cookieId} />
        </Row>
        <Row label="anonymous" path="identity.isAnonymous" diff={diff}>
          {identity.identity.isAnonymous ? '🔵 yes' : '⚪ no'}
        </Row>
      </Group>

      <Group title="Profile">
        <Row label="name" path="customer.name" diff={diff}>
          {identity.customer.name ?? '—'}
        </Row>
        <Row label="age" path="customer.age" diff={diff}>
          {identity.customer.age ?? '—'}
        </Row>
        <Row label="language" path="customer.language" diff={diff}>
          {identity.customer.language}
        </Row>
        <div className="pt-1">
          <div className="text-gray-500">extractedProfile:</div>
          {Object.keys(identity.customer.extractedProfile).length === 0 ? (
            <div className="pl-3 text-gray-400">—</div>
          ) : (
            <div className="pl-3 space-y-0.5">
              {Object.entries(identity.customer.extractedProfile).map(([k, v]) => (
                <Row
                  key={k}
                  label={k}
                  path={`customer.extractedProfile.${k}`}
                  diff={diff}
                >
                  {formatValue(v)}
                </Row>
              ))}
            </div>
          )}
        </div>
      </Group>

      <Group title="Consent">
        <Row label="GDPR" path="consent.gdprConsentAt" diff={diff}>
          {identity.consent.gdprConsentAt
            ? `✓ ${formatTimestamp(identity.consent.gdprConsentAt)}${
                identity.consent.gdprConsentScope
                  ? ` (${identity.consent.gdprConsentScope})`
                  : ''
              }`
            : '✗ not granted'}
        </Row>
        <Row
          label="AI disclosure"
          path="consent.aiDisclosureAcknowledgedAt"
          diff={diff}
        >
          {identity.consent.aiDisclosureAcknowledgedAt
            ? `✓ ${formatTimestamp(identity.consent.aiDisclosureAcknowledgedAt)}`
            : '✗ not acknowledged'}
        </Row>
      </Group>

      <Group title={`Memory (${identity.memory.length} insight${identity.memory.length === 1 ? '' : 's'})`}>
        {identity.memory.length === 0 ? (
          <div className="text-gray-400">— no cross-conversation insights yet —</div>
        ) : (
          <ul className="space-y-1">
            {identity.memory.map((m) => {
              const isNew = diff.newMemoryIds.has(m.id)
              return (
                <li
                  key={m.id}
                  className={`pl-2 ${isNew ? 'border-l-2 border-emerald-400' : 'border-l border-gray-200'}`}
                >
                  <div>
                    <span className="text-gray-500">{m.kind}</span> — {m.text}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {formatTimestamp(m.createdAt)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-semibold text-gray-700 mb-0.5">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Row({
  label,
  path,
  diff,
  children,
}: {
  label: string
  path: string
  diff: IdentityDiffResult
  children: React.ReactNode
}) {
  const change = diff.scalarDiffs.get(path)
  const highlight = change ? 'bg-amber-100' : ''
  return (
    <div className={`grid grid-cols-[8rem_1fr] gap-x-2 px-1 rounded ${highlight}`}>
      <span className="text-gray-500">{label}</span>
      <span>
        {children}
        {change && (
          <span className="text-amber-700 ml-2">
            (was: {formatValue(change.was)})
          </span>
        )}
      </span>
    </div>
  )
}

function CookieIdValue({ value }: { value: string }) {
  const truncated = value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value
  return (
    <button
      type="button"
      title={`Click to copy: ${value}`}
      onClick={() => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          void navigator.clipboard.writeText(value)
        }
      }}
      className="text-left underline decoration-dotted hover:text-blue-700"
    >
      {truncated}
    </button>
  )
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
  } catch {
    return iso
  }
}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```
git add components/debug/sections/identity-section.tsx
git commit -m "feat(debug-ui): IdentitySection component with diff highlighting"
```

---

## Task 8: Wire `IdentitySection` into `TurnCard` above Gate

**Files:**
- Modify: `components/debug/turn-card.tsx`

- [ ] **Step 1: Update `TurnCard` props to accept the previous turn**

Open `components/debug/turn-card.tsx`. Replace the existing `TurnCardProps` interface and the component body (the current file is at lines 9-61):

```tsx
'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'
import { GateSection } from './sections/gate-section'
import { PromptSection } from './sections/prompt-section'
import { ToolsSection } from './sections/tools-section'
import { IdentitySection } from './sections/identity-section'

interface TurnCardProps {
  turn: DebugTurn
  previousTurn: DebugTurn | null
  defaultOpen: boolean
}

export function TurnCard({ turn, previousTurn, defaultOpen }: TurnCardProps) {
  const [openIdentity, setOpenIdentity] = useState(defaultOpen)
  const [openGate, setOpenGate] = useState(defaultOpen)
  const [openPrompt, setOpenPrompt] = useState(defaultOpen)
  const [openTools, setOpenTools] = useState(defaultOpen)

  const latency = turn.totals?.latencyMs
  const preview =
    turn.userMessage.length > 60
      ? turn.userMessage.slice(0, 57) + '...'
      : turn.userMessage

  return (
    <div className="border border-black/10 rounded-md bg-white">
      <div className="px-3 py-2 border-b border-black/5">
        <p className="text-xs font-mono">
          <span className="text-gray-500">#{turn.messageIndex}</span> {preview}
        </p>
        {latency != null && (
          <p className="text-[10px] text-gray-500 font-mono mt-1">
            {latency}ms · in {turn.totals?.totalInputTokens ?? 0}t · out{' '}
            {turn.totals?.totalOutputTokens ?? 0}t
          </p>
        )}
      </div>
      <Subsection
        title="Identity & Stored Context"
        open={openIdentity}
        onToggle={() => setOpenIdentity(!openIdentity)}
      >
        <IdentitySection
          identity={turn.identity}
          previousIdentity={previousTurn?.identity ?? null}
        />
      </Subsection>
      <Subsection
        title="Gate"
        open={openGate}
        onToggle={() => setOpenGate(!openGate)}
      >
        <GateSection gate={turn.gate} />
      </Subsection>
      <Subsection
        title="Prompt"
        open={openPrompt}
        onToggle={() => setOpenPrompt(!openPrompt)}
      >
        <PromptSection prompt={turn.prompt} />
      </Subsection>
      <Subsection
        title="Tools"
        open={openTools}
        onToggle={() => setOpenTools(!openTools)}
      >
        <ToolsSection toolCalls={turn.toolCalls} />
      </Subsection>
    </div>
  )
}

function Subsection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-black/5 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-left text-xs font-mono font-semibold hover:bg-gray-50 flex justify-between items-center"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Update the caller (debug-drawer) to pass `previousTurn`**

`TurnCard`'s only caller is `components/debug/debug-drawer.tsx:68-70`. Since the `DebugState.turns` array is stored **newest first** (per `lib/debug/reducer.ts:73`), the "previous" turn for the snapshot at index `i` is the one at index `i + 1` (the next-older entry).

Open `components/debug/debug-drawer.tsx` and replace:

```tsx
        {turns.map((turn, i) => (
          <TurnCard key={turn.traceId} turn={turn} defaultOpen={i === 0} />
        ))}
```

with:

```tsx
        {turns.map((turn, i) => (
          <TurnCard
            key={turn.traceId}
            turn={turn}
            previousTurn={turns[i + 1] ?? null}
            defaultOpen={i === 0}
          />
        ))}
```

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```
git add components/debug/turn-card.tsx components/debug/debug-drawer.tsx
git commit -m "feat(debug-ui): wire IdentitySection into TurnCard above Gate"
```

---

## Task 9: Manual verification

**Files:** none (runtime smoke test against the dev server).

- [ ] **Step 1: Start the stack**

The Postgres container `zeno-db-1` should already be running on port 5435. If not:

```
docker compose up -d
```

Then:

```
npm run dev
```

Wait for `Ready in <N>s`.

- [ ] **Step 2: First-turn smoke test**

1. Open a **fresh** browser profile (or incognito) at `http://localhost:3000/chat`.
2. Open DevTools → Application → Cookies. Note the `zeno_session` cookie value.
3. Click the debug toggle button to enable the debug drawer.
4. Send a short message ("Salut").
5. After the response lands, expand the new "Identity & Stored Context" card at the top of the turn card.

Expected:
- `cookieId` shows the truncated form of the `zeno_session` cookie value. Hover shows the full UUID; clicking copies it.
- `anonymous` shows `🔵 yes`.
- `name` shows `—`, `age` shows `—`, `language` shows `ro` (or whatever default).
- `extractedProfile` shows `—`.
- `GDPR` shows `✗ not granted`, `AI disclosure` similar.
- `Memory` shows `— no cross-conversation insights yet —`.
- No `[N changes]` chip (first turn).

- [ ] **Step 3: Change detection — consent flip**

1. Continue the conversation in a way that triggers `record_gdpr_consent` (typical flow: agree when Zeno asks for consent).
2. After the next turn, expand the new turn's Identity card.

Expected:
- `GDPR` row is highlighted yellow with `✓ <timestamp>` and inline `(was: ✗ not granted)`.
- Header chip shows `[1 change this turn]`.

- [ ] **Step 4: Change detection — extracted profile**

1. Send a message that causes Zeno to extract a profile field (e.g. mention an occupation or family size).
2. After the next turn, expand its Identity card.

Expected:
- The corresponding `extractedProfile.<key>` row is highlighted yellow and shows `(was: —)`.
- Header chip count increments accordingly.

- [ ] **Step 5: Production build check**

```
npm run build
```

If the build succeeds, briefly start the production server:

```
npm start
```

Visit `http://localhost:3000/chat`. Confirm:
- The debug toggle button is NOT visible.
- DevTools → Network → the `/api/chat` event stream contains no `debug:identity` event.

Stop the production server.

- [ ] **Step 6: Final commit (only if anything was tweaked during manual verification)**

If manual testing surfaced no issues, no commit needed. If small adjustments were required, commit them now.

```
git status
git add <files>
git commit -m "fix(debug-ui): <description of tweak>"
```
