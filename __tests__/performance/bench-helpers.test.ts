import { describe, it, expect, beforeEach } from 'vitest'
import { eventBus } from '@/lib/events'
import {
  collectTimings,
  assertPhaseUnder,
  assertPhasesParallel,
  createMockProvider,
} from './bench-helpers'

// ============================================================
// collectTimings
// ============================================================

describe('collectTimings', () => {
  it('captures phase timings from event bus', async () => {
    const traceId = 'trace-collect-1'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId, phase: 'llm', timestamp: 1000 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'llm', durationMs: 150 })

    const result = collector.finish()

    expect(result.timings['llm']).toBe(150)
  })

  it('captures span start and end times', async () => {
    const traceId = 'trace-collect-2'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId, phase: 'retrieval', timestamp: 2000 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'retrieval', durationMs: 80 })

    const result = collector.finish()

    expect(result.spans['retrieval']).toBeDefined()
    expect(result.spans['retrieval'].startMs).toBe(2000)
    expect(result.spans['retrieval'].endMs).toBe(2000 + 80)
  })

  it('captures multiple phases independently', () => {
    const traceId = 'trace-collect-3'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId, phase: 'planning', timestamp: 100 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'planning', durationMs: 50 })
    eventBus.emit({ type: 'phase:start', traceId, phase: 'execution', timestamp: 150 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'execution', durationMs: 200 })

    const result = collector.finish()

    expect(result.timings['planning']).toBe(50)
    expect(result.timings['execution']).toBe(200)
  })

  it('ignores events from other traceIds', () => {
    const traceId = 'trace-collect-4'
    const otherTraceId = 'trace-other'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId: otherTraceId, phase: 'llm', timestamp: 500 })
    eventBus.emit({ type: 'phase:end', traceId: otherTraceId, phase: 'llm', durationMs: 999 })

    const result = collector.finish()

    expect(result.timings['llm']).toBeUndefined()
  })

  it('unsubscribes after finish so subsequent events are not captured', () => {
    const traceId = 'trace-collect-5'
    const collector = collectTimings(traceId)

    eventBus.emit({ type: 'phase:start', traceId, phase: 'alpha', timestamp: 1 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'alpha', durationMs: 10 })

    const result = collector.finish()
    expect(result.timings['alpha']).toBe(10)

    // Emit more events after finish — should not appear
    eventBus.emit({ type: 'phase:start', traceId, phase: 'beta', timestamp: 100 })
    eventBus.emit({ type: 'phase:end', traceId, phase: 'beta', durationMs: 20 })

    // Re-call finish on the same result (no new collector) — timings are already captured
    expect(result.timings['beta']).toBeUndefined()
  })
})

// ============================================================
// assertPhaseUnder
// ============================================================

describe('assertPhaseUnder', () => {
  it('does not throw when phase duration is under the threshold', () => {
    const timings = { llm: 100 }
    expect(() => assertPhaseUnder(timings, 'llm', 200)).not.toThrow()
  })

  it('does not throw when phase duration equals the threshold', () => {
    const timings = { llm: 200 }
    expect(() => assertPhaseUnder(timings, 'llm', 200)).not.toThrow()
  })

  it('throws when phase duration exceeds threshold', () => {
    const timings = { llm: 350 }
    expect(() => assertPhaseUnder(timings, 'llm', 300)).toThrow()
  })

  it('throws with a descriptive message including phase name and values', () => {
    const timings = { planning: 500 }
    expect(() => assertPhaseUnder(timings, 'planning', 400)).toThrowError(
      /planning.*500.*400/i
    )
  })

  it('throws when phase is not found in timings', () => {
    const timings = { llm: 100 }
    expect(() => assertPhaseUnder(timings, 'missing-phase', 200)).toThrow()
  })
})

// ============================================================
// assertPhasesParallel
// ============================================================

describe('assertPhasesParallel', () => {
  it('does not throw when phases overlap by more than threshold', () => {
    // phaseA: 0–200, phaseB: 100–300, overlap = 100ms
    const spans = {
      phaseA: { startMs: 0, endMs: 200 },
      phaseB: { startMs: 100, endMs: 300 },
    }
    expect(() => assertPhasesParallel(spans, 'phaseA', 'phaseB', 50)).not.toThrow()
  })

  it('does not throw when overlap exactly equals threshold', () => {
    const spans = {
      phaseA: { startMs: 0, endMs: 200 },
      phaseB: { startMs: 150, endMs: 300 },
    }
    // overlap = 50ms
    expect(() => assertPhasesParallel(spans, 'phaseA', 'phaseB', 50)).not.toThrow()
  })

  it('throws when phases are sequential (no overlap)', () => {
    const spans = {
      phaseA: { startMs: 0, endMs: 100 },
      phaseB: { startMs: 200, endMs: 300 },
    }
    expect(() => assertPhasesParallel(spans, 'phaseA', 'phaseB', 10)).toThrow()
  })

  it('throws with descriptive message including phase names and overlap amount', () => {
    const spans = {
      fetch: { startMs: 0, endMs: 100 },
      compute: { startMs: 200, endMs: 300 },
    }
    expect(() => assertPhasesParallel(spans, 'fetch', 'compute', 10)).toThrowError(
      /fetch.*compute|overlap/i
    )
  })

  it('throws when overlap is less than threshold', () => {
    // overlap = 20ms, threshold = 50ms
    const spans = {
      phaseA: { startMs: 0, endMs: 120 },
      phaseB: { startMs: 100, endMs: 300 },
    }
    expect(() => assertPhasesParallel(spans, 'phaseA', 'phaseB', 50)).toThrow()
  })

  it('throws when a phase span is missing', () => {
    const spans = {
      phaseA: { startMs: 0, endMs: 200 },
    }
    expect(() => assertPhasesParallel(spans, 'phaseA', 'phaseB', 10)).toThrow()
  })
})

// ============================================================
// createMockProvider
// ============================================================

describe('createMockProvider', () => {
  it('chat returns a response with the configured content after delay', async () => {
    const provider = createMockProvider({ latencyMs: 10, content: 'hello world' })
    const start = Date.now()
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'test-model',
    })
    const elapsed = Date.now() - start

    expect(response.content).toBe('hello world')
    // 1ms tolerance: setTimeout can fire up to ~1ms before Date.now() ticks
    // over, which made this assertion flaky (observed elapsed=9).
    expect(elapsed).toBeGreaterThanOrEqual(9)
  })

  it('chat returns the configured token usage', async () => {
    const provider = createMockProvider({
      latencyMs: 0,
      content: 'response',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    })
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
    })

    expect(response.usage.promptTokens).toBe(10)
    expect(response.usage.completionTokens).toBe(20)
    expect(response.usage.totalTokens).toBe(30)
  })

  it('chatWithTools returns response with empty toolCalls by default', async () => {
    const provider = createMockProvider({ latencyMs: 0, content: 'result' })
    const response = await provider.chatWithTools({
      messages: [{ role: 'user', content: 'use a tool' }],
      model: 'test-model',
      tools: [],
    })

    expect(response.content).toBe('result')
    expect(Array.isArray(response.toolCalls)).toBe(true)
  })

  it('chatStream yields a content chunk then a done chunk', async () => {
    const provider = createMockProvider({ latencyMs: 0, content: 'streamed content' })
    const chunks = []
    for await (const chunk of await provider.chatStream({
      messages: [{ role: 'user', content: 'stream this' }],
      model: 'test-model',
    })) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    const contentChunk = chunks.find((c) => c.type === 'content')
    const doneChunk = chunks.find((c) => c.type === 'done')
    expect(contentChunk).toBeDefined()
    expect(contentChunk?.content).toBe('streamed content')
    expect(doneChunk).toBeDefined()
    expect(doneChunk?.usage).toBeDefined()
  })

  it('chatStreamWithTools yields content chunk then done chunk', async () => {
    const provider = createMockProvider({ latencyMs: 0, content: 'tool-stream' })
    const chunks = []
    for await (const chunk of await provider.chatStreamWithTools({
      messages: [{ role: 'user', content: 'go' }],
      model: 'test-model',
      tools: [],
    })) {
      chunks.push(chunk)
    }

    expect(chunks.some((c) => c.type === 'content')).toBe(true)
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })

  it('uses default content when none provided', async () => {
    const provider = createMockProvider({ latencyMs: 0 })
    const response = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'test-model',
    })

    expect(typeof response.content).toBe('string')
    expect(response.content!.length).toBeGreaterThan(0)
  })
})
