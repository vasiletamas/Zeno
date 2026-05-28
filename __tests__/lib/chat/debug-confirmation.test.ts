import { describe, it, expect } from 'vitest'
import { reduceDebugEvent, EMPTY_STATE } from '@/lib/debug/reducer'

describe('debug reducer — tool result confirmation (subsystem C)', () => {
  it('stores the confirmation payload on a tool result', () => {
    let state = EMPTY_STATE

    state = reduceDebugEvent(state, {
      event: 'debug:turn_start',
      data: { traceId: 't1', conversationId: 'c1', messageIndex: 0, userMessage: 'hi', language: 'ro' },
    } as never)

    state = reduceDebugEvent(state, {
      event: 'debug:tool_call',
      data: {
        traceId: 't1',
        round: 0,
        toolCallId: 'tc-1',
        name: 'list_products',
        args: { productId: 'prod-1' },
        partition: 'writing',
      },
    } as never)

    state = reduceDebugEvent(state, {
      event: 'debug:tool_result',
      data: {
        traceId: 't1',
        toolCallId: 'tc-1',
        success: true,
        durationMs: 50,
        cached: false,
        data: { productSet: true },
        confirmation: {
          category: 'lifecycle',
          label: 'Produs selectat',
          value: 'LIFE-PRO — Asigurare Viață Premium',
          timestamp: '2026-05-20T12:00:00.000Z',
        },
      },
    } as never)

    const turn = state.turns[0]
    expect(turn).toBeDefined()
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0].result).toBeDefined()
    expect(turn.toolCalls[0].result?.confirmation).toEqual({
      category: 'lifecycle',
      label: 'Produs selectat',
      value: 'LIFE-PRO — Asigurare Viață Premium',
      timestamp: '2026-05-20T12:00:00.000Z',
    })
  })
})
