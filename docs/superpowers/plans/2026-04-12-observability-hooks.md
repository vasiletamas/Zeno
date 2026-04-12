# Observability & Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed lifecycle event bus to the Zeno pipeline that powers OpenTelemetry tracing, Sentry integration, per-turn cost calculation, and anomaly detection.

**Architecture:** A singleton `EventBus` emits 12 typed events at pipeline phase boundaries. Five independent subscriber layers listen: OTel span management, Sentry error bridging, cost accumulation from ModelCatalog, threshold-based anomaly detection, and PostHog enrichment. All subscribers are fire-and-forget — errors are logged but never break the pipeline.

**Tech Stack:** TypeScript, OpenTelemetry API + SDK + OTLP exporter, @sentry/nextjs + @sentry/opentelemetry, Vitest, existing LRUCache and structured logger.

**Spec:** `docs/superpowers/specs/2026-04-12-observability-hooks-design.md`

---

### Task 1: Install dependencies and add environment variables

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install OpenTelemetry packages**

Run:
```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions @sentry/opentelemetry
```

- [ ] **Step 2: Add environment variables to .env.example**

Append to `.env.example`:

```bash

# Sentry (Error Tracking + Performance)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# PostHog (Product Analytics)
POSTHOG_API_KEY=
POSTHOG_HOST=https://eu.posthog.com

# OpenTelemetry (Tracing) — disabled by default
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=zeno-agent
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "feat: add OpenTelemetry and Sentry OTel bridge dependencies"
```

---

### Task 2: Event types and EventBus core

**Files:**
- Create: `lib/events/types.ts`
- Create: `lib/events/event-bus.ts`
- Test: `__tests__/lib/events/event-bus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/events/event-bus.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import type { ZenoEvent } from '@/lib/events/types'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  const turnStartEvent: ZenoEvent = {
    type: 'turn:start',
    traceId: 'trace-1',
    conversationId: 'conv-1',
    messageIndex: 0,
    timestamp: Date.now(),
  }

  const turnEndEvent: ZenoEvent = {
    type: 'turn:end',
    traceId: 'trace-1',
    conversationId: 'conv-1',
    cost: 0.05,
    latencyMs: 1200,
    anomalies: [],
  }

  it('emits events to matching handlers', () => {
    const handler = vi.fn()
    bus.on('turn:start', handler)

    bus.emit(turnStartEvent)

    expect(handler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('does not emit to non-matching handlers', () => {
    const handler = vi.fn()
    bus.on('turn:end', handler)

    bus.emit(turnStartEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('wildcard handler receives all events', () => {
    const handler = vi.fn()
    bus.on('*', handler)

    bus.emit(turnStartEvent)
    bus.emit(turnEndEvent)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith(turnStartEvent)
    expect(handler).toHaveBeenCalledWith(turnEndEvent)
  })

  it('unsubscribe removes the handler', () => {
    const handler = vi.fn()
    const unsub = bus.on('turn:start', handler)

    unsub()
    bus.emit(turnStartEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('once handler fires only once', () => {
    const handler = vi.fn()
    bus.once('turn:start', handler)

    bus.emit(turnStartEvent)
    bus.emit(turnStartEvent)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handler errors do not propagate', () => {
    const badHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()
    bus.on('turn:start', badHandler)
    bus.on('turn:start', goodHandler)

    expect(() => bus.emit(turnStartEvent)).not.toThrow()
    expect(goodHandler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('async handler errors do not propagate', () => {
    const badHandler = vi.fn(async () => { throw new Error('async boom') })
    const goodHandler = vi.fn()
    bus.on('turn:start', badHandler)
    bus.on('turn:start', goodHandler)

    expect(() => bus.emit(turnStartEvent)).not.toThrow()
    expect(goodHandler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('multiple handlers for same event all fire', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    bus.on('turn:start', handler1)
    bus.on('turn:start', handler2)

    bus.emit(turnStartEvent)

    expect(handler1).toHaveBeenCalledOnce()
    expect(handler2).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/event-bus.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Create event types**

Create `lib/events/types.ts`:

```typescript
// ==============================================
// ANOMALY
// ==============================================

export interface Anomaly {
  type: 'latency' | 'cost' | 'error_pattern' | 'behavioral'
  severity: 'info' | 'warning' | 'critical'
  message: string
  metadata: Record<string, unknown>
}

// ==============================================
// ZENO EVENTS — 12 typed lifecycle events
// ==============================================

export type ZenoEvent =
  // Core pipeline events (8)
  | { type: 'turn:start'; traceId: string; conversationId: string; messageIndex: number; timestamp: number }
  | { type: 'turn:end'; traceId: string; conversationId: string; cost: number | null; latencyMs: number; anomalies: Anomaly[] }
  | { type: 'phase:start'; traceId: string; phase: string; timestamp: number }
  | { type: 'phase:end'; traceId: string; phase: string; durationMs: number; metadata?: Record<string, unknown> }
  | { type: 'llm:call:start'; traceId: string; provider: string; model: string; agentSlug: string }
  | { type: 'llm:call:end'; traceId: string; provider: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }
  | { type: 'tool:start'; traceId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool:end'; traceId: string; toolName: string; durationMs: number; success: boolean; cached: boolean }
  // Business events (4)
  | { type: 'mode:transition'; traceId: string; from: string; to: string; conversationId: string }
  | { type: 'skillpack:activated'; traceId: string; slugs: string[]; conversationId: string }
  | { type: 'skillpack:deactivated'; traceId: string; slugs: string[]; conversationId: string }
  | { type: 'compliance:result'; traceId: string; passed: boolean; gaps: string[]; conversationId: string }

// ==============================================
// HANDLER TYPE
// ==============================================

export type ZenoEventType = ZenoEvent['type']
export type EventHandler = (event: ZenoEvent) => void | Promise<void>
```

- [ ] **Step 4: Create EventBus**

Create `lib/events/event-bus.ts`:

```typescript
import type { ZenoEvent, ZenoEventType, EventHandler } from './types'
import { logWarn } from '@/lib/errors/logger'

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()
  private wildcardHandlers = new Set<EventHandler>()

  on(type: ZenoEventType | '*', handler: EventHandler): () => void {
    if (type === '*') {
      this.wildcardHandlers.add(handler)
      return () => { this.wildcardHandlers.delete(handler) }
    }

    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)

    return () => { this.handlers.get(type)?.delete(handler) }
  }

  once(type: ZenoEventType, handler: EventHandler): void {
    const unsub = this.on(type, (event) => {
      unsub()
      return handler(event)
    })
  }

  emit(event: ZenoEvent): void {
    const handlers = this.handlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        this.safeCall(handler, event)
      }
    }
    for (const handler of this.wildcardHandlers) {
      this.safeCall(handler, event)
    }
  }

  private safeCall(handler: EventHandler, event: ZenoEvent): void {
    try {
      const result = handler(event)
      if (result && typeof result.catch === 'function') {
        result.catch((err: unknown) => {
          logWarn({
            layer: 'orchestrator',
            category: 'event_handler_error',
            message: `Async event handler failed for ${event.type}`,
            context: { traceId: event.traceId },
            error: err,
          })
        })
      }
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'event_handler_error',
        message: `Event handler failed for ${event.type}`,
        context: { traceId: event.traceId },
        error: err,
      })
    }
  }
}

export const eventBus = new EventBus()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/events/event-bus.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/events/types.ts lib/events/event-bus.ts __tests__/lib/events/event-bus.test.ts
git commit -m "feat: add typed event bus with 12 lifecycle event types"
```

---

### Task 3: Cost calculator subscriber

**Files:**
- Create: `lib/events/cost-subscriber.ts`
- Test: `__tests__/lib/events/cost-subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/events/cost-subscriber.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerCostSubscriber, getTurnCost } from '@/lib/events/cost-subscriber'
import type { ZenoEvent } from '@/lib/events/types'

// Mock Prisma ModelCatalog lookup
vi.mock('@/lib/db', () => ({
  prisma: {
    modelCatalog: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'
const mockFindFirst = vi.mocked(prisma.modelCatalog.findFirst)

describe('CostSubscriber', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
    vi.clearAllMocks()
    registerCostSubscriber(bus)
  })

  const emitTurnStart = (traceId: string) => {
    bus.emit({ type: 'turn:start', traceId, conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
  }

  const emitLlmEnd = (traceId: string, provider: string, model: string, inputTokens: number, outputTokens: number) => {
    bus.emit({ type: 'llm:call:end', traceId, provider, model, inputTokens, outputTokens, durationMs: 500 })
  }

  const emitTurnEnd = (traceId: string) => {
    bus.emit({ type: 'turn:end', traceId, conversationId: 'conv-1', cost: null, latencyMs: 1000, anomalies: [] })
  }

  it('calculates cost from ModelCatalog pricing', async () => {
    mockFindFirst.mockResolvedValue({
      id: '1', provider: 'OPENAI', modelId: 'gpt-5.4', displayName: 'GPT-5.4',
      supportsStreaming: true, supportsTools: true,
      costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03,
      contextWindow: 128000,
    } as any)

    emitTurnStart('trace-1')
    emitLlmEnd('trace-1', 'OPENAI', 'gpt-5.4', 1000, 500)

    // Allow async ModelCatalog lookup to resolve
    await vi.waitFor(() => {
      const cost = getTurnCost('trace-1')
      expect(cost).not.toBeNull()
    })

    const cost = getTurnCost('trace-1')
    // (1000/1000 * 0.01) + (500/1000 * 0.03) = 0.01 + 0.015 = 0.025
    expect(cost).toBeCloseTo(0.025)
  })

  it('accumulates cost across multiple LLM calls in same turn', async () => {
    mockFindFirst.mockResolvedValue({
      id: '1', provider: 'OPENAI', modelId: 'gpt-5.4', displayName: 'GPT-5.4',
      supportsStreaming: true, supportsTools: true,
      costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03,
      contextWindow: 128000,
    } as any)

    emitTurnStart('trace-2')
    emitLlmEnd('trace-2', 'OPENAI', 'gpt-5.4', 1000, 500)
    emitLlmEnd('trace-2', 'OPENAI', 'gpt-5.4', 2000, 100)

    await vi.waitFor(() => {
      const cost = getTurnCost('trace-2')
      expect(cost).not.toBeNull()
      // Call 1: (1000/1000 * 0.01) + (500/1000 * 0.03) = 0.025
      // Call 2: (2000/1000 * 0.01) + (100/1000 * 0.03) = 0.023
      // Total: 0.048
      expect(cost).toBeCloseTo(0.048)
    })
  })

  it('returns null when model not in catalog', async () => {
    mockFindFirst.mockResolvedValue(null)

    emitTurnStart('trace-3')
    emitLlmEnd('trace-3', 'UNKNOWN', 'unknown-model', 1000, 500)

    // Give time for async lookup
    await new Promise((r) => setTimeout(r, 50))

    expect(getTurnCost('trace-3')).toBeNull()
  })

  it('cleans up state on turn:end', async () => {
    mockFindFirst.mockResolvedValue({
      id: '1', provider: 'OPENAI', modelId: 'gpt-5.4', displayName: 'GPT-5.4',
      supportsStreaming: true, supportsTools: true,
      costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03,
      contextWindow: 128000,
    } as any)

    emitTurnStart('trace-4')
    emitLlmEnd('trace-4', 'OPENAI', 'gpt-5.4', 1000, 500)

    await vi.waitFor(() => {
      expect(getTurnCost('trace-4')).not.toBeNull()
    })

    emitTurnEnd('trace-4')
    expect(getTurnCost('trace-4')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/cost-subscriber.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cost subscriber**

Create `lib/events/cost-subscriber.ts`:

```typescript
import type { EventBus } from './event-bus'
import type { ZenoEvent } from './types'
import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/cache/lru-cache'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// PRICING CACHE
// ==============================================

interface ModelPricing {
  costPer1kInputTokens: number
  costPer1kOutputTokens: number
}

const pricingCache = new LRUCache<string, ModelPricing | null>(50, 5 * 60 * 1000) // 50 entries, 5 min TTL

async function getModelPricing(provider: string, model: string): Promise<ModelPricing | null> {
  const key = `${provider}:${model}`
  const cached = pricingCache.get(key)
  if (cached !== undefined) return cached

  try {
    const catalog = await prisma.modelCatalog.findFirst({
      where: { provider, modelId: model },
      select: { costPer1kInputTokens: true, costPer1kOutputTokens: true },
    })

    if (!catalog || catalog.costPer1kInputTokens === null || catalog.costPer1kOutputTokens === null) {
      pricingCache.set(key, null)
      return null
    }

    const pricing: ModelPricing = {
      costPer1kInputTokens: catalog.costPer1kInputTokens,
      costPer1kOutputTokens: catalog.costPer1kOutputTokens,
    }
    pricingCache.set(key, pricing)
    return pricing
  } catch {
    return null
  }
}

// ==============================================
// TURN COST ACCUMULATOR
// ==============================================

const turnCosts = new Map<string, number>()

export function getTurnCost(traceId: string): number | null {
  return turnCosts.get(traceId) ?? null
}

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerCostSubscriber(bus: EventBus): void {
  bus.on('turn:start', (event) => {
    if (event.type !== 'turn:start') return
    turnCosts.set(event.traceId, 0)
  })

  bus.on('llm:call:end', (event) => {
    if (event.type !== 'llm:call:end') return
    const { traceId, provider, model, inputTokens, outputTokens } = event

    void getModelPricing(provider, model).then((pricing) => {
      if (!pricing) {
        logWarn({
          layer: 'orchestrator',
          category: 'cost_lookup_miss',
          message: `No pricing found for ${provider}/${model}`,
          context: { traceId, provider, model },
        })
        return
      }

      const cost =
        (inputTokens / 1000) * pricing.costPer1kInputTokens +
        (outputTokens / 1000) * pricing.costPer1kOutputTokens

      const current = turnCosts.get(traceId) ?? 0
      turnCosts.set(traceId, current + cost)
    })
  })

  bus.on('turn:end', (event) => {
    if (event.type !== 'turn:end') return
    // Delay cleanup to allow getTurnCost() to be called after turn:end
    setTimeout(() => turnCosts.delete(event.traceId), 1000)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/events/cost-subscriber.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/events/cost-subscriber.ts __tests__/lib/events/cost-subscriber.test.ts
git commit -m "feat: add cost calculator subscriber with ModelCatalog pricing"
```

---

### Task 4: Anomaly detector subscriber

**Files:**
- Create: `lib/events/anomaly-subscriber.ts`
- Test: `__tests__/lib/events/anomaly-subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/events/anomaly-subscriber.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerAnomalySubscriber, getTurnAnomalies, RollingStats } from '@/lib/events/anomaly-subscriber'

describe('AnomalySubscriber', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
    registerAnomalySubscriber(bus)
  })

  const emitTurnStart = (traceId: string) => {
    bus.emit({ type: 'turn:start', traceId, conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
  }

  // --- Latency anomalies ---

  it('flags turn latency > 30s as warning', () => {
    emitTurnStart('t1')
    bus.emit({ type: 'turn:end', traceId: 't1', conversationId: 'conv-1', cost: null, latencyMs: 35000, anomalies: [] })

    const anomalies = getTurnAnomalies('t1')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'latency', severity: 'warning',
    }))
  })

  it('flags turn latency > 60s as critical', () => {
    emitTurnStart('t2')
    bus.emit({ type: 'turn:end', traceId: 't2', conversationId: 'conv-1', cost: null, latencyMs: 65000, anomalies: [] })

    const anomalies = getTurnAnomalies('t2')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'latency', severity: 'critical',
    }))
  })

  it('flags phase > 10s as warning', () => {
    emitTurnStart('t3')
    bus.emit({ type: 'phase:end', traceId: 't3', phase: 'llm_tools', durationMs: 12000 })

    const anomalies = getTurnAnomalies('t3')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'latency', severity: 'warning', metadata: expect.objectContaining({ phase: 'llm_tools' }),
    }))
  })

  it('flags LLM call > 20s as warning', () => {
    emitTurnStart('t4')
    bus.emit({ type: 'llm:call:end', traceId: 't4', provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 1000, outputTokens: 500, durationMs: 22000 })

    const anomalies = getTurnAnomalies('t4')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'latency', severity: 'warning',
    }))
  })

  // --- Cost anomalies ---

  it('flags turn cost > $0.50 as warning', () => {
    emitTurnStart('t5')
    bus.emit({ type: 'turn:end', traceId: 't5', conversationId: 'conv-1', cost: 0.75, latencyMs: 1000, anomalies: [] })

    const anomalies = getTurnAnomalies('t5')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'cost', severity: 'warning',
    }))
  })

  it('flags turn cost > $2.00 as critical', () => {
    emitTurnStart('t6')
    bus.emit({ type: 'turn:end', traceId: 't6', conversationId: 'conv-1', cost: 2.50, latencyMs: 1000, anomalies: [] })

    const anomalies = getTurnAnomalies('t6')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'cost', severity: 'critical',
    }))
  })

  it('flags LLM call with > 50k output tokens as warning', () => {
    emitTurnStart('t7')
    bus.emit({ type: 'llm:call:end', traceId: 't7', provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 1000, outputTokens: 55000, durationMs: 5000 })

    const anomalies = getTurnAnomalies('t7')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'cost', severity: 'warning',
    }))
  })

  // --- Error pattern anomalies ---

  it('flags > 2 tool failures as warning', () => {
    emitTurnStart('t8')
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'a', durationMs: 100, success: false, cached: false })
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'b', durationMs: 100, success: false, cached: false })
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'c', durationMs: 100, success: false, cached: false })

    const anomalies = getTurnAnomalies('t8')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'error_pattern', severity: 'warning',
    }))
  })

  it('flags LLM retry (same agentSlug called 2+ times) as info', () => {
    emitTurnStart('t9')
    bus.emit({ type: 'llm:call:start', traceId: 't9', provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    bus.emit({ type: 'llm:call:start', traceId: 't9', provider: 'ANTHROPIC', model: 'claude-4', agentSlug: 'main-chat' })

    const anomalies = getTurnAnomalies('t9')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'error_pattern', severity: 'info',
    }))
  })

  // --- Behavioral anomalies ---

  it('flags compliance failure as warning', () => {
    emitTurnStart('t10')
    bus.emit({ type: 'compliance:result', traceId: 't10', passed: false, gaps: ['needs_identification'], conversationId: 'conv-1' })

    const anomalies = getTurnAnomalies('t10')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'behavioral', severity: 'warning',
    }))
  })

  it('flags tool call count > 8 as warning', () => {
    emitTurnStart('t11')
    for (let i = 0; i < 9; i++) {
      bus.emit({ type: 'tool:end', traceId: 't11', toolName: `tool-${i}`, durationMs: 50, success: true, cached: false })
    }

    const anomalies = getTurnAnomalies('t11')
    expect(anomalies).toContainEqual(expect.objectContaining({
      type: 'behavioral', severity: 'warning',
    }))
  })

  it('cleans up on turn:end', () => {
    emitTurnStart('t12')
    bus.emit({ type: 'phase:end', traceId: 't12', phase: 'slow', durationMs: 15000 })

    expect(getTurnAnomalies('t12').length).toBeGreaterThan(0)

    bus.emit({ type: 'turn:end', traceId: 't12', conversationId: 'conv-1', cost: null, latencyMs: 1000, anomalies: [] })

    // After cleanup delay
    expect(getTurnAnomalies('t12')).toEqual([])
  })
})

describe('RollingStats', () => {
  it('computes mean', () => {
    const stats = new RollingStats(10)
    stats.push(10)
    stats.push(20)
    stats.push(30)
    expect(stats.mean()).toBe(20)
  })

  it('computes p95', () => {
    const stats = new RollingStats(100)
    for (let i = 1; i <= 100; i++) {
      stats.push(i)
    }
    expect(stats.p95()).toBe(95)
  })

  it('evicts oldest values when at capacity', () => {
    const stats = new RollingStats(3)
    stats.push(100)
    stats.push(200)
    stats.push(300)
    stats.push(10) // evicts 100
    expect(stats.mean()).toBeCloseTo(170) // (200 + 300 + 10) / 3
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/anomaly-subscriber.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement anomaly subscriber**

Create `lib/events/anomaly-subscriber.ts`:

```typescript
import type { EventBus } from './event-bus'
import type { Anomaly } from './types'

// ==============================================
// ROLLING STATS
// ==============================================

export class RollingStats {
  private values: number[] = []

  constructor(private readonly maxSize: number = 200) {}

  push(value: number): void {
    if (this.values.length >= this.maxSize) {
      this.values.shift()
    }
    this.values.push(value)
  }

  mean(): number {
    if (this.values.length === 0) return 0
    return this.values.reduce((a, b) => a + b, 0) / this.values.length
  }

  p95(): number {
    if (this.values.length === 0) return 0
    const sorted = [...this.values].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.95) - 1
    return sorted[Math.max(0, idx)]
  }
}

// ==============================================
// PER-TURN STATE
// ==============================================

const turnAnomalies = new Map<string, Anomaly[]>()
const turnToolFailures = new Map<string, number>()
const turnToolCalls = new Map<string, number>()
const turnLlmStarts = new Map<string, Map<string, number>>()

// Per-mode rolling latency stats (for future relative thresholds)
const _rollingLatency = new Map<string, RollingStats>()

// ==============================================
// HELPERS
// ==============================================

function addAnomaly(traceId: string, anomaly: Anomaly): void {
  if (!turnAnomalies.has(traceId)) {
    turnAnomalies.set(traceId, [])
  }
  turnAnomalies.get(traceId)!.push(anomaly)
}

// ==============================================
// PUBLIC API
// ==============================================

export function getTurnAnomalies(traceId: string): Anomaly[] {
  return turnAnomalies.get(traceId) ?? []
}

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerAnomalySubscriber(bus: EventBus): void {
  bus.on('turn:start', (event) => {
    if (event.type !== 'turn:start') return
    turnAnomalies.set(event.traceId, [])
    turnToolFailures.set(event.traceId, 0)
    turnToolCalls.set(event.traceId, 0)
    turnLlmStarts.set(event.traceId, new Map())
  })

  // --- Phase latency ---
  bus.on('phase:end', (event) => {
    if (event.type !== 'phase:end') return
    if (event.durationMs > 10_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `Phase "${event.phase}" took ${event.durationMs}ms (>10s)`,
        metadata: { phase: event.phase, durationMs: event.durationMs },
      })
    }
  })

  // --- LLM call anomalies ---
  bus.on('llm:call:start', (event) => {
    if (event.type !== 'llm:call:start') return
    const slugMap = turnLlmStarts.get(event.traceId)
    if (!slugMap) return
    const count = (slugMap.get(event.agentSlug) ?? 0) + 1
    slugMap.set(event.agentSlug, count)

    if (count === 2) {
      addAnomaly(event.traceId, {
        type: 'error_pattern',
        severity: 'info',
        message: `LLM retry detected for agent "${event.agentSlug}"`,
        metadata: { agentSlug: event.agentSlug, callCount: count },
      })
    }
  })

  bus.on('llm:call:end', (event) => {
    if (event.type !== 'llm:call:end') return
    if (event.durationMs > 20_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `LLM call took ${event.durationMs}ms (>20s)`,
        metadata: { provider: event.provider, model: event.model, durationMs: event.durationMs },
      })
    }
    if (event.outputTokens > 50_000) {
      addAnomaly(event.traceId, {
        type: 'cost',
        severity: 'warning',
        message: `LLM call produced ${event.outputTokens} output tokens (>50k)`,
        metadata: { provider: event.provider, model: event.model, outputTokens: event.outputTokens },
      })
    }
  })

  // --- Tool anomalies ---
  bus.on('tool:end', (event) => {
    if (event.type !== 'tool:end') return
    const calls = (turnToolCalls.get(event.traceId) ?? 0) + 1
    turnToolCalls.set(event.traceId, calls)

    if (!event.success) {
      const failures = (turnToolFailures.get(event.traceId) ?? 0) + 1
      turnToolFailures.set(event.traceId, failures)

      if (failures === 3) {
        addAnomaly(event.traceId, {
          type: 'error_pattern',
          severity: 'warning',
          message: `${failures} tool failures in this turn`,
          metadata: { failureCount: failures },
        })
      }
    }

    if (calls === 9) {
      addAnomaly(event.traceId, {
        type: 'behavioral',
        severity: 'warning',
        message: `${calls} tool calls in this turn (>8)`,
        metadata: { toolCallCount: calls },
      })
    }
  })

  // --- Compliance anomalies ---
  bus.on('compliance:result', (event) => {
    if (event.type !== 'compliance:result') return
    if (!event.passed) {
      addAnomaly(event.traceId, {
        type: 'behavioral',
        severity: 'warning',
        message: `Compliance check failed: ${event.gaps.join(', ')}`,
        metadata: { gaps: event.gaps },
      })
    }
  })

  // --- Turn-level anomalies (evaluated on turn:end) ---
  bus.on('turn:end', (event) => {
    if (event.type !== 'turn:end') return

    // Latency thresholds
    if (event.latencyMs > 60_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'critical',
        message: `Turn took ${event.latencyMs}ms (>60s)`,
        metadata: { latencyMs: event.latencyMs },
      })
    } else if (event.latencyMs > 30_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `Turn took ${event.latencyMs}ms (>30s)`,
        metadata: { latencyMs: event.latencyMs },
      })
    }

    // Cost thresholds
    if (event.cost !== null) {
      if (event.cost > 2.00) {
        addAnomaly(event.traceId, {
          type: 'cost',
          severity: 'critical',
          message: `Turn cost $${event.cost.toFixed(3)} (>$2.00)`,
          metadata: { cost: event.cost },
        })
      } else if (event.cost > 0.50) {
        addAnomaly(event.traceId, {
          type: 'cost',
          severity: 'warning',
          message: `Turn cost $${event.cost.toFixed(3)} (>$0.50)`,
          metadata: { cost: event.cost },
        })
      }
    }

    // Cleanup after a delay (let getTurnAnomalies() be called first)
    setTimeout(() => {
      turnAnomalies.delete(event.traceId)
      turnToolFailures.delete(event.traceId)
      turnToolCalls.delete(event.traceId)
      turnLlmStarts.delete(event.traceId)
    }, 1000)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/events/anomaly-subscriber.test.ts`
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/events/anomaly-subscriber.ts __tests__/lib/events/anomaly-subscriber.test.ts
git commit -m "feat: add anomaly detector with threshold rules and RollingStats"
```

---

### Task 5: Sentry integration — logger transport

**Files:**
- Modify: `lib/errors/logger.ts`
- Modify: `sentry.server.config.ts`
- Test: `__tests__/lib/events/sentry-subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/events/sentry-subscriber.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Sentry before importing logger
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'

const mockCapture = vi.mocked(Sentry.captureException)

describe('Sentry Logger Transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate SENTRY_DSN being set
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
  })

  afterEach(() => {
    delete process.env.SENTRY_DSN
  })

  it('sends errors to Sentry with correct tags', () => {
    const errorId = logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Provider timeout',
      context: { provider: 'OPENAI' },
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [exception, options] = mockCapture.mock.calls[0]
    expect(exception).toBeInstanceOf(Error)
    expect((exception as Error).message).toBe('Provider timeout')
    expect(options).toEqual(expect.objectContaining({
      tags: { layer: 'gateway', category: 'transient', errorId },
      level: 'error',
    }))
    expect(options?.extra).toEqual(expect.objectContaining({ provider: 'OPENAI' }))
  })

  it('sends fatals to Sentry with fatal level', () => {
    logFatal({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Database unreachable',
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [, options] = mockCapture.mock.calls[0]
    expect(options?.level).toBe('fatal')
  })

  it('does NOT send warnings to Sentry', () => {
    logWarn({
      layer: 'tool',
      category: 'validation',
      message: 'Invalid argument',
    })

    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('uses original Error object when provided', () => {
    const originalError = new Error('original')
    logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Wrapped error',
      error: originalError,
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [exception] = mockCapture.mock.calls[0]
    expect(exception).toBe(originalError)
  })

  it('skips Sentry when SENTRY_DSN is not set', () => {
    delete process.env.SENTRY_DSN
    logError({
      layer: 'gateway',
      category: 'transient',
      message: 'No DSN',
    })

    expect(mockCapture).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/sentry-subscriber.test.ts`
Expected: FAIL — Sentry.captureException never called (logger doesn't have Sentry transport yet)

- [ ] **Step 3: Add Sentry transport to structured logger**

Modify `lib/errors/logger.ts` — add import and Sentry call inside `emitLog()`:

Add at top of file after existing imports:
```typescript
import * as Sentry from '@sentry/nextjs'
```

Replace the `emitLog` function body (lines 33-52) — add Sentry transport after `console.error`:

```typescript
function emitLog(severity: ErrorSeverity, input: ErrorInput): string {
  const errorId = nanoid(12)

  const entry: ErrorEntry = {
    errorId,
    severity,
    layer: input.layer,
    category: input.category,
    context: input.context ?? {},
    message: input.message,
    timestamp: new Date().toISOString(),
  }

  if (input.error instanceof Error) {
    entry.stack = input.error.stack
  }

  console.error(JSON.stringify(entry))

  // Sentry transport: send errors and fatals
  if ((severity === 'error' || severity === 'fatal') && process.env.SENTRY_DSN) {
    try {
      Sentry.captureException(
        input.error instanceof Error ? input.error : new Error(input.message),
        {
          tags: { layer: input.layer, category: input.category, errorId },
          extra: input.context ?? {},
          level: severity === 'fatal' ? 'fatal' : 'error',
        },
      )
    } catch {
      // Sentry transport failure must never break the logger
    }
  }

  return errorId
}
```

- [ ] **Step 4: Update Sentry server config**

Replace `sentry.server.config.ts`:

```typescript
import * as Sentry from '@sentry/nextjs'

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    skipOpenTelemetrySetup: true, // we manage OTel ourselves via otel-setup.ts
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/events/sentry-subscriber.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/errors/logger.ts sentry.server.config.ts __tests__/lib/events/sentry-subscriber.test.ts
git commit -m "feat: add Sentry transport to structured logger for error/fatal"
```

---

### Task 6: OpenTelemetry setup and span subscriber

**Files:**
- Create: `lib/events/otel-setup.ts`
- Create: `lib/events/otel-subscriber.ts`
- Test: `__tests__/lib/events/otel-subscriber.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/events/otel-subscriber.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerOtelSubscriber } from '@/lib/events/otel-subscriber'

// Mock OTel API
const mockStartSpan = vi.fn()
const mockEndSpan = vi.fn()
const mockSetAttribute = vi.fn()
const mockAddEvent = vi.fn()
const mockSpan = {
  end: mockEndSpan,
  setAttribute: mockSetAttribute,
  addEvent: mockAddEvent,
}

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: mockStartSpan.mockReturnValue(mockSpan),
    }),
  },
  context: {
    active: () => ({}),
    with: (_ctx: any, fn: () => any) => fn(),
  },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}))

describe('OtelSubscriber', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
    vi.clearAllMocks()
    registerOtelSubscriber(bus)
  })

  it('creates root span on turn:start', () => {
    bus.emit({ type: 'turn:start', traceId: 't1', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })

    expect(mockStartSpan).toHaveBeenCalledWith('zeno.turn', expect.objectContaining({
      attributes: expect.objectContaining({ 'zeno.conversationId': 'conv-1', 'zeno.messageIndex': 0 }),
    }))
  })

  it('creates child span on phase:start and ends on phase:end', () => {
    bus.emit({ type: 'turn:start', traceId: 't2', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
    mockStartSpan.mockClear()

    bus.emit({ type: 'phase:start', traceId: 't2', phase: 'reasoning_gate', timestamp: Date.now() })
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.phase.reasoning_gate', expect.any(Object))

    bus.emit({ type: 'phase:end', traceId: 't2', phase: 'reasoning_gate', durationMs: 150 })
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.durationMs', 150)
    expect(mockEndSpan).toHaveBeenCalled()
  })

  it('creates LLM span on llm:call:start and ends on llm:call:end', () => {
    bus.emit({ type: 'turn:start', traceId: 't3', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
    bus.emit({ type: 'phase:start', traceId: 't3', phase: 'llm_tools', timestamp: Date.now() })
    mockStartSpan.mockClear()

    bus.emit({ type: 'llm:call:start', traceId: 't3', provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.llm.OPENAI.gpt-5.4', expect.any(Object))

    bus.emit({ type: 'llm:call:end', traceId: 't3', provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 1000, outputTokens: 500, durationMs: 800 })
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.inputTokens', 1000)
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.outputTokens', 500)
    expect(mockEndSpan).toHaveBeenCalled()
  })

  it('creates tool span on tool:start and ends on tool:end', () => {
    bus.emit({ type: 'turn:start', traceId: 't4', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
    bus.emit({ type: 'phase:start', traceId: 't4', phase: 'llm_tools', timestamp: Date.now() })
    mockStartSpan.mockClear()

    bus.emit({ type: 'tool:start', traceId: 't4', toolName: 'get_product_info', args: { id: '1' } })
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.tool.get_product_info', expect.any(Object))

    bus.emit({ type: 'tool:end', traceId: 't4', toolName: 'get_product_info', durationMs: 50, success: true, cached: true })
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.success', true)
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.cached', true)
    expect(mockEndSpan).toHaveBeenCalled()
  })

  it('adds span events for business events', () => {
    bus.emit({ type: 'turn:start', traceId: 't5', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })

    bus.emit({ type: 'mode:transition', traceId: 't5', from: 'SALES', to: 'SUPPORT', conversationId: 'conv-1' })
    expect(mockAddEvent).toHaveBeenCalledWith('mode.transition', expect.objectContaining({ from: 'SALES', to: 'SUPPORT' }))

    bus.emit({ type: 'skillpack:activated', traceId: 't5', slugs: ['post-sale-support'], conversationId: 'conv-1' })
    expect(mockAddEvent).toHaveBeenCalledWith('skillpack.activated', expect.objectContaining({ slugs: 'post-sale-support' }))

    bus.emit({ type: 'compliance:result', traceId: 't5', passed: true, gaps: [], conversationId: 'conv-1' })
    expect(mockAddEvent).toHaveBeenCalledWith('compliance.result', expect.objectContaining({ passed: true }))
  })

  it('ends root span and cleans up on turn:end', () => {
    bus.emit({ type: 'turn:start', traceId: 't6', conversationId: 'conv-1', messageIndex: 0, timestamp: Date.now() })
    mockEndSpan.mockClear()

    bus.emit({ type: 'turn:end', traceId: 't6', conversationId: 'conv-1', cost: 0.05, latencyMs: 1200, anomalies: [] })

    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.cost', 0.05)
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.latencyMs', 1200)
    expect(mockEndSpan).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/events/otel-subscriber.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create OTel setup (lazy initialization)**

Create `lib/events/otel-setup.ts`:

```typescript
let initialized = false

export function initOtel(): void {
  if (initialized) return
  if (process.env.OTEL_ENABLED !== 'true') return

  try {
    // Lazy require — OTel SDK only loaded when enabled (~1.1MB)
    const { NodeSDK } = require('@opentelemetry/sdk-node')
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
    const { Resource } = require('@opentelemetry/resources')
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions')

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'zeno-agent',
    })

    const traceExporter = new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'}/v1/traces`,
    })

    const spanProcessors: any[] = []

    // Bridge OTel spans to Sentry if Sentry DSN is configured
    if (process.env.SENTRY_DSN) {
      try {
        const { SentrySpanProcessor } = require('@sentry/opentelemetry')
        spanProcessors.push(new SentrySpanProcessor())
      } catch {
        // @sentry/opentelemetry not available — skip Sentry bridge
      }
    }

    const sdk = new NodeSDK({
      resource,
      traceExporter,
      spanProcessors,
    })

    sdk.start()
    initialized = true
  } catch (err) {
    console.error('[otel-setup] Failed to initialize OpenTelemetry:', err)
  }
}
```

- [ ] **Step 4: Create OTel subscriber**

Create `lib/events/otel-subscriber.ts`:

```typescript
import { trace, context, type Span, SpanStatusCode } from '@opentelemetry/api'
import type { EventBus } from './event-bus'
import type { ZenoEvent } from './types'

// ==============================================
// SPAN TRACKING
// ==============================================

interface TraceState {
  root: Span
  phases: Map<string, Span>
  llmSpans: Map<string, Span>    // key: `${provider}:${model}` (last active)
  toolSpans: Map<string, Span>   // key: toolName (last active)
  createdAt: number
}

const activeTraces = new Map<string, TraceState>()

const STALE_TRACE_MS = 2 * 60 * 1000 // 2 minutes

// Periodic cleanup of stale traces (crashed pipelines)
setInterval(() => {
  const now = Date.now()
  for (const [traceId, state] of activeTraces) {
    if (now - state.createdAt > STALE_TRACE_MS) {
      state.root.end()
      activeTraces.delete(traceId)
    }
  }
}, 5 * 60 * 1000) // Every 5 minutes

// ==============================================
// HELPERS
// ==============================================

function getTracer() {
  return trace.getTracer('zeno-agent')
}

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerOtelSubscriber(bus: EventBus): void {
  bus.on('*', (event: ZenoEvent) => {
    switch (event.type) {
      case 'turn:start': {
        const span = getTracer().startSpan('zeno.turn', {
          attributes: {
            'zeno.traceId': event.traceId,
            'zeno.conversationId': event.conversationId,
            'zeno.messageIndex': event.messageIndex,
          },
        })
        activeTraces.set(event.traceId, {
          root: span,
          phases: new Map(),
          llmSpans: new Map(),
          toolSpans: new Map(),
          createdAt: Date.now(),
        })
        break
      }

      case 'phase:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const span = getTracer().startSpan(`zeno.phase.${event.phase}`, {
          attributes: { 'zeno.phase': event.phase },
        })
        ts.phases.set(event.phase, span)
        break
      }

      case 'phase:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.phases.get(event.phase)
        if (!span) return
        span.setAttribute('zeno.durationMs', event.durationMs)
        if (event.metadata) {
          for (const [k, v] of Object.entries(event.metadata)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              span.setAttribute(`zeno.${k}`, v)
            }
          }
        }
        span.end()
        ts!.phases.delete(event.phase)
        break
      }

      case 'llm:call:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const spanName = `zeno.llm.${event.provider}.${event.model}`
        const span = getTracer().startSpan(spanName, {
          attributes: {
            'zeno.provider': event.provider,
            'zeno.model': event.model,
            'zeno.agentSlug': event.agentSlug,
          },
        })
        ts.llmSpans.set(`${event.provider}:${event.model}`, span)
        break
      }

      case 'llm:call:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.llmSpans.get(`${event.provider}:${event.model}`)
        if (!span) return
        span.setAttribute('zeno.inputTokens', event.inputTokens)
        span.setAttribute('zeno.outputTokens', event.outputTokens)
        span.setAttribute('zeno.durationMs', event.durationMs)
        span.end()
        ts!.llmSpans.delete(`${event.provider}:${event.model}`)
        break
      }

      case 'tool:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const span = getTracer().startSpan(`zeno.tool.${event.toolName}`, {
          attributes: { 'zeno.toolName': event.toolName },
        })
        ts.toolSpans.set(event.toolName, span)
        break
      }

      case 'tool:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.toolSpans.get(event.toolName)
        if (!span) return
        span.setAttribute('zeno.durationMs', event.durationMs)
        span.setAttribute('zeno.success', event.success)
        span.setAttribute('zeno.cached', event.cached)
        if (!event.success) {
          span.setStatus({ code: SpanStatusCode.ERROR })
        }
        span.end()
        ts!.toolSpans.delete(event.toolName)
        break
      }

      case 'mode:transition': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('mode.transition', { from: event.from, to: event.to })
        break
      }

      case 'skillpack:activated': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('skillpack.activated', { slugs: event.slugs.join(',') })
        break
      }

      case 'skillpack:deactivated': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('skillpack.deactivated', { slugs: event.slugs.join(',') })
        break
      }

      case 'compliance:result': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('compliance.result', {
          passed: event.passed,
          gaps: event.gaps.join(','),
        })
        break
      }

      case 'turn:end': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        if (event.cost !== null) ts.root.setAttribute('zeno.cost', event.cost)
        ts.root.setAttribute('zeno.latencyMs', event.latencyMs)
        ts.root.setAttribute('zeno.anomalyCount', event.anomalies.length)
        ts.root.end()
        activeTraces.delete(event.traceId)
        break
      }
    }
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/events/otel-subscriber.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/events/otel-setup.ts lib/events/otel-subscriber.ts __tests__/lib/events/otel-subscriber.test.ts
git commit -m "feat: add OpenTelemetry span subscriber with lazy SDK init"
```

---

### Task 7: PostHog enrichment

**Files:**
- Modify: `lib/analytics/events.ts`

- [ ] **Step 1: Add enrichEventProps helper**

Add at the top of `lib/analytics/events.ts`, after existing imports:

```typescript
import { getTurnCost } from '@/lib/events/cost-subscriber'
```

Add before the existing `trackChatStarted` function:

```typescript
// ==============================================
// OBSERVABILITY ENRICHMENT
// ==============================================

export function enrichEventProps(
  traceId: string | null,
  base: Record<string, unknown>,
): Record<string, unknown> {
  if (!traceId) return base
  const turnCost = getTurnCost(traceId)
  return {
    ...base,
    ...(turnCost !== null ? { turnCost } : {}),
  }
}
```

- [ ] **Step 2: Update existing funnel event calls to accept optional enrichment params**

Update `trackChatStarted` to accept optional enrichment:

```typescript
export function trackChatStarted(
  customerId: string,
  enrichment?: { conversationMode?: string; activeSkillPacks?: string[]; traceId?: string },
) {
  trackEvent(customerId, 'chat_started', enrichEventProps(
    enrichment?.traceId ?? null,
    {
      ...(enrichment?.conversationMode ? { conversationMode: enrichment.conversationMode } : {}),
      ...(enrichment?.activeSkillPacks ? { activeSkillPacks: enrichment.activeSkillPacks } : {}),
    },
  ))
}
```

The remaining funnel events (`trackProductSelected`, `trackQuoteGenerated`, etc.) follow the same pattern — add an optional `enrichment` parameter and wrap properties with `enrichEventProps()`. The existing call signatures remain backward-compatible since `enrichment` is optional.

- [ ] **Step 3: Commit**

```bash
git add lib/analytics/events.ts
git commit -m "feat: add PostHog enrichment with cost and observability data"
```

---

### Task 8: Barrel export and initObservability

**Files:**
- Create: `lib/events/index.ts`

- [ ] **Step 1: Create barrel export with initialization function**

Create `lib/events/index.ts`:

```typescript
export { eventBus, EventBus } from './event-bus'
export type { ZenoEvent, ZenoEventType, EventHandler, Anomaly } from './types'
export { getTurnCost } from './cost-subscriber'
export { getTurnAnomalies, RollingStats } from './anomaly-subscriber'
export { initOtel } from './otel-setup'

import { eventBus } from './event-bus'
import { registerCostSubscriber } from './cost-subscriber'
import { registerAnomalySubscriber } from './anomaly-subscriber'
import { registerOtelSubscriber } from './otel-subscriber'
import { initOtel } from './otel-setup'

let initialized = false

export function initObservability(): void {
  if (initialized) return
  initialized = true

  // Initialize OTel SDK (lazy, only when OTEL_ENABLED=true)
  initOtel()

  // Register all subscribers on the shared event bus
  registerCostSubscriber(eventBus)
  registerAnomalySubscriber(eventBus)

  // OTel subscriber only if tracing is enabled
  if (process.env.OTEL_ENABLED === 'true') {
    registerOtelSubscriber(eventBus)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/events/index.ts
git commit -m "feat: add initObservability barrel export for event subscribers"
```

---

### Task 9: Orchestrator instrumentation

**Files:**
- Modify: `lib/chat/orchestrator.ts`
- Modify: `lib/llm/gateway.ts`
- Modify: `lib/tools/executor.ts`

This is the largest task — wiring emit calls into the existing pipeline. No new tests here because the integration test (Task 10) covers the full flow.

- [ ] **Step 1: Add traceId to TurnState and imports in orchestrator**

In `lib/chat/orchestrator.ts`:

Add import at top (after existing imports):
```typescript
import { eventBus, initObservability, getTurnCost, getTurnAnomalies } from '@/lib/events'
```

Add `traceId` field to the `TurnState` interface (after `startMs`):
```typescript
  traceId: string
```

- [ ] **Step 2: Initialize observability and generate traceId at pipeline start**

In the orchestrator's main generator function, at the very beginning where TurnState is initialized, add:

```typescript
initObservability()
```

When initializing TurnState, add:
```typescript
traceId: crypto.randomUUID(),
```

Right after TurnState initialization, emit `turn:start`:
```typescript
eventBus.emit({
  type: 'turn:start',
  traceId: state.traceId,
  conversationId: state.conversationId,
  messageIndex: state.messageCount,
  timestamp: state.startMs,
})
```

- [ ] **Step 3: Add phase:start/phase:end emit calls around each pipeline step**

For each of the 10 steps, wrap the existing phase timing with emit calls. Pattern for each step:

```typescript
// Before step timing:
eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'step_name', timestamp: Date.now() })

// ... existing step code ...

// After step timing (existing `state.phases['stepN_name'] = Date.now() - stepNStart`):
eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'step_name', durationMs: Date.now() - stepNStart })
```

Apply to steps: `resolve` (Step 1), `save_user` (Step 2), `reasoning_gate` (Step 3), `context` (Step 4), `token_budget` (Step 4b), `sliding_window` (Step 5), `build_messages` (Step 6), `llm_tools` (Step 7), `save_assistant` (Step 8), `background` (Step 9), `trace` (Step 10).

- [ ] **Step 4: Add business event emits**

After the reasoning gate processes a mode transition:
```typescript
if (/* mode changed */) {
  eventBus.emit({
    type: 'mode:transition',
    traceId: state.traceId,
    from: previousMode,
    to: state.conversationMode,
    conversationId: state.conversationId,
  })
}
```

After skill packs are loaded/changed:
```typescript
if (newPacks.length > 0) {
  eventBus.emit({
    type: 'skillpack:activated',
    traceId: state.traceId,
    slugs: newPacks,
    conversationId: state.conversationId,
  })
}
```

After compliance check completes:
```typescript
if (state.complianceResult) {
  eventBus.emit({
    type: 'compliance:result',
    traceId: state.traceId,
    passed: state.complianceResult.passed,
    gaps: state.complianceResult.gaps ?? [],
    conversationId: state.conversationId,
  })
}
```

- [ ] **Step 5: Update Step 10 (TurnTrace) to use cost and anomalies**

In the TurnTrace creation (currently at line ~1188), replace `cost: null` with:

```typescript
cost: getTurnCost(state.traceId),
anomalies: getTurnAnomalies(state.traceId).length > 0
  ? JSON.parse(JSON.stringify(getTurnAnomalies(state.traceId)))
  : undefined,
```

After TurnTrace write, emit `turn:end`:

```typescript
eventBus.emit({
  type: 'turn:end',
  traceId: state.traceId,
  conversationId: state.conversationId,
  cost: getTurnCost(state.traceId),
  latencyMs,
  anomalies: getTurnAnomalies(state.traceId),
})
```

- [ ] **Step 6: Add traceId to gateway calls**

In `lib/llm/gateway.ts`, add `traceId?: string` to the `GatewayCallOptions` interface.

In the `call()` method, emit around the LLM call:

```typescript
if (options.traceId) {
  eventBus.emit({
    type: 'llm:call:start',
    traceId: options.traceId,
    provider: agent.provider,
    model: agent.model,
    agentSlug,
  })
}

// ... existing LLM call ...

if (options.traceId) {
  eventBus.emit({
    type: 'llm:call:end',
    traceId: options.traceId,
    provider: agent.provider,
    model: agent.model,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    durationMs: Date.now() - callStart,
  })
}
```

Same pattern for the `stream()` method — emit `llm:call:start` before streaming and `llm:call:end` in the completion tracker.

Add import at top: `import { eventBus } from '@/lib/events'`

- [ ] **Step 7: Add traceId to tool executor**

In `lib/tools/executor.ts`, add `traceId?: string` to the function signature of `executeTool()`.

Add emit calls around tool execution:

```typescript
if (traceId) {
  eventBus.emit({ type: 'tool:start', traceId, toolName: name, args })
}

// ... existing execution ...

if (traceId) {
  eventBus.emit({
    type: 'tool:end',
    traceId,
    toolName: name,
    durationMs: Date.now() - execStart,
    success: result.success,
    cached: /* was cache hit */,
  })
}
```

Add import at top: `import { eventBus } from '@/lib/events'`

- [ ] **Step 8: Thread traceId through orchestrator calls to gateway and executor**

In the orchestrator, pass `state.traceId` to all gateway calls:

```typescript
// Reasoning gate call
gateway.call('reasoning-gate', { ...options, traceId: state.traceId })

// Main chat call
gateway.stream(agentSlug, { ...options, traceId: state.traceId })

// Profile extractor call
gateway.call('profile-extractor', { ...options, traceId: state.traceId })

// Compliance checker call
gateway.call('compliance-checker', { ...options, traceId: state.traceId })
```

Pass `state.traceId` to all tool executor calls:

```typescript
executeTool(tc.name, tc.arguments, toolContext, userRole, state.traceId)
```

- [ ] **Step 9: Commit**

```bash
git add lib/chat/orchestrator.ts lib/llm/gateway.ts lib/tools/executor.ts
git commit -m "feat: instrument orchestrator, gateway, and executor with event bus"
```

---

### Task 10: Integration test

**Files:**
- Test: `__tests__/lib/events/pipeline-observability.test.ts`

- [ ] **Step 1: Write integration test**

Create `__tests__/lib/events/pipeline-observability.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerCostSubscriber, getTurnCost } from '@/lib/events/cost-subscriber'
import { registerAnomalySubscriber, getTurnAnomalies } from '@/lib/events/anomaly-subscriber'
import { registerOtelSubscriber } from '@/lib/events/otel-subscriber'
import type { ZenoEvent } from '@/lib/events/types'

// Mock Prisma for cost subscriber
vi.mock('@/lib/db', () => ({
  prisma: {
    modelCatalog: {
      findFirst: vi.fn().mockResolvedValue({
        id: '1', provider: 'OPENAI', modelId: 'gpt-5.4', displayName: 'GPT-5.4',
        supportsStreaming: true, supportsTools: true,
        costPer1kInputTokens: 0.01, costPer1kOutputTokens: 0.03,
        contextWindow: 128000,
      }),
    },
  },
}))

// Mock OTel
const mockStartSpan = vi.fn()
const mockEndSpan = vi.fn()
const mockSetAttribute = vi.fn()
const mockAddEvent = vi.fn()
const mockSpan = { end: mockEndSpan, setAttribute: mockSetAttribute, addEvent: mockAddEvent }
vi.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startSpan: mockStartSpan.mockReturnValue(mockSpan) }) },
  context: { active: () => ({}), with: (_ctx: any, fn: () => any) => fn() },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}))

describe('Pipeline Observability Integration', () => {
  let bus: EventBus
  const allEvents: ZenoEvent[] = []

  beforeEach(() => {
    bus = new EventBus()
    allEvents.length = 0
    vi.clearAllMocks()

    // Register all subscribers
    registerCostSubscriber(bus)
    registerAnomalySubscriber(bus)
    registerOtelSubscriber(bus)

    // Record all events for verification
    bus.on('*', (event) => allEvents.push(event))
  })

  it('full pipeline simulation: cost calculated, anomalies detected, spans created', async () => {
    const traceId = 'integration-trace-1'

    // Simulate a full turn
    bus.emit({ type: 'turn:start', traceId, conversationId: 'conv-1', messageIndex: 5, timestamp: Date.now() })

    // Step 3: reasoning gate LLM call
    bus.emit({ type: 'phase:start', traceId, phase: 'reasoning_gate', timestamp: Date.now() })
    bus.emit({ type: 'llm:call:start', traceId, provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'reasoning-gate' })
    bus.emit({ type: 'llm:call:end', traceId, provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 500, outputTokens: 100, durationMs: 200 })
    bus.emit({ type: 'phase:end', traceId, phase: 'reasoning_gate', durationMs: 250 })

    // Skill pack activation
    bus.emit({ type: 'skillpack:activated', traceId, slugs: ['life-insurance-closing'], conversationId: 'conv-1' })

    // Step 4: compliance check
    bus.emit({ type: 'phase:start', traceId, phase: 'context', timestamp: Date.now() })
    bus.emit({ type: 'compliance:result', traceId, passed: true, gaps: [], conversationId: 'conv-1' })
    bus.emit({ type: 'phase:end', traceId, phase: 'context', durationMs: 100 })

    // Step 7: main LLM call + tool
    bus.emit({ type: 'phase:start', traceId, phase: 'llm_tools', timestamp: Date.now() })
    bus.emit({ type: 'llm:call:start', traceId, provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    bus.emit({ type: 'llm:call:end', traceId, provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 3000, outputTokens: 800, durationMs: 1500 })
    bus.emit({ type: 'tool:start', traceId, toolName: 'get_product_info', args: { code: 'protect' } })
    bus.emit({ type: 'tool:end', traceId, toolName: 'get_product_info', durationMs: 45, success: true, cached: true })
    bus.emit({ type: 'phase:end', traceId, phase: 'llm_tools', durationMs: 1600 })

    // Allow async cost lookups to resolve
    await vi.waitFor(() => {
      expect(getTurnCost(traceId)).not.toBeNull()
    })

    // Verify cost calculated
    const cost = getTurnCost(traceId)!
    // Gate call: (500/1000 * 0.01) + (100/1000 * 0.03) = 0.005 + 0.003 = 0.008
    // Main call: (3000/1000 * 0.01) + (800/1000 * 0.03) = 0.03 + 0.024 = 0.054
    // Total: 0.062
    expect(cost).toBeCloseTo(0.062)

    // Emit turn:end
    bus.emit({ type: 'turn:end', traceId, conversationId: 'conv-1', cost, latencyMs: 2500, anomalies: getTurnAnomalies(traceId) })

    // Verify no anomalies (normal turn)
    expect(getTurnAnomalies(traceId)).toEqual([])

    // Verify OTel spans created
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.turn', expect.any(Object))
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.phase.reasoning_gate', expect.any(Object))
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.phase.llm_tools', expect.any(Object))
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.llm.OPENAI.gpt-5.4', expect.any(Object))
    expect(mockStartSpan).toHaveBeenCalledWith('zeno.tool.get_product_info', expect.any(Object))

    // Verify business span events
    expect(mockAddEvent).toHaveBeenCalledWith('skillpack.activated', expect.objectContaining({ slugs: 'life-insurance-closing' }))
    expect(mockAddEvent).toHaveBeenCalledWith('compliance.result', expect.objectContaining({ passed: true }))

    // Verify root span ended with cost
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.cost', expect.closeTo(0.062, 2))
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.latencyMs', 2500)

    // Verify all events recorded
    expect(allEvents.length).toBe(16)
  })

  it('detects anomalies on expensive slow turn', async () => {
    const traceId = 'integration-trace-2'

    bus.emit({ type: 'turn:start', traceId, conversationId: 'conv-2', messageIndex: 0, timestamp: Date.now() })

    // Slow LLM with massive output
    bus.emit({ type: 'phase:start', traceId, phase: 'llm_tools', timestamp: Date.now() })
    bus.emit({ type: 'llm:call:start', traceId, provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    bus.emit({ type: 'llm:call:end', traceId, provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 10000, outputTokens: 55000, durationMs: 25000 })
    bus.emit({ type: 'phase:end', traceId, phase: 'llm_tools', durationMs: 25000 })

    // Compliance failed
    bus.emit({ type: 'compliance:result', traceId, passed: false, gaps: ['needs_identification', 'suitability'], conversationId: 'conv-2' })

    await vi.waitFor(() => {
      expect(getTurnCost(traceId)).not.toBeNull()
    })

    const cost = getTurnCost(traceId)!
    bus.emit({ type: 'turn:end', traceId, conversationId: 'conv-2', cost, latencyMs: 35000, anomalies: getTurnAnomalies(traceId) })

    const anomalies = getTurnAnomalies(traceId)

    // Should have multiple anomalies:
    // - LLM duration > 20s (latency warning)
    // - Output tokens > 50k (cost warning)
    // - Phase > 10s (latency warning)
    // - Turn latency > 30s (latency warning)
    // - Compliance failed (behavioral warning)
    expect(anomalies.length).toBeGreaterThanOrEqual(4)
    expect(anomalies.some(a => a.type === 'latency')).toBe(true)
    expect(anomalies.some(a => a.type === 'cost')).toBe(true)
    expect(anomalies.some(a => a.type === 'behavioral')).toBe(true)
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run __tests__/lib/events/pipeline-observability.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run __tests__/lib/events/`
Expected: All tests across all 6 test files PASS

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/events/pipeline-observability.test.ts
git commit -m "test: add integration test for full pipeline observability"
```

---

### Task 11: Update .env.example and master plan

**Files:**
- Modify: `.env.example`
- Modify: `docs/MASTER-TRANSFORMATION-PLAN.md`

- [ ] **Step 1: Add observability env vars to .env.example**

Append to `.env.example`:

```bash

# Sentry (Error Tracking + Performance)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# PostHog (Product Analytics)
POSTHOG_API_KEY=
POSTHOG_HOST=https://eu.posthog.com

# OpenTelemetry (Tracing) — disabled by default
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=zeno-agent
```

- [ ] **Step 2: Update master plan status**

In `docs/MASTER-TRANSFORMATION-PLAN.md`, update Sub-project #5 status from `NEXT` to `COMPLETE` in the progress table, and add the commit range.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/MASTER-TRANSFORMATION-PLAN.md
git commit -m "docs: update env example and master plan for sub-project #5 completion"
```
