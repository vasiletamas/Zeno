# Context & Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 20-message sliding window with a token-aware, resilient context management system and add cross-conversation memory.

**Architecture:** Token budget calculates available message space dynamically. Reactive compaction catches overflow errors and compresses message groups. Two new Prisma models (CustomerInsight, AgentKnowledge) store cross-conversation learning. LRU cache reduces redundant DB hits. Prompt reordering enables provider-level prefix caching.

**Tech Stack:** TypeScript, Prisma ORM, Vitest, Next.js API routes, OpenAI SDK, Anthropic SDK

**Spec:** `docs/superpowers/specs/2026-04-10-context-and-memory-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `lib/chat/token-budget.ts` | Token estimation and budget calculation |
| `lib/chat/compaction.ts` | Reactive compaction on context overflow |
| `lib/cache/lru-cache.ts` | Generic LRU cache with TTL |
| `prisma/seeds/seed-agent-knowledge.ts` | Bootstrap AgentKnowledge from ObjectionStrategy |
| `__tests__/lib/cache/lru-cache.test.ts` | LRU cache unit tests |
| `__tests__/lib/chat/token-budget.test.ts` | Token budget unit tests |
| `__tests__/lib/chat/compaction.test.ts` | Compaction unit tests |
| `__tests__/lib/chat/sliding-window.test.ts` | Updated sliding window tests |
| `__tests__/lib/chat/context-loaders.test.ts` | Customer memory & agent knowledge tests |

### Modified Files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add CustomerInsight, AgentKnowledge models + enums, contextWindow on ModelCatalog |
| `lib/chat/sliding-window.ts` | Dynamic window sizing based on token budget |
| `lib/chat/orchestrator.ts` | Wire token budget, reactive compaction, expanded profile extraction |
| `lib/chat/context-loaders.ts` | Implement loadCustomerMemory, update loadAgentKnowledge signature |
| `lib/chat/prompt-builder.ts` | Reorder sections for stable prefix, return stablePrefix/dynamicSuffix |
| `lib/llm/errors.ts` | Add context_length_exceeded classification, parseTokenDeficit |
| `lib/llm/providers/anthropic.ts` | Add cache_control on stable prefix |
| `lib/tools/registry.ts` | Add LRU cache for getToolsForLLM |
| `prisma/seeds/seed-model-catalog.ts` | Add contextWindow to model seeds, update to GPT-5.4 |
| `prisma/seeds/index.ts` | Add seed-agent-knowledge to seed order |

---

## Task 1: LRU Cache Utility

**Files:**
- Create: `lib/cache/lru-cache.ts`
- Create: `__tests__/lib/cache/lru-cache.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/cache/lru-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LRUCache } from '@/lib/cache/lru-cache'

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('stores and retrieves values', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
  })

  it('evicts oldest entry when maxSize is exceeded', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3) // should evict 'a'
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('expires entries past TTL', () => {
    const cache = new LRUCache<string, number>(10, 1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)

    vi.advanceTimersByTime(1001)
    expect(cache.get('a')).toBeUndefined()
  })

  it('refreshes position on get (LRU behavior)', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a') // refresh 'a' — 'b' is now oldest
    cache.set('c', 3) // should evict 'b', not 'a'
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('invalidate removes a specific key', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    cache.invalidate('a')
    expect(cache.get('a')).toBeUndefined()
  })

  it('clear removes all entries', () => {
    const cache = new LRUCache<string, number>(10, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('overwrites existing key without increasing size', () => {
    const cache = new LRUCache<string, number>(2, 60_000)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // overwrite, not new entry
    cache.set('c', 3) // should evict 'b' (oldest non-refreshed)
    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/cache/lru-cache.test.ts`
Expected: FAIL — module `@/lib/cache/lru-cache` not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/cache/lru-cache.ts
/**
 * Generic LRU Cache with TTL expiry.
 *
 * Uses a Map (insertion-ordered) for O(1) get/set.
 * On get: checks TTL, refreshes position by delete+re-insert.
 * On set: evicts oldest if at capacity.
 */

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export class LRUCache<K, V> {
  private map = new Map<K, CacheEntry<V>>()

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined

    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }

    // Refresh position: delete and re-insert
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: K, value: V): void {
    // Delete first to refresh position if key exists
    this.map.delete(key)

    // Evict oldest if at capacity
    if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value!
      this.map.delete(oldestKey)
    }

    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  invalidate(key: K): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/cache/lru-cache.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/cache/lru-cache.ts __tests__/lib/cache/lru-cache.test.ts
git commit -m "feat: add generic LRU cache with TTL expiry"
```

---

## Task 2: Token Budget System

**Files:**
- Create: `lib/chat/token-budget.ts`
- Create: `__tests__/lib/chat/token-budget.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/chat/token-budget.test.ts
import { describe, it, expect } from 'vitest'
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'

describe('estimateTokens', () => {
  it('estimates English text at ~4 chars per token', () => {
    const text = 'Hello world' // 11 chars → ~3 tokens
    const tokens = estimateTokens(text, 'en')
    expect(tokens).toBeGreaterThanOrEqual(2)
    expect(tokens).toBeLessThanOrEqual(4)
  })

  it('estimates Romanian text at ~3 chars per token', () => {
    const text = 'Bună ziua' // 9 chars → ~3 tokens
    const tokens = estimateTokens(text, 'ro')
    expect(tokens).toBeGreaterThanOrEqual(2)
    expect(tokens).toBeLessThanOrEqual(4)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('', 'en')).toBe(0)
  })

  it('handles long text proportionally', () => {
    const text = 'a'.repeat(4000) // 4000 chars → ~1000 tokens (en)
    const tokens = estimateTokens(text, 'en')
    expect(tokens).toBeGreaterThanOrEqual(900)
    expect(tokens).toBeLessThanOrEqual(1100)
  })
})

describe('calculateMessageBudget', () => {
  it('calculates available budget correctly', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 128_000,
      systemPromptTokens: 3000,
      toolDefinitionTokens: 2000,
      outputReservation: 4096,
      safetyMargin: 0.10,
    })
    // (128000 - 3000 - 2000 - 4096) * 0.90 = 107013.6 → floor = 107013
    expect(budget).toBe(Math.floor((128_000 - 3000 - 2000 - 4096) * 0.90))
  })

  it('returns 0 if budget would be negative', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 1000,
      systemPromptTokens: 500,
      toolDefinitionTokens: 500,
      outputReservation: 500,
      safetyMargin: 0.10,
    })
    expect(budget).toBe(0)
  })

  it('uses default 10% safety margin', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 10_000,
      systemPromptTokens: 1000,
      toolDefinitionTokens: 500,
      outputReservation: 500,
    })
    // (10000 - 1000 - 500 - 500) * 0.90 = 7200
    expect(budget).toBe(7200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/token-budget.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/chat/token-budget.ts
/**
 * Token Budget — Token Estimation and Budget Calculation
 *
 * Fast char-based token estimator (no external tokenizer dependency).
 * Accuracy within ~10% — sufficient for budget calculations with safety margin.
 *
 * Exports:
 * - estimateTokens(text, language) — estimate token count for a string
 * - calculateMessageBudget(params) — calculate available tokens for messages
 */

// ==============================================
// CONSTANTS
// ==============================================

/** Average characters per token by language. Romanian uses more diacritics. */
const CHARS_PER_TOKEN: Record<string, number> = {
  en: 4,
  ro: 3,
}

const DEFAULT_CHARS_PER_TOKEN = 4

// ==============================================
// TOKEN ESTIMATION
// ==============================================

/**
 * Estimate token count for a text string.
 * Uses character-based heuristic: ~4 chars/token (English), ~3 chars/token (Romanian).
 */
export function estimateTokens(text: string, language: 'en' | 'ro' = 'en'): number {
  if (!text) return 0
  const charsPerToken = CHARS_PER_TOKEN[language] ?? DEFAULT_CHARS_PER_TOKEN
  return Math.ceil(text.length / charsPerToken)
}

// ==============================================
// BUDGET CALCULATION
// ==============================================

export interface BudgetParams {
  modelContextWindow: number
  systemPromptTokens: number
  toolDefinitionTokens: number
  outputReservation: number
  /** Default: 0.10 (10%) */
  safetyMargin?: number
}

/**
 * Calculate available token budget for conversation messages.
 *
 * Formula:
 *   available = contextWindow - systemPrompt - toolDefs - outputReservation
 *   budget = available * (1 - safetyMargin)
 *
 * Returns 0 if budget would be negative.
 */
export function calculateMessageBudget(params: BudgetParams): number {
  const margin = params.safetyMargin ?? 0.10
  const available =
    params.modelContextWindow -
    params.systemPromptTokens -
    params.toolDefinitionTokens -
    params.outputReservation

  if (available <= 0) return 0
  return Math.floor(available * (1 - margin))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/token-budget.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat/token-budget.ts __tests__/lib/chat/token-budget.test.ts
git commit -m "feat: add token budget system for dynamic context window sizing"
```

---

## Task 3: Error Classification for Context Overflow

**Files:**
- Modify: `lib/llm/errors.ts`

- [ ] **Step 1: Write the failing test**

Create a new test file:

```typescript
// __tests__/lib/llm/errors.test.ts
import { describe, it, expect } from 'vitest'
import {
  classifyError,
  isContextLengthError,
  parseTokenDeficit,
} from '@/lib/llm/errors'

describe('isContextLengthError', () => {
  it('detects OpenAI context_length_exceeded error', () => {
    const err = {
      status: 400,
      code: 'context_length_exceeded',
      message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 135000 tokens.",
    }
    expect(isContextLengthError(err)).toBe(true)
  })

  it('detects Anthropic prompt too long error', () => {
    const err = {
      status: 400,
      message: 'prompt is too long: 150000 tokens > 128000 maximum',
    }
    expect(isContextLengthError(err)).toBe(true)
  })

  it('returns false for regular 400 errors', () => {
    const err = {
      status: 400,
      message: 'invalid parameter: temperature must be between 0 and 2',
    }
    expect(isContextLengthError(err)).toBe(false)
  })

  it('returns false for non-400 errors', () => {
    const err = {
      status: 500,
      message: 'internal server error',
    }
    expect(isContextLengthError(err)).toBe(false)
  })
})

describe('parseTokenDeficit', () => {
  it('parses OpenAI format: "resulted in X tokens" vs "maximum context length is Y"', () => {
    const err = {
      message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 135000 tokens.",
    }
    expect(parseTokenDeficit(err)).toBe(7000)
  })

  it('parses Anthropic format: "X tokens > Y maximum"', () => {
    const err = {
      message: 'prompt is too long: 150000 tokens > 128000 maximum',
    }
    expect(parseTokenDeficit(err)).toBe(22000)
  })

  it('returns null for unparseable messages', () => {
    const err = { message: 'something went wrong' }
    expect(parseTokenDeficit(err)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/llm/errors.test.ts`
Expected: FAIL — `isContextLengthError` and `parseTokenDeficit` are not exported

- [ ] **Step 3: Add the new functions to errors.ts**

Add the following to the end of `lib/llm/errors.ts` (after the existing `getErrorCode` function):

```typescript
// ==============================================
// CONTEXT LENGTH OVERFLOW
// ==============================================

const CONTEXT_LENGTH_PATTERNS = [
  /context.length/i,
  /too.long/i,
  /maximum.context/i,
  /token.limit/i,
]

/**
 * Detect if an error is a context length overflow.
 * Both OpenAI and Anthropic return 400 with specific messages.
 */
export function isContextLengthError(error: unknown): boolean {
  const status = getStatusCode(error)
  if (status !== 400) return false

  const message = getErrorMessage(error)
  if (!message) return false

  return CONTEXT_LENGTH_PATTERNS.some((p) => p.test(message))
}

/**
 * Parse the token deficit (how many tokens over the limit) from the error message.
 * Returns null if the format is not recognized.
 *
 * Supported formats:
 * - OpenAI: "maximum context length is Y tokens. However, your messages resulted in X tokens."
 * - Anthropic: "X tokens > Y maximum"
 */
export function parseTokenDeficit(error: unknown): number | null {
  const message = getErrorMessage(error)
  if (!message) return null

  // OpenAI: "maximum context length is 128000 tokens ... resulted in 135000 tokens"
  const openaiMatch = message.match(
    /maximum context length is (\d+).*resulted in (\d+)/i,
  )
  if (openaiMatch) {
    const limit = parseInt(openaiMatch[1], 10)
    const actual = parseInt(openaiMatch[2], 10)
    return actual - limit
  }

  // Anthropic: "150000 tokens > 128000 maximum"
  const anthropicMatch = message.match(/(\d+)\s*tokens?\s*>\s*(\d+)/i)
  if (anthropicMatch) {
    const actual = parseInt(anthropicMatch[1], 10)
    const limit = parseInt(anthropicMatch[2], 10)
    return actual - limit
  }

  return null
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    return (error as Record<string, unknown>).message as string
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/llm/errors.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/llm/errors.ts __tests__/lib/llm/errors.test.ts
git commit -m "feat: add context length overflow detection and token deficit parsing"
```

---

## Task 4: Reactive Compaction

**Files:**
- Create: `lib/chat/compaction.ts`
- Create: `__tests__/lib/chat/compaction.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/chat/compaction.test.ts
import { describe, it, expect, vi } from 'vitest'
import { compactMessages, groupMessages } from '@/lib/chat/compaction'
import type { Message } from '@/lib/llm/providers/types'

// Mock the gateway
vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn().mockResolvedValue({
      content: 'Summary: Customer discussed pricing and coverage options.',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
      rawMessage: { role: 'assistant', content: 'Summary: Customer discussed pricing and coverage options.' },
    }),
  },
}))

describe('groupMessages', () => {
  it('groups messages into chunks of groupSize', () => {
    const messages: Message[] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }))
    const groups = groupMessages(messages, 10)
    expect(groups).toHaveLength(3) // 10 + 10 + 5
    expect(groups[0]).toHaveLength(10)
    expect(groups[1]).toHaveLength(10)
    expect(groups[2]).toHaveLength(5)
  })

  it('returns single group for small arrays', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    const groups = groupMessages(messages, 10)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })
})

describe('compactMessages', () => {
  it('compresses oldest groups to cover token deficit', async () => {
    // 20 messages, each ~10 tokens (short content)
    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Short message number ${i}`,
    }))

    // Request compaction of 500 tokens — should compress first group
    const result = await compactMessages(messages, 500, 'conv-123')

    // Should have fewer messages than original
    expect(result.length).toBeLessThan(messages.length)
    // First message should be the compacted summary
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('Summary')
  })

  it('preserves system messages at the start', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are Zeno.' },
      ...Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      })),
    ]

    const result = await compactMessages(messages, 500, 'conv-123')

    // System message should still be first
    expect(result[0].role).toBe('system')
    expect(result[0].content).toBe('You are Zeno.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/compaction.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/chat/compaction.ts
/**
 * Reactive Compaction — Message History Compression
 *
 * When the LLM API returns a "prompt too long" error, this module
 * compresses older message groups into summaries and returns a
 * shorter message array.
 *
 * Exports:
 * - compactMessages(messages, tokenDeficit, conversationId) — compress to fit
 * - groupMessages(messages, groupSize) — split messages into groups (exported for testing)
 */

import { gateway } from '@/lib/llm/gateway'
import { estimateTokens } from '@/lib/chat/token-budget'
import type { Message } from '@/lib/llm/providers/types'

// ==============================================
// CONSTANTS
// ==============================================

const GROUP_SIZE = 10
const MIN_TOKENS_PER_MESSAGE = 15 // floor estimate for very short messages

// ==============================================
// GROUP MESSAGES
// ==============================================

/**
 * Split an array of messages into groups of `groupSize`.
 * Last group may be smaller.
 */
export function groupMessages(messages: Message[], groupSize: number): Message[][] {
  const groups: Message[][] = []
  for (let i = 0; i < messages.length; i += groupSize) {
    groups.push(messages.slice(i, i + groupSize))
  }
  return groups
}

// ==============================================
// COMPACT MESSAGES
// ==============================================

/**
 * Compress oldest message groups to free up `tokenDeficit` tokens.
 *
 * Algorithm:
 * 1. Separate leading system messages from conversation messages
 * 2. Group conversation messages into chunks of GROUP_SIZE
 * 3. Estimate tokens per group, determine how many groups to compress
 * 4. Summarize compressed groups via the summarizer agent
 * 5. Return: system messages + summary message + remaining messages
 */
export async function compactMessages(
  messages: Message[],
  tokenDeficit: number,
  conversationId: string,
): Promise<Message[]> {
  // Separate leading system messages
  let systemPrefix: Message[] = []
  let conversationMessages: Message[] = messages

  const firstNonSystem = messages.findIndex((m) => m.role !== 'system')
  if (firstNonSystem > 0) {
    systemPrefix = messages.slice(0, firstNonSystem)
    conversationMessages = messages.slice(firstNonSystem)
  }

  // Need at least 4 messages to compact (keep at least 2 after compaction)
  if (conversationMessages.length < 4) {
    return messages
  }

  const groups = groupMessages(conversationMessages, GROUP_SIZE)

  // Calculate how many groups to compress
  let tokensFreed = 0
  let groupsToCompress = 0

  for (const group of groups) {
    if (tokensFreed >= tokenDeficit) break
    // Keep at least the last group intact
    if (groupsToCompress >= groups.length - 1) break

    const groupTokens = group.reduce(
      (sum, msg) => sum + Math.max(estimateTokens(msg.content, 'en'), MIN_TOKENS_PER_MESSAGE),
      0,
    )
    tokensFreed += groupTokens
    groupsToCompress++
  }

  if (groupsToCompress === 0) return messages

  // Flatten groups to compress
  const messagesToCompress = groups.slice(0, groupsToCompress).flat()
  const remainingMessages = groups.slice(groupsToCompress).flat()

  // Summarize via summarizer agent
  const formatted = messagesToCompress
    .map((msg) => {
      const role = msg.role === 'user' ? 'Customer' : msg.role === 'assistant' ? 'Agent' : 'System'
      return `${role}: ${msg.content}`
    })
    .join('\n')

  const response = await gateway.call('summarizer', {
    messages: [{ role: 'user', content: formatted }],
  })

  const summaryText = response.content ?? 'Previous conversation context unavailable.'

  const summaryMessage: Message = {
    role: 'system',
    content: `[Compacted summary of ${messagesToCompress.length} earlier messages]\n${summaryText}\n[End of compacted summary — recent messages follow]`,
  }

  return [...systemPrefix, summaryMessage, ...remainingMessages]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/compaction.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat/compaction.ts __tests__/lib/chat/compaction.test.ts
git commit -m "feat: add reactive compaction for context overflow recovery"
```

---

## Task 5: Prisma Schema — New Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums and models to schema**

Add at the end of the enums section in `prisma/schema.prisma` (after `enum UserRole`):

```prisma
enum InsightCategory {
  DEMOGRAPHIC
  PREFERENCE
  OBJECTION_PATTERN
  BUYING_SIGNAL
  RISK_FACTOR
}

enum KnowledgeCategory {
  OBJECTION_RESPONSE
  TOOL_SEQUENCE
  CONVERSATION_PATTERN
  PROMPT_FRAGMENT
}
```

Add the `contextWindow` field to `ModelCatalog` (after `costPer1kOutputTokens`):

```prisma
  contextWindow           Int         @default(128000)
```

Add the relation field to `Customer` model (after `user` relation):

```prisma
  insights          CustomerInsight[]
```

Add the relation field to `Product` model (after `policies` relation):

```prisma
  agentKnowledge    AgentKnowledge[]
```

Add the new models at the end of the schema (before the closing):

```prisma
// ==========================================
// DOMAIN: CROSS-CONVERSATION MEMORY
// ==========================================

model CustomerInsight {
  id              String          @id @default(cuid())
  customerId      String
  category        InsightCategory
  key             String
  value           String          @db.Text
  confidence      Float           @default(0.5)
  source          String
  lastConfirmedAt DateTime        @default(now())
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  customer Customer @relation(fields: [customerId], references: [id])

  @@unique([customerId, key])
  @@index([customerId, category])
}

model AgentKnowledge {
  id               String            @id @default(cuid())
  category         KnowledgeCategory
  trigger          String
  content          String            @db.Text
  successRate      Float             @default(0.0)
  sampleSize       Int               @default(0)
  productId        String?
  workflowStepCode String?
  isActive         Boolean           @default(true)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  product Product? @relation(fields: [productId], references: [id])

  @@index([category, isActive])
  @@index([productId, workflowStepCode])
}
```

- [ ] **Step 2: Push schema to database**

Run: `npx prisma db push`
Expected: Output includes "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Generate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message

- [ ] **Step 4: Verify build still works**

Run: `npx tsc --noEmit`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add CustomerInsight, AgentKnowledge models and contextWindow to ModelCatalog"
```

---

## Task 6: Update Model Catalog Seeds (GPT-5.4 + contextWindow)

**Files:**
- Modify: `prisma/seeds/seed-model-catalog.ts`

- [ ] **Step 1: Read current seed file**

Read `prisma/seeds/seed-model-catalog.ts` to see the current model definitions.

- [ ] **Step 2: Update seed file**

Update the seed file to:
- Change `gpt-5.2` references to `gpt-5.4`
- Change `gpt-5.2-mini` references to `gpt-5.4-mini`
- Add `contextWindow` to each model's upsert data

Each model upsert should include the `contextWindow` field:

```typescript
// For GPT-5.4 models:
contextWindow: 128_000,

// For Claude models:
contextWindow: 200_000,
```

- [ ] **Step 3: Update agent seeds to reference GPT-5.4**

Read and update `prisma/seeds/seed-agents.ts` — change model references from `gpt-5.2` to `gpt-5.4` and `gpt-5.2-mini` to `gpt-5.4-mini`.

- [ ] **Step 4: Re-run seeds**

Run: `npx prisma db seed`
Expected: Seeds complete with updated model names showing `gpt-5.4`

- [ ] **Step 5: Commit**

```bash
git add prisma/seeds/seed-model-catalog.ts prisma/seeds/seed-agents.ts
git commit -m "feat: upgrade to GPT-5.4, add contextWindow to model catalog"
```

---

## Task 7: Bootstrap AgentKnowledge Seeds

**Files:**
- Create: `prisma/seeds/seed-agent-knowledge.ts`
- Modify: `prisma/seeds/index.ts`

- [ ] **Step 1: Write the seed file**

```typescript
// prisma/seeds/seed-agent-knowledge.ts
/**
 * Seed: Agent Knowledge — Bootstrap from ObjectionStrategy
 *
 * Converts existing objection strategies into AgentKnowledge rows
 * so loadAgentKnowledge has data from day one.
 */

import { prisma } from '../../lib/db'

export async function seedAgentKnowledge() {
  console.log('  Seeding agent knowledge from objection strategies...')

  const strategies = await prisma.objectionStrategy.findMany({
    where: { isActive: true },
    select: {
      type: true,
      title: true,
      strategy: true,
      productId: true,
    },
  })

  let count = 0
  for (const s of strategies) {
    await prisma.agentKnowledge.upsert({
      where: {
        // Use compound lookup: category + trigger + productId
        // Since there's no unique constraint on these, use create-or-skip pattern
        id: `bootstrap-${s.productId}-${s.type}`,
      },
      update: {
        content: s.strategy,
        isActive: true,
      },
      create: {
        id: `bootstrap-${s.productId}-${s.type}`,
        category: 'OBJECTION_RESPONSE',
        trigger: `${s.type}_objection`,
        content: `[${s.title}] ${s.strategy}`,
        successRate: 0,
        sampleSize: 0,
        productId: s.productId,
        isActive: true,
      },
    })
    count++
  }

  console.log(`    ${count} agent knowledge entries bootstrapped.`)
}
```

- [ ] **Step 2: Add to seed index**

Read `prisma/seeds/index.ts` and add the import and call:

```typescript
import { seedAgentKnowledge } from './seed-agent-knowledge'
```

Add `await seedAgentKnowledge()` after the objection strategies seed call (since it depends on them).

- [ ] **Step 3: Run seeds**

Run: `npx prisma db seed`
Expected: Output includes "X agent knowledge entries bootstrapped."

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seed-agent-knowledge.ts prisma/seeds/index.ts
git commit -m "feat: bootstrap AgentKnowledge from existing objection strategies"
```

---

## Task 8: Dynamic Sliding Window

**Files:**
- Modify: `lib/chat/sliding-window.ts`
- Create: `__tests__/lib/chat/sliding-window.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/chat/sliding-window.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSlidingWindow } from '@/lib/chat/sliding-window'
import { estimateTokens } from '@/lib/chat/token-budget'

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: vi.fn(),
    },
    conversationSummary: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock gateway (for summarizer)
vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn().mockResolvedValue({
      content: 'Summary of earlier conversation.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      rawMessage: { role: 'assistant', content: 'Summary of earlier conversation.' },
    }),
  },
}))

const { prisma } = await import('@/lib/db')

function makeDbMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message number ${i} with some content for token counting`,
    toolCalls: null,
    toolResults: null,
    createdAt: new Date(2026, 0, 1, 0, i),
  }))
}

describe('buildSlidingWindow with token budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads all messages when total fits within budget', async () => {
    const messages = makeDbMessages(5)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 5, 50_000)
    expect(result.messages).toHaveLength(5)
    expect(result.summaryPrefix).toBeNull()
  })

  it('falls back to 20 messages when no budget provided', async () => {
    const messages = makeDbMessages(20)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 25)
    // Should request 20 messages (WINDOW_SIZE fallback)
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    )
  })

  it('limits messages by token budget', async () => {
    // Each message ~12 tokens. Budget of 50 tokens → should fit ~4 messages
    const messages = makeDbMessages(10)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 10, 50)
    expect(result.messages.length).toBeLessThan(10)
    expect(result.messages.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/sliding-window.test.ts`
Expected: FAIL — `buildSlidingWindow` doesn't accept third parameter

- [ ] **Step 3: Update sliding-window.ts**

Replace the content of `lib/chat/sliding-window.ts`:

```typescript
/**
 * Sliding Window — Token-Aware Message Window + Summarizer Trigger
 *
 * Dynamically sizes the conversation message window based on available
 * token budget. When conversations exceed the window, generates a summary
 * of older messages.
 *
 * Exports:
 * - buildSlidingWindow(conversationId, totalMessages, availableTokenBudget?) — build the message window
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { estimateTokens } from '@/lib/chat/token-budget'
import type { Message } from '@/lib/llm/providers/types'

// ==============================================
// CONSTANTS
// ==============================================

/** Fallback when no token budget is provided */
const FALLBACK_WINDOW_SIZE = 20

/** Minimum messages to always include (even if over budget) */
const MIN_WINDOW_SIZE = 4

// ==============================================
// DB MESSAGE → LLM MESSAGE CONVERSION
// ==============================================

function dbMessageToLLM(msg: {
  role: string
  content: string
  toolCalls: unknown
  toolResults: unknown
}): Message {
  let toolCalls: Message['toolCalls'] = undefined
  if (msg.toolCalls) {
    const parsed = msg.toolCalls as unknown
    if (Array.isArray(parsed)) {
      toolCalls = parsed as Message['toolCalls']
    }
  }

  return {
    role: msg.role as Message['role'],
    content: msg.content,
    toolCalls,
  }
}

// ==============================================
// BUILD SLIDING WINDOW
// ==============================================

/**
 * Build the sliding window of messages for the LLM call.
 *
 * - If availableTokenBudget is provided: load messages newest-first until budget exhausted
 * - If not provided: fall back to loading last 20 messages
 * - If messages exceed window: generate/retrieve summary of older messages
 *
 * Returns messages in chronological order (oldest first).
 */
export async function buildSlidingWindow(
  conversationId: string,
  totalMessages: number,
  availableTokenBudget?: number,
): Promise<{ messages: Message[]; summaryPrefix: string | null }> {
  // Determine window size
  const useTokenBudget = availableTokenBudget !== undefined && availableTokenBudget > 0
  const maxToLoad = useTokenBudget ? totalMessages : Math.min(totalMessages, FALLBACK_WINDOW_SIZE)

  if (totalMessages <= MIN_WINDOW_SIZE) {
    // Very small conversation — load everything
    const dbMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })
    return { messages: dbMessages.map(dbMessageToLLM), summaryPrefix: null }
  }

  // Load messages newest-first (we'll trim by budget)
  const dbMessagesDesc = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: maxToLoad,
  })

  const dbMessagesAsc = dbMessagesDesc.reverse()
  const allMessages = dbMessagesAsc.map(dbMessageToLLM)

  // If using token budget, trim from the front until within budget
  let windowMessages: Message[]
  if (useTokenBudget) {
    let tokenCount = 0
    let startIndex = allMessages.length

    // Walk backward (newest first) accumulating tokens
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(allMessages[i].content, 'en')
      if (tokenCount + msgTokens > availableTokenBudget && startIndex < allMessages.length - MIN_WINDOW_SIZE + 1) {
        break
      }
      tokenCount += msgTokens
      startIndex = i
    }

    windowMessages = allMessages.slice(startIndex)
  } else {
    // Fallback: last FALLBACK_WINDOW_SIZE
    windowMessages = allMessages.slice(-FALLBACK_WINDOW_SIZE)
  }

  // If window includes all messages, no summary needed
  if (windowMessages.length >= totalMessages) {
    return { messages: windowMessages, summaryPrefix: null }
  }

  // Need summary for older messages
  const olderCount = totalMessages - windowMessages.length

  // Check for existing summary
  const existingSummary = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  if (existingSummary && existingSummary.messagesUpTo >= olderCount) {
    return { messages: windowMessages, summaryPrefix: existingSummary.summary }
  }

  // Load older messages and trigger summarizer
  const olderMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: olderCount,
  })

  const olderLLMMessages = olderMessages.map(dbMessageToLLM)
  const summaryText = await triggerSummarizer(
    conversationId,
    olderLLMMessages,
    olderCount,
  )

  return { messages: windowMessages, summaryPrefix: summaryText }
}

// ==============================================
// SUMMARIZER TRIGGER
// ==============================================

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role =
        msg.role === 'user'
          ? 'Customer'
          : msg.role === 'assistant'
            ? 'Agent'
            : msg.role === 'system'
              ? 'System'
              : 'Tool'
      return `${role}: ${msg.content}`
    })
    .join('\n')
}

async function triggerSummarizer(
  conversationId: string,
  messagesToSummarize: Message[],
  messagesUpTo: number,
): Promise<string> {
  const formattedMessages = formatMessagesForSummary(messagesToSummarize)

  const response = await gateway.call('summarizer', {
    messages: [{ role: 'user', content: formattedMessages }],
  })

  const summaryText = response.content ?? ''

  await prisma.conversationSummary.upsert({
    where: { conversationId },
    update: {
      summary: summaryText,
      messagesUpTo,
    },
    create: {
      conversationId,
      summary: summaryText,
      messagesUpTo,
    },
  })

  return summaryText
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/sliding-window.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add lib/chat/sliding-window.ts __tests__/lib/chat/sliding-window.test.ts
git commit -m "feat: dynamic sliding window with token-based sizing"
```

---

## Task 9: Implement loadCustomerMemory and loadAgentKnowledge

**Files:**
- Modify: `lib/chat/context-loaders.ts`
- Create: `__tests__/lib/chat/context-loaders.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/chat/context-loaders.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: { findMany: vi.fn() },
    agentKnowledge: { findMany: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')

// Import after mocks
const { loadCustomerMemory, loadAgentKnowledge } = await import('@/lib/chat/context-loaders')

describe('loadCustomerMemory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when no insights exist', async () => {
    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([])
    const result = await loadCustomerMemory('cust-1')
    expect(result).toBeNull()
  })

  it('formats insights grouped by category', async () => {
    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([
      {
        id: '1', customerId: 'cust-1', category: 'PREFERENCE',
        key: 'price_sensitivity', value: 'High — mentioned budget concerns',
        confidence: 0.8, source: 'conv-1',
        lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', customerId: 'cust-1', category: 'BUYING_SIGNAL',
        key: 'urgency', value: 'Expecting a child soon',
        confidence: 0.9, source: 'conv-1',
        lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
    ] as never)

    const result = await loadCustomerMemory('cust-1')
    expect(result).toContain('PREFERENCE')
    expect(result).toContain('price_sensitivity')
    expect(result).toContain('BUYING_SIGNAL')
    expect(result).toContain('urgency')
  })

  it('marks stale insights as unverified', async () => {
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - 45) // 45 days ago

    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([
      {
        id: '1', customerId: 'cust-1', category: 'DEMOGRAPHIC',
        key: 'occupation', value: 'Software engineer',
        confidence: 0.7, source: 'conv-old',
        lastConfirmedAt: staleDate, createdAt: staleDate, updatedAt: staleDate,
      },
    ] as never)

    const result = await loadCustomerMemory('cust-1')
    expect(result).toContain('unverified')
  })
})

describe('loadAgentKnowledge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when no knowledge exists', async () => {
    vi.mocked(prisma.agentKnowledge.findMany).mockResolvedValue([])
    const result = await loadAgentKnowledge(null, null)
    expect(result).toBeNull()
  })

  it('formats knowledge with success rates', async () => {
    vi.mocked(prisma.agentKnowledge.findMany).mockResolvedValue([
      {
        id: '1', category: 'OBJECTION_RESPONSE',
        trigger: 'price_objection', content: 'Focus on value per day calculation',
        successRate: 0.75, sampleSize: 20, productId: 'prod-1',
        workflowStepCode: null, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      },
    ] as never)

    const result = await loadAgentKnowledge('prod-1', null)
    expect(result).toContain('price_objection')
    expect(result).toContain('75%')
    expect(result).toContain('n=20')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/context-loaders.test.ts`
Expected: FAIL — `loadCustomerMemory` returns `null` always, `loadAgentKnowledge` has wrong signature

- [ ] **Step 3: Implement loadCustomerMemory**

Replace the placeholder in `lib/chat/context-loaders.ts`:

```typescript
// Replace the existing loadCustomerMemory function (around line 463-468)

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_MEMORY_TOKENS = 500

/**
 * Load customer memory section.
 * Queries CustomerInsight table and formats insights by category.
 * Marks insights older than 30 days as (unverified).
 */
export async function loadCustomerMemory(
  customerId: string,
): Promise<string | null> {
  const insights = await prisma.customerInsight.findMany({
    where: { customerId },
    orderBy: [
      { confidence: 'desc' },
      { lastConfirmedAt: 'desc' },
    ],
  })

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

  // Cap at MAX_MEMORY_TOKENS
  const tokens = estimateTokens(text, 'en')
  if (tokens > MAX_MEMORY_TOKENS) {
    // Truncate by taking fewer insights
    const truncated = parts.slice(0, Math.ceil(parts.length * (MAX_MEMORY_TOKENS / tokens)))
    return truncated.join('\n')
  }

  return text
}
```

Add the import for `estimateTokens` at the top of the file:

```typescript
import { estimateTokens } from '@/lib/chat/token-budget'
```

- [ ] **Step 4: Implement loadAgentKnowledge**

Replace the placeholder in `lib/chat/context-loaders.ts`:

```typescript
// Replace the existing loadAgentKnowledge function (around line 474-479)

const MAX_KNOWLEDGE_TOKENS = 400
const MIN_SAMPLE_SIZE = 5
const MAX_PATTERNS = 5

/**
 * Load agent knowledge section.
 * Queries AgentKnowledge for proven patterns with minimum evidence threshold.
 */
export async function loadAgentKnowledge(
  productId: string | null,
  workflowStepCode: string | null,
): Promise<string | null> {
  const knowledge = await prisma.agentKnowledge.findMany({
    where: {
      isActive: true,
      sampleSize: { gte: MIN_SAMPLE_SIZE },
      OR: [
        { productId: productId ?? undefined },
        { productId: null },
      ],
    },
    orderBy: { successRate: 'desc' },
    take: MAX_PATTERNS,
  })

  if (knowledge.length === 0) return null

  // Further filter by workflowStepCode if provided
  let filtered = knowledge
  if (workflowStepCode) {
    const stepSpecific = knowledge.filter(
      (k) => k.workflowStepCode === workflowStepCode || k.workflowStepCode === null,
    )
    if (stepSpecific.length > 0) filtered = stepSpecific
  }

  const lines = filtered.map((k) => {
    const rate = Math.round(k.successRate * 100)
    return `- [${k.trigger}] ${k.content} (success: ${rate}%, n=${k.sampleSize})`
  })

  return lines.join('\n')
}
```

- [ ] **Step 5: Update loadAllSections to pass workflowStepCode to loadAgentKnowledge**

In the `loadAllSections` function, change the `loadAgentKnowledge` call:

```typescript
// Change from:
loadAgentKnowledge(productId),
// Change to:
loadAgentKnowledge(productId, workflowStepCode),
```

The `workflowStepCode` parameter is already available in the `params` object.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/chat/context-loaders.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 7: Run all tests for regressions**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add lib/chat/context-loaders.ts __tests__/lib/chat/context-loaders.test.ts
git commit -m "feat: implement loadCustomerMemory and loadAgentKnowledge with real DB queries"
```

---

## Task 10: Reorder Prompt Builder for Stable Prefix

**Files:**
- Modify: `lib/chat/prompt-builder.ts`
- Modify: `__tests__/lib/chat/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/lib/chat/prompt-builder.test.ts`:

```typescript
describe('prompt caching — stable prefix', () => {
  it('returns stablePrefix and dynamicSuffix separately', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    expect(result.stablePrefix).toBeDefined()
    expect(result.dynamicSuffix).toBeDefined()
    expect(result.prompt).toBe(result.stablePrefix + result.dynamicSuffix)
  })

  it('places constitution + product + coaching in stable prefix', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    // Stable prefix should contain these
    expect(result.stablePrefix).toContain('You are Zeno')
    expect(result.stablePrefix).toContain('Never give medical advice')
    expect(result.stablePrefix).toContain('Protect Standard I')
    expect(result.stablePrefix).toContain('Focus on value')

    // Dynamic suffix should NOT contain them
    expect(result.dynamicSuffix).not.toContain('You are Zeno')
    expect(result.dynamicSuffix).not.toContain('Protect Standard I')
  })

  it('places situational + customer + workflow in dynamic suffix', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    // Dynamic suffix should contain these
    expect(result.dynamicSuffix).toContain('Customer is asking about pricing')
    expect(result.dynamicSuffix).toContain('Ion, age 35')
    expect(result.dynamicSuffix).toContain('Ask the next DNT question')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/chat/prompt-builder.test.ts`
Expected: FAIL — `stablePrefix` and `dynamicSuffix` not in return type

- [ ] **Step 3: Update prompt-builder.ts**

Update the `PromptBuildResult` interface:

```typescript
export interface PromptBuildResult {
  stablePrefix: string
  dynamicSuffix: string
  prompt: string          // stablePrefix + dynamicSuffix (backward compat)
  sectionSizes: Record<string, number>
  gateActive: boolean
  includedSections: string[]
  excludedSections: string[]
}
```

Update the `SECTION_REGISTRY` to reorder sections — stable sections get lower priorities:

```typescript
const SECTION_REGISTRY: SectionConfig[] = [
  // STABLE PREFIX — rarely changes within a conversation
  { key: 'agentIdentity',       priority: 1,  layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'constraints',         priority: 2,  layer: 'constitution', alwaysInclude: true,  prefix: 'CRITICAL CONSTRAINTS:' },
  { key: 'capabilityManifest',  priority: 3,  layer: 'constitution', alwaysInclude: false, prefix: 'WHAT I CAN DO:' },
  { key: 'productContext',      priority: 4,  layer: 'stable',      alwaysInclude: false, prefix: '=== PRODUCT CONTEXT ===' },
  { key: 'coachingBriefing',    priority: 5,  layer: 'stable',      alwaysInclude: false, prefix: '=== PRODUCT SALES PLAYBOOK ===' },

  // DYNAMIC SUFFIX — changes every turn
  { key: 'situationalBriefing', priority: 10, layer: 'dynamic',     alwaysInclude: true,  prefix: '=== SITUATIONAL ANALYSIS ===' },
  { key: 'customerMemory',      priority: 11, layer: 'dynamic',     alwaysInclude: false, prefix: '=== RETURNING CUSTOMER ===' },
  { key: 'agentKnowledge',      priority: 12, layer: 'dynamic',     alwaysInclude: false, prefix: '=== PROVEN PATTERNS ===' },
  { key: 'customerContext',     priority: 13, layer: 'dynamic',     alwaysInclude: false, prefix: '=== CUSTOMER PROFILE ===' },
  { key: 'workflowInstructions',priority: 14, layer: 'dynamic',     alwaysInclude: true,  prefix: '=== ACTIVE WORKFLOW ===' },
  { key: 'questionnaireContext',priority: 15, layer: 'dynamic',     alwaysInclude: false, prefix: '=== ACTIVE QUESTIONNAIRE ===' },
]
```

Update the `SectionConfig` type to include `'stable'` layer:

```typescript
interface SectionConfig {
  key: keyof PromptSections
  priority: number
  layer: 'constitution' | 'stable' | 'reasoning' | 'dynamic'
  alwaysInclude: boolean
  prefix: string
}
```

Update the `buildPrompt` function to track where the dynamic section starts and split the output:

```typescript
export function buildPrompt(
  sections: PromptSections,
  gateSelection: GateSelection,
): PromptBuildResult {
  const required = new Set(gateSelection.requiredSections)
  const excluded = new Set(gateSelection.excludedSections)

  const gateActive =
    (required.size > 0 || excluded.size > 0) && gateSelection.confidence >= 0.3

  const stableParts: string[] = []
  const dynamicParts: string[] = []
  const sectionSizes: Record<string, number> = {}
  const includedSections: string[] = []
  const excludedSectionsList: string[] = []
  let separatorInserted = false

  for (const config of SORTED_REGISTRY) {
    const content = sections[config.key]
    if (!content) continue

    if (gateActive && !config.alwaysInclude && excluded.has(config.key)) {
      excludedSectionsList.push(config.key)
      continue
    }

    const isDynamic = config.layer === 'dynamic' || config.layer === 'reasoning'

    // Insert separator at the boundary
    if (!separatorInserted && isDynamic) {
      dynamicParts.push(INTERNAL_GUIDANCE_SEPARATOR)
      separatorInserted = true
    }

    let rendered: string
    if (config.prefix) {
      rendered = `\n\n${config.prefix}\n${content}`
    } else {
      const targetParts = isDynamic ? dynamicParts : stableParts
      if (targetParts.length === 0 && stableParts.length === 0) {
        rendered = content
      } else {
        rendered = `\n\n${content}`
      }
    }

    if (isDynamic) {
      dynamicParts.push(rendered)
    } else {
      stableParts.push(rendered)
    }

    sectionSizes[config.key] = rendered.length
    includedSections.push(config.key)
  }

  const stablePrefix = stableParts.join('')
  const dynamicSuffix = dynamicParts.join('')
  const prompt = stablePrefix + dynamicSuffix

  return {
    stablePrefix,
    dynamicSuffix,
    prompt,
    sectionSizes,
    gateActive,
    includedSections,
    excludedSections: excludedSectionsList,
  }
}
```

- [ ] **Step 4: Update existing tests that check section ordering**

The existing test `renders sections in priority order` may need updating since the order changed. Read the test, verify expectations match new order (agentIdentity → constraints → capabilityManifest → productContext → coachingBriefing → separator → situationalBriefing → ...).

- [ ] **Step 5: Run all prompt-builder tests**

Run: `npx vitest run __tests__/lib/chat/prompt-builder.test.ts`
Expected: All tests PASS (including new stable prefix tests)

- [ ] **Step 6: Commit**

```bash
git add lib/chat/prompt-builder.ts __tests__/lib/chat/prompt-builder.test.ts
git commit -m "feat: reorder prompt sections for stable prefix caching"
```

---

## Task 11: Anthropic Cache Control

**Files:**
- Modify: `lib/llm/providers/anthropic.ts`

- [ ] **Step 1: Read the Anthropic provider file fully**

Read the full `lib/llm/providers/anthropic.ts` to understand the message conversion logic and where system prompt is sent.

- [ ] **Step 2: Add cache_control to system prompt**

Find where the system prompt is extracted and sent to the Anthropic API. The Anthropic SDK accepts `cache_control` on content blocks. Modify the system prompt handling to add `cache_control: { type: "ephemeral" }` to the system message block.

In the message conversion function that extracts system messages, update to:

```typescript
// When building the system parameter for the Anthropic API call:
// If system content exists, wrap it with cache_control
const systemBlocks = systemContent
  ? [{ type: 'text' as const, text: systemContent, cache_control: { type: 'ephemeral' as const } }]
  : undefined
```

This tells Anthropic to cache this block across requests within the same session.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new type errors

- [ ] **Step 4: Commit**

```bash
git add lib/llm/providers/anthropic.ts
git commit -m "feat: add cache_control to Anthropic system prompt for prompt caching"
```

---

## Task 12: Wire Everything into the Orchestrator

**Files:**
- Modify: `lib/chat/orchestrator.ts`

- [ ] **Step 1: Add imports**

Add to the top of `lib/chat/orchestrator.ts`:

```typescript
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'
import { compactMessages } from '@/lib/chat/compaction'
import { isContextLengthError, parseTokenDeficit } from '@/lib/llm/errors'
```

- [ ] **Step 2: Wire token budget into step 4-5**

After step 4 (context assembly) and before step 5 (sliding window), add budget calculation:

```typescript
  // =============================================
  // STEP 4b — Calculate token budget
  // =============================================
  const systemPromptTokens = estimateTokens(buildResult.prompt, state.language)
  const toolDefs = getToolsForLLM()
  const toolDefTokens = estimateTokens(JSON.stringify(toolDefs), 'en')
  const availableTokenBudget = calculateMessageBudget({
    modelContextWindow: agentConfig.contextWindow ?? 128_000,
    systemPromptTokens,
    toolDefinitionTokens: toolDefTokens,
    outputReservation: agentConfig.maxTokens,
  })
```

Note: This requires adding `contextWindow` to `AgentConfig`. Update `lib/llm/agent-config.ts` to include:

```typescript
// In AgentConfig interface:
contextWindow: number | null

// In the config mapping:
contextWindow: agent.contextWindow ?? null
```

Wait — `contextWindow` is on `ModelCatalog`, not `Agent`. We need to look it up. Simpler approach: pass a default based on provider.

```typescript
  // Use known defaults per provider (ModelCatalog lookup is a future optimization)
  const contextWindow = agentConfig.provider === 'ANTHROPIC' ? 200_000 : 128_000
  const availableTokenBudget = calculateMessageBudget({
    modelContextWindow: contextWindow,
    systemPromptTokens,
    toolDefinitionTokens: toolDefTokens,
    outputReservation: agentConfig.maxTokens,
  })

  state.phases['step4b_token_budget'] = {
    contextWindow,
    systemPromptTokens,
    toolDefTokens,
    availableTokenBudget,
  }
```

- [ ] **Step 3: Pass budget to sliding window**

Update the step 5 call:

```typescript
  const { messages: windowMessages, summaryPrefix } = await buildSlidingWindow(
    state.conversationId,
    state.messageCount,
    availableTokenBudget,
  )
```

- [ ] **Step 4: Add reactive compaction to step 7**

In the standard chat path (the `while (round <= MAX_TOOL_ROUNDS)` loop), wrap the `gateway.stream` call:

```typescript
      let stream: AsyncIterable<StreamChunk>
      try {
        stream = await gateway.stream('main-chat', {
          messages,
          tools: toolChoice === 'none' ? undefined : tools,
          toolChoice: toolChoice === 'none' ? undefined : toolChoice,
          overrideSystemPrompt: systemPrompt,
        })
      } catch (err) {
        if (round === 0 && isContextLengthError(err)) {
          // Reactive compaction: compress and retry once
          const deficit = parseTokenDeficit(err) ?? 2000
          const compactedMessages = await compactMessages(messages, deficit, state.conversationId)
          messages.length = 0
          messages.push(...compactedMessages)
          state.phases['reactiveCompaction'] = { deficit, originalLength: messages.length }

          stream = await gateway.stream('main-chat', {
            messages,
            tools: toolChoice === 'none' ? undefined : tools,
            toolChoice: toolChoice === 'none' ? undefined : toolChoice,
            overrideSystemPrompt: systemPrompt,
          })
        } else {
          throw err
        }
      }
```

- [ ] **Step 5: Expand profile extraction in step 9**

Update the profile extraction block in step 9 to also write `CustomerInsight` records. After the existing `prisma.customer.update` call, add:

```typescript
          // Write insights to CustomerInsight table
          for (const [key, value] of Object.entries(extracted)) {
            if (value == null) continue
            const category = categorizeInsight(key)
            await prisma.customerInsight.upsert({
              where: {
                customerId_key: {
                  customerId: state.customerId,
                  key,
                },
              },
              update: {
                value: String(value),
                lastConfirmedAt: new Date(),
              },
              create: {
                customerId: state.customerId,
                category,
                key,
                value: String(value),
                confidence: 0.6,
                source: state.conversationId,
              },
            })
          }
```

Add the helper function (inside orchestrator.ts or as an import):

```typescript
function categorizeInsight(key: string): 'DEMOGRAPHIC' | 'PREFERENCE' | 'OBJECTION_PATTERN' | 'BUYING_SIGNAL' | 'RISK_FACTOR' {
  const demographics = ['age', 'occupation', 'income', 'education', 'familySize', 'hasSpouse', 'hasChildren', 'minorChildren']
  const buyingSignals = ['urgency', 'motivation', 'readiness', 'interests']
  const riskFactors = ['health', 'smoking', 'hazardous']

  if (demographics.includes(key)) return 'DEMOGRAPHIC'
  if (buyingSignals.includes(key)) return 'BUYING_SIGNAL'
  if (riskFactors.includes(key)) return 'RISK_FACTOR'
  return 'PREFERENCE'
}
```

- [ ] **Step 6: Move the prompt build before the sliding window**

Currently the orchestrator builds the prompt in step 6 (after the sliding window). For the token budget to work, we need the prompt size first. Reorder:

- Step 4: Context assembly + prompt build (already done, `buildResult` exists)
- Step 4b: Token budget calculation (new)
- Step 5: Sliding window with budget
- Step 6: Build final messages array (uses existing `buildResult.prompt`)

This is already the current flow — `buildPrompt` is called in step 6 but `loadAllSections` is in step 4. Move `buildPrompt` call from step 6 to step 4 (right after `loadAllSections`).

- [ ] **Step 7: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat: wire token budget, reactive compaction, and customer insights into orchestrator"
```

---

## Task 13: Add LRU Cache to Tool Registry

**Files:**
- Modify: `lib/tools/registry.ts`

- [ ] **Step 1: Add cache for getToolsForLLM**

Import the LRU cache and add caching to `getToolsForLLM`:

```typescript
import { LRUCache } from '@/lib/cache/lru-cache'

const toolsCache = new LRUCache<string, LLMToolDefinition[]>(5, 5 * 60 * 1000) // 5 min TTL

export function getToolsForLLM(allowedTools?: string[]): LLMToolDefinition[] {
  const cacheKey = allowedTools ? allowedTools.sort().join(',') : '__all__'
  const cached = toolsCache.get(cacheKey)
  if (cached) return cached

  const result: LLMToolDefinition[] = []
  for (const [name, def] of definitions) {
    if (allowedTools && !allowedTools.includes(name)) continue
    result.push({
      type: 'function',
      function: {
        name,
        description: def.description,
        parameters: def.parameters,
      },
    })
  }

  toolsCache.set(cacheKey, result)
  return result
}
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add lib/tools/registry.ts
git commit -m "feat: add LRU cache to tool registry for getToolsForLLM"
```

---

## Task 14: Add LRU Cache to Context Loaders

**Files:**
- Modify: `lib/chat/context-loaders.ts`

- [ ] **Step 1: Add cache for loadProductContext and loadCoachingBriefing**

```typescript
import { LRUCache } from '@/lib/cache/lru-cache'

const productContextCache = new LRUCache<string, string | null>(5, 10 * 60 * 1000) // 10 min
const coachingBriefingCache = new LRUCache<string, string | null>(5, 10 * 60 * 1000)
```

In `loadProductContext`, add at the start:

```typescript
  const cacheKey = `${productId}:${language}`
  const cached = productContextCache.get(cacheKey)
  if (cached !== undefined) return cached
  // ... existing logic ...
  productContextCache.set(cacheKey, result)
  return result
```

Where `result` is the final `parts.join('\n')` return value (assign to a variable first).

Same pattern for `loadCoachingBriefing`:

```typescript
  const cached = coachingBriefingCache.get(productId)
  if (cached !== undefined) return cached
  // ... existing logic ...
  const result = product?.defaultPlaybook ?? null
  coachingBriefingCache.set(productId, result)
  return result
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add lib/chat/context-loaders.ts
git commit -m "feat: add LRU cache to product context and coaching briefing loaders"
```

---

## Task 15: Integration Smoke Test

**Files:**
- None (manual verification)

- [ ] **Step 1: Ensure database is running**

Run: `docker compose up -d` (port 5435)

- [ ] **Step 2: Push schema and re-seed**

Run: `npx prisma db push && npx prisma db seed`
Expected: Schema synced, all seeds including new AgentKnowledge run successfully

- [ ] **Step 3: Start dev server**

Run: `npm run dev`
Expected: Server starts on http://localhost:3000 without errors

- [ ] **Step 4: Send a test chat message via curl**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, I want to learn about life insurance"}' \
  --no-buffer
```

Expected: SSE stream with content events, no errors. Check server logs for:
- `step4b_token_budget` phase in TurnTrace
- No context length errors
- Dynamic window sizing working

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (old + new)

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete context and memory upgrade — token budget, compaction, customer memory, agent knowledge, LRU cache, prompt caching"
```

---

## Dependency Order

```
Task 1 (LRU Cache) ─────────────────────────────────┐
Task 2 (Token Budget) ──────────────┐                │
Task 3 (Error Classification) ──┐   │                │
Task 4 (Compaction) ────────────┤   │                │
Task 5 (Prisma Schema) ────────┤   │                │
Task 6 (Model Seeds) ──────────┤   │                │
Task 7 (Knowledge Seeds) ──────┤   │                │
Task 8 (Sliding Window) ───────┼───┘                │
Task 9 (Context Loaders) ──────┤                    │
Task 10 (Prompt Builder) ──────┤                    │
Task 11 (Anthropic Cache) ─────┤                    │
Task 12 (Orchestrator Wiring)──┤────────────────────┘
Task 13 (Tool Registry Cache)──┘
Task 14 (Context Loader Cache)─┘
Task 15 (Integration Smoke) ───── depends on all above
```

Tasks 1-7 can be parallelized (independent). Tasks 8-14 depend on earlier tasks. Task 15 depends on everything.
