# Sub-Project #5: Observability & Hooks — Design Spec

**Date:** 2026-04-12
**Status:** Draft
**Author:** Vasile Tamas + Claude Code
**Depends on:** Sub-project #2 (Error Recovery) — structured logger, circuit breakers; Sub-project #4 (Agent Extensibility) — skill packs, conversation modes, compliance checker
**Depended on by:** Sub-project #7 (Self-Improvement Engine) — subscribes to lifecycle events for outcome analysis

## Overview

Transform Zeno's pipeline from opaque to observable by adding a typed lifecycle event bus that powers three subscriber layers: OpenTelemetry tracing, Sentry error/performance integration, and in-process analytics (cost tracking, anomaly detection, PostHog enrichment).

The event bus is the central spine. All observability features are independent subscribers that don't know about each other. New consumers (including Sub-project #7's self-improvement engine) plug in by registering a handler — no changes to the bus or existing subscribers required.

## Architecture

```
Orchestrator / Gateway / Tool Executor
        │ emit()
        ▼
   ┌─────────────┐
   │  Event Bus   │  (singleton, typed, fire-and-forget)
   │  12 events   │
   └──────┬───────┘
          │ on()
    ┌─────┼──────────┬──────────────┬──────────────┐
    ▼     ▼          ▼              ▼              ▼
  OTel  Sentry    Cost Calc    Anomaly Det    PostHog
  Spans  Errors   per-turn     thresholds     enrichment
    │     │        accumulate   & rolling
    ▼     ▼                    stats
  Sentry Performance
  (via SentrySpanProcessor)
```

### Design Principles

- **Fire-and-forget**: Every `emit()` is non-blocking. Subscriber errors are caught and logged via the structured logger. The pipeline never breaks because of observability code.
- **Typed events**: All 12 event types are a discriminated union. Subscribers get compile-time type safety.
- **traceId threading**: A `traceId` (UUID) is generated at `turn:start` and threaded through TurnState to every emit call. All subscribers use it for correlation.
- **Lazy initialization**: OTel SDK (~1.1MB) only loads when `OTEL_ENABLED=true`. Zero overhead when disabled.
- **No schema changes**: TurnTrace.cost and TurnTrace.anomalies fields already exist in Prisma — they're just populated now.

## Event Types

**New file: `lib/events/types.ts`**

12 event types in a discriminated union:

### Core Pipeline Events (8)

```typescript
| { type: 'turn:start'; traceId: string; conversationId: string; messageIndex: number; timestamp: number }
| { type: 'turn:end'; traceId: string; conversationId: string; cost: number | null; latencyMs: number; anomalies: Anomaly[] }
| { type: 'phase:start'; traceId: string; phase: string; timestamp: number }
| { type: 'phase:end'; traceId: string; phase: string; durationMs: number; metadata?: Record<string, unknown> }
| { type: 'llm:call:start'; traceId: string; provider: string; model: string; agentSlug: string }
| { type: 'llm:call:end'; traceId: string; provider: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }
| { type: 'tool:start'; traceId: string; toolName: string; args: Record<string, unknown> }
| { type: 'tool:end'; traceId: string; toolName: string; durationMs: number; success: boolean; cached: boolean }
```

### Business Events (4)

```typescript
| { type: 'mode:transition'; traceId: string; from: string; to: string; conversationId: string }
| { type: 'skillpack:activated'; traceId: string; slugs: string[]; conversationId: string }
| { type: 'skillpack:deactivated'; traceId: string; slugs: string[]; conversationId: string }
| { type: 'compliance:result'; traceId: string; passed: boolean; gaps: string[]; conversationId: string }
```

### Supporting Types

```typescript
interface Anomaly {
  type: 'latency' | 'cost' | 'error_pattern' | 'behavioral'
  severity: 'info' | 'warning' | 'critical'
  message: string
  metadata: Record<string, unknown>
}

type EventHandler = (event: ZenoEvent) => void | Promise<void>
```

## Component Specifications

### 1. Event Bus

**New file: `lib/events/event-bus.ts`**

Singleton class with three methods:

- `emit(event: ZenoEvent): void` — dispatches to all matching handlers. Each handler is wrapped in try/catch — errors logged via structured logger (`logWarn`, layer: 'orchestrator', category: 'event_handler_error'`). Async handlers are fire-and-forget (not awaited).
- `on(type: string | '*', handler: EventHandler): () => void` — registers a handler for a specific event type or all events (wildcard). Returns an unsubscribe function.
- `once(type: string, handler: EventHandler): void` — registers a handler that auto-unsubscribes after first call.

Internal storage: `Map<string, Set<EventHandler>>` keyed by event type, plus a separate `Set<EventHandler>` for wildcard subscribers.

Exported as a singleton: `export const eventBus = new EventBus()`.

### 2. OpenTelemetry Layer

**New file: `lib/events/otel-setup.ts`** — Lazy SDK initialization

```typescript
let initialized = false

export function initOtel(): void {
  if (initialized || !process.env.OTEL_ENABLED) return
  
  const { NodeSDK } = require('@opentelemetry/sdk-node')
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
  const { SentrySpanProcessor } = require('@sentry/opentelemetry')
  
  const sdk = new NodeSDK({
    resource: { 'service.name': process.env.OTEL_SERVICE_NAME || 'zeno-agent' },
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318',
    }),
    spanProcessors: [new SentrySpanProcessor()],
  })
  
  sdk.start()
  initialized = true
}
```

- Uses `require()` for lazy loading — the ~1.1MB OTel SDK only loads when `OTEL_ENABLED=true`
- `SentrySpanProcessor` bridges all OTel spans into Sentry Performance automatically
- Called once at application startup (in the API route or server initialization)

**New file: `lib/events/otel-subscriber.ts`** — Span management

Subscribes to the event bus with wildcard (`'*'`) and manages span lifecycle:

**Internal state:**
```typescript
const activeTraces: Map<string, {
  root: Span
  phases: Map<string, Span>
}>
```

**Behavior per event:**

| Event | Action |
|-------|--------|
| `turn:start` | Create root span `zeno.turn` with attributes `conversationId`, `messageIndex`. Store in `activeTraces`. |
| `phase:start` | Create child span `zeno.phase.{phase}` under root. Store in `phases` map. |
| `phase:end` | End the phase span. Set `durationMs` + metadata as attributes. Remove from `phases` map. |
| `llm:call:start` | Create child span `zeno.llm.{provider}.{model}` under current phase span. Set `agentSlug` attribute. |
| `llm:call:end` | End LLM span. Set `inputTokens`, `outputTokens`, `durationMs` as attributes. |
| `tool:start` | Create child span `zeno.tool.{toolName}`. |
| `tool:end` | End tool span. Set `success`, `cached`, `durationMs` as attributes. |
| `mode:transition` | Add span event `mode.transition` on root span with `from`, `to` attributes. |
| `skillpack:activated` | Add span event `skillpack.activated` on root span with `slugs` attribute. |
| `skillpack:deactivated` | Add span event `skillpack.deactivated` on root span with `slugs` attribute. |
| `compliance:result` | Add span event `compliance.result` on root span with `passed`, `gaps` attributes. |
| `turn:end` | Set `cost`, `latencyMs`, anomaly count as root span attributes. End root span. Delete from `activeTraces`. |

**Cleanup:** If a trace is never ended (pipeline crash), the entry remains in `activeTraces`. Since the orchestrator has a 90s timeout, the worst case is a stale map entry. A periodic cleanup (every 5 minutes) removes entries older than 2 minutes.

### 3. Sentry Integration

**Modified file: `lib/errors/logger.ts`**

Add Sentry transport to the existing structured logger. After writing JSON to console (existing behavior):

```typescript
if ((severity === 'error' || severity === 'fatal') && Sentry) {
  Sentry.captureException(error ?? new Error(message), {
    tags: { layer, category, errorId },
    extra: context,
    level: severity === 'fatal' ? 'fatal' : 'error',
  })
}
```

- Only `error` and `fatal` severity go to Sentry — warnings stay console-only
- `errorId` as a Sentry tag — searchable across console logs and Sentry
- `layer` and `category` as tags — enables filtering (e.g., `layer:gateway`, `category:circuit_open`)
- Full `context` object attached as Sentry extras

**Modified file: `sentry.server.config.ts`**

```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    skipOpenTelemetrySetup: true,  // we manage OTel ourselves via otel-setup.ts
  })
}
```

The `SentrySpanProcessor` in `otel-setup.ts` handles bridging OTel spans → Sentry Performance. Setting `skipOpenTelemetrySetup: true` prevents Sentry from initializing its own OTel instance (avoids double-instrumentation).

### 4. Cost Calculator

**New file: `lib/events/cost-subscriber.ts`**

Subscribes to `llm:call:end` to calculate per-call cost and accumulate per-turn totals.

**Internal state:**
```typescript
const turnCosts: Map<string, number>  // traceId -> accumulated cost
```

**On `llm:call:end`:**
1. Look up pricing from ModelCatalog via existing LRU cache (`lib/cache/lru-cache.ts`)
2. Calculate: `cost = (inputTokens / 1000 * costPer1kInputTokens) + (outputTokens / 1000 * costPer1kOutputTokens)`
3. Accumulate into `turnCosts.get(traceId)`
4. If model not found in catalog, log a warning and skip (don't block)

**Exported function:**
```typescript
export function getTurnCost(traceId: string): number | null
```

Called by the orchestrator before emitting `turn:end` and persisting TurnTrace.

**On `turn:end`:** Clean up the traceId entry from `turnCosts`.

**Edge cases:**
- Multiple LLM calls per turn (main chat + reasoning gate + profile extractor + compliance checker) — all accumulated into the same traceId total
- Missing ModelCatalog entry — returns `null` for that call, logs warning, doesn't affect other calls in the turn

### 5. Anomaly Detector

**New file: `lib/events/anomaly-subscriber.ts`**

Subscribes to multiple event types, evaluates threshold rules, and collects anomalies per turn.

**Internal state:**
```typescript
const turnAnomalies: Map<string, Anomaly[]>         // traceId -> anomalies for this turn
const turnToolFailures: Map<string, number>          // traceId -> count of failed tools
const turnToolCalls: Map<string, number>             // traceId -> count of tool calls
const turnLlmStarts: Map<string, Map<string, number>> // traceId -> agentSlug -> call count (for retry detection)
const rollingLatency: Map<string, RollingStats>      // conversationMode -> latency stats
```

**Detection rules:**

| Category | Condition | Severity |
|----------|-----------|----------|
| Latency | Turn latency > 30s | warning |
| Latency | Turn latency > 60s | critical |
| Latency | Individual phase > 10s | warning |
| Latency | LLM call > 20s | warning |
| Cost | Turn cost > $0.50 | warning |
| Cost | Turn cost > $2.00 | critical |
| Cost | Single LLM call > 50k output tokens | warning |
| Error pattern | Tool failure count in turn > 2 | warning |
| Error pattern | LLM retry detected (same agentSlug called 2+ times in one turn) | info |
| Behavioral | Compliance check failed | warning |
| Behavioral | Mode transition without purchase (SALES → CLAIMS or RENEWAL) | warning |
| Behavioral | Tool call count in turn > 8 | warning |

**RollingStats helper class:**
```typescript
class RollingStats {
  private values: number[] = []
  private readonly maxSize = 200  // last 200 data points
  
  push(value: number): void   // adds value, evicts oldest if at capacity
  p95(): number               // 95th percentile
  mean(): number              // arithmetic mean
}
```

Maintained per conversation mode (SALES latency profile differs from SUPPORT). Used for future relative thresholds — not wired into rules yet (fixed thresholds first, data-driven later in sub-project #7).

**Exported function:**
```typescript
export function getTurnAnomalies(traceId: string): Anomaly[]
```

Called by the orchestrator before emitting `turn:end` and persisting TurnTrace.

**On `turn:end`:** Clean up all maps for the traceId.

### 6. PostHog Enrichment

**Modified file: `lib/analytics/events.ts`**

Add a helper that enriches existing funnel event properties with observability data:

```typescript
export function enrichEventProps(
  traceId: string,
  base: Record<string, unknown>
): Record<string, unknown> {
  const cost = getTurnCost(traceId)
  return {
    ...base,
    turnCost: cost,
    // conversationMode and activeSkillPacks passed in from caller
  }
}
```

Each existing funnel event call (`chat_started`, `product_selected`, `quote_generated`, `quote_accepted`, `payment_completed`, `policy_issued`, `dnt_completed`) passes the traceId and receives enriched properties including `turnCost`, `conversationMode`, `activeSkillPacks`, and `turnLatencyMs`.

No new PostHog events are added. The lifecycle events stay on the internal bus. PostHog remains exclusively for business funnel analytics.

## Orchestrator Instrumentation

**Modified file: `lib/chat/orchestrator.ts`**

### TurnState change

Add `traceId: string` to the TurnState interface. Generated via `crypto.randomUUID()` at the start of the pipeline.

### Emit points

```
emit('turn:start')                          ← before Step 1
  emit('phase:start', 'resolve')
  emit('phase:end', 'resolve')              ← Step 1 done
  emit('phase:start', 'save_user')
  emit('phase:end', 'save_user')            ← Step 2 done
  emit('phase:start', 'reasoning_gate')
    emit('llm:call:start')                  ← gate LLM call
    emit('llm:call:end')
  emit('phase:end', 'reasoning_gate')       ← Step 3 done
  emit('mode:transition')                   ← if gate detected mode change
  emit('skillpack:activated')               ← if new packs loaded
  emit('phase:start', 'context')
    emit('compliance:result')               ← if compliance checker ran
  emit('phase:end', 'context')              ← Step 4 done
  emit('phase:start', 'token_budget')
  emit('phase:end', 'token_budget')         ← Step 4b done
  emit('phase:start', 'sliding_window')
  emit('phase:end', 'sliding_window')       ← Step 5 done
  emit('phase:start', 'build_messages')
  emit('phase:end', 'build_messages')       ← Step 6 done
  emit('phase:start', 'llm_tools')
    emit('llm:call:start')                  ← main LLM call(s)
    emit('llm:call:end')
    emit('tool:start')                      ← per tool in loop
    emit('tool:end')
  emit('phase:end', 'llm_tools')            ← Step 7 done
  emit('phase:start', 'save_assistant')
  emit('phase:end', 'save_assistant')       ← Step 8 done
  emit('phase:start', 'background')
    emit('llm:call:start')                  ← profile extractor
    emit('llm:call:end')
  emit('phase:end', 'background')           ← Step 9 done
  emit('phase:start', 'trace')
  emit('phase:end', 'trace')                ← Step 10 done
emit('turn:end')                            ← with cost + anomalies
```

### Cost and anomaly collection

Before emitting `turn:end`, the orchestrator calls:
- `getTurnCost(traceId)` → populates `TurnTrace.cost`
- `getTurnAnomalies(traceId)` → populates `TurnTrace.anomalies`

### Gateway modification (`lib/llm/gateway.ts`)

Accept `traceId` as a parameter. Emit `llm:call:start` before calling the provider and `llm:call:end` after (data already tracked in GatewayCallRecord — inputTokens, outputTokens, durationMs).

### Tool executor modification (`lib/tools/executor.ts`)

Accept `traceId` as a parameter. Emit `tool:start` before execution and `tool:end` after, including `success`, `cached` (from tool result cache), and `durationMs`.

## New Dependencies

```
@opentelemetry/api                          — Core tracing API (~50KB)
@opentelemetry/sdk-node                     — Node.js SDK for span processing
@opentelemetry/exporter-trace-otlp-http     — OTLP HTTP exporter
@sentry/opentelemetry                       — Bridge OTel spans to Sentry Performance
```

`@sentry/opentelemetry` may already be bundled with `@sentry/nextjs` v10.45.0. Verify during implementation — if included, skip the explicit install.

## Environment Variables

```bash
# Sentry (Error Tracking + Performance)
SENTRY_DSN=                                        # From sentry.io project settings
NEXT_PUBLIC_SENTRY_DSN=                            # Same DSN, exposed to client

# PostHog (Product Analytics)
POSTHOG_API_KEY=                                   # From eu.posthog.com project settings
POSTHOG_HOST=https://eu.posthog.com                # EU instance for GDPR

# OpenTelemetry (Tracing) — disabled by default
OTEL_ENABLED=false                                 # Set true to enable tracing
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # OTLP collector endpoint
OTEL_SERVICE_NAME=zeno-agent                       # Service name in traces
```

All observability features degrade gracefully when env vars are missing:
- No `SENTRY_DSN` → logger skips Sentry transport, OTel skips SentrySpanProcessor
- No `POSTHOG_API_KEY` → enrichment helper still returns base properties
- `OTEL_ENABLED=false` (default) → OTel SDK never loaded, no performance overhead

## File Summary

### New Files (7)

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `lib/events/types.ts` | ZenoEvent union, Anomaly interface, EventHandler type | ~60 |
| `lib/events/event-bus.ts` | Singleton EventBus — emit, on, once | ~70 |
| `lib/events/otel-setup.ts` | Lazy OTel SDK initialization with SentrySpanProcessor | ~40 |
| `lib/events/otel-subscriber.ts` | Subscribes to bus, creates/manages OTel spans | ~120 |
| `lib/events/cost-subscriber.ts` | Accumulates per-turn cost from ModelCatalog pricing | ~60 |
| `lib/events/anomaly-subscriber.ts` | Threshold-based anomaly detection with RollingStats | ~140 |
| `lib/events/index.ts` | Barrel export + `initObservability()` that registers all subscribers | ~30 |

### Modified Files (6)

| File | Change |
|------|--------|
| `lib/chat/orchestrator.ts` | Add traceId to TurnState, emit events at all phase boundaries, call getTurnCost/getTurnAnomalies before TurnTrace write |
| `lib/llm/gateway.ts` | Accept traceId parameter, emit `llm:call:start`/`llm:call:end` |
| `lib/tools/executor.ts` | Accept traceId parameter, emit `tool:start`/`tool:end` |
| `lib/errors/logger.ts` | Add Sentry transport for error/fatal severity |
| `lib/analytics/events.ts` | Add `enrichEventProps()`, enrich existing funnel events with cost/mode/skillpacks |
| `sentry.server.config.ts` | Add `skipOpenTelemetrySetup: true` |

### No Schema Changes

TurnTrace.cost (Float?) and TurnTrace.anomalies (Json?) already exist in the Prisma schema. Both are currently persisted as `null`. This sub-project populates them with real data.

## Testing Strategy

### Unit Tests (5 files)

| Test File | Coverage |
|-----------|----------|
| `__tests__/lib/events/event-bus.test.ts` | emit/on/once/unsubscribe, wildcard subscriber, handler errors don't propagate, async handlers fire-and-forget |
| `__tests__/lib/events/cost-subscriber.test.ts` | Cost calculation against known ModelCatalog pricing, multi-LLM accumulation across one turn, missing model fallback to null, cleanup on turn:end |
| `__tests__/lib/events/anomaly-subscriber.test.ts` | Each anomaly rule fires at correct threshold and severity, RollingStats p95/mean calculation, cleanup on turn:end |
| `__tests__/lib/events/sentry-subscriber.test.ts` | error/fatal → Sentry.captureException with correct tags/extras, warnings not sent to Sentry |
| `__tests__/lib/events/otel-subscriber.test.ts` | Span creation/ending for turn/phase/llm/tool events, business events as span events on root, cleanup on turn:end, no-op when OTEL_ENABLED=false |

### Integration Test (1 file)

| Test File | Coverage |
|-----------|----------|
| `__tests__/lib/events/pipeline-observability.test.ts` | Full pipeline simulation: emit realistic sequence of 12 event types, verify cost accumulated correctly, anomalies detected, OTel spans created with correct parent-child relationships, Sentry called for errors. All subscribers wired together via `initObservability()`. |

### Mocking Strategy

| Mocked | Not Mocked |
|--------|-----------|
| Sentry SDK (`captureException`) | EventBus (real event propagation) |
| OTel SDK (span creation/ending) | Cost calculation math |
| PostHog client | Anomaly threshold logic |
| ModelCatalog DB query (provide known test prices) | RollingStats |
| `crypto.randomUUID` (deterministic traceIds in tests) | |

## Scope Boundaries

### In Scope
- Typed event bus with 12 event types
- OpenTelemetry tracing with lazy loading
- Sentry error integration (structured logger transport)
- Sentry performance integration (OTel → SentrySpanProcessor bridge)
- Per-turn cost calculation from ModelCatalog
- Threshold-based anomaly detection (fixed thresholds)
- PostHog funnel event enrichment
- Orchestrator/gateway/executor instrumentation
- Unit and integration tests

### Out of Scope (Deferred)
- **Admin dashboard for metrics** — admin can query TurnTrace directly for now. Dashboard deferred to sub-project #6 or #7.
- **Alerting rules** — anomalies are detected and persisted but don't trigger notifications. Sentry alerts can be configured manually in the Sentry dashboard.
- **Webhook delivery of events** — bus is in-process only. External delivery not needed yet.
- **Relative anomaly thresholds** — RollingStats infrastructure is built but thresholds are fixed. Data-driven thresholds deferred to sub-project #7.
- **SSE admin stream** — real-time event stream for admin dashboard. Not needed yet.
- **Distributed tracing across services** — Zeno is a single Next.js process. Cross-service trace propagation not needed.
