/**
 * T22: action turns must persist a human-readable, localized user message —
 * the route is the ONLY writer of the synthesized action message, so this is
 * where "[Action: sign_dnt]" used to be born and shown to customers after
 * reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACTION_MESSAGE_PREFIX } from '@/lib/chat/action-labels'

// Capture the handleChatTurn arguments so we can assert on the persisted message
const handleChatTurnSpy = vi.fn((..._args: unknown[]) => {
  void _args
  return new ReadableStream({ start(c) { c.close() } })
})

vi.mock('@/lib/chat/orchestrator', () => ({
  handleChatTurn: (input: unknown) => handleChatTurnSpy(input),
}))
vi.mock('@/lib/errors/logger', () => ({ logError: vi.fn(), logFatal: vi.fn() }))
// 2026-07-21: the route now resolves the caller from the cookie and checks
// conversation ownership before anything else (spec §3.1). Both are DB-backed;
// stubbed to "allow" here exactly as the orchestrator already is. The refusal
// paths have their own suite: __tests__/integration/chat-route-access.test.ts.
vi.mock('@/lib/auth/reauth-gate', () => ({
  canonicalCustomerId: async (id?: string | null) => id ?? null,
}))
vi.mock('@/lib/chat/conversation-access', () => ({
  decideConversationAccess: async ({ cookieCustomerId }: { cookieCustomerId?: string }) => ({
    kind: 'allow', customerId: cookieCustomerId,
  }),
}))

const { POST } = await import('@/app/api/chat/route')

let convCounter = 0
function actionRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'zeno_session=cust1' },
    // Fresh conversationId per request: the module-level concurrency guard
    // only releases on stream consumption, which these tests never do.
    body: JSON.stringify({ conversationId: `conv-t22-${convCounter++}`, customerId: 'cust1', ...body }),
  })
}

describe('POST /api/chat — action turns persist human-readable messages (T22)', () => {
  beforeEach(() => handleChatTurnSpy.mockClear())

  it('synthesizes a prefixed Romanian label by default (language omitted)', async () => {
    const res = await POST(actionRequest({ action: { type: 'sign_dnt', payload: {} } }))
    expect(res.status).toBe(200)
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: `${ACTION_MESSAGE_PREFIX}✓ Analiza de nevoi semnată` }),
    )
  })

  it('honors language: en', async () => {
    const res = await POST(actionRequest({ language: 'en', action: { type: 'sign_dnt', payload: {} } }))
    expect(res.status).toBe(200)
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: `${ACTION_MESSAGE_PREFIX}✓ Needs analysis signed` }),
    )
  })

  it('derives the answer from the action payload', async () => {
    const res = await POST(actionRequest({
      action: { type: 'answer_question', payload: { answer: '35', questionCode: 'DNT_AGE', groupType: 'dnt' } },
    }))
    expect(res.status).toBe(200)
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: `${ACTION_MESSAGE_PREFIX}✓ Răspuns: 35` }),
    )
  })

  it('never emits the legacy [Action: …] marker', async () => {
    await POST(actionRequest({ action: { type: 'otp_submit', payload: { code: '123456' } } }))
    const input = handleChatTurnSpy.mock.calls[0][0] as { message: string }
    expect(input.message).not.toContain('[Action:')
    expect(input.message).not.toContain('123456')
    expect(input.message.startsWith(ACTION_MESSAGE_PREFIX)).toBe(true)
  })

  it('a user-provided message rides unchanged alongside an action', async () => {
    await POST(actionRequest({ message: 'de fapt vreau altceva', action: { type: 'sign_dnt', payload: {} } }))
    expect(handleChatTurnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'de fapt vreau altceva' }),
    )
  })
})
