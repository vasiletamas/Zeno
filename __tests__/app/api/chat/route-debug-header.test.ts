import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { POST } = await import('@/app/api/chat/route')

function makeRequest(headers: Record<string, string>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ conversationId: 'c1', customerId: 'cust1', message: 'hi' }),
  }) as unknown as import('next/server').NextRequest
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
