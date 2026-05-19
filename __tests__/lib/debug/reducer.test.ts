import { describe, it, expect } from 'vitest'
import { reduceDebugEvent, type DebugState, EMPTY_STATE } from '@/lib/debug/reducer'
import type { DebugEvent } from '@/lib/chat/debug'

function start(traceId: string, idx: number): DebugEvent {
  return {
    event: 'debug:turn_start',
    data: { traceId, conversationId: 'c1', messageIndex: idx, userMessage: 'hi', language: 'en' },
  }
}

function gate(traceId: string): DebugEvent {
  return {
    event: 'debug:gate',
    data: { traceId, skipped: true, reason: 'fast_path', durationMs: 0 },
  }
}

function end(traceId: string): DebugEvent {
  return {
    event: 'debug:turn_end',
    data: {
      traceId,
      phases: {},
      totalInputTokens: 1,
      totalOutputTokens: 2,
      cost: 0.001,
      latencyMs: 100,
      anomalies: [],
    },
  }
}

describe('reduceDebugEvent', () => {
  it('creates a new turn on debug:turn_start', () => {
    const s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    expect(s.turns).toHaveLength(1)
    expect(s.turns[0].traceId).toBe('t1')
    expect(s.turns[0].userMessage).toBe('hi')
    expect(s.turns[0].toolCalls).toEqual([])
  })

  it('attaches debug:gate payload to the matching turn', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, gate('t1'))
    expect(s.turns[0].gate).toEqual({ skipped: true, reason: 'fast_path', durationMs: 0 })
  })

  it('stamps endedAt and totals on debug:turn_end', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, end('t1'))
    expect(s.turns[0].endedAt).toBeDefined()
    expect(s.turns[0].totals?.totalInputTokens).toBe(1)
    expect(s.turns[0].totals?.latencyMs).toBe(100)
  })

  it('matches a debug:tool_result to its prior debug:tool_call by toolCallId', () => {
    let s = reduceDebugEvent(EMPTY_STATE, start('t1', 0))
    s = reduceDebugEvent(s, {
      event: 'debug:tool_call',
      data: { traceId: 't1', round: 0, toolCallId: 'tc1', name: 'list_products', args: {}, partition: 'readOnly' },
    })
    s = reduceDebugEvent(s, {
      event: 'debug:tool_result',
      data: { traceId: 't1', toolCallId: 'tc1', success: true, durationMs: 5, cached: false, data: { ok: true } },
    })
    expect(s.turns[0].toolCalls).toHaveLength(1)
    expect(s.turns[0].toolCalls[0].name).toBe('list_products')
    expect(s.turns[0].toolCalls[0].result?.success).toBe(true)
  })

  it('keeps newest turn first and caps at 50', () => {
    let s = EMPTY_STATE
    for (let i = 0; i < 55; i++) {
      s = reduceDebugEvent(s, start(`t${i}`, i))
    }
    expect(s.turns).toHaveLength(50)
    expect(s.turns[0].traceId).toBe('t54')
    expect(s.turns[49].traceId).toBe('t5')
  })

  it('ignores events for unknown traceIds (no turn_start seen)', () => {
    const s = reduceDebugEvent(EMPTY_STATE, gate('unknown'))
    expect(s.turns).toEqual([])
  })
})
