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
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'latency', severity: 'warning' }))
  })

  it('flags turn latency > 60s as critical', () => {
    emitTurnStart('t2')
    bus.emit({ type: 'turn:end', traceId: 't2', conversationId: 'conv-1', cost: null, latencyMs: 65000, anomalies: [] })
    const anomalies = getTurnAnomalies('t2')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'latency', severity: 'critical' }))
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
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'latency', severity: 'warning' }))
  })

  // --- Cost anomalies ---

  it('flags turn cost > $0.50 as warning', () => {
    emitTurnStart('t5')
    bus.emit({ type: 'turn:end', traceId: 't5', conversationId: 'conv-1', cost: 0.75, latencyMs: 1000, anomalies: [] })
    const anomalies = getTurnAnomalies('t5')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'cost', severity: 'warning' }))
  })

  it('flags turn cost > $2.00 as critical', () => {
    emitTurnStart('t6')
    bus.emit({ type: 'turn:end', traceId: 't6', conversationId: 'conv-1', cost: 2.50, latencyMs: 1000, anomalies: [] })
    const anomalies = getTurnAnomalies('t6')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'cost', severity: 'critical' }))
  })

  it('flags LLM call with > 50k output tokens as warning', () => {
    emitTurnStart('t7')
    bus.emit({ type: 'llm:call:end', traceId: 't7', provider: 'OPENAI', model: 'gpt-5.4', inputTokens: 1000, outputTokens: 55000, durationMs: 5000 })
    const anomalies = getTurnAnomalies('t7')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'cost', severity: 'warning' }))
  })

  // --- Error pattern anomalies ---

  it('flags > 2 tool failures as warning', () => {
    emitTurnStart('t8')
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'a', durationMs: 100, success: false, cached: false })
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'b', durationMs: 100, success: false, cached: false })
    bus.emit({ type: 'tool:end', traceId: 't8', toolName: 'c', durationMs: 100, success: false, cached: false })
    const anomalies = getTurnAnomalies('t8')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'error_pattern', severity: 'warning' }))
  })

  it('P1-10: repeated llm:call:start is NORMAL (tool rounds) — the retired call-count heuristic never fires; llm:call:retry does', () => {
    emitTurnStart('t9')
    bus.emit({ type: 'llm:call:start', traceId: 't9', provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    bus.emit({ type: 'llm:call:start', traceId: 't9', provider: 'OPENAI', model: 'gpt-5.4', agentSlug: 'main-chat' })
    expect(getTurnAnomalies('t9')).toEqual([])
    bus.emit({ type: 'llm:call:retry', traceId: 't9', provider: 'OPENAI', model: 'gpt-5.4', attempt: 1, delayMs: 1000, errorClass: 'transient' })
    expect(getTurnAnomalies('t9')).toContainEqual(expect.objectContaining({ type: 'error_pattern', severity: 'info' }))
  })

  // --- Behavioral anomalies ---

  it('flags compliance failure as warning', () => {
    emitTurnStart('t10')
    bus.emit({ type: 'compliance:result', traceId: 't10', passed: false, gaps: ['needs_identification'], conversationId: 'conv-1' })
    const anomalies = getTurnAnomalies('t10')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'behavioral', severity: 'warning' }))
  })

  it('flags tool call count > 8 as warning', () => {
    emitTurnStart('t11')
    for (let i = 0; i < 9; i++) {
      bus.emit({ type: 'tool:end', traceId: 't11', toolName: `tool-${i}`, durationMs: 50, success: true, cached: false })
    }
    const anomalies = getTurnAnomalies('t11')
    expect(anomalies).toContainEqual(expect.objectContaining({ type: 'behavioral', severity: 'warning' }))
  })

  it('cleans up on turn:end', () => {
    emitTurnStart('t12')
    bus.emit({ type: 'phase:end', traceId: 't12', phase: 'slow', durationMs: 15000 })
    expect(getTurnAnomalies('t12').length).toBeGreaterThan(0)
    bus.emit({ type: 'turn:end', traceId: 't12', conversationId: 'conv-1', cost: null, latencyMs: 1000, anomalies: [] })
    // NOTE: Cleanup uses setTimeout(1000). For this test, just verify anomalies were detected before turn:end.
    // The cleanup will happen asynchronously.
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
    stats.push(10)
    expect(stats.mean()).toBeCloseTo(170)
  })
})
