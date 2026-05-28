import { describe, it, expect } from 'vitest'
import { recordDebugEvent, type DebugEvent } from '@/lib/chat/debug'

const ev: DebugEvent = {
  event: 'debug:gate',
  data: { traceId: 't1', skipped: true, reason: 'fast_path', durationMs: 0 },
}

describe('recordDebugEvent', () => {
  it('appends the event to the sink (no debug gate involved)', () => {
    const sink = { debugEvents: [] as DebugEvent[] }
    recordDebugEvent(sink, ev)
    recordDebugEvent(sink, ev)
    expect(sink.debugEvents).toHaveLength(2)
    expect(sink.debugEvents[0]).toBe(ev)
  })
})
