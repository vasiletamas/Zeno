# Sub-Project #3: Tool System

**Date:** 2026-04-11
**Status:** Approved
**Author:** Vasile Tamas + Claude Code
**Depends on:** Sub-project #1 (Context & Memory) — uses LRUCache, Sub-project #2 (Error Recovery) — uses circuit breakers, structured logger
**Depended on by:** Sub-project #7 (Self-Improvement Engine)

## Overview

Improve the tool execution system with parallel execution of read-only tools and global result caching. Currently all tool calls execute sequentially in a for loop, and every tool call hits the DB even for stable data like product info. These changes reduce turn latency and DB load.

## Motivation

The orchestrator's Step 7 tool loop processes tool calls one-by-one. When the LLM returns multiple tool calls in a single round (e.g., `get_product_info` + `get_customer_profile` + `get_objection_strategy`), each waits for the previous to finish. Read-only tools have no reason to wait — they can run concurrently.

Additionally, tools like `get_product_info` and `list_products` return the same data across conversations and turns. Re-querying the DB every time is wasteful when the data hasn't changed.

## Scope

**In scope:**
- Parallel execution of read-only tools within a round
- Global tool result caching with TTL (using existing LRUCache)
- Explicit opt-in flags on tool definitions

**Deferred to later:**
- Speculative execution (predicting LLM's next tool call)
- Tool dependency graph analysis
- Cache warming on conversation start

## Component 1: Tool Definition Extension

### Problem

No way to distinguish read-only tools from state-modifying tools, or to mark which tools produce cacheable results.

### Changes to `lib/tools/types.ts`

Add three optional fields to `ToolDefinition`:

```typescript
sideEffects?: boolean     // default true — tools with no side effects can run in parallel
cacheable?: boolean       // default false — opt-in to result caching
cacheTtlMs?: number       // default 300_000 (5 minutes) — TTL for cached results
```

### Tool Classification

**`sideEffects: false` (safe to parallelize):**
- `list_products`
- `get_product_info`
- `compare_products`
- `get_customer_profile`
- `get_objection_strategy`
- `check_dnt_status`

**`cacheable: true` (results cached globally):**
- `list_products` — 5 min TTL
- `get_product_info` — 5 min TTL
- `compare_products` — 5 min TTL
- `get_objection_strategy` — 10 min TTL

**Not cached (even though read-only):**
- `get_customer_profile` — changes during conversation (profile extractor updates it)
- `check_dnt_status` — changes during conversation (DNT questionnaire progresses)

**`sideEffects: true` (default, sequential execution):**
- All other tools (`save_dnt_answer`, `start_application`, `generate_quote`, `sign_dnt`, `accept_quote`, `initiate_payment`, etc.)

## Component 2: Tool Result Cache

### Problem

Read-only tools like `get_product_info` re-query the DB on every call. Product data, objection strategies, and product comparisons rarely change — they're the same for every user.

### New File: `lib/tools/cache.ts`

A thin wrapper around the existing `LRUCache` for tool-specific caching.

**Exports:**
- `getCachedResult(toolName: string, args: Record<string, unknown>): ToolResult | undefined`
- `setCachedResult(toolName: string, args: Record<string, unknown>, result: ToolResult, ttlMs: number): void`
- `isToolCacheable(toolName: string): boolean`
- `invalidateToolCache(toolName?: string): void`

**Cache key:** `toolName:JSON.stringify(args, Object.keys(args).sort())` — deterministic regardless of property order.

**Cache config:**
- Single `LRUCache` instance, module-level singleton
- Max size: 50 entries
- Default TTL: 5 minutes (overridden per-tool via `cacheTtlMs`)

**Rules:**
- Only successful results are cached (`result.success === true`)
- Failed results are never cached
- Cache is checked before execution — on hit, no handler call, no circuit breaker check, no timeout
- On miss, result is stored after successful execution

### Integration with `lib/tools/executor.ts`

In `executeTool`, before the handler call:

1. Check `isToolCacheable(name)`
2. If cacheable, check `getCachedResult(name, args)`
3. On cache hit → return cached result immediately (log with structured logger)
4. On cache miss → execute normally, then `setCachedResult(name, args, result, ttlMs)` if successful

## Component 3: Parallel Tool Execution

### Problem

When the LLM returns multiple tool calls in one round, they execute sequentially. Read-only tools (product lookups, profile reads) have no dependencies and can run concurrently.

### Changes to `lib/chat/orchestrator.ts` (Step 7)

**Partition tool calls into two phases:**

1. Receive `roundToolCalls: ToolCall[]` from LLM
2. For each tool call, look up its definition and check `sideEffects`
3. Split into:
   - `readOnlyTools` — tools with `sideEffects === false`
   - `writingTools` — everything else (default `sideEffects: true`)

**Phase 1: Execute read-only tools in parallel**

```typescript
const readOnlyResults = await Promise.all(
  readOnlyTools.map(tc => executeAndEmitEvents(tc, toolContext))
)
```

Each parallel execution still emits `tool_start`/`tool_complete` SSE events individually. Status messages are picked to avoid repetition (existing `pickStatusMessage` logic).

**Phase 2: Execute writing tools sequentially**

Same as current `for` loop — one at a time, with workflow transition evaluation after each.

**Message ordering:** All tool result messages are pushed to the messages array in the original `roundToolCalls` order (not execution order). This keeps the LLM's conversation history deterministic regardless of which read-only tool finished first.

**Background tools:** Continue as fire-and-forget, unchanged. They're partitioned out before Phase 1/2 (same as current logic).

**Workflow transitions:** Only evaluated for Phase 2 tools. Read-only tools should never trigger transitions (they don't modify state), but if one somehow does, it's handled normally.

### Expected Latency Improvement

Typical multi-tool round: LLM calls `get_product_info` + `get_customer_profile` + `get_objection_strategy` together. Currently: ~300ms (3 x ~100ms sequential). After: ~100ms (parallel). When cached: ~0ms.

## Files Summary

### New Files (1)

| File | Purpose |
|------|---------|
| `lib/tools/cache.ts` | Tool result cache — wraps LRUCache for tool-specific caching |

### Modified Files (4)

| File | Changes |
|------|---------|
| `lib/tools/types.ts` | Add `sideEffects`, `cacheable`, `cacheTtlMs` to ToolDefinition |
| `lib/tools/registry.ts` | Mark 4 tools cacheable, 6 tools sideEffects=false |
| `lib/tools/executor.ts` | Check cache before execution, store results on success |
| `lib/chat/orchestrator.ts` | Split tool calls into read-only (parallel) + writing (sequential) |

## Testing Strategy

- **Unit tests** for cache: hit/miss, TTL expiry, key generation with sorted args, invalidation, only-success caching
- **Unit tests** for parallel execution: mock multiple tool calls, verify read-only run concurrently (timing), verify write tools run sequentially, verify message ordering matches original call order
- **Integration tests**: full round with mixed read-only + write tools, verify correct results and SSE event ordering

## Non-Goals (Explicitly Out of Scope)

- **Speculative execution** — predicting LLM's next tool call and pre-executing. Deferred.
- **Tool dependency graph** — analyzing which write tools conflict for smarter parallelization. Not worth the complexity.
- **Cache warming** — pre-loading caches on conversation start. Let caches populate naturally.
- **Distributed caching** — single-process, in-memory (same as Sub-project #1).
- **Tool priority/ordering** — all read-only tools execute with equal priority in Phase 1.
- **Per-conversation caching** — global with TTL is simpler and gives more benefit.
