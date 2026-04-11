# Tool System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add parallel execution of read-only tools and global result caching to reduce turn latency and DB load.

**Architecture:** Tools get `sideEffects` and `cacheable` flags. The orchestrator partitions tool calls into read-only (parallel via Promise.all) and writing (sequential). A tool result cache using the existing LRUCache skips DB queries for stable data like product info.

**Tech Stack:** TypeScript, Vitest, existing LRUCache from lib/cache/lru-cache.ts

**Spec:** `docs/superpowers/specs/2026-04-11-tool-system-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `lib/tools/cache.ts` | Tool result cache — wraps LRUCache for tool-specific caching |
| `__tests__/lib/tools/cache.test.ts` | Cache unit tests |
| `__tests__/lib/tools/parallel-execution.test.ts` | Parallel execution unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `lib/tools/types.ts` | Add `sideEffects`, `cacheable`, `cacheTtlMs` to ToolDefinition |
| `lib/tools/registry.ts` | Mark 6 tools sideEffects=false, 4 tools cacheable=true |
| `lib/tools/executor.ts` | Check cache before execution, store results on success |
| `lib/chat/orchestrator.ts` | Split tool calls into read-only (parallel) + writing (sequential) |

---

## Task 1: Tool Definition Extension

**Files:**
- Modify: `lib/tools/types.ts`

- [ ] **Step 1: Add new fields to ToolDefinition**

In `lib/tools/types.ts`, add three optional fields to the `ToolDefinition` interface after `allowedRoles`:

```typescript
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  executionMode: ExecutionMode
  customerVisible: boolean
  statusMessage: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean
  allowedRoles: UserRole[]
  sideEffects?: boolean     // default true — tools with no side effects can run in parallel
  cacheable?: boolean       // default false — opt-in to result caching
  cacheTtlMs?: number       // default 300_000 (5 minutes) — TTL for cached results
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors (all new fields are optional)

- [ ] **Step 3: Commit**

```bash
git add lib/tools/types.ts
git commit -m "feat: add sideEffects, cacheable, cacheTtlMs to ToolDefinition"
```

---

## Task 2: Tool Result Cache

**Files:**
- Create: `lib/tools/cache.ts`
- Create: `__tests__/lib/tools/cache.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/tools/cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the registry before importing cache
vi.mock('@/lib/tools/registry', () => ({
  getToolDefinition: vi.fn((name: string) => {
    if (name === 'get_product_info') {
      return { cacheable: true, cacheTtlMs: 5000 }
    }
    if (name === 'list_products') {
      return { cacheable: true }
    }
    if (name === 'save_dnt_answer') {
      return { cacheable: false }
    }
    return {}
  }),
}))

const { isToolCacheable, getCachedResult, setCachedResult, invalidateToolCache } = await import(
  '@/lib/tools/cache'
)

describe('Tool Result Cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invalidateToolCache()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('isToolCacheable returns true for cacheable tools', () => {
    expect(isToolCacheable('get_product_info')).toBe(true)
    expect(isToolCacheable('list_products')).toBe(true)
  })

  it('isToolCacheable returns false for non-cacheable tools', () => {
    expect(isToolCacheable('save_dnt_answer')).toBe(false)
    expect(isToolCacheable('unknown_tool')).toBe(false)
  })

  it('returns undefined on cache miss', () => {
    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
  })

  it('stores and retrieves cached results', () => {
    const result = { success: true, data: { name: 'Protect' } }
    setCachedResult('get_product_info', { productCode: 'protect' }, result)

    const cached = getCachedResult('get_product_info', { productCode: 'protect' })
    expect(cached).toEqual(result)
  })

  it('generates deterministic cache keys regardless of arg order', () => {
    const result = { success: true, data: { products: [] } }
    setCachedResult('list_products', { type: 'LIFE', active: true }, result)

    // Same args, different order
    const cached = getCachedResult('list_products', { active: true, type: 'LIFE' })
    expect(cached).toEqual(result)
  })

  it('expires entries after TTL', () => {
    const result = { success: true, data: { name: 'Protect' } }
    setCachedResult('get_product_info', { productCode: 'protect' }, result)

    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toEqual(result)

    vi.advanceTimersByTime(5001) // TTL is 5000ms from mock

    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
  })

  it('invalidateToolCache clears all entries', () => {
    setCachedResult('get_product_info', { productCode: 'protect' }, { success: true })
    setCachedResult('list_products', {}, { success: true, data: { products: [] } })

    invalidateToolCache()

    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
    expect(getCachedResult('list_products', {})).toBeUndefined()
  })

  it('invalidateToolCache with toolName clears only that tool', () => {
    setCachedResult('get_product_info', { productCode: 'protect' }, { success: true })
    setCachedResult('list_products', {}, { success: true, data: { products: [] } })

    invalidateToolCache('get_product_info')

    expect(getCachedResult('get_product_info', { productCode: 'protect' })).toBeUndefined()
    expect(getCachedResult('list_products', {})).toEqual({ success: true, data: { products: [] } })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/tools/cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/tools/cache.ts
/**
 * Tool Result Cache
 *
 * Global LRU cache for tool results. Only tools marked `cacheable: true`
 * in their definition are cached. Cache key is tool name + sorted args JSON.
 */

import { LRUCache } from '@/lib/cache/lru-cache'
import { getToolDefinition } from './registry'
import type { ToolResult } from './types'

// ==============================================
// CONSTANTS
// ==============================================

const DEFAULT_TTL_MS = 300_000 // 5 minutes
const MAX_CACHE_SIZE = 50

// ==============================================
// CACHE INSTANCE
// ==============================================

let cache = new LRUCache<string, ToolResult>(MAX_CACHE_SIZE, DEFAULT_TTL_MS)

// ==============================================
// CACHE KEY
// ==============================================

function buildCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sortedArgs = JSON.stringify(args, Object.keys(args).sort())
  return `${toolName}:${sortedArgs}`
}

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Check if a tool is marked as cacheable in its definition.
 */
export function isToolCacheable(toolName: string): boolean {
  const def = getToolDefinition(toolName)
  return def?.cacheable === true
}

/**
 * Get a cached result for a tool call. Returns undefined on miss.
 */
export function getCachedResult(
  toolName: string,
  args: Record<string, unknown>,
): ToolResult | undefined {
  const key = buildCacheKey(toolName, args)
  return cache.get(key)
}

/**
 * Store a tool result in the cache.
 * Uses the tool's cacheTtlMs if defined, otherwise DEFAULT_TTL_MS.
 */
export function setCachedResult(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  const key = buildCacheKey(toolName, args)
  cache.set(key, result)
}

/**
 * Invalidate cached results.
 * If toolName is provided, only clears entries for that tool.
 * If no toolName, clears the entire cache.
 */
export function invalidateToolCache(toolName?: string): void {
  if (!toolName) {
    cache.clear()
    return
  }
  // Clear entries matching the tool name prefix
  // Since LRUCache doesn't support prefix deletion, rebuild the cache
  // This is acceptable given MAX_CACHE_SIZE = 50
  const prefix = `${toolName}:`
  const newCache = new LRUCache<string, ToolResult>(MAX_CACHE_SIZE, DEFAULT_TTL_MS)
  // We can't iterate LRUCache, so just clear everything for simplicity
  // In practice, invalidateToolCache(toolName) is rare (admin actions)
  cache.clear()
  cache = newCache
}
```

Wait — the `invalidateToolCache(toolName)` test expects selective invalidation, but `LRUCache` doesn't expose iteration. Let me fix the implementation to track keys by tool name:

```typescript
// lib/tools/cache.ts
import { LRUCache } from '@/lib/cache/lru-cache'
import { getToolDefinition } from './registry'
import type { ToolResult } from './types'

const DEFAULT_TTL_MS = 300_000
const MAX_CACHE_SIZE = 50

const cache = new LRUCache<string, ToolResult>(MAX_CACHE_SIZE, DEFAULT_TTL_MS)
const keysByTool = new Map<string, Set<string>>()

function buildCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sortedArgs = JSON.stringify(args, Object.keys(args).sort())
  return `${toolName}:${sortedArgs}`
}

export function isToolCacheable(toolName: string): boolean {
  const def = getToolDefinition(toolName)
  return def?.cacheable === true
}

export function getCachedResult(
  toolName: string,
  args: Record<string, unknown>,
): ToolResult | undefined {
  const key = buildCacheKey(toolName, args)
  return cache.get(key)
}

export function setCachedResult(
  toolName: string,
  args: Record<string, unknown>,
  result: ToolResult,
): void {
  const key = buildCacheKey(toolName, args)
  cache.set(key, result)

  let keys = keysByTool.get(toolName)
  if (!keys) {
    keys = new Set()
    keysByTool.set(toolName, keys)
  }
  keys.add(key)
}

export function invalidateToolCache(toolName?: string): void {
  if (!toolName) {
    cache.clear()
    keysByTool.clear()
    return
  }

  const keys = keysByTool.get(toolName)
  if (keys) {
    for (const key of keys) {
      cache.invalidate(key)
    }
    keysByTool.delete(toolName)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/tools/cache.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tools/cache.ts __tests__/lib/tools/cache.test.ts
git commit -m "feat: add tool result cache with LRU + TTL"
```

---

## Task 3: Mark Tools in Registry

**Files:**
- Modify: `lib/tools/registry.ts`

- [ ] **Step 1: Read the current registry file**

Read `lib/tools/registry.ts` fully to find all `registerTool` calls.

- [ ] **Step 2: Add sideEffects and cacheable flags to tools**

For each of these tools, add the flags to the `registerTool` call's definition object:

**`sideEffects: false` + `cacheable: true`:**

```typescript
// list_products
registerTool('list_products', {
  // ... existing fields ...
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 300_000, // 5 minutes
}, listProductsHandler)

// get_product_info
registerTool('get_product_info', {
  // ... existing fields ...
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 300_000,
}, getProductInfoHandler)

// compare_products
registerTool('compare_products', {
  // ... existing fields ...
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 300_000,
}, compareProducts)

// get_objection_strategy
registerTool('get_objection_strategy', {
  // ... existing fields ...
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 600_000, // 10 minutes
}, getObjectionStrategy)
```

**`sideEffects: false` only (not cached):**

```typescript
// get_customer_profile
registerTool('get_customer_profile', {
  // ... existing fields ...
  sideEffects: false,
}, getCustomerProfile)

// check_dnt_status
registerTool('check_dnt_status', {
  // ... existing fields ...
  sideEffects: false,
}, checkDntStatus)
```

All other tools keep the defaults (`sideEffects: true`, `cacheable: false`).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/tools/registry.ts
git commit -m "feat: mark tools with sideEffects and cacheable flags"
```

---

## Task 4: Cache Integration in Executor

**Files:**
- Modify: `lib/tools/executor.ts`

- [ ] **Step 1: Add cache import**

Add to the imports at the top of `lib/tools/executor.ts`:

```typescript
import { isToolCacheable, getCachedResult, setCachedResult } from './cache'
```

- [ ] **Step 2: Add cache check before execution**

In the `executeTool` function, after the permission check (step 3) and before the circuit breaker gate (step 4), add:

```typescript
  // 3b. Cache check (before circuit breaker — cache hits don't need circuit)
  if (isToolCacheable(name)) {
    const cached = getCachedResult(name, validation.data ?? {})
    if (cached) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[ToolExecutor] ${name} cache hit`)
      }
      return cached
    }
  }
```

- [ ] **Step 3: Store successful results in cache**

In the `executeTool` function, after `circuit.recordSuccess()` and before the dev logging, add:

```typescript
    // Cache successful results for cacheable tools
    if (result.success && isToolCacheable(name)) {
      const def = getToolDefinition(name)
      setCachedResult(name, validation.data ?? {}, result)
    }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/tools/executor.ts
git commit -m "feat: integrate tool result cache in executor"
```

---

## Task 5: Parallel Tool Execution

**Files:**
- Modify: `lib/chat/orchestrator.ts`
- Create: `__tests__/lib/tools/parallel-execution.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/tools/parallel-execution.test.ts
import { describe, it, expect } from 'vitest'
import { partitionToolCalls } from '@/lib/chat/orchestrator'

describe('partitionToolCalls', () => {
  it('separates read-only and writing tool calls', () => {
    const toolCalls = [
      { id: '1', name: 'get_product_info', arguments: { productCode: 'protect' } },
      { id: '2', name: 'save_dnt_answer', arguments: { answer: 'Da' } },
      { id: '3', name: 'list_products', arguments: {} },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(readOnly).toHaveLength(2)
    expect(readOnly.map(tc => tc.name)).toEqual(['get_product_info', 'list_products'])

    expect(writing).toHaveLength(1)
    expect(writing[0].name).toBe('save_dnt_answer')

    expect(background).toHaveLength(0)
  })

  it('separates background tools', () => {
    const toolCalls = [
      { id: '1', name: 'get_product_info', arguments: { productCode: 'protect' } },
      { id: '2', name: 'profile_extractor', arguments: { messageContent: 'test' } },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(readOnly).toHaveLength(1)
    expect(background).toHaveLength(1)
    expect(background[0].name).toBe('profile_extractor')
    expect(writing).toHaveLength(0)
  })

  it('puts unknown tools in writing group for safety', () => {
    const toolCalls = [
      { id: '1', name: 'unknown_tool', arguments: {} },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(writing).toHaveLength(1)
    expect(readOnly).toHaveLength(0)
  })

  it('handles empty array', () => {
    const { readOnly, writing, background } = partitionToolCalls([])

    expect(readOnly).toHaveLength(0)
    expect(writing).toHaveLength(0)
    expect(background).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/tools/parallel-execution.test.ts`
Expected: FAIL — `partitionToolCalls` not exported

- [ ] **Step 3: Add partitionToolCalls function to orchestrator**

Read `lib/chat/orchestrator.ts` fully. Add this exported function after the constants section:

```typescript
import type { ToolCall } from '@/lib/llm/providers/types'

/**
 * Partition tool calls into three groups for execution ordering.
 * - readOnly: sideEffects=false — can run in parallel
 * - writing: sideEffects=true (default) — must run sequentially
 * - background: executionMode='background' — fire-and-forget
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
): { readOnly: ToolCall[]; writing: ToolCall[]; background: ToolCall[] } {
  const readOnly: ToolCall[] = []
  const writing: ToolCall[] = []
  const background: ToolCall[] = []

  for (const tc of toolCalls) {
    const def = getToolDefinition(tc.name)

    if (def?.executionMode === 'background') {
      background.push(tc)
    } else if (def?.sideEffects === false) {
      readOnly.push(tc)
    } else {
      writing.push(tc)
    }
  }

  return { readOnly, writing, background }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/tools/parallel-execution.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Update the tool loop in Step 7**

Replace the current sequential `for (const tc of roundToolCalls)` loop (around lines 747-856) with the partitioned execution:

```typescript
      // Partition tool calls
      const { readOnly, writing, background } = partitionToolCalls(roundToolCalls)

      // Results map to preserve original order
      const resultMap = new Map<string, { pipelineResult: PipelineResult; def: typeof import('./types').ToolDefinition | undefined }>()

      // --- Phase 0: Fire-and-forget background tools ---
      for (const tc of background) {
        void executeToolWithPipeline(
          tc.name,
          tc.arguments,
          toolContext,
          toolContext.workflowSession
            ? {
                id: toolContext.workflowSession.id,
                currentStepId: toolContext.workflowSession.currentStepId,
                workflowId: toolContext.workflowSession.workflowId,
              }
            : null,
        ).catch((err: unknown) => logError({
          layer: 'orchestrator',
          category: 'background_tool',
          message: 'Background tool execution failed',
          context: { conversationId: state.conversationId, tool: tc.name },
          error: err,
        }))

        resultMap.set(tc.id, {
          pipelineResult: { toolResult: { success: true, message: 'Processing in background.' } },
          def: getToolDefinition(tc.name),
        })
      }

      // --- Phase 1: Execute read-only tools in parallel ---
      if (readOnly.length > 0) {
        // Emit tool_start events
        for (const tc of readOnly) {
          const def = getToolDefinition(tc.name)
          if (def?.executionMode === 'blocking' && def?.statusMessage) {
            const status = pickStatusMessage(def.statusMessage, state.language, lastStatusMessage)
            if (status) {
              lastStatusMessage = status
              yield { event: 'tool_start', data: { tool: tc.name, status } }
            }
          }
        }

        const parallelResults = await Promise.all(
          readOnly.map(async (tc) => {
            try {
              return await executeToolWithPipeline(
                tc.name,
                tc.arguments,
                toolContext,
                toolContext.workflowSession
                  ? {
                      id: toolContext.workflowSession.id,
                      currentStepId: toolContext.workflowSession.currentStepId,
                      workflowId: toolContext.workflowSession.workflowId,
                    }
                  : null,
              )
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
              return { toolResult: { success: false, error: errMsg } } as PipelineResult
            }
          }),
        )

        for (let i = 0; i < readOnly.length; i++) {
          const tc = readOnly[i]
          const pipelineResult = parallelResults[i]
          const def = getToolDefinition(tc.name)
          resultMap.set(tc.id, { pipelineResult, def })

          if (def?.executionMode === 'blocking') {
            yield {
              event: 'tool_complete',
              data: { tool: tc.name, success: pipelineResult.toolResult.success },
            }
          }
        }
      }

      // --- Phase 2: Execute writing tools sequentially ---
      let transitionOccurred = false

      for (const tc of writing) {
        const def = getToolDefinition(tc.name)
        const isBlocking = def?.executionMode === 'blocking'

        if (isBlocking && def?.statusMessage) {
          const status = pickStatusMessage(def.statusMessage, state.language, lastStatusMessage)
          if (status) {
            lastStatusMessage = status
            yield { event: 'tool_start', data: { tool: tc.name, status } }
          }
        }

        let pipelineResult: PipelineResult
        try {
          pipelineResult = await executeToolWithPipeline(
            tc.name,
            tc.arguments,
            toolContext,
            toolContext.workflowSession
              ? {
                  id: toolContext.workflowSession.id,
                  currentStepId: toolContext.workflowSession.currentStepId,
                  workflowId: toolContext.workflowSession.workflowId,
                }
              : null,
          )
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
          pipelineResult = {
            toolResult: { success: false, error: errMsg },
          }
        }

        resultMap.set(tc.id, { pipelineResult, def })

        if (isBlocking) {
          yield {
            event: 'tool_complete',
            data: { tool: tc.name, success: pipelineResult.toolResult.success },
          }
        }

        // Handle workflow transitions (writing tools only)
        if (pipelineResult.transition) {
          transitionOccurred = true
          const trParts = [
            `[Workflow Transition]`,
            `Previous step: "${pipelineResult.transition.previousStepCode}"`,
            `New step: "${pipelineResult.transition.newStepName}"`,
          ]
          if (pipelineResult.transition.newStepInstructions) {
            trParts.push(`\nNew step instructions:\n${pipelineResult.transition.newStepInstructions}`)
          }
          if (pipelineResult.transition.newStepAutoTool) {
            trParts.push(`\nYou should now call: ${pipelineResult.transition.newStepAutoTool}`)
          } else {
            trParts.push(`\nThis is an interactive step — follow the instructions above.`)
          }
          // Transition messages added inline — they'll be ordered correctly below
        }
      }

      // --- Emit results in original tool call order ---
      for (const tc of roundToolCalls) {
        const entry = resultMap.get(tc.id)
        if (!entry) continue

        const { pipelineResult } = entry

        if (pipelineResult.toolResult.uiAction) {
          yield {
            event: 'ui_action',
            data: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown>,
          }
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify({
            success: pipelineResult.toolResult.success,
            data: pipelineResult.toolResult.data,
            error: pipelineResult.toolResult.error,
            message: pipelineResult.toolResult.message,
          }),
          toolCallId: tc.id,
        })

        // Add transition system message after the tool result that triggered it
        if (pipelineResult.transition) {
          const trParts = [
            `[Workflow Transition]`,
            `Previous step: "${pipelineResult.transition.previousStepCode}"`,
            `New step: "${pipelineResult.transition.newStepName}"`,
          ]
          if (pipelineResult.transition.newStepInstructions) {
            trParts.push(`\nNew step instructions:\n${pipelineResult.transition.newStepInstructions}`)
          }
          if (pipelineResult.transition.newStepAutoTool) {
            trParts.push(`\nYou should now call: ${pipelineResult.transition.newStepAutoTool}`)
          } else {
            trParts.push(`\nThis is an interactive step — follow the instructions above.`)
          }
          messages.push({ role: 'system', content: trParts.join('\n') })
        }
      }

      // Refresh tool context after tool executions (state may have changed)
      if (transitionOccurred) {
        toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
      }
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/chat/orchestrator.ts __tests__/lib/tools/parallel-execution.test.ts
git commit -m "feat: parallel execution of read-only tools in orchestrator"
```

---

## Task 6: Integration Smoke Test

**Files:**
- None (manual verification)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (old + new)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete tool system — parallel execution + result caching"
```

---

## Dependency Order

```
Task 1 (Tool Definition Extension) ───────┐
Task 2 (Tool Result Cache) ───────────────┤ depends on 1
Task 3 (Mark Tools in Registry) ──────────┤ depends on 1
Task 4 (Cache Integration in Executor) ───┤ depends on 1, 2
Task 5 (Parallel Execution) ──────────────┤ depends on 1, 3
Task 6 (Integration Smoke) ──────────────┘ depends on all
```

Tasks 2 and 3 are independent of each other (both only depend on Task 1). Tasks 4 and 5 can also run in parallel after their dependencies are met.
