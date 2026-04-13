# Sub-Project #6: Performance — Design Spec

**Date:** 2026-04-13
**Branch:** `feat/agent-extensibility`
**Depends on:** Sub-project #1 (Context & Memory), Sub-project #5 (Observability & Hooks)
**Goal:** Reduce per-turn latency (primary) and LLM token cost (secondary) through pipeline parallelization, query consolidation, intelligent caching, and proactive summarization.

---

## Approach: Parallel Pipeline + Intelligent Caching

Combines pipeline parallelization (eliminating unnecessary sequential execution) with a caching layer that makes each parallel branch faster: consolidated DB queries, proactive summarizer keeping summaries warm, prompt cache hit optimization via generic cache hints, and benchmark integration tests to validate improvements.

Each component delivers independently — partial implementation still yields measurable gains.

---

## 1. Pipeline Parallelization — Steps 3+4 Concurrent Execution

### Current flow (sequential)

```
Step 1: Resolve conversation
  → Step 2: Save user message
    → Step 3: Reasoning gate (LLM call, ~1-3s)
      → Step 4: Context assembly (DB queries, ~200-500ms)
        → Step 4b: Token budget
          → Step 5: Sliding window → ...
```

### New flow (parallel gate + context)

```
Step 1: Resolve conversation
  → Step 2: Save user message
    ┬→ Step 3: Reasoning gate (LLM call)
    └→ Step 4a: Context assembly (DB + section loading)
      ← (both complete)
      → Step 4b: Two-phase prompt build
        → Step 4c: Token budget
          → Step 5: Sliding window → ...
```

### Two-phase prompt build

1. `loadAllSections` runs without gate output — loads ALL sections unconditionally
2. Reasoning gate runs in parallel, producing `gateSelection` (required/excluded sections)
3. When both complete, `buildPrompt(sections, gateSelection)` runs — same as today, just faster
4. `situationalBriefing` (formatted gate output) is patched into sections after the gate completes
5. Skill pack loading and mode transition happen after gate completes (they depend on gate output)
6. Compliance check fires conditionally based on `gateOutput.complianceRelevant`, can overlap with prompt build

### Changes

- `orchestrator.ts`: Steps 3+4 wrapped in `Promise.all` instead of sequential execution
- `loadAllSections` no longer receives `situationalBriefing` as input — patched in after gate completes
- Steps 1-2 remain sequential (Step 2 depends on Step 1)
- Steps 5-10 are unchanged

### Expected win

~200-500ms per non-fast-path turn (context DB queries no longer wait for gate LLM call).

---

## 2. Consolidated "Turn Context" Query

### Problem

Steps 1, 3, and 4 make overlapping DB queries:

| Data | Step 1 | Step 3 | Step 4 |
|------|--------|--------|--------|
| Conversation + product | x | | |
| Conversation + workflowSession | x | | |
| Customer (name, dob, profile) | | x | x |
| Application + quote + policy | | x | x |
| Active SkillPacks | | x | |
| Recent messages (last 3) | | x | |
| Recent messages (last 10) | | | x |

~10+ DB round trips with significant overlap.

### Solution: `loadTurnContext`

New file `lib/chat/turn-context.ts`:

```typescript
export interface TurnContext {
  conversation: {
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
  customer: {
    name: string | null
    dateOfBirth: Date | null
    extractedProfile: Record<string, unknown>
    language: string
    isAnonymous: boolean
  }
  recentMessages: { role: string; content: string; createdAt: Date }[]
  activeSkillPacks: { slug: string; description: string }[]
}

export async function loadTurnContext(
  conversationId: string,
  customerId: string,
): Promise<TurnContext>
```

Four parallel queries instead of ~10+ sequential:
1. Conversation with all includes (product, workflowSession, application+quote+policy)
2. Customer (name, dob, extractedProfile)
3. Recent messages (last 10, superset of last 3)
4. Active skill packs

### How it flows

- Step 1 calls `loadTurnContext()`, result stored in `TurnState`
- Step 3 reads from `turnContext` instead of querying DB
- Step 4 `loadAllSections` receives pre-fetched data for `customerContext`, `customerMemory`, `agentKnowledge` instead of self-querying
- Step 7 `buildToolContext` still queries fresh state after tool mutations (correct — tools may have changed DB state)
- Product/coaching LRU caches in `context-loaders.ts` remain (cross-conversation, already efficient)

### Changes

- New file: `lib/chat/turn-context.ts`
- `orchestrator.ts` Step 1: call `loadTurnContext`, pass downstream
- `context-loaders.ts`: `loadAllSections` accepts pre-fetched customer/message data
- Reasoning gate input assembly: reads from `turnContext` instead of inline queries

### Expected win

~5-8 fewer DB round trips per turn. At ~5-20ms each: ~25-160ms saved.

---

## 3. Proactive Summarizer with Stale-While-Revalidate

### Problem

In `sliding-window.ts`, when no cached summary exists or it's stale, the summarizer LLM call blocks the turn (1-3s). This is a 3rd LLM round trip on long conversations.

### Inspiration: Claude Code's session memory pattern

Claude Code uses continuous background extraction (session memory) rather than on-demand summarization. The summary is always warm because it's built incrementally after each turn.

### 3a: Stale-while-revalidate (Step 5)

When `buildSlidingWindow` needs a summary:

1. Check `ConversationSummary` table — if ANY summary exists (even stale), use it immediately
2. If stale (more messages than `STALE_MESSAGE_THRESHOLD` since `messagesUpTo`), flag for background refresh but **don't block**
3. Only block on the summarizer if NO summary exists at all (first-ever trigger for this conversation)

```typescript
const STALE_MESSAGE_THRESHOLD = 10

// In buildSlidingWindow:
if (existingSummary) {
  const isStale = (olderCount - existingSummary.messagesUpTo) > STALE_MESSAGE_THRESHOLD
  if (isStale) {
    void refreshSummaryInBackground(conversationId, olderMessages, olderCount)
  }
  return { messages: windowMessages, summaryPrefix: existingSummary.summary }
}

// No summary at all — must block (first time only)
const summaryText = await triggerSummarizer(conversationId, olderLLMMessages, olderCount)
return { messages: windowMessages, summaryPrefix: summaryText }
```

### 3b: Proactive background summarization (Step 9)

After each turn completes (in existing background agents step), update the summary if it's getting stale:

```typescript
// In Step 9, after profile extractor:
void updateSummaryIfStale(state.conversationId, state.messageCount)
```

`updateSummaryIfStale` checks if `messagesUpTo` is more than `STALE_MESSAGE_THRESHOLD` behind `messageCount`. If behind, loads uncovered messages and calls the summarizer. Runs fire-and-forget.

### 3c: Incremental summarization

Rather than re-summarizing the entire older history each time, the proactive refresh:

1. Loads the existing summary text
2. Loads only NEW messages (between `messagesUpTo` and current boundary)
3. Asks the summarizer to **extend** the existing summary with the new messages

Each background summarization is cheaper (fewer input tokens) and faster.

### Changes

- `sliding-window.ts`: stale-while-revalidate logic, `refreshSummaryInBackground` helper
- `orchestrator.ts` Step 9: add `updateSummaryIfStale` call
- Summarizer prompt: new "incremental extension" mode alongside full summarization

### Expected win

Eliminates 1-3s summarizer blocking on ~95% of long-conversation turns.

---

## 4. Generic Prompt Cache Optimization

### 4a: Generic cache hint abstraction

Extend `Message` type in `lib/llm/providers/types.ts`:

```typescript
export interface CacheHint {
  breakpoint: 'ephemeral' | 'persistent'
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  cacheHint?: CacheHint  // optional — providers that support it use it, others ignore
}
```

The orchestrator marks the system message containing `stablePrefix` with `cacheHint: { breakpoint: 'ephemeral' }`.

### 4b: Provider-specific adapters

**Anthropic** (`lib/llm/providers/anthropic/`):
- Reads `cacheHint` on messages, maps to `cache_control: { type: "ephemeral" }` on the content block
- Applied at the system message boundary between stable and dynamic content

**OpenAI** (`lib/llm/providers/openai/`):
- Uses automatic prefix caching — no explicit headers needed
- Adapter ignores `cacheHint` (or logs for tracking)

**Future providers:** Implement their own mapping in their adapter.

### 4c: Prefix stability improvements

To maximize cache hits, the stable prefix must not change unnecessarily:

1. **Deterministic tool definition serialization** — `getToolsForLLM` sorts tool definitions by name before returning. Currently order may vary if registry is modified at runtime.
2. **Stable section ordering** — already handled by `SORTED_REGISTRY` in prompt builder.
3. **Agent config stability** — `getAgentConfig` 5-minute cache prevents mid-conversation config changes from busting the prefix cache.

### 4d: Cache hit/miss tracking

New event type in `lib/events/types.ts`:

```typescript
{
  type: 'cache:status'
  traceId: string
  provider: string
  cacheRead: number     // tokens read from cache (from API response)
  cacheWrite: number    // tokens written to cache
  cacheHit: boolean     // cacheRead > 0
}
```

Emitted from `gateway.ts` after each LLM call, with provider-specific response parsing:
- **Anthropic:** `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`
- **OpenAI:** `usage.prompt_tokens_details.cached_tokens`
- **Others:** emit with `cacheRead: 0` (unknown)

The anomaly subscriber can flag conversations with consistently low cache hit rates.

### Changes

- `lib/llm/providers/types.ts`: add `CacheHint` to `Message`
- Anthropic provider adapter: map `cacheHint` to `cache_control`
- OpenAI provider adapter: no-op pass-through
- `orchestrator.ts` Step 6: mark stable prefix message with cache hint
- `lib/events/types.ts`: add `cache:status` event
- `gateway.ts`: emit `cache:status` after LLM calls, parsing provider response
- Tool registry: deterministic sort in `getToolsForLLM`

### Expected win

Anthropic cache hits save ~90% on cached input tokens. OpenAI automatic caching saves ~50%. With prefix stability, hit rate target is >80% within a conversation.

---

## 5. Performance Benchmark Integration Tests

### Test structure

```
__tests__/
  performance/
    bench-pipeline.test.ts    — full pipeline timing tests
    bench-helpers.ts          — timing utilities, mock LLM, assertions
```

Tests use a **mock LLM provider** with configurable latency. DB is real (test database via Docker). This isolates pipeline overhead from LLM variance.

### Benchmark scenarios

#### Scenario 1: Fast-path turn
Short questionnaire answer, skips reasoning gate.
- **Asserts:** total pipeline overhead (excl. LLM) < 500ms
- **Measures:** Steps 1-2 (resolve+save), Step 4 (context), Step 5 (window), Step 6 (build)

#### Scenario 2: Standard turn
Normal message, full reasoning gate + context assembly.
- **Asserts:** gate+context combined < gate time + 200ms (proves parallel overlap)
- **Measures:** Steps 3+4 combined wall time vs. individual step times

#### Scenario 3: Long conversation turn
50+ messages, triggers sliding window with summary.
- **Asserts:** summary comes from cache (not blocking LLM), window build < 100ms
- **Measures:** Step 5 duration, whether summarizer blocked or used cached

#### Scenario 4: Repeated turn (cache warmth)
Second turn in same conversation.
- **Asserts:** product/coaching context from LRU cache, agent config from cache
- **Measures:** Step 4 duration on warm vs. cold cache

### Timing utilities

```typescript
// bench-helpers.ts

export interface PhaseTimings {
  [phase: string]: number  // duration in ms
}

export interface PhaseSpans {
  [phase: string]: { startMs: number; endMs: number }
}

// Listens to event bus phase:start/end events, returns both duration map and span map
export function collectTimings(traceId: string): { timings: PhaseTimings; spans: PhaseSpans }

// Assertion: phase completed under threshold
export function assertPhaseUnder(timings: PhaseTimings, phase: string, maxMs: number): void

// Assertion: two phases overlapped in time (proves parallelization)
// Uses phase:start timestamp + phase:end durationMs to compute overlap
export function assertPhasesParallel(
  spans: PhaseSpans,  // { [phase]: { startMs: number; endMs: number } }
  phaseA: string,
  phaseB: string,
  minOverlapMs: number,
): void
```

### Mock LLM provider

```typescript
export function createMockProvider(options: {
  latencyMs: number
  responseContent: string
  tokenUsage: { promptTokens: number; completionTokens: number }
}): LLMProvider
```

Registered as a test provider. Agent configs in test DB point to it.

### Initial timing thresholds

| Scenario | Metric | Threshold |
|----------|--------|-----------|
| Fast-path | Pipeline overhead (excl. LLM) | < 500ms |
| Standard | Gate + context wall time | < gate time + 200ms |
| Long conversation | Step 5 (warm summary) | < 100ms |
| Repeated turn | Step 4 (warm cache) | < 200ms |

Thresholds are generous (establishing baselines). Stored in a config object in `bench-helpers.ts` for easy tightening.

### Scope

- **Tested:** DB query count/duration, pipeline step ordering, cache behavior, event bus timing, parallelization proof
- **Not tested:** Actual LLM latency, network performance, SSE streaming overhead

---

## Out of Scope

- Connection pooling / PgBouncer (future optimization when concurrent load demands it)
- Lazy module loading (already handled in sub-project #5 for OTel)
- Speculative LLM execution (starting main call before gate completes)
- Fast-path heuristic expansion (could be sub-project #7 work)
- Startup / cold boot optimization (Next.js concern, not agent pipeline)

---

## File Impact Summary

| Component | New files | Modified files |
|-----------|-----------|----------------|
| Pipeline parallelization | — | `orchestrator.ts` |
| Turn context query | `lib/chat/turn-context.ts` | `orchestrator.ts`, `context-loaders.ts` |
| Proactive summarizer | — | `sliding-window.ts`, `orchestrator.ts` |
| Cache hints | — | `providers/types.ts`, Anthropic adapter, OpenAI adapter, `orchestrator.ts` |
| Cache tracking | — | `events/types.ts`, `gateway.ts`, provider adapters |
| Prefix stability | — | tool registry (`getToolsForLLM`) |
| Benchmark suite | `__tests__/performance/bench-pipeline.test.ts`, `__tests__/performance/bench-helpers.ts` | — |

**Total: 3 new files, ~10 modified files**
