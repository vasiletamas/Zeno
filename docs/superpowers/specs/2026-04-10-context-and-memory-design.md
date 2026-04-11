# Sub-Project #1: Context & Memory

**Date:** 2026-04-10
**Status:** Approved
**Author:** Vasile Tamas + Claude Code
**Depends on:** Nothing (foundation layer)
**Depended on by:** Sub-project #7 (Self-Improvement Engine)

## Overview

Replace the fixed 20-message sliding window with a token-aware, resilient context management system inspired by Claude Code's architecture. Add cross-conversation memory so the agent learns about customers and effective patterns over time.

## Motivation

The current system has a hardcoded `WINDOW_SIZE = 20` in `lib/chat/sliding-window.ts`. This creates two problems:

1. **Long conversations lose context** — after 20 messages, older content is summarized and the agent can't recall specifics. Insurance sales conversations often exceed 20 exchanges (DNT questionnaire alone can be 37 questions).
2. **No cross-conversation learning** — `loadCustomerMemory` and `loadAgentKnowledge` in `lib/chat/context-loaders.ts` are P2 placeholders returning `null`. Returning customers start from zero.

Claude Code solves these with: token budgets (dynamic window), reactive compaction (graceful overflow), 3-tier memory (session/cross-session/team), LRU caching (performance), and prompt caching (cost).

## Architecture Roadmap Context

This is sub-project #1 of 7 in the Zeno architectural upgrade:

1. **Context & Memory** (this spec)
2. Error Recovery — 3-tier error handling, graceful degradation
3. Tool System — parallel execution, caching, speculative execution
4. Agent Extensibility — dynamic agent registry, pluggable agents
5. Observability & Hooks — lifecycle event system
6. Performance — prompt caching, LRU caches, response speed
7. Self-Improvement Engine — real-time + daily analysis, proposes changes, user approves

## Component 1: Token Budget System

### Problem

Fixed 20-message window wastes context on short system prompts and overflows on long ones.

### Solution

Calculate available message budget dynamically based on model context window minus system prompt, tool definitions, and output reservation.

### New File: `lib/chat/token-budget.ts`

**Exports:**
- `estimateTokens(text: string, language: 'en' | 'ro'): number` — fast char-based estimator (4 chars/token for English, 3 chars/token for Romanian). No external tokenizer dependency. Accurate within ~10%.
- `calculateMessageBudget(params): number` — returns available tokens for conversation messages.

**Parameters for `calculateMessageBudget`:**
```typescript
interface BudgetParams {
  modelContextWindow: number   // from ModelCatalog or agent config
  systemPromptTokens: number   // estimated from built prompt
  toolDefinitionTokens: number // estimated from tool JSON schemas
  outputReservation: number    // agent's maxTokens setting
  safetyMargin: number         // default 0.10 (10%)
}
```

**Formula:**
```
available = modelContextWindow - systemPromptTokens - toolDefinitionTokens - outputReservation
budget = available * (1 - safetyMargin)
```

### Changes to `lib/chat/sliding-window.ts`

- `buildSlidingWindow` signature changes: add `availableTokenBudget: number` parameter
- Remove `const WINDOW_SIZE = 20`
- Load messages newest-first, accumulate token count via `estimateTokens`
- Stop when budget would be exceeded
- Summarizer trigger logic unchanged — fires for everything outside the window

**Backward compatibility:** If `availableTokenBudget` is not provided (shouldn't happen but safety), fall back to loading last 20 messages.

### Changes to `lib/chat/orchestrator.ts`

- After step 4 (context assembly): calculate system prompt token size using `estimateTokens`
- After step 6 (build messages): estimate tool definition tokens
- Pass `availableTokenBudget` to `buildSlidingWindow` in step 5
- Log budget breakdown in TurnTrace phases

### Model Context Windows

The `ModelCatalog` table already exists with model metadata. Add a `contextWindow` integer column if not present. Seed values:

| Model | Context Window |
|-------|---------------|
| GPT-5.4 | 128,000 |
| GPT-5.4 Mini | 128,000 |
| Claude Opus 4.6 | 200,000 |
| Claude Sonnet 4.6 | 200,000 |
| Claude Sonnet 4 | 200,000 |
| Claude Haiku 4.5 | 200,000 |

## Component 2: Reactive Compaction

### Problem

If the token budget miscalculates or edge cases arise, the LLM API returns a "prompt too long" / "context_length_exceeded" error and the turn fails.

### Solution

Catch context overflow errors, compress message history in groups, retry.

### New File: `lib/chat/compaction.ts`

**Exports:**
- `compactMessages(messages: Message[], tokenDeficit: number, conversationId: string): Promise<Message[]>`

**Algorithm:**
1. Group messages into compaction groups of ~10 messages each
2. Calculate how many groups need to be compressed to cover `tokenDeficit`
3. Send those groups to the summarizer agent (existing `gateway.call('summarizer', ...)`)
4. Replace the compressed groups with a single system message: `[Compacted summary of messages 1-N]: <summary>`
5. Return the new message array

### Changes to `lib/chat/orchestrator.ts` (Step 7)

Wrap the LLM stream call:
```
try {
  stream = await gateway.stream(...)
} catch (err) {
  if (isContextLengthError(err)) {
    const deficit = parseTokenDeficit(err) ?? 2000  // fallback 2000 tokens
    messages = await compactMessages(messages, deficit, state.conversationId)
    stream = await gateway.stream(...)  // retry once
  } else {
    throw err
  }
}
```

Max 2 compaction retries. If still failing after 2, propagate the error.

### Changes to `lib/llm/errors.ts`

Add error classification:
- `context_length_exceeded` — detected from OpenAI error code `context_length_exceeded` and Anthropic error type `invalid_request_error` with message containing "too long"
- Add `parseTokenDeficit(err): number | null` — extract the token overage from the provider error message

## Component 3: Customer Memory

### Problem

`loadCustomerMemory` returns `null`. Returning customers start from scratch every conversation.

### Solution

New `CustomerInsight` table stores learned facts per customer. Profile-extractor agent writes to it. `loadCustomerMemory` reads from it.

### New Prisma Model

```prisma
enum InsightCategory {
  DEMOGRAPHIC
  PREFERENCE
  OBJECTION_PATTERN
  BUYING_SIGNAL
  RISK_FACTOR
}

model CustomerInsight {
  id              String          @id @default(cuid())
  customerId      String
  customer        Customer        @relation(fields: [customerId], references: [id])
  category        InsightCategory
  key             String          // e.g. "price_sensitivity", "has_existing_coverage"
  value           String          // the insight content
  confidence      Float           @default(0.5) // 0-1
  source          String          // conversationId that produced this
  lastConfirmedAt DateTime        @default(now())
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@unique([customerId, key])
  @@index([customerId, category])
}
```

### Changes to `lib/chat/context-loaders.ts`

`loadCustomerMemory(customerId)` implementation:
- Query `CustomerInsight` where `customerId` matches, ordered by `confidence DESC`, `lastConfirmedAt DESC`
- Group by category
- Mark insights older than 30 days unconfirmed as `(unverified)`
- Format into prompt text, cap at ~500 tokens via `estimateTokens`
- Return formatted string or `null` if no insights

### Changes to Profile-Extractor Agent (orchestrator.ts Step 9)

Expand the background profile extraction:
- Current: extracts demographics only, writes to `Customer.extractedProfile` JSON field
- New: also extracts preferences, objection patterns, buying signals, risk factors
- Writes each insight to `CustomerInsight` table via upsert on `(customerId, key)`
- If insight already exists and matches, bump `lastConfirmedAt`
- If insight exists but conflicts, update only if new confidence > existing confidence

The profile-extractor agent's system prompt needs updating to output a structured array of insights:
```json
[
  { "category": "PREFERENCE", "key": "price_sensitivity", "value": "High — mentioned budget concerns twice", "confidence": 0.8 },
  { "category": "BUYING_SIGNAL", "key": "urgency", "value": "Mentioned expecting a child soon", "confidence": 0.9 }
]
```

## Component 4: Agent Knowledge

### Problem

`loadAgentKnowledge` returns `null`. The agent can't leverage patterns that work across conversations.

### Solution

New `AgentKnowledge` table stores proven patterns with success metrics. `loadAgentKnowledge` reads from it.

### New Prisma Model

```prisma
enum KnowledgeCategory {
  OBJECTION_RESPONSE
  TOOL_SEQUENCE
  CONVERSATION_PATTERN
  PROMPT_FRAGMENT
}

model AgentKnowledge {
  id               String            @id @default(cuid())
  category         KnowledgeCategory
  trigger          String            // when to apply: "price_objection_after_quote"
  content          String            // the proven approach/response
  successRate      Float             @default(0.0) // 0-1
  sampleSize       Int               @default(0)
  productId        String?
  product          Product?          @relation(fields: [productId], references: [id])
  workflowStepCode String?           // optional step-specific
  isActive         Boolean           @default(true)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  @@index([category, isActive])
  @@index([productId, workflowStepCode])
}
```

### Changes to `lib/chat/context-loaders.ts`

`loadAgentKnowledge(productId)` implementation:
- Query `AgentKnowledge` where `isActive = true` AND `sampleSize >= 5` (minimum evidence)
- Filter by `productId` match OR `productId IS NULL` (generic patterns)
- Optionally filter by `workflowStepCode` if available (signature changes to `loadAgentKnowledge(productId, workflowStepCode)`)
- Update `loadAllSections` to pass `workflowStepCode` through to this loader
- Order by `successRate DESC`
- Take top 5 patterns
- Format as: `[Pattern] trigger → content (success: X%, n=Y)`
- Cap at ~400 tokens

### Initial Seeding

Bootstrap from existing `ObjectionStrategy` table data:
- Convert each strategy to an `AgentKnowledge` row with `category = OBJECTION_RESPONSE`
- Set `sampleSize = 0`, `successRate = 0` (no real data yet)
- Mark `isActive = true`
- Self-Improvement Engine (sub-project #7) will be the primary writer to this table going forward

## Component 5: LRU Cache

### Problem

Product data, agent configs, and tool definitions are loaded from the DB on every turn (sometimes multiple times per turn). This data rarely changes.

### Solution

Generic in-memory LRU cache with TTL-based expiry.

### New File: `lib/cache/lru-cache.ts`

```typescript
export class LRUCache<K, V> {
  constructor(maxSize: number, ttlMs: number)
  get(key: K): V | undefined
  set(key: K, value: V): void
  invalidate(key: K): void
  clear(): void
}
```

Implementation: `Map` with insertion-order tracking. On `get`, check TTL — if expired, delete and return `undefined`. On `set`, if at `maxSize`, delete oldest entry.

### Cache Application Points

| Location | Cache Key | TTL | Max Size |
|----------|-----------|-----|----------|
| `lib/llm/agent-config.ts` → `getAgentConfig(slug)` | agent slug | 5 min | 10 |
| `lib/chat/context-loaders.ts` → `loadProductContext(id, lang)` | `${productId}:${lang}` | 10 min | 5 |
| `lib/chat/context-loaders.ts` → `loadCoachingBriefing(id)` | productId | 10 min | 5 |
| `lib/tools/registry.ts` → `getToolsForLLM()` | `"all"` or tools hash | 5 min | 1 |

Each module creates its own cache instance (module-level singleton).

### Cache Invalidation

- TTL handles normal expiry
- Future admin panel can call `cache.clear()` on save
- No distributed cache needed — single Next.js server process

## Component 6: Stable System Prompt Prefix (Prompt Caching)

### Problem

Every turn sends the full system prompt to the LLM. Providers can cache matching prefixes, but the current prompt changes entirely each turn because dynamic sections are interleaved with stable ones.

### Solution

Restructure the prompt so stable content comes first, dynamic content comes second. This maximizes prefix cache hits at the provider level.

### Changes to `lib/chat/prompt-builder.ts`

**New `buildPrompt` return type:**
```typescript
interface PromptBuildResult {
  stablePrefix: string    // constitution + product + coaching (rarely changes)
  dynamicSuffix: string   // reasoning + customer + workflow + questionnaire (every turn)
  prompt: string          // stablePrefix + separator + dynamicSuffix (for backward compat)
  sectionSizes: Record<string, number>
  gateActive: boolean
  includedSections: string[]
  excludedSections: string[]
}
```

**Section ordering for caching:**

Stable prefix (same across turns within a conversation):
1. `agentIdentity` (priority 1)
2. `constraints` (priority 5)
3. `capabilityManifest` (priority 2)
4. `productContext` (priority 26 → moved to 6)
5. `coachingBriefing` (priority 23 → moved to 7)

`[INTERNAL GUIDANCE SEPARATOR]`

Dynamic suffix (changes every turn):
6. `situationalBriefing` (priority 10)
7. `customerMemory` (priority 20)
8. `agentKnowledge` (priority 21)
9. `customerContext` (priority 22)
10. `workflowInstructions` (priority 24)
11. `questionnaireContext` (priority 25)

### Changes to `lib/llm/providers/anthropic.ts`

For Anthropic API calls, apply `cache_control: { type: "ephemeral" }` to the stable prefix block. This tells Anthropic to cache that block across requests.

### Changes to `lib/llm/providers/openai.ts`

No code changes needed. OpenAI automatically caches matching prefixes. The restructuring alone enables this.

### Expected Savings

- Stable prefix: ~50-70% of total system prompt tokens
- Anthropic cached input: 90% cheaper
- OpenAI cached input: 50% cheaper
- Latency: faster time-to-first-token on cache hits

## Files Summary

### New Files (4)
| File | Purpose |
|------|---------|
| `lib/chat/token-budget.ts` | Token estimation and budget calculation |
| `lib/chat/compaction.ts` | Reactive compaction on context overflow |
| `lib/cache/lru-cache.ts` | Generic LRU cache with TTL |
| `prisma/seeds/seed-agent-knowledge.ts` | Bootstrap AgentKnowledge from ObjectionStrategy |

### Modified Files (8)
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `CustomerInsight`, `AgentKnowledge` models, `contextWindow` on ModelCatalog |
| `lib/chat/sliding-window.ts` | Dynamic window sizing based on token budget |
| `lib/chat/orchestrator.ts` | Wire token budget (step 4-5), reactive compaction (step 7), expanded profile extraction (step 9) |
| `lib/chat/context-loaders.ts` | Implement `loadCustomerMemory`, `loadAgentKnowledge` |
| `lib/chat/prompt-builder.ts` | Split into stable prefix + dynamic suffix, reorder sections |
| `lib/llm/errors.ts` | Add `context_length_exceeded` classification, `parseTokenDeficit` |
| `lib/llm/providers/anthropic.ts` | Add `cache_control` on stable prefix |
| `lib/llm/agent-config.ts` | Add LRU cache for agent config lookups |

### Prisma Schema Additions

2 new models: `CustomerInsight`, `AgentKnowledge`
2 new enums: `InsightCategory`, `KnowledgeCategory`
1 column addition: `ModelCatalog.contextWindow` (Int)

## Testing Strategy

Each component gets:
- **Unit tests** for pure functions (token estimation, budget calculation, LRU cache, prompt builder reorder)
- **Integration tests** for DB-dependent logic (customer memory loading, agent knowledge loading, compaction with summarizer)
- **Edge case tests**: empty conversations, single message, exactly at budget limit, Romanian vs English token estimation, stale insights (>30 days)

## Non-Goals (Explicitly Out of Scope)

- Distributed caching (Redis) — not needed for single-server deployment
- External tokenizer (tiktoken) — char-based estimation is sufficient
- Real-time memory sync across concurrent conversations — single-process handles this
- Self-Improvement Engine writing to AgentKnowledge — that's sub-project #7
- Model upgrade to GPT-5.4 — tracked separately, will be done during implementation as a prerequisite
