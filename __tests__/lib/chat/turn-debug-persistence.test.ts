import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DebugEvent } from '@/lib/chat/debug'

const upsertSpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: { turnDebug: { upsert: (...a: unknown[]) => upsertSpy(...a) } },
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn() }))

const { persistTurnDebug } = await import('@/lib/chat/turn-debug-persistence')

function events(traceId: string): DebugEvent[] {
  return [
    { event: 'debug:turn_start', data: { traceId, conversationId: 'c1', messageIndex: 0, userMessage: 'hi', language: 'en' } },
    { event: 'debug:tool_call', data: { traceId, round: 0, toolCallId: 'tc1', name: 'list_products', args: { insuranceType: 'life' }, partition: 'readOnly' } },
    { event: 'debug:tool_result', data: { traceId, toolCallId: 'tc1', success: true, durationMs: 5, cached: false, data: { items: 2 } } },
    { event: 'debug:turn_end', data: { traceId, phases: {}, totalInputTokens: 10, totalOutputTokens: 20, cost: 0.01, latencyMs: 100, anomalies: [] } },
  ]
}

describe('persistTurnDebug', () => {
  beforeEach(() => upsertSpy.mockReset())

  it('upserts one row keyed by traceId, with tool args + results in the payload', async () => {
    upsertSpy.mockResolvedValueOnce({})
    await persistTurnDebug({ conversationId: 'c1', messageIndex: 3, traceId: 't1', events: events('t1') })
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const arg = upsertSpy.mock.calls[0][0] as {
      where: { traceId: string }
      create: { conversationId: string; messageIndex: number; payload: any }
    }
    expect(arg.where).toEqual({ traceId: 't1' })
    expect(arg.create.conversationId).toBe('c1')
    expect(arg.create.messageIndex).toBe(3)
    expect(arg.create.payload.toolCalls[0].args).toEqual({ insuranceType: 'life' })
    expect(arg.create.payload.toolCalls[0].result.data).toEqual({ items: 2 })
    expect(arg.create.payload.totals.totalInputTokens).toBe(10)
  })

  it('does not write when there are no events', async () => {
    await persistTurnDebug({ conversationId: 'c1', messageIndex: 0, traceId: 't1', events: [] })
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('swallows DB errors and never throws', async () => {
    upsertSpy.mockRejectedValueOnce(new Error('db down'))
    await expect(
      persistTurnDebug({ conversationId: 'c1', messageIndex: 0, traceId: 't1', events: events('t1') }),
    ).resolves.toBeUndefined()
  })
})
