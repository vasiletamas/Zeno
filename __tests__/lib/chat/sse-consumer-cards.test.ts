import { describe, it, expect } from 'vitest'
import { consumeSSE } from '@/lib/chat/sse-consumer'

const sseResponse = (frames: string[]): Response =>
  new Response(new ReadableStream({
    start(c) { frames.forEach((f) => c.enqueue(new TextEncoder().encode(f))); c.close() },
  }))

// SSEHandlers' non-card members are required — no-op stubs (the plan's
// two-handler literal fails tsc; assertions unchanged).
const stubs = {
  onContent: () => {},
  onToolStart: () => {},
  onToolComplete: () => {},
  onUiAction: () => {},
  onError: () => {},
}

describe('cards_state SSE dispatch (spec 2026-07-20 §2)', () => {
  it('dispatches cards_state frames to onCardsState', async () => {
    const seen: unknown[] = []
    await consumeSSE(sseResponse([
      'event: cards_state\ndata: {"cards":[{"key":"data_field:email","status":"active","hint":"x"}]}\n\n',
      'event: done\ndata: {}\n\n',
    ]), {
      ...stubs,
      onCardsState: (d) => seen.push(d),
      onDone: () => {},
    })
    expect(seen).toEqual([{ cards: [{ key: 'data_field:email', status: 'active', hint: 'x' }] }])
  })
})
