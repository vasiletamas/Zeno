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
      expect(cost).toBeGreaterThan(0)
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

  it('returns 0 when model not in catalog', async () => {
    mockFindFirst.mockResolvedValue(null)

    emitTurnStart('trace-3')
    emitLlmEnd('trace-3', 'UNKNOWN', 'unknown-model', 1000, 500)

    // Give time for async lookup
    await new Promise((r) => setTimeout(r, 50))

    // turn:start initializes the accumulator to 0; no pricing found so cost stays 0
    expect(getTurnCost('trace-3')).toBe(0)
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
      expect(getTurnCost('trace-4')).toBeGreaterThan(0)
    })

    emitTurnEnd('trace-4')

    // Cleanup happens after 1s delay
    await new Promise((r) => setTimeout(r, 1100))
    expect(getTurnCost('trace-4')).toBeNull()
  })
})
