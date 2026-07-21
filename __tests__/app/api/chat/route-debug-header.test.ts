import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Capture the handleChatTurn arguments so we can assert on them
const handleChatTurnSpy = vi.fn((..._args: unknown[]) => {
  void _args
  return new ReadableStream({ start(c) { c.close() } })
})

vi.mock('@/lib/chat/orchestrator', () => ({
  handleChatTurn: (input: unknown) => handleChatTurnSpy(input),
}))
vi.mock('@/lib/chat/action-adapter', () => ({ adaptAction: () => undefined }))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn(), logFatal: vi.fn() }))
// 2026-07-21: the route now resolves the caller from the cookie and checks
// conversation ownership before anything else (spec §3.1). Both are DB-backed;
// this suite is about the debug header, so they are stubbed to "allow" exactly
// as the orchestrator already is. The refusal paths have their own suite:
// __tests__/integration/chat-route-access.test.ts.
vi.mock('@/lib/auth/reauth-gate', () => ({
  canonicalCustomerId: async (id?: string | null) => id ?? null,
}))
vi.mock('@/lib/chat/conversation-access', () => ({
  decideConversationAccess: async ({ cookieCustomerId }: { cookieCustomerId?: string }) => ({
    kind: 'allow', customerId: cookieCustomerId,
  }),
}))

const { POST } = await import('@/app/api/chat/route')

function makeRequest(headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'zeno_session=cust1', ...headers },
    body: JSON.stringify({ conversationId: 'c1', customerId: 'cust1', message: 'hi' }),
  })
}

describe('POST /api/chat — x-zeno-debug header', () => {
  beforeEach(() => handleChatTurnSpy.mockClear())

  it('passes debugEnabled=true when x-zeno-debug: 1 is present', async () => {
    await POST(makeRequest({ 'x-zeno-debug': '1' }))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: true }),
    )
  })

  it('passes debugEnabled=false when the header is missing', async () => {
    await POST(makeRequest({}))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: false }),
    )
  })

  it('passes debugEnabled=false when the header has any other value', async () => {
    await POST(makeRequest({ 'x-zeno-debug': '0' }))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ debugEnabled: false }),
    )
  })
})
