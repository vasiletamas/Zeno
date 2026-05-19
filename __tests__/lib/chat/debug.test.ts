import { describe, it, expect } from 'vitest'
import { debugYield, type DebugEvent } from '@/lib/chat/debug'

function collect(gen: Generator<unknown>): unknown[] {
  const out: unknown[] = []
  for (const x of gen) out.push(x)
  return out
}

const sample: DebugEvent = {
  event: 'debug:turn_start',
  data: { traceId: 't1', conversationId: 'c1', messageIndex: 0, userMessage: 'hi', language: 'en' },
}

describe('debugYield', () => {
  it('yields nothing when isDev=false (production)', () => {
    expect(collect(debugYield(false, true, sample))).toEqual([])
  })

  it('yields nothing when enabled=false (dev with panel off)', () => {
    expect(collect(debugYield(true, false, sample))).toEqual([])
  })

  it('yields nothing when both are false', () => {
    expect(collect(debugYield(false, false, sample))).toEqual([])
  })

  it('yields the event when isDev=true AND enabled=true', () => {
    expect(collect(debugYield(true, true, sample))).toEqual([sample])
  })
})
