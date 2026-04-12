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
const mockSetStatus = vi.fn()
const mockSpan = { end: mockEndSpan, setAttribute: mockSetAttribute, addEvent: mockAddEvent, setStatus: mockSetStatus }
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
      const cost = getTurnCost(traceId)
      expect(cost).not.toBeNull()
      expect(cost).toBeGreaterThan(0)
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
    // Note: anomalies are cleaned up on turn:end with setTimeout, so check right away
    expect(allEvents.filter(e => e.type === 'turn:end')[0]).toEqual(expect.objectContaining({
      anomalies: [],
    }))

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
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.cost', expect.closeTo(0.062, 1))
    expect(mockSetAttribute).toHaveBeenCalledWith('zeno.latencyMs', 2500)

    // Verify total events emitted
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
      const cost = getTurnCost(traceId)
      expect(cost).not.toBeNull()
      expect(cost).toBeGreaterThan(0)
    })

    const cost = getTurnCost(traceId)!

    // Get anomalies BEFORE turn:end (since turn:end triggers cleanup)
    const anomaliesBefore = [...getTurnAnomalies(traceId)]

    bus.emit({ type: 'turn:end', traceId, conversationId: 'conv-2', cost, latencyMs: 35000, anomalies: anomaliesBefore })

    // Get final anomalies (turn:end also adds its own)
    const anomalies = getTurnAnomalies(traceId)

    // Should have multiple anomalies:
    // - LLM duration > 20s (latency warning)
    // - Output tokens > 50k (cost warning)
    // - Phase > 10s (latency warning)
    // - Turn latency > 30s (latency warning) — added by turn:end handler
    // - Compliance failed (behavioral warning)
    expect(anomalies.length).toBeGreaterThanOrEqual(4)
    expect(anomalies.some(a => a.type === 'latency')).toBe(true)
    expect(anomalies.some(a => a.type === 'cost')).toBe(true)
    expect(anomalies.some(a => a.type === 'behavioral')).toBe(true)
  })
})
