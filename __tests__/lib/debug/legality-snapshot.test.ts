import { describe, it, expect } from 'vitest'
import { buildTurnDebugPayload } from '@/lib/debug/reducer'
import { redactSnapshot } from '@/lib/debug/redact'
import type { DebugEvent } from '@/lib/chat/debug'

const start: DebugEvent = { event: 'debug:turn_start', data: { traceId: 't1', conversationId: 'c1', messageIndex: 0, userMessage: 'u', language: 'ro' } }
const legality = (point: 'turn_start' | 'post_commit'): DebugEvent => ({
  event: 'debug:legality',
  data: {
    traceId: 't1', point, commitLedgerId: point === 'post_commit' ? 'led_1' : undefined,
    engineVersion: '1.33.0', contentVersions: ['pc_v4'],
    snapshot: { customerId: 'cust' },
    state: { phase: 'APPLICATION', subphase: null }, actions: { available: ['open_dnt_session'], blocked: [] },
  } as never,
})

describe('debug:legality event (F2.1, T14.D2)', () => {
  it('accumulates into DebugTurn.legality in order, turn_start first', () => {
    const turn = buildTurnDebugPayload([start, legality('turn_start'), legality('post_commit')])!
    expect(turn.legality).toHaveLength(2)
    expect(turn.legality![0].point).toBe('turn_start')
    expect(turn.legality![1].commitLedgerId).toBe('led_1')
    expect(turn.legality![0].engineVersion).toBe('1.33.0')
    expect(turn.legality![0].contentVersions).toEqual(['pc_v4']) // M8 pin 1
  })
})

describe('redactSnapshot (T14.D5)', () => {
  it('strips raw PII values from identity scope but keeps provenance states and derived facts', () => {
    const red = redactSnapshot({
      customerId: 'c',
      eligibilityFacts: { age: 35, residency: 'Romania' },
      identity: {
        tier: 'declared',
        fields: { cnp: { provenance: 'verified', value: '1900101123456' }, email: { provenance: 'declared', value: 'a@b.c' } },
      },
    })
    const s = JSON.stringify(red)
    expect(s).not.toContain('1900101123456')
    expect(s).not.toContain('a@b.c')
    expect(s).toContain('"provenance":"verified"')
    expect(s).toContain('"age":35') // derived facts stay — recompute needs them
    expect(s).toContain('"tier":"declared"')
  })
  it('leaves non-identity scopes untouched (quote money, schedule dates)', () => {
    const red = redactSnapshot({ quote: { id: 'q1', premiumAnnual: 190 }, schedule: { nextDueAt: '2026-07-01' } })
    expect(red).toEqual({ quote: { id: 'q1', premiumAnnual: 190 }, schedule: { nextDueAt: '2026-07-01' } })
  })
})
