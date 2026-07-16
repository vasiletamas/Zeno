/**
 * T30: the unknown-action 400 must release its concurrency slot. Evidence
 * (2026-07-15 live test): the counter was incremented BEFORE the
 * unknown-action check and the 400 return never decremented — 3 bad posts
 * permanently 429'd the conversation.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/chat/orchestrator', () => ({
  handleChatTurn: () => new ReadableStream({ start(c) { c.close() } }),
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn(), logFatal: vi.fn() }))

const { POST } = await import('@/app/api/chat/route')

function unknownActionRequest(conversationId: string) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      action: { type: 'definitely_not_a_registered_action', payload: {} },
    }),
  }) as unknown as import('next/server').NextRequest
}

describe('POST /api/chat — unknown-action 400 releases the concurrency slot (T30)', () => {
  it('4 sequential unknown actions all return 400 — never a leaked-slot 429', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await POST(unknownActionRequest('conv-t30-concurrency'))
      expect(res.status, `post ${i + 1} of 4`).toBe(400)
    }
  })
})
