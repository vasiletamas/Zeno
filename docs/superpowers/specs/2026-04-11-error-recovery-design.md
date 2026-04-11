# Sub-Project #2: Error Recovery

**Date:** 2026-04-11
**Status:** Approved
**Author:** Vasile Tamas + Claude Code
**Depends on:** Sub-project #1 (Context & Memory) — completed, no direct dependency but builds on same codebase
**Depended on by:** Sub-project #5 (Observability & Hooks) — builds transports on top of structured logger

## Overview

Add a 3-tier error recovery system with layered error boundaries, circuit breakers, structured logging, and graceful degradation. The goal: no user should ever see a broken chat. Every failure either recovers silently or surfaces a clean, branded error message.

## Motivation

The current system has basic retry/failover at the gateway level but significant gaps everywhere else:

- **Streaming errors are uncaught** — mid-stream LLM failures crash the SSE connection
- **No rate limit handling** — 429 errors retry with fixed delays, no jitter, no circuit breaker
- **DB errors in core steps have no try/catch** — steps 1, 2, 8 of the orchestrator can crash the turn
- **Background tasks silently swallow errors** — profile extraction, turn traces fail with only console.error
- **No timeout protection** — a hung LLM call or DB query blocks the pipeline indefinitely
- **Workflow gate fails open** — DB error in permission check returns `allowed: true`
- **No structured logging** — errors are logged as raw strings, not traceable in production

## Architecture

Layered Error Boundaries — each architectural layer handles what it can, escalates what it can't:

```
API Route (Tier 3) ← outermost, last line of defense
  └─ Orchestrator (Tier 2) ← step-level boundaries, queued retry
       ├─ Gateway (Tier 1) ← adaptive retry, failover, circuit breaker
       │    ├─ OpenAI Provider
       │    └─ Anthropic Provider
       └─ Tool Executor (Tier 2b) ← per-tool circuit breaker, timeout
            ├─ Tool Handlers
            └─ Pipeline (transitions, gates)
```

Cross-cutting concerns (circuit breaker, structured logger) are shared utilities used by all layers independently.

## Component 1: Structured Error Logger

### Problem

Errors are logged via `console.error`/`console.warn` as unstructured strings. No error IDs, no context, no severity levels. Impossible to trace in production.

### New File: `lib/errors/logger.ts`

**Exports:**
- `logError(entry: ErrorInput): string` — logs at error severity, returns errorId
- `logWarn(entry: ErrorInput): string` — logs at warn severity, returns errorId
- `logFatal(entry: ErrorInput): string` — logs at fatal severity, returns errorId

**Error entry structure:**

```typescript
interface ErrorEntry {
  errorId: string                // nanoid, short unique ID for tracing
  severity: 'warn' | 'error' | 'fatal'
  layer: 'provider' | 'gateway' | 'orchestrator' | 'tool' | 'api'
  category: string              // transient, provider_down, validation, context_overflow,
                                // timeout, tool_failure, db_error, circuit_open
  context: Record<string, unknown>  // conversationId, customerId, step, tool name, provider
  message: string               // human-readable description
  timestamp: string             // ISO 8601
  stack?: string                // error stack trace (error/fatal only)
}
```

**Input type (callers provide):**

```typescript
interface ErrorInput {
  layer: ErrorEntry['layer']
  category: string
  message: string
  context?: Record<string, unknown>
  error?: unknown               // original error — stack extracted automatically
}
```

The logger writes JSON lines to `console.error` (compatible with Docker log drivers, CloudWatch, structured log ingestion). Sub-project #5 (Observability) will add transports to Sentry/external systems — this ensures the data shape is correct from day one.

### Changes to Existing Files

All `console.error` and `console.warn` calls across `lib/` get replaced with structured logger calls. Each call includes the appropriate `layer`, `category`, and `context`.

## Component 2: Circuit Breaker

### Problem

No protection against repeated failures. A down provider gets hammered with retries. A broken tool gets called in a loop by the LLM, wasting tokens.

### New File: `lib/errors/circuit-breaker.ts`

Generic circuit breaker with three states: **closed** (normal), **open** (failing — reject immediately), **half-open** (testing — allow one probe).

```typescript
export class CircuitBreaker {
  constructor(options: {
    name: string              // e.g. "openai", "generate_quote"
    failureThreshold: number  // failures before opening
    resetTimeoutMs: number    // how long open before half-open
    monitorWindowMs: number   // sliding window for counting failures
  })

  async execute<T>(fn: () => Promise<T>): Promise<T>
  get state(): 'closed' | 'open' | 'half-open'
  recordSuccess(): void
  recordFailure(error: unknown): void
  reset(): void
}
```

**State transitions:**
- **Closed → Open:** `failureThreshold` failures within `monitorWindowMs`
- **Open → Half-Open:** After `resetTimeoutMs` elapses
- **Half-Open → Closed:** First success (probe passed)
- **Half-Open → Open:** First failure (still broken, restart timer)

When open, `execute()` throws `CircuitOpenError` immediately without calling the function. Every state transition is logged via the structured logger.

### New File: `lib/errors/types.ts`

Shared error types:
- `CircuitOpenError` — thrown when circuit is open
- `TimeoutError` — thrown when operation exceeds deadline
- Type definitions for severity, layer, category enums

### Configuration

| Circuit Breaker | Failure Threshold | Reset Timeout | Monitor Window |
|----------------|-------------------|---------------|----------------|
| Per-provider (openai, anthropic) | 5 failures | 30 seconds | 60 seconds |
| Per-tool (by tool name) | 3 failures | 20 seconds | 30 seconds |

## Component 3: Gateway Hardening (Tier 1 — Provider Layer)

### Problem

Gateway has basic retry (fixed 1s/3s delays) and failover, but no rate limit awareness, no circuit breaker, and streaming calls have no error handling.

### Changes to `lib/llm/providers/registry.ts`

**Adaptive backoff with jitter:**
- Replace fixed 1s/3s delays with exponential backoff: `baseDelay * 2^attempt + random(0, 500ms)`
- Parse `retry-after` header from 429 responses — use provider's requested delay when available
- Base delay: 500ms, max delay cap: 10s

**Circuit breaker integration:**
- Module-level circuit breaker instances, one per provider
- Wrap each provider call with its circuit breaker
- If primary provider's circuit is open, skip straight to failover (no wasted attempt)
- If both circuits are open → propagate `CircuitOpenError` to orchestrator

**Streaming error recovery:**
- Wrap stream iteration: if the stream throws after partial content has been yielded, emit a `{ type: 'error' }` chunk instead of crashing the SSE connection
- `streamWithRetry` added — wraps streaming calls with retry logic for the initial connection, plus error-chunk emission for mid-stream failures

**Structured logging:**
- Replace all `console.warn` calls with structured logger
- Log every retry attempt, failover trigger, and circuit state change with full context

## Component 4: Orchestrator Hardening (Tier 2 — Pipeline Layer)

### Problem

Most orchestrator steps have no try/catch. DB errors, context assembly failures, and streaming errors can crash the entire turn. Background task failures are silently swallowed.

### Changes to `lib/chat/orchestrator.ts`

**Step-level error boundaries:**

| Step | Current State | New Behavior |
|------|--------------|-------------|
| Step 1 (Resolve conversation) | No try/catch | Catch DB errors → log + yield SSE error event |
| Step 2 (Save user message) | No try/catch | Catch DB errors → log + yield SSE error event |
| Step 3 (Reasoning gate) | Already caught | Keep as-is (non-fatal, falls back to defaults) |
| Step 4 (Context assembly) | No try/catch | Catch DB errors → fall back to minimal context (identity + constraints only) |
| Step 5 (Sliding window) | No try/catch | Catch DB/summarizer errors → fall back to empty window + user message only |
| Step 7 (LLM + tools) | Partial (compaction) | Add streaming error catch, circuit breaker integration, queued retry |
| Step 8 (Save assistant) | No try/catch | Catch DB errors → log, still yield the response (already streamed) |
| Step 9 (Background agents) | Silently swallowed | Keep fire-and-forget but log via structured logger with full context |
| Step 10 (Turn trace) | Silently swallowed | Same — fire-and-forget with structured logging |

**Queued retry for total outage (Step 7):**

When both provider circuits are open:
1. Emit SSE event `{ event: 'status', data: { type: 'processing', message: 'Un moment, reconectez...' } }`
2. Wait with backoff: 5s, 10s, 20s (3 attempts over ~35 seconds)
3. On each attempt, check if either circuit has transitioned to half-open
4. If a retry succeeds → continue normally, emit content
5. If all retries exhausted → emit SSE error event with `type: 'service_unavailable'`

**Timeout guard:**

90-second timeout on the entire pipeline. If any step hangs:
- Yield a timeout SSE error event and exit the generator
- Implemented via `AbortController` signal for fetch-based calls and `Promise.race` with a timer for DB calls

**Workflow gate security fix:**

Change `checkWorkflowGate` to return `allowed: false` on DB error (currently returns `allowed: true`). The LLM sees "tool not permitted" rather than silently bypassing the permission check. Log with `category: 'db_error'`.

## Component 5: Tool Execution Hardening (Tier 2b — Tool Layer)

### Problem

Tools already never throw (contained), but there's no circuit breaker to prevent the LLM from repeatedly calling a broken tool. No timeout protection against hung handlers.

### Changes to `lib/tools/executor.ts`

**Circuit breaker per tool:**
- Module-level `Map<string, CircuitBreaker>` — lazily created per tool name
- Before executing a handler, check the tool's circuit breaker
- If circuit is open → return `{ success: false, error: "Tool temporarily unavailable. Please try a different approach or try again shortly." }`
- On handler success → `recordSuccess()`
- On handler failure → `recordFailure()`

**Execution timeout:**
- 15-second timeout per tool call via `Promise.race` against a timer
- On timeout → return `{ success: false, error: "Tool execution timed out" }`
- Record as circuit breaker failure
- Log with structured logger

### Changes to `lib/tools/pipeline.ts`

**Transition evaluation:**
- Replace silent `console.error` with structured logger (`layer: 'tool'`, `category: 'transition_error'`)
- Add `transitionError: boolean` flag to `PipelineResult` so the orchestrator can track it in turn trace

**Workflow gate fix:**
- On DB error, return `allowed: false` instead of `allowed: true`
- Log with structured logger

## Component 6: API Route Hardening (Tier 3 — API Boundary)

### Problem

API route catches Zod validation errors and generic errors, but orchestrator failures propagate as broken SSE streams. No timeout, no error format consistency.

### Changes to `app/api/chat/route.ts`

**Catch orchestrator errors:**
- If `handleChatTurn()` throws synchronously → return JSON error response with 500 status
- Internal error boundaries (Component 4) handle most cases via SSE error events; the API route catches catastrophic/unexpected failures

**Request-level timeout:**
- 90-second timeout matching the orchestrator timeout
- If SSE stream hasn't sent `done` within 90s → close stream with SSE error event

**Error SSE format:**

All error events follow a consistent shape:
```typescript
{
  event: 'error',
  data: {
    errorId: string       // from structured logger, for support reference
    type: 'validation' | 'service_unavailable' | 'timeout' | 'internal'
    message: string       // user-facing, localized (ro/en)
    retryable: boolean    // hint to frontend for "Try again" button
  }
}
```

**Per-conversation concurrency guard:**
- Max 3 concurrent requests per conversationId
- Module-level `Map<string, number>` tracking in-flight count
- If 4th request arrives → return 429 immediately
- Prevents spam-clicking from creating parallel pipeline runs (DB race conditions)

## Files Summary

### New Files (3)

| File | Purpose |
|------|---------|
| `lib/errors/logger.ts` | Structured JSON error logger |
| `lib/errors/circuit-breaker.ts` | Generic circuit breaker with 3 states |
| `lib/errors/types.ts` | Shared error types, CircuitOpenError, TimeoutError |

### Modified Files (7)

| File | Changes |
|------|---------|
| `lib/llm/providers/registry.ts` | Adaptive backoff, jitter, retry-after parsing, circuit breaker, streaming recovery |
| `lib/chat/orchestrator.ts` | Error boundaries on all steps, queued retry, 90s timeout guard |
| `lib/tools/executor.ts` | Per-tool circuit breaker, 15s execution timeout |
| `lib/tools/pipeline.ts` | Structured logging for transition errors, transitionError flag, gate security fix |
| `app/api/chat/route.ts` | Orchestrator error catch, 90s timeout, error SSE format, concurrency guard |
| `lib/llm/errors.ts` | Add CircuitOpenError, TimeoutError to error classification |
| All files with console.error/warn | Replace with structured logger calls |

## Testing Strategy

Each component gets:
- **Unit tests** for pure logic: circuit breaker state transitions, backoff calculation with jitter, structured logger output format, timeout races
- **Integration tests** for error recovery: mock provider failures → verify failover, mock tool timeout → verify circuit opens, mock DB error → verify graceful degradation
- **Edge cases**: circuit half-open probe succeeding/failing, concurrent requests hitting concurrency guard, retry-after header parsing, partial stream recovery

## Non-Goals (Explicitly Out of Scope)

- **Distributed circuit breaker state** (Redis) — single-process, in-memory is fine
- **External error transports** (Sentry, Datadog) — Sub-project #5 (Observability)
- **Durable retry queues** — queued retry is in-memory, not persistent across restarts
- **Client-side retry logic** — we provide the `retryable` hint, frontend implementation is separate
- **Global API rate limiting** — only per-conversation concurrency guard, not infrastructure-level
- **LLM cost budgets on retries** — tracked in turn trace, no enforcement
- **Retry for background tasks** — profile extraction and turn traces remain fire-and-forget (structured logging provides visibility; retry would add complexity for low-value operations)
