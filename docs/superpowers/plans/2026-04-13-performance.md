# Sub-Project #6: Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce per-turn latency through pipeline parallelization, query consolidation, proactive summarization, and prompt cache optimization.

**Architecture:** Run reasoning gate + context assembly concurrently (two-phase prompt build), consolidate ~10 DB round trips into 4 parallel queries, keep conversation summaries warm via background refresh (stale-while-revalidate), and add generic cache hints with provider-specific adapters for prompt caching. Benchmark integration tests validate all improvements.

**Tech Stack:** TypeScript, Next.js 15, Prisma, Vitest, Event Bus (sub-project #5)

**Spec:** `docs/superpowers/specs/2026-04-13-performance-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `__tests__/performance/bench-helpers.ts` | Create | Timing utilities, mock LLM provider, assertion helpers |
| `__tests__/performance/bench-pipeline.test.ts` | Create | 4 benchmark scenarios with timing assertions |
| `lib/chat/turn-context.ts` | Create | Consolidated turn context query |
| `lib/chat/orchestrator.ts` | Modify | Parallel steps 3+4, two-phase prompt build, proactive summarizer call |
| `lib/chat/context-loaders.ts` | Modify | Accept pre-fetched data in `loadAllSections` |
| `lib/chat/sliding-window.ts` | Modify | Stale-while-revalidate, background refresh, incremental summarization |
| `lib/llm/providers/types.ts` | Modify | Add `CacheHint` interface to `Message` |
| `lib/llm/providers/anthropic.ts` | Modify | Map `cacheHint` to separate system content blocks with `cache_control` |
| `lib/llm/providers/openai.ts` | Modify | Ignore `cacheHint` (OpenAI auto-caches prefixes) |
| `lib/events/types.ts` | Modify | Add `cache:status` event to `ZenoEvent` union |
| `lib/events/index.ts` | Modify | Export new event type |
| `lib/llm/gateway.ts` | Modify | Emit `cache:status` event after LLM calls |
| `lib/tools/registry.ts` | Modify | Deterministic sort in `getToolsForLLM` |

---

### Task 1: Benchmark Infrastructure — Timing Utilities & Mock LLM Provider

**Files:**
- Create: `__tests__/performance/bench-helpers.ts`
- Create: `__tests__/performance/bench-helpers.test.ts`

This task builds the foundation for measuring all subsequent improvements.

- [ ] **Step 1: Write failing test for `collectTimings`**

Create `__tests__/performance/bench-helpers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { eventBus } from '@/lib/events'
import { collectTimings, type PhaseSpans } from './bench-helpers'

describe('collectTimings', () => {
  it('captures phase start/end into spans with correct durations', () => {
    const traceId = 'test-trace-1'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId, phase: 'resolve', timestamp: 1000 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'resolve', durationMs: 50 })
    eventBus.emit({ type: 'phase:start', traceId, phase: 'context', timestamp: 1050 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'context', durationMs: 200 })

    const result = collector.finish()

    expect(result.timings['resolve']).toBe(50)
    expect(result.timings['context']).toBe(200)
    expect(result.spans['resolve'].startMs).toBe(1000)
    expect(result.spans['resolve'].endMs).toBe(1050)
    expect(result.spans['context'].startMs).toBe(1050)
    expect(result.spans['context'].endMs).toBe(1250)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: FAIL — `Cannot find module './bench-helpers'`

- [ ] **Step 3: Implement `collectTimings`**

Create `__tests__/performance/bench-helpers.ts`:

```typescript
import { eventBus } from '@/lib/events'
import type { ZenoEvent } from '@/lib/events'

// ==============================================
// TIMING COLLECTION
// ==============================================

export interface PhaseTimings {
  [phase: string]: number
}

export interface PhaseSpans {
  [phase: string]: { startMs: number; endMs: number }
}

export interface TimingResult {
  timings: PhaseTimings
  spans: PhaseSpans
}

export function collectTimings(traceId: string): { finish: () => TimingResult } {
  const timings: PhaseTimings = {}
  const spans: PhaseSpans = {}

  const unsubStart = eventBus.on('phase:start', (event: ZenoEvent) => {
    if (event.type !== 'phase:start') return
    if (event.traceId !== traceId) return
    spans[event.phase] = { startMs: event.timestamp, endMs: 0 }
  })

  const unsubEnd = eventBus.on('phase:end', (event: ZenoEvent) => {
    if (event.type !== 'phase:end') return
    if (event.traceId !== traceId) return
    timings[event.phase] = event.durationMs
    if (spans[event.phase]) {
      spans[event.phase].endMs = spans[event.phase].startMs + event.durationMs
    }
  })

  return {
    finish() {
      unsubStart()
      unsubEnd()
      return { timings, spans }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for assertion helpers**

Add to `__tests__/performance/bench-helpers.test.ts`:

```typescript
import { assertPhaseUnder, assertPhasesParallel } from './bench-helpers'

describe('assertPhaseUnder', () => {
  it('passes when phase is under threshold', () => {
    expect(() => assertPhaseUnder({ resolve: 50 }, 'resolve', 100)).not.toThrow()
  })

  it('fails when phase exceeds threshold', () => {
    expect(() => assertPhaseUnder({ resolve: 150 }, 'resolve', 100)).toThrow(/resolve.*150ms.*exceeds.*100ms/)
  })
})

describe('assertPhasesParallel', () => {
  it('passes when phases overlap', () => {
    const spans: PhaseSpans = {
      gate: { startMs: 1000, endMs: 2000 },
      context: { startMs: 1000, endMs: 1500 },
    }
    expect(() => assertPhasesParallel(spans, 'gate', 'context', 100)).not.toThrow()
  })

  it('fails when phases are sequential', () => {
    const spans: PhaseSpans = {
      gate: { startMs: 1000, endMs: 2000 },
      context: { startMs: 2000, endMs: 2500 },
    }
    expect(() => assertPhasesParallel(spans, 'gate', 'context', 100)).toThrow(/overlap/)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: FAIL — `assertPhaseUnder is not a function`

- [ ] **Step 7: Implement assertion helpers**

Add to `__tests__/performance/bench-helpers.ts`:

```typescript
// ==============================================
// ASSERTION HELPERS
// ==============================================

export function assertPhaseUnder(timings: PhaseTimings, phase: string, maxMs: number): void {
  const actual = timings[phase]
  if (actual === undefined) {
    throw new Error(`Phase "${phase}" not found in timings`)
  }
  if (actual > maxMs) {
    throw new Error(`Phase "${phase}" took ${actual}ms, exceeds threshold of ${maxMs}ms`)
  }
}

export function assertPhasesParallel(
  spans: PhaseSpans,
  phaseA: string,
  phaseB: string,
  minOverlapMs: number,
): void {
  const a = spans[phaseA]
  const b = spans[phaseB]
  if (!a) throw new Error(`Phase "${phaseA}" not found in spans`)
  if (!b) throw new Error(`Phase "${phaseB}" not found in spans`)

  const overlapStart = Math.max(a.startMs, b.startMs)
  const overlapEnd = Math.min(a.endMs, b.endMs)
  const overlap = Math.max(0, overlapEnd - overlapStart)

  if (overlap < minOverlapMs) {
    throw new Error(
      `Phases "${phaseA}" and "${phaseB}" overlap by ${overlap}ms, ` +
      `required at least ${minOverlapMs}ms. ` +
      `${phaseA}: ${a.startMs}-${a.endMs}, ${phaseB}: ${b.startMs}-${b.endMs}`
    )
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: PASS

- [ ] **Step 9: Write failing test for mock LLM provider**

Add to `__tests__/performance/bench-helpers.test.ts`:

```typescript
import { createMockProvider } from './bench-helpers'

describe('createMockProvider', () => {
  it('returns configured response after simulated latency', async () => {
    const provider = createMockProvider({
      latencyMs: 50,
      responseContent: 'Hello from mock',
      tokenUsage: { promptTokens: 100, completionTokens: 20 },
    })

    const start = Date.now()
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'mock-model',
    })
    const elapsed = Date.now() - start

    expect(result.content).toBe('Hello from mock')
    expect(result.usage.promptTokens).toBe(100)
    expect(result.usage.completionTokens).toBe(20)
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow slight timing variance
  })

  it('implements chatStream with content chunks and done', async () => {
    const provider = createMockProvider({
      latencyMs: 10,
      responseContent: 'streamed reply',
      tokenUsage: { promptTokens: 50, completionTokens: 10 },
    })

    const chunks: Array<{ type: string; content?: string }> = []
    const stream = await provider.chatStream({
      messages: [{ role: 'user', content: 'test' }],
      model: 'mock-model',
    })

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    const contentChunks = chunks.filter(c => c.type === 'content')
    const doneChunks = chunks.filter(c => c.type === 'done')
    expect(contentChunks.length).toBeGreaterThan(0)
    expect(doneChunks.length).toBe(1)
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: FAIL — `createMockProvider is not a function`

- [ ] **Step 11: Implement mock LLM provider**

Add to `__tests__/performance/bench-helpers.ts`:

```typescript
import type {
  LLMProviderInterface,
  ChatRequest,
  ChatResponse,
  ChatWithToolsRequest,
  ChatWithToolsResponse,
  StreamChunk,
  Message,
  TokenUsage,
} from '@/lib/llm/providers/types'

// ==============================================
// MOCK LLM PROVIDER
// ==============================================

export interface MockProviderOptions {
  latencyMs: number
  responseContent: string
  tokenUsage: { promptTokens: number; completionTokens: number }
}

export function createMockProvider(options: MockProviderOptions): LLMProviderInterface {
  const usage: TokenUsage = {
    promptTokens: options.tokenUsage.promptTokens,
    completionTokens: options.tokenUsage.completionTokens,
    totalTokens: options.tokenUsage.promptTokens + options.tokenUsage.completionTokens,
  }

  const delay = () => new Promise<void>(r => setTimeout(r, options.latencyMs))

  const rawMessage: Message = {
    role: 'assistant',
    content: options.responseContent,
  }

  return {
    async chat(_request: ChatRequest): Promise<ChatResponse> {
      await delay()
      return {
        content: options.responseContent,
        finishReason: 'stop',
        usage,
        rawMessage,
      }
    },

    async chatWithTools(_request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
      await delay()
      return {
        content: options.responseContent,
        finishReason: 'stop',
        usage,
        rawMessage,
        toolCalls: [],
      }
    },

    async *chatStream(_request: ChatRequest): AsyncIterable<StreamChunk> {
      await delay()
      yield { type: 'content', content: options.responseContent }
      yield { type: 'done', usage }
    },

    async *chatStreamWithTools(_request: ChatWithToolsRequest): AsyncIterable<StreamChunk> {
      await delay()
      yield { type: 'content', content: options.responseContent }
      yield { type: 'done', usage }
    },
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run __tests__/performance/bench-helpers.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add __tests__/performance/bench-helpers.ts __tests__/performance/bench-helpers.test.ts
git commit -m "feat: add benchmark infrastructure — timing collector, assertions, mock LLM provider"
```

---

### Task 2: Turn Context Consolidation

**Files:**
- Create: `lib/chat/turn-context.ts`
- Create: `__tests__/lib/chat/turn-context.test.ts`

Consolidates ~10 DB round trips into 4 parallel queries.

- [ ] **Step 1: Write failing test**

Create `__tests__/lib/chat/turn-context.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadTurnContext } from '@/lib/chat/turn-context'

// Mock Prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUniqueOrThrow: vi.fn(),
    },
    customer: {
      findUnique: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
    skillPack: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'

describe('loadTurnContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads conversation, customer, messages, and skill packs in parallel', async () => {
    const mockConversation = {
      id: 'conv-1',
      status: 'ACTIVE',
      messageCount: 5,
      mode: 'SALES',
      activeSkillPacks: [],
      productId: null,
      product: null,
      workflowSession: null,
      application: null,
    }
    const mockCustomer = {
      name: 'Ion',
      dateOfBirth: new Date('1990-01-01'),
      extractedProfile: { occupation: 'engineer' },
      language: 'ro',
      isAnonymous: false,
    }
    const mockMessages = [
      { role: 'user', content: 'Buna ziua', createdAt: new Date() },
      { role: 'assistant', content: 'Buna!', createdAt: new Date() },
    ]
    const mockSkillPacks = [
      { slug: 'life-insurance-discovery', description: 'Discovery phase' },
    ]

    vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(mockConversation as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(mockCustomer as never)
    vi.mocked(prisma.message.findMany).mockResolvedValue(mockMessages as never)
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue(mockSkillPacks as never)

    const ctx = await loadTurnContext('conv-1', 'cust-1')

    expect(ctx.conversation.id).toBe('conv-1')
    expect(ctx.customer.name).toBe('Ion')
    expect(ctx.recentMessages).toHaveLength(2)
    expect(ctx.activeSkillPacks).toHaveLength(1)

    // Verify all 4 queries were issued
    expect(prisma.conversation.findUniqueOrThrow).toHaveBeenCalledOnce()
    expect(prisma.customer.findUnique).toHaveBeenCalledOnce()
    expect(prisma.message.findMany).toHaveBeenCalledOnce()
    expect(prisma.skillPack.findMany).toHaveBeenCalledOnce()
  })

  it('returns empty recentMessages when no messages exist', async () => {
    vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue({
      id: 'conv-1', status: 'ACTIVE', messageCount: 0, mode: 'SALES',
      activeSkillPacks: [], productId: null, product: null,
      workflowSession: null, application: null,
    } as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      name: null, dateOfBirth: null, extractedProfile: {},
      language: 'ro', isAnonymous: true,
    } as never)
    vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([] as never)

    const ctx = await loadTurnContext('conv-1', 'cust-1')

    expect(ctx.recentMessages).toHaveLength(0)
    expect(ctx.activeSkillPacks).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/turn-context.test.ts`
Expected: FAIL — `Cannot find module '@/lib/chat/turn-context'`

- [ ] **Step 3: Implement `loadTurnContext`**

Create `lib/chat/turn-context.ts`:

```typescript
/**
 * Turn Context — Consolidated Per-Turn Data Loader
 *
 * Replaces ~10 sequential DB queries across Steps 1, 3, and 4 with
 * 4 parallel queries. Result is passed downstream through the pipeline,
 * eliminating redundant conversation/customer/message fetches.
 */

import { prisma } from '@/lib/db'

// ==============================================
// TYPES
// ==============================================

export interface TurnContextConversation {
  id: string
  status: string
  messageCount: number
  mode: string
  activeSkillPacks: string[]
  productId: string | null
  product: { id: string } | null
  workflowSession: {
    id: string
    workflowId: string
    currentStepId: string
    currentStep: {
      id: string
      code: string
      name: string
      agentInstructions: string | null
      allowedTools: string[]
      autoTool: string | null
    }
    data: unknown
  } | null
  application: {
    status: string
    currentQuestionIndex: number
    totalQuestions: number
    quote: {
      status: string
      premiumAnnual: number
      policy: { id: string } | null
    } | null
  } | null
}

export interface TurnContextCustomer {
  name: string | null
  dateOfBirth: Date | null
  extractedProfile: Record<string, unknown>
  language: string
  isAnonymous: boolean
}

export interface TurnContextMessage {
  role: string
  content: string
  createdAt: Date
}

export interface TurnContext {
  conversation: TurnContextConversation
  customer: TurnContextCustomer
  recentMessages: TurnContextMessage[]
  activeSkillPacks: { slug: string; description: string }[]
}

// ==============================================
// LOADER
// ==============================================

const RECENT_MESSAGE_COUNT = 10

/**
 * Load all data needed for a turn in 4 parallel queries.
 * Replaces individual queries in Steps 1, 3, and 4.
 */
export async function loadTurnContext(
  conversationId: string,
  customerId: string,
): Promise<TurnContext> {
  const [conversation, customer, recentMessages, activeSkillPacks] = await Promise.all([
    // Query 1: Conversation with all relations
    prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        product: { select: { id: true } },
        workflowSession: {
          include: {
            currentStep: {
              select: {
                id: true,
                code: true,
                name: true,
                agentInstructions: true,
                allowedTools: true,
                autoTool: true,
              },
            },
          },
        },
        application: {
          select: {
            status: true,
            currentQuestionIndex: true,
            totalQuestions: true,
            quote: {
              select: {
                status: true,
                premiumAnnual: true,
                policy: { select: { id: true } },
              },
            },
          },
        },
      },
    }),

    // Query 2: Customer profile
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true,
        dateOfBirth: true,
        extractedProfile: true,
        language: true,
        isAnonymous: true,
      },
    }),

    // Query 3: Recent messages (last 10 — superset of "last 3" used by gate)
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: RECENT_MESSAGE_COUNT,
      select: { role: true, content: true, createdAt: true },
    }),

    // Query 4: Active skill packs
    prisma.skillPack.findMany({
      where: { isActive: true },
      select: { slug: true, description: true },
    }),
  ])

  return {
    conversation: {
      id: conversation.id,
      status: conversation.status,
      messageCount: conversation.messageCount,
      mode: (conversation.mode as string) ?? 'SALES',
      activeSkillPacks: (conversation.activeSkillPacks as string[]) ?? [],
      productId: conversation.productId,
      product: conversation.product,
      workflowSession: conversation.workflowSession
        ? {
            id: conversation.workflowSession.id,
            workflowId: conversation.workflowSession.workflowId,
            currentStepId: conversation.workflowSession.currentStepId,
            currentStep: conversation.workflowSession.currentStep,
            data: conversation.workflowSession.data,
          }
        : null,
      application: conversation.application,
    },
    customer: {
      name: customer?.name ?? null,
      dateOfBirth: customer?.dateOfBirth ?? null,
      extractedProfile: (customer?.extractedProfile as Record<string, unknown>) ?? {},
      language: customer?.language ?? 'ro',
      isAnonymous: customer?.isAnonymous ?? true,
    },
    recentMessages: recentMessages.reverse(), // chronological order
    activeSkillPacks,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/turn-context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat/turn-context.ts __tests__/lib/chat/turn-context.test.ts
git commit -m "feat: add consolidated turn context query — 4 parallel queries replace ~10 sequential"
```

---

### Task 3: Integrate Turn Context + Parallel Steps 3+4 in Orchestrator

**Files:**
- Modify: `lib/chat/orchestrator.ts`
- Modify: `lib/chat/context-loaders.ts`

Wires up `loadTurnContext` and makes Steps 3+4 run concurrently. This is the biggest orchestrator refactor.

- [ ] **Step 1: Write failing test for context-loaders accepting pre-fetched data**

Create `__tests__/lib/chat/context-loaders-prefetch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { loadAllSections } from '@/lib/chat/context-loaders'

vi.mock('@/lib/db', () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    question: { findMany: vi.fn().mockResolvedValue([]) },
    answer: { findMany: vi.fn().mockResolvedValue([]) },
    customerInsight: { findMany: vi.fn().mockResolvedValue([]) },
    agentKnowledge: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'

describe('loadAllSections with pre-fetched data', () => {
  it('uses prefetchedCustomer instead of querying DB', async () => {
    const sections = await loadAllSections({
      agentConfig: { systemPrompt: 'You are Zeno', constraints: 'Be helpful' },
      allowedTools: [],
      productId: null,
      conversationId: 'conv-1',
      customerId: 'cust-1',
      workflowSession: null,
      workflowStepCode: null,
      situationalBriefing: null,
      language: 'ro',
      prefetchedCustomer: {
        name: 'Ion',
        dateOfBirth: new Date('1990-01-01'),
        extractedProfile: { occupation: 'engineer' },
        language: 'ro',
        isAnonymous: false,
      },
    })

    expect(sections.customerContext).toContain('Ion')
    expect(sections.customerContext).toContain('engineer')
    // Customer was NOT queried from DB
    expect(prisma.customer.findUnique).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/context-loaders-prefetch.test.ts`
Expected: FAIL — `prefetchedCustomer` is not a recognized parameter

- [ ] **Step 3: Modify `loadAllSections` to accept pre-fetched customer data**

In `lib/chat/context-loaders.ts`, update the `loadAllSections` function signature (around line 584) to accept optional pre-fetched data:

Add a new parameter to the `params` object:

```typescript
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
  /** Pre-fetched customer data from turn context. Skips DB query when provided. */
  prefetchedCustomer?: {
    name: string | null
    dateOfBirth: Date | null
    extractedProfile: Record<string, unknown>
    language: string
    isAnonymous: boolean
  }
}): Promise<PromptSections> {
```

Then in the async loaders section (around line 614), use pre-fetched data when available:

```typescript
  // Async loaders — run in parallel
  const [
    productContext,
    coachingBriefing,
    questionnaireContext,
    customerContext,
    customerMemory,
    agentKnowledge,
  ] = await Promise.all([
    productId ? loadProductContext(productId, language) : null,
    productId ? loadCoachingBriefing(productId) : null,
    loadQuestionnaireContext(conversationId, workflowStepCode, language),
    params.prefetchedCustomer
      ? loadCustomerContextFromData(params.prefetchedCustomer)
      : loadCustomerContext(customerId),
    loadCustomerMemory(customerId),
    loadAgentKnowledge(productId, workflowStepCode),
  ])
```

Add a new function that builds customer context from pre-fetched data (before `loadAllSections`):

```typescript
/**
 * Build customer context from pre-fetched data (no DB query).
 */
function loadCustomerContextFromData(customer: {
  name: string | null
  dateOfBirth: Date | null
  extractedProfile: Record<string, unknown>
  language: string
  isAnonymous: boolean
}): string | null {
  const parts: string[] = []

  if (customer.name) parts.push(`Name: ${customer.name}`)
  parts.push(`Language: ${customer.language}`)

  if (customer.dateOfBirth) {
    parts.push(`Age: ${calculateAge(customer.dateOfBirth)}`)
  }

  if (customer.isAnonymous) {
    parts.push('Status: Anonymous visitor')
  }

  const profile = customer.extractedProfile
  if (profile.occupation && typeof profile.occupation === 'string') {
    parts.push(`Occupation: ${profile.occupation}`)
  }
  if (profile.incomeLevel && typeof profile.incomeLevel === 'string') {
    parts.push(`Income level: ${profile.incomeLevel}`)
  }
  if (profile.education && typeof profile.education === 'string') {
    parts.push(`Education: ${profile.education}`)
  }
  if (profile.familySize != null) parts.push(`Family size: ${String(profile.familySize)}`)
  if (profile.hasSpouse != null) parts.push(`Has spouse: ${String(profile.hasSpouse)}`)
  if (profile.hasChildren != null) parts.push(`Has children: ${String(profile.hasChildren)}`)
  if (profile.minorChildren != null) parts.push(`Minor children: ${String(profile.minorChildren)}`)
  if (Array.isArray(profile.motivations) && profile.motivations.length > 0) {
    parts.push(`Motivations: ${(profile.motivations as string[]).join(', ')}`)
  }
  if (Array.isArray(profile.interests) && profile.interests.length > 0) {
    parts.push(`Interests: ${(profile.interests as string[]).join(', ')}`)
  }

  return parts.length > 0 ? parts.join('\n') : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/context-loaders-prefetch.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor orchestrator Steps 1+3+4 for parallel execution**

Modify `lib/chat/orchestrator.ts`. The key changes:

1. **Step 1:** After creating/resolving `conversationId` and `customerId`, call `loadTurnContext()` instead of the current `prisma.conversation.findUniqueOrThrow` with includes.

2. **Steps 3+4:** Wrap in `Promise.all`. Context assembly no longer depends on gate output — `situationalBriefing` is patched in after both complete.

At the top of the file, add import:

```typescript
import { loadTurnContext, type TurnContext } from '@/lib/chat/turn-context'
```

In Step 1 (after conversation/customer ID are resolved, around line 207), replace the `prisma.conversation.findUniqueOrThrow` call with:

```typescript
    let turnCtx: TurnContext
    try {
      turnCtx = await loadTurnContext(state.conversationId, state.customerId)
    } catch (err) {
      const errorId = logFatal({
        layer: 'orchestrator',
        category: 'db_error',
        message: 'Failed to load turn context',
        context: { conversationId: state.conversationId, customerId: state.customerId },
        error: err,
      })
      yield {
        event: 'error',
        data: { errorId, type: 'internal', message: 'Service temporarily unavailable', retryable: true },
      }
      return
    }

    const conversation = turnCtx.conversation
```

Then update all the references that previously used the old `conversation` shape to use `turnCtx.conversation` (status check, messageCount, productId, workflowSession, mode, activeSkillPacks).

For Steps 3+4 parallel execution (around line 309), replace the sequential flow with:

```typescript
  // =============================================
  // STEPS 3+4 — Reasoning gate + Context assembly (PARALLEL)
  // =============================================
  const step3_4Start = Date.now()

  // --- Step 3: Reasoning gate (async) ---
  const gatePromise = (async (): Promise<{
    gateOutput: ReasoningGateOutput | null
    gateSelection: GateSelection
  }> => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'reasoning_gate', timestamp: Date.now() })
    const gateStart = Date.now()

    if (detectFastPath(input.message, hasActiveQuestionnaire) && !input.syntheticToolCall) {
      state.phases['reasoningGate'] = { skipped: true, fastPath: true, durationMs: 0 }
      eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs: 0 })
      return { gateOutput: null, gateSelection: FAST_PATH_GATE }
    }

    if (input.syntheticToolCall) {
      state.phases['reasoningGate'] = { skipped: true, syntheticAction: true, durationMs: 0 }
      eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs: 0 })
      return { gateOutput: null, gateSelection: { requiredSections: [], excludedSections: [], confidence: 0 } }
    }

    try {
      // Use pre-fetched data from turnCtx instead of querying DB
      const last3Messages = turnCtx.recentMessages
        .slice(-3)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 300) }))

      const extractedProfile = turnCtx.customer.extractedProfile
      const customerAge = turnCtx.customer.dateOfBirth
        ? Math.floor((Date.now() - turnCtx.customer.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null

      const application = turnCtx.conversation.application

      const gateInput: ReasoningGateInput = {
        lastUserMessage: input.message,
        last3Messages,
        hasActiveQuestionnaire,
        currentQuestionText: null,
        workflowStepCode: state.workflowStepCode,
        availableTools: getToolsForLLM(
          turnCtx.conversation.workflowSession?.currentStep.allowedTools.length
            ? turnCtx.conversation.workflowSession.currentStep.allowedTools
            : undefined,
        ).map((t) => t.function.name),
        customerProfile: {
          name: turnCtx.customer.name,
          age: customerAge,
          family: typeof extractedProfile.familySize === 'number'
            ? `family of ${extractedProfile.familySize}`
            : typeof extractedProfile.hasChildren === 'boolean'
              ? (extractedProfile.hasChildren ? 'has children' : 'no children')
              : null,
          occupation: typeof extractedProfile.occupation === 'string'
            ? extractedProfile.occupation
            : null,
          isReturningCustomer: false,
        },
        businessState: {
          selectedProduct: turnCtx.conversation.product?.id ?? null,
          dntProgress: null,
          applicationProgress: application
            ? `${application.currentQuestionIndex}/${application.totalQuestions} (${application.status})`
            : null,
          hasQuote: !!application?.quote,
          quoteValue: application?.quote?.premiumAnnual ?? null,
          hasPolicy: !!application?.quote?.policy,
        },
        currentMode: state.conversationMode,
        availableSkillPacks: turnCtx.activeSkillPacks,
        activeSkillPacks: state.activeSkillPacks,
      }

      const output = await executeReasoningGate(gateInput)
      const durationMs = Date.now() - gateStart
      state.phases['reasoningGate'] = {
        durationMs,
        complexity: output.complexity,
        situationType: output.situationType,
        confidence: output.confidence,
      }
      eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs })

      return {
        gateOutput: output,
        gateSelection: {
          requiredSections: output.requiredSections,
          excludedSections: output.excludedSections,
          confidence: output.confidence,
        },
      }
    } catch (err: unknown) {
      const durationMs = Date.now() - gateStart
      logWarn({
        layer: 'orchestrator',
        category: 'reasoning_gate',
        message: 'Reasoning gate failed, using defaults',
        context: { conversationId: state.conversationId },
        error: err,
      })
      state.phases['reasoningGate'] = { durationMs, error: true }
      eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs })
      return { gateOutput: null, gateSelection: { requiredSections: [], excludedSections: [], confidence: 0 } }
    }
  })()

  // --- Step 4a: Context assembly (runs in parallel with gate) ---
  const contextPromise = (async () => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'context', timestamp: Date.now() })
    const ctxStart = Date.now()

    const agentSlug = resolveAgent(state.conversationMode)
    const agentConfig = await getAgentConfig(agentSlug)

    const stepAllowedTools = turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? []

    const workflowSessionData: WorkflowSessionData | null = turnCtx.conversation.workflowSession
      ? {
          currentStepCode: turnCtx.conversation.workflowSession.currentStep.code,
          currentStepName: turnCtx.conversation.workflowSession.currentStep.name,
          agentInstructions: turnCtx.conversation.workflowSession.currentStep.agentInstructions,
          allowedTools: turnCtx.conversation.workflowSession.currentStep.allowedTools,
          data: turnCtx.conversation.workflowSession.data,
        }
      : null

    let sections: Awaited<ReturnType<typeof loadAllSections>>
    try {
      sections = await loadAllSections({
        agentConfig: { systemPrompt: agentConfig.systemPrompt, constraints: agentConfig.constraints },
        allowedTools: stepAllowedTools,
        productId: state.productId,
        conversationId: state.conversationId,
        customerId: state.customerId,
        workflowSession: workflowSessionData,
        workflowStepCode: state.workflowStepCode,
        situationalBriefing: null, // patched after gate completes
        language: state.language,
        prefetchedCustomer: turnCtx.customer,
      })
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'db_error',
        message: 'Context assembly failed, using minimal context',
        context: { conversationId: state.conversationId },
        error: err,
      })
      sections = {
        agentIdentity: agentConfig.systemPrompt,
        capabilityManifest: null,
        constraints: agentConfig.constraints,
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
    }

    const durationMs = Date.now() - ctxStart
    eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'context', durationMs })

    return { agentSlug, agentConfig, sections, stepAllowedTools }
  })()

  // --- Await both ---
  const [gateResult, contextResult] = await Promise.all([gatePromise, contextPromise])
  const { gateOutput, gateSelection } = gateResult
  const { agentSlug, agentConfig, stepAllowedTools } = contextResult
  let { sections } = contextResult

  state.phases['step3_4_parallel'] = Date.now() - step3_4Start

  // --- Step 4b: Two-phase prompt build (patch gate output into sections) ---
  const situationalBriefing = gateOutput ? formatGateBriefing(gateOutput) : null
  sections.situationalBriefing = situationalBriefing
```

Then continue with skill pack loading, mode transition, compliance check, and `buildPrompt` as before — these depend on gateOutput so they run after both promises resolve.

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add lib/chat/orchestrator.ts lib/chat/context-loaders.ts __tests__/lib/chat/context-loaders-prefetch.test.ts
git commit -m "feat: parallelize Steps 3+4 — gate + context run concurrently with turn context"
```

---

### Task 4: Proactive Summarizer with Stale-While-Revalidate

**Files:**
- Modify: `lib/chat/sliding-window.ts`
- Modify: `lib/chat/orchestrator.ts` (Step 9)
- Create: `__tests__/lib/chat/sliding-window-proactive.test.ts`

- [ ] **Step 1: Write failing test for stale-while-revalidate**

Create `__tests__/lib/chat/sliding-window-proactive.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSlidingWindow } from '@/lib/chat/sliding-window'

vi.mock('@/lib/db', () => ({
  prisma: {
    message: { findMany: vi.fn() },
    conversationSummary: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn().mockResolvedValue({ content: 'Summary text' }),
  },
}))

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'

describe('buildSlidingWindow stale-while-revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses stale summary immediately without blocking on summarizer', async () => {
    // 30 total messages, window will only hold last 10
    const windowMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      createdAt: new Date(Date.now() - (30 - i) * 1000),
      toolCalls: null,
      toolResults: null,
    }))

    vi.mocked(prisma.message.findMany).mockResolvedValue(windowMessages as never)

    // Stale summary: covers up to message 5, but there are 20 older messages
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue({
      conversationId: 'conv-1',
      summary: 'Old summary',
      messagesUpTo: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const result = await buildSlidingWindow('conv-1', 30, 5000)

    // Should use old summary immediately
    expect(result.summaryPrefix).toBe('Old summary')
    // Should NOT have called the summarizer synchronously
    // (background refresh may fire but doesn't block)
  })

  it('blocks on summarizer only when no summary exists at all', async () => {
    const windowMessages = Array.from({ length: 30 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
      createdAt: new Date(Date.now() - (30 - i) * 1000),
      toolCalls: null,
      toolResults: null,
    }))

    vi.mocked(prisma.message.findMany).mockResolvedValue(windowMessages as never)
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.conversationSummary.upsert).mockResolvedValue({} as never)

    const result = await buildSlidingWindow('conv-1', 30, 5000)

    // Summarizer WAS called (blocking — no existing summary)
    expect(gateway.call).toHaveBeenCalled()
    expect(result.summaryPrefix).toBe('Summary text')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/sliding-window-proactive.test.ts`
Expected: FAIL — current code blocks on stale summary

- [ ] **Step 3: Implement stale-while-revalidate in `sliding-window.ts`**

Modify `lib/chat/sliding-window.ts`. Add at the top (after imports):

```typescript
const STALE_MESSAGE_THRESHOLD = 10
```

Replace the summary-handling logic (around line 120-147) with:

```typescript
  // If window covers all messages, no summary needed
  if (windowMessages.length >= totalMessages) {
    return { messages: windowMessages, summaryPrefix: null }
  }

  const olderCount = totalMessages - windowMessages.length

  const existingSummary = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  // Stale-while-revalidate: use ANY existing summary immediately
  if (existingSummary) {
    const isStale = (olderCount - existingSummary.messagesUpTo) > STALE_MESSAGE_THRESHOLD

    if (isStale) {
      // Fire background refresh — non-blocking
      void refreshSummaryInBackground(conversationId, olderCount)
    }

    return { messages: windowMessages, summaryPrefix: existingSummary.summary }
  }

  // No summary at all — must block (first time only)
  const olderMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: olderCount,
  })

  const olderLLMMessages = olderMessages.map(dbMessageToLLM)
  const summaryText = await triggerSummarizer(conversationId, olderLLMMessages, olderCount)

  return { messages: windowMessages, summaryPrefix: summaryText }
```

Add the background refresh function and incremental summarizer:

```typescript
/**
 * Refresh summary in the background (non-blocking).
 * Uses incremental summarization: extends existing summary with new messages.
 */
async function refreshSummaryInBackground(
  conversationId: string,
  targetMessagesUpTo: number,
): Promise<void> {
  try {
    const existing = await prisma.conversationSummary.findUnique({
      where: { conversationId },
    })
    if (!existing) return

    // Load only NEW messages since last summary
    const newMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      skip: existing.messagesUpTo,
      take: targetMessagesUpTo - existing.messagesUpTo,
    })

    if (newMessages.length === 0) return

    const newLLMMessages = newMessages.map(dbMessageToLLM)
    const formatted = formatMessagesForSummary(newLLMMessages)

    // Incremental: extend existing summary
    const response = await gateway.call('summarizer', {
      messages: [{
        role: 'user',
        content: `Existing summary:\n${existing.summary}\n\nNew messages to incorporate:\n${formatted}\n\nExtend the summary to include these new messages. Keep it concise.`,
      }],
    })

    const updatedSummary = response.content ?? existing.summary

    await prisma.conversationSummary.upsert({
      where: { conversationId },
      update: { summary: updatedSummary, messagesUpTo: targetMessagesUpTo },
      create: { conversationId, summary: updatedSummary, messagesUpTo: targetMessagesUpTo },
    })
  } catch {
    // Background — errors are silently ignored
  }
}

/**
 * Proactive summary update — called from orchestrator Step 9.
 * Checks if summary is stale and refreshes in background if needed.
 */
export async function updateSummaryIfStale(
  conversationId: string,
  currentMessageCount: number,
): Promise<void> {
  const existing = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  if (!existing) return // No summary yet — will be created on demand

  const gap = currentMessageCount - existing.messagesUpTo
  if (gap > STALE_MESSAGE_THRESHOLD) {
    await refreshSummaryInBackground(conversationId, currentMessageCount)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/sliding-window-proactive.test.ts`
Expected: PASS

- [ ] **Step 5: Add `updateSummaryIfStale` call in orchestrator Step 9**

In `lib/chat/orchestrator.ts`, add import at the top:

```typescript
import { updateSummaryIfStale } from '@/lib/chat/sliding-window'
```

In Step 9 (around line 1162, after the profile extractor block), add:

```typescript
  // Proactive summary refresh — keep summary warm for next turn
  void updateSummaryIfStale(state.conversationId, state.messageCount).catch((err: unknown) =>
    logWarn({
      layer: 'orchestrator',
      category: 'summary',
      message: 'Proactive summary refresh failed',
      context: { conversationId: state.conversationId },
      error: err,
    }),
  )
```

- [ ] **Step 6: Run existing sliding-window tests to verify no regressions**

Run: `npx vitest run __tests__/lib/chat/sliding-window.test.ts __tests__/lib/chat/sliding-window-proactive.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add lib/chat/sliding-window.ts lib/chat/orchestrator.ts __tests__/lib/chat/sliding-window-proactive.test.ts
git commit -m "feat: proactive summarizer — stale-while-revalidate + background refresh + incremental"
```

---

### Task 5: Cache Hint Type + Two-Message System Prompt Split

**Files:**
- Modify: `lib/llm/providers/types.ts`
- Modify: `lib/chat/orchestrator.ts` (Step 6)
- Create: `__tests__/lib/chat/cache-hint.test.ts`

- [ ] **Step 1: Write failing test for cache-hinted message split**

Create `__tests__/lib/chat/cache-hint.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Message, CacheHint } from '@/lib/llm/providers/types'

describe('CacheHint on Message', () => {
  it('allows setting cacheHint on a system message', () => {
    const msg: Message = {
      role: 'system',
      content: 'You are Zeno, an AI insurance agent.',
      cacheHint: { breakpoint: 'ephemeral' },
    }

    expect(msg.cacheHint).toBeDefined()
    expect(msg.cacheHint!.breakpoint).toBe('ephemeral')
  })

  it('cacheHint is optional and defaults to undefined', () => {
    const msg: Message = {
      role: 'user',
      content: 'Hello',
    }

    expect(msg.cacheHint).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/chat/cache-hint.test.ts`
Expected: FAIL — `CacheHint` is not exported from types

- [ ] **Step 3: Add `CacheHint` to Message type**

In `lib/llm/providers/types.ts`, add after the `ToolChoice` type (line 54):

```typescript
// ==============================================
// CACHE HINTS
// ==============================================

/** Provider-agnostic cache hint for prompt caching optimization. */
export interface CacheHint {
  /** 'ephemeral' = cache for this session; 'persistent' = long-lived cache */
  breakpoint: 'ephemeral' | 'persistent'
}
```

Then in the `Message` interface (line 61), add the optional field:

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Assistant messages: tools the LLM wants to call. */
  toolCalls?: ToolCall[]
  /** Tool messages: which call this result is for. */
  toolCallId?: string
  /** Preserve native provider content blocks (e.g. Anthropic thinking). Pass-through only. */
  _providerContent?: unknown
  /** Optional hint for provider-level prompt caching. */
  cacheHint?: CacheHint
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/chat/cache-hint.test.ts`
Expected: PASS

- [ ] **Step 5: Split system message in orchestrator Step 6**

In `lib/chat/orchestrator.ts`, find Step 6 (build messages array, around line 682). Replace the single system message with two messages — stable prefix with cache hint, dynamic suffix without:

```typescript
  // =============================================
  // STEP 6 — Build messages array
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'build_messages', timestamp: Date.now() })
  const step6Start = Date.now()

  const messages: Message[] = []

  // Stable prefix — marked for provider-level caching
  if (buildResult.stablePrefix) {
    messages.push({
      role: 'system' as const,
      content: buildResult.stablePrefix,
      cacheHint: { breakpoint: 'ephemeral' },
    })
  }

  // Dynamic suffix — changes every turn, NOT cached
  if (buildResult.dynamicSuffix) {
    messages.push({
      role: 'system' as const,
      content: buildResult.dynamicSuffix,
    })
  }

  if (summaryPrefix) {
    messages.push({
      role: 'system' as const,
      content: `[Previous conversation summary]\n${summaryPrefix}\n[End of summary — recent messages follow]`,
    })
  }
  messages.push(...windowMessages)
  messages.push({ role: 'user' as const, content: input.message })

  state.phases['step6_build_messages'] = Date.now() - step6Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'build_messages', durationMs: Date.now() - step6Start })
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add lib/llm/providers/types.ts lib/chat/orchestrator.ts __tests__/lib/chat/cache-hint.test.ts
git commit -m "feat: add CacheHint type and split system message — stable prefix cached, dynamic suffix not"
```

---

### Task 6: Anthropic Cache Adapter

**Files:**
- Modify: `lib/llm/providers/anthropic.ts`
- Create: `__tests__/lib/llm/anthropic-cache.test.ts`

- [ ] **Step 1: Write failing test for cache-hint-aware message conversion**

Create `__tests__/lib/llm/anthropic-cache.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { Message } from '@/lib/llm/providers/types'

// Mock the SDK to avoid API key issues
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {}
    messages = {
      create: vi.fn(),
      stream: vi.fn(),
    }
  },
}))

describe('AnthropicProvider cache hint handling', () => {
  it('creates separate system blocks for cached and non-cached messages', () => {
    const provider = new AnthropicProvider()

    // Access private method via type assertion for testing
    const convertMessages = (provider as unknown as {
      convertMessages: (msgs: Message[]) => {
        system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> | undefined
        messages: unknown[]
      }
    }).convertMessages.bind(provider)

    const messages: Message[] = [
      { role: 'system', content: 'Stable prefix content', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'system', content: 'Dynamic suffix content' },
      { role: 'user', content: 'Hello' },
    ]

    const result = convertMessages(messages)

    // Should produce TWO system text blocks
    expect(result.system).toHaveLength(2)

    // First block: stable prefix WITH cache_control
    expect(result.system![0].text).toBe('Stable prefix content')
    expect(result.system![0].cache_control).toEqual({ type: 'ephemeral' })

    // Second block: dynamic suffix WITHOUT cache_control
    expect(result.system![1].text).toBe('Dynamic suffix content')
    expect(result.system![1]).not.toHaveProperty('cache_control')
  })

  it('handles single system message without cache hint (backward compat)', () => {
    const provider = new AnthropicProvider()
    const convertMessages = (provider as unknown as {
      convertMessages: (msgs: Message[]) => {
        system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> | undefined
        messages: unknown[]
      }
    }).convertMessages.bind(provider)

    const messages: Message[] = [
      { role: 'system', content: 'Full system prompt' },
      { role: 'user', content: 'Hello' },
    ]

    const result = convertMessages(messages)

    // Backward compatible: single block with cache_control (existing behavior)
    expect(result.system).toHaveLength(1)
    expect(result.system![0].text).toBe('Full system prompt')
    expect(result.system![0].cache_control).toEqual({ type: 'ephemeral' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/llm/anthropic-cache.test.ts`
Expected: FAIL — current code joins all system messages into one block

- [ ] **Step 3: Update Anthropic `convertMessages` to handle cache hints**

In `lib/llm/providers/anthropic.ts`, replace the system message extraction logic (lines 81-96) with:

```typescript
    // 1. Extract system messages — preserve cache hints
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
    const nonSystemMessages: Message[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (msg.content) {
          if (msg.cacheHint) {
            // Explicit cache hint — apply cache_control
            systemBlocks.push({
              type: 'text' as const,
              text: msg.content,
              cache_control: { type: 'ephemeral' as const },
            })
          } else {
            // No cache hint — no cache_control
            systemBlocks.push({
              type: 'text' as const,
              text: msg.content,
            })
          }
        }
      } else {
        nonSystemMessages.push(msg)
      }
    }

    // Backward compat: if there's exactly one system block with no cache_control,
    // add it (preserves existing behavior for callers not using cache hints)
    if (systemBlocks.length === 1 && !systemBlocks[0].cache_control) {
      systemBlocks[0].cache_control = { type: 'ephemeral' as const }
    }

    const system = systemBlocks.length > 0 ? systemBlocks : undefined
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/llm/anthropic-cache.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add lib/llm/providers/anthropic.ts __tests__/lib/llm/anthropic-cache.test.ts
git commit -m "feat: Anthropic adapter maps CacheHint to separate system blocks with cache_control"
```

---

### Task 7: Cache Status Event Tracking

**Files:**
- Modify: `lib/events/types.ts`
- Modify: `lib/llm/gateway.ts`
- Create: `__tests__/lib/events/cache-status.test.ts`

- [ ] **Step 1: Write failing test for cache:status event emission**

Create `__tests__/lib/events/cache-status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventBus } from '@/lib/events'
import type { ZenoEvent } from '@/lib/events'

describe('cache:status event', () => {
  it('is a valid ZenoEvent type', () => {
    const events: ZenoEvent[] = []
    const unsub = eventBus.on('cache:status', (event) => {
      events.push(event)
    })

    eventBus.emit({
      type: 'cache:status',
      traceId: 'trace-1',
      provider: 'ANTHROPIC',
      cacheRead: 5000,
      cacheWrite: 2000,
      cacheHit: true,
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('cache:status')
    if (events[0].type === 'cache:status') {
      expect(events[0].cacheRead).toBe(5000)
      expect(events[0].cacheWrite).toBe(2000)
      expect(events[0].cacheHit).toBe(true)
    }

    unsub()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/cache-status.test.ts`
Expected: FAIL — `cache:status` is not a valid event type

- [ ] **Step 3: Add `cache:status` to ZenoEvent union**

In `lib/events/types.ts`, add to the `ZenoEvent` union (after line 30, before the closing):

```typescript
  // Infrastructure events
  | { type: 'cache:status'; traceId: string; provider: string; cacheRead: number; cacheWrite: number; cacheHit: boolean }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/events/cache-status.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for gateway cache:status emission**

Add to `__tests__/lib/events/cache-status.test.ts`:

```typescript
import { parseCacheUsage } from '@/lib/llm/gateway'

describe('parseCacheUsage', () => {
  it('extracts Anthropic cache tokens from usage', () => {
    const usage = {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 300,
    }

    const result = parseCacheUsage('ANTHROPIC', usage)

    expect(result.cacheRead).toBe(500)
    expect(result.cacheWrite).toBe(300)
    expect(result.cacheHit).toBe(true)
  })

  it('returns zeros for unknown providers', () => {
    const usage = { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 }

    const result = parseCacheUsage('UNKNOWN', usage)

    expect(result.cacheRead).toBe(0)
    expect(result.cacheWrite).toBe(0)
    expect(result.cacheHit).toBe(false)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/cache-status.test.ts`
Expected: FAIL — `parseCacheUsage is not exported`

- [ ] **Step 7: Implement `parseCacheUsage` and emit in gateway**

In `lib/llm/gateway.ts`, add after the imports:

```typescript
// ==============================================
// CACHE USAGE PARSING
// ==============================================

export interface CacheUsage {
  cacheRead: number
  cacheWrite: number
  cacheHit: boolean
}

export function parseCacheUsage(
  provider: string,
  usage: Record<string, unknown>,
): CacheUsage {
  if (provider === 'ANTHROPIC') {
    const cacheRead = typeof usage.cache_read_input_tokens === 'number'
      ? usage.cache_read_input_tokens
      : 0
    const cacheWrite = typeof usage.cache_creation_input_tokens === 'number'
      ? usage.cache_creation_input_tokens
      : 0
    return { cacheRead, cacheWrite, cacheHit: cacheRead > 0 }
  }

  if (provider === 'OPENAI') {
    // OpenAI nested: usage.prompt_tokens_details.cached_tokens
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
    const cached = typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0
    return { cacheRead: cached, cacheWrite: 0, cacheHit: cached > 0 }
  }

  return { cacheRead: 0, cacheWrite: 0, cacheHit: false }
}
```

Then in the `gateway.call` method, after `recordCall(...)` (around line 159), add:

```typescript
    // Emit cache status event
    if (options.traceId) {
      const cacheUsage = parseCacheUsage(config.provider, result.usage as unknown as Record<string, unknown>)
      eventBus.emit({
        type: 'cache:status',
        traceId: options.traceId,
        provider: config.provider,
        ...cacheUsage,
      })
    }
```

Similarly, in `trackStreamCompletion` (around line 287, after `recordCall`), add:

```typescript
  if (meta.traceId) {
    const cacheUsage = parseCacheUsage(meta.provider, usage as unknown as Record<string, unknown>)
    eventBus.emit({
      type: 'cache:status',
      traceId: meta.traceId,
      provider: meta.provider,
      ...cacheUsage,
    })
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/events/cache-status.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/events/types.ts lib/llm/gateway.ts __tests__/lib/events/cache-status.test.ts
git commit -m "feat: add cache:status event — tracks prompt cache hits per provider"
```

---

### Task 8: Prefix Stability — Deterministic Tool Sort

**Files:**
- Modify: `lib/tools/registry.ts`
- Create: `__tests__/lib/tools/deterministic-sort.test.ts`

- [ ] **Step 1: Write failing test for deterministic ordering**

Create `__tests__/lib/tools/deterministic-sort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getToolsForLLM } from '@/lib/tools/registry'

describe('getToolsForLLM deterministic ordering', () => {
  it('returns tools sorted by name for consistent serialization', () => {
    const tools = getToolsForLLM()
    const names = tools.map(t => t.function.name)

    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('returns same order on repeated calls', () => {
    const tools1 = getToolsForLLM()
    const tools2 = getToolsForLLM()

    const names1 = tools1.map(t => t.function.name)
    const names2 = tools2.map(t => t.function.name)
    expect(names1).toEqual(names2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/tools/deterministic-sort.test.ts`
Expected: FAIL — tools are in Map insertion order, not sorted

- [ ] **Step 3: Add sort to `getToolsForLLM`**

In `lib/tools/registry.ts`, modify `getToolsForLLM` (line 73). After building the result array (line 89), add a sort before caching:

```typescript
  // Deterministic sort for stable serialization (prompt cache optimization)
  result.sort((a, b) => a.function.name.localeCompare(b.function.name))

  toolsCache.set(cacheKey, result)
  return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/tools/deterministic-sort.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add lib/tools/registry.ts __tests__/lib/tools/deterministic-sort.test.ts
git commit -m "feat: deterministic tool sort in getToolsForLLM for stable prompt prefix"
```

---

### Task 9: Full Benchmark Scenarios

**Files:**
- Create: `__tests__/performance/bench-pipeline.test.ts`

This task creates the 4 benchmark scenarios that validate all the above optimizations. These tests require a running test database with seeded data, so they may be tagged for CI-only or manual runs.

- [ ] **Step 1: Create benchmark scenario file with all 4 scenarios**

Create `__tests__/performance/bench-pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { eventBus } from '@/lib/events'
import {
  collectTimings,
  assertPhaseUnder,
  assertPhasesParallel,
  createMockProvider,
} from './bench-helpers'

// ==============================================
// MOCK SETUP
// ==============================================

// Mock LLM providers to isolate pipeline overhead from LLM latency
const mockProvider = createMockProvider({
  latencyMs: 100, // simulate 100ms LLM response
  responseContent: 'Mock response from Zeno',
  tokenUsage: { promptTokens: 500, completionTokens: 100 },
})

// Mock the provider registry to return our mock provider
vi.mock('@/lib/llm/providers/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/llm/providers/registry')>()
  return {
    ...original,
    getProvider: vi.fn(() => mockProvider),
    callWithFailover: vi.fn(async (_primary, _fallback, fn) => {
      return fn(mockProvider, 'mock-model')
    }),
  }
})

// Mock agent config
vi.mock('@/lib/llm/agent-config', () => ({
  getAgentConfig: vi.fn().mockResolvedValue({
    slug: 'main-chat',
    name: 'Main Chat',
    role: 'agent',
    provider: 'MOCK',
    model: 'mock-model',
    fallbackProvider: null,
    fallbackModel: null,
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: 'You are Zeno, an AI insurance sales agent.',
    constraints: 'Always be helpful.',
    isActive: true,
  }),
  flushAgentConfigCache: vi.fn(),
}))

// Mock Prisma with realistic data
vi.mock('@/lib/db', () => {
  const mockConversation = {
    id: 'bench-conv-1',
    status: 'ACTIVE',
    messageCount: 5,
    mode: 'SALES',
    activeSkillPacks: [],
    productId: null,
    product: null,
    workflowSession: null,
    application: null,
    channel: 'web',
    language: 'ro',
    customerId: 'bench-cust-1',
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockMessages = Array.from({ length: 5 }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Test message ${i}`,
    createdAt: new Date(Date.now() - (5 - i) * 1000),
    conversationId: 'bench-conv-1',
    toolCalls: null,
    toolResults: null,
    tokenCount: null,
  }))

  return {
    prisma: {
      customer: {
        create: vi.fn().mockResolvedValue({ id: 'bench-cust-1' }),
        findUnique: vi.fn().mockResolvedValue({
          name: 'Test User',
          dateOfBirth: null,
          extractedProfile: {},
          language: 'ro',
          isAnonymous: true,
        }),
        update: vi.fn(),
      },
      conversation: {
        create: vi.fn().mockResolvedValue({ id: 'bench-conv-1' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(mockConversation),
        findUnique: vi.fn().mockResolvedValue(mockConversation),
        update: vi.fn().mockResolvedValue(mockConversation),
      },
      message: {
        create: vi.fn().mockResolvedValue({ id: 'new-msg' }),
        findMany: vi.fn().mockResolvedValue(mockMessages),
      },
      conversationSummary: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
      skillPack: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      turnTrace: {
        create: vi.fn(),
      },
      customerInsight: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      agentKnowledge: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }
})

// ==============================================
// TIMING THRESHOLDS (generous initial baselines)
// ==============================================

const THRESHOLDS = {
  fastPathOverhead: 500,        // pipeline overhead excl. LLM < 500ms
  parallelOverlap: 50,          // gate+context must overlap by at least 50ms
  warmSummaryStep5: 100,        // warm summary lookup < 100ms
  warmCacheStep4: 200,          // warm cache context < 200ms
}

// ==============================================
// SCENARIOS
// ==============================================

describe('Performance Benchmarks', () => {
  describe('Scenario 1: Fast-path turn', () => {
    it('completes pipeline under threshold when gate is skipped', async () => {
      // Fast-path: short questionnaire answer
      // This test validates pipeline overhead without the reasoning gate
      const traceId = 'bench-fast-' + Date.now()
      const collector = collectTimings(traceId)

      // Import and call handleChatTurn (captures timing through event bus)
      const { handleChatTurn } = await import('@/lib/chat/orchestrator')

      const stream = handleChatTurn({
        conversationId: 'bench-conv-1',
        customerId: 'bench-cust-1',
        message: 'Da', // short response = fast path
        language: 'ro',
      })

      // Consume the stream to completion
      const reader = stream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const { timings } = collector.finish()

      // Verify fast path was taken (gate should be near-instant)
      expect(timings['reasoning_gate']).toBeLessThan(10)
    })
  })

  describe('Scenario 2: Standard turn — parallel gate + context', () => {
    it('runs reasoning gate and context assembly with measurable overlap', async () => {
      const traceId = 'bench-parallel-' + Date.now()
      const collector = collectTimings(traceId)

      const { handleChatTurn } = await import('@/lib/chat/orchestrator')

      const stream = handleChatTurn({
        conversationId: 'bench-conv-1',
        customerId: 'bench-cust-1',
        message: 'Vreau sa aflu mai multe despre asigurarea de viata', // long enough = full gate
        language: 'ro',
      })

      const reader = stream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const { timings, spans } = collector.finish()

      // Both phases should have run
      expect(timings['reasoning_gate']).toBeDefined()
      expect(timings['context']).toBeDefined()

      // Verify parallel execution: phases should overlap
      if (spans['reasoning_gate'] && spans['context']) {
        assertPhasesParallel(spans, 'reasoning_gate', 'context', THRESHOLDS.parallelOverlap)
      }
    })
  })

  describe('Scenario 3: Long conversation — warm summary', () => {
    it('uses cached summary without blocking on summarizer', async () => {
      // Setup: mock 50 messages and an existing (stale) summary
      const { prisma } = await import('@/lib/db')
      const longMessages = Array.from({ length: 50 }, (_, i) => ({
        id: `long-msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Long conversation message ${i} with some content to fill tokens`,
        createdAt: new Date(Date.now() - (50 - i) * 1000),
        conversationId: 'bench-conv-1',
        toolCalls: null,
        toolResults: null,
        tokenCount: null,
      }))

      vi.mocked(prisma.message.findMany).mockResolvedValue(longMessages as never)
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue({
        id: 'bench-conv-1',
        status: 'ACTIVE',
        messageCount: 50,
        mode: 'SALES',
        activeSkillPacks: [],
        productId: null,
        product: null,
        workflowSession: null,
        application: null,
      } as never)

      // Existing summary — stale but usable
      vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue({
        conversationId: 'bench-conv-1',
        summary: 'Previous conversation about life insurance.',
        messagesUpTo: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)

      const traceId = 'bench-long-' + Date.now()
      const collector = collectTimings(traceId)

      const { handleChatTurn } = await import('@/lib/chat/orchestrator')

      const stream = handleChatTurn({
        conversationId: 'bench-conv-1',
        customerId: 'bench-cust-1',
        message: 'Da',
        language: 'ro',
      })

      const reader = stream.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }

      const { timings } = collector.finish()

      // Sliding window should be fast (used cached summary)
      if (timings['sliding_window'] !== undefined) {
        assertPhaseUnder(timings, 'sliding_window', THRESHOLDS.warmSummaryStep5)
      }
    })
  })

  describe('Scenario 4: Repeated turn — cache warmth', () => {
    it('second turn in same conversation uses cached context', async () => {
      const { handleChatTurn } = await import('@/lib/chat/orchestrator')

      // First turn — cold cache
      const stream1 = handleChatTurn({
        conversationId: 'bench-conv-1',
        customerId: 'bench-cust-1',
        message: 'Da',
        language: 'ro',
      })
      const reader1 = stream1.getReader()
      while (true) {
        const { done } = await reader1.read()
        if (done) break
      }

      // Second turn — warm cache
      const traceId = 'bench-warm-' + Date.now()
      const collector = collectTimings(traceId)

      const stream2 = handleChatTurn({
        conversationId: 'bench-conv-1',
        customerId: 'bench-cust-1',
        message: 'Da',
        language: 'ro',
      })
      const reader2 = stream2.getReader()
      while (true) {
        const { done } = await reader2.read()
        if (done) break
      }

      const { timings } = collector.finish()

      // Context assembly should be faster on warm cache
      if (timings['context'] !== undefined) {
        assertPhaseUnder(timings, 'context', THRESHOLDS.warmCacheStep4)
      }
    })
  })
})
```

- [ ] **Step 2: Run benchmarks**

Run: `npx vitest run __tests__/performance/bench-pipeline.test.ts`
Expected: All PASS (thresholds are generous). If any fail, adjust thresholds upward and note the actual values — these become the baseline.

- [ ] **Step 3: Commit**

```bash
git add __tests__/performance/bench-pipeline.test.ts
git commit -m "test: add 4 performance benchmark scenarios with timing assertions"
```

---

### Task 10: Update Master Plan

**Files:**
- Modify: `docs/MASTER-TRANSFORMATION-PLAN.md`

- [ ] **Step 1: Update progress table and sub-project #6 section**

In `docs/MASTER-TRANSFORMATION-PLAN.md`, update the Sub-Project #6 section (around line 202) with the actual spec, plan, and commit info. Update the progress table (around line 246) to mark #6 as COMPLETE with the commit count.

- [ ] **Step 2: Commit**

```bash
git add docs/MASTER-TRANSFORMATION-PLAN.md
git commit -m "docs: update master plan — sub-project #6 complete, #7 next"
```
