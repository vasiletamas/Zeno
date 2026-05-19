import { describe, it, expect, vi } from 'vitest'
import { debugYield, isDev, type DebugEvent } from '@/lib/chat/debug'

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

describe('isDev', () => {
  it('reflects the current NODE_ENV each call (not captured at import)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isDev()).toBe(true)
    vi.stubEnv('NODE_ENV', 'production')
    expect(isDev()).toBe(false)
    vi.unstubAllEnvs()
  })
})
