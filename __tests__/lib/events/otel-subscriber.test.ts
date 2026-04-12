import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerOtelSubscriber } from '@/lib/events/otel-subscriber'

// Mock OTel API
const mockEndSpan = vi.fn()
const mockSetAttribute = vi.fn()
const mockAddEvent = vi.fn()
const mockSetStatus = vi.fn()
const mockSpan = {
  end: mockEndSpan,
  setAttribute: mockSetAttribute,
  addEvent: mockAddEvent,
  setStatus: mockSetStatus,
}

const mockStartSpan = vi.fn().mockReturnValue(mockSpan)

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: mockStartSpan,
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
