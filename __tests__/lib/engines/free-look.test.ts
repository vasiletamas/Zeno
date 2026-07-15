import { describe, it, expect } from 'vitest'
import { freeLookDecision } from '@/lib/engines/policy-machine'

describe('free-look deterministic rule (D4.5 — frozen freeLookEndsAt, T-1s/T+1s)', () => {
  const ends = new Date('2026-07-12T00:00:00Z')
  it('inside window (inclusive) -> in_window', () => {
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, new Date(ends.getTime() - 1000))).toBe('in_window')
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, ends)).toBe('in_window')
  })
  it('outside window -> outside_window; non-ACTIVE -> not_cancellable', () => {
    expect(freeLookDecision({ status: 'ACTIVE', freeLookEndsAt: ends }, new Date(ends.getTime() + 1000))).toBe('outside_window')
    expect(freeLookDecision({ status: 'SUBMITTED', freeLookEndsAt: null }, ends)).toBe('not_cancellable')
  })
})
