/**
 * P1-10: "LLM retry detected" fired on the normal second LLM round of every
 * tool-calling turn (97/97 with tool calls — 100% false positive) while real
 * retries inside executeWithRetries emitted NO event. The call-count
 * heuristic dies; dedicated llm:call:retry / llm:failover events carry the
 * truth from the registry.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import { registerAnomalySubscriber, getTurnAnomalies } from '@/lib/events/anomaly-subscriber'
import { eventBus } from '@/lib/events/event-bus'
import { callWithFailover } from '@/lib/llm/providers/registry'
import type { ZenoEvent } from '@/lib/events/types'

beforeAll(() => {
  process.env.OPENAI_API_KEY ??= 'sk-test'
  process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
})

describe('anomaly subscriber (P1-10)', () => {
  it('two llm:call:start for the same agent produce NO anomaly (the retired false positive)', () => {
    const bus = new EventBus()
    registerAnomalySubscriber(bus)
    bus.emit({ type: 'turn:start', traceId: 't1', conversationId: 'c1', messageIndex: 0, timestamp: 1 })
    bus.emit({ type: 'llm:call:start', traceId: 't1', provider: 'OPENAI', model: 'gpt-test', agentSlug: 'main-chat' })
    bus.emit({ type: 'llm:call:start', traceId: 't1', provider: 'OPENAI', model: 'gpt-test', agentSlug: 'main-chat' })
    expect(getTurnAnomalies('t1').filter((a) => /retry/i.test(a.message))).toHaveLength(0)
  })

  it('llm:call:retry records an info anomaly', () => {
    const bus = new EventBus()
    registerAnomalySubscriber(bus)
    bus.emit({ type: 'turn:start', traceId: 't2', conversationId: 'c1', messageIndex: 0, timestamp: 1 })
    bus.emit({ type: 'llm:call:retry', traceId: 't2', provider: 'OPENAI', model: 'gpt-test', attempt: 1, delayMs: 1000, errorClass: 'transient' } as ZenoEvent)
    const hits = getTurnAnomalies('t2').filter((a) => /retry/i.test(a.message))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('info')
  })

  it('llm:failover records a warning anomaly', () => {
    const bus = new EventBus()
    registerAnomalySubscriber(bus)
    bus.emit({ type: 'turn:start', traceId: 't3', conversationId: 'c1', messageIndex: 0, timestamp: 1 })
    bus.emit({ type: 'llm:failover', traceId: 't3', fromModel: 'gpt-test', toModel: 'claude-test', errorClass: 'provider_down' } as ZenoEvent)
    const hits = getTurnAnomalies('t3').filter((a) => /failover/i.test(a.message))
    expect(hits).toHaveLength(1)
    expect(hits[0].severity).toBe('warning')
  })
})

describe('registry emits the real events (P1-10)', () => {
  it('a transient failure then success emits llm:call:retry with the attempt count', async () => {
    const seen: ZenoEvent[] = []
    const off = (e: ZenoEvent) => { if (e.type === 'llm:call:retry') seen.push(e) }
    eventBus.on('llm:call:retry' as never, off)
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls === 1) throw Object.assign(new Error('rate limited'), { status: 429, headers: { 'retry-after': '0' } })
      return 'ok'
    })
    const result = await callWithFailover(
      { provider: { name: 'x' } as never, model: 'gpt-test' },
      null,
      fn,
      { traceId: 'trace-retry' },
    )
    expect(result).toBe('ok')
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(seen[0]).toMatchObject({ type: 'llm:call:retry', traceId: 'trace-retry', attempt: 1 })
  }, 20_000)

  it('a provider_down primary with a healthy fallback emits llm:failover', async () => {
    const seen: ZenoEvent[] = []
    eventBus.on('llm:failover' as never, (e: ZenoEvent) => { if (e.type === 'llm:failover') seen.push(e) })
    const fn = vi.fn(async (_provider: unknown, model: string) => {
      if (model === 'primary-model') throw Object.assign(new Error('401 bad key'), { status: 401 })
      return 'fallback-ok'
    })
    const result = await callWithFailover(
      { provider: { name: 'p' } as never, model: 'primary-model' },
      { provider: { name: 'f' } as never, model: 'fallback-model' },
      fn as never,
      { traceId: 'trace-failover' },
    )
    expect(result).toBe('fallback-ok')
    expect(seen.some((e) => e.type === 'llm:failover' && e.traceId === 'trace-failover' && e.toModel === 'fallback-model')).toBe(true)
  })
})
