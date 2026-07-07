/**
 * P1-12: a mid-pipeline crash used to abort the SSE generator silently —
 * the user message was saved, no reply came, and NO TurnDebug row existed
 * (13 minutes of recorded dead air with zero diagnostics). A fatal error
 * must persist the debug record collected so far and hand the GUI a
 * structured, retryable error event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Force a deterministic mid-pipeline crash through a seam that genuinely
// lacks a local catch (getAgentConfig runs OUTSIDE the context try-block).
// Fires AFTER step 1 (conversation resolved, user message saved) and BEFORE
// any LLM call — exactly the recorded dead-air class, and cheap.
vi.mock('@/lib/llm/agent-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/agent-config')>()
  return {
    ...actual,
    getAgentConfig: vi.fn().mockRejectedValue(new Error('boom: forced mid-pipeline crash')),
  }
})

import { prisma } from '@/lib/db'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { resetFunnelTables } from '../helpers/test-db'

async function drainEvents(stream: ReadableStream<Uint8Array>): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: { event: string; data: Record<string, unknown> }[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = raw.match(/^event: (.+)$/m)?.[1]
      const data = raw.match(/^data: (.+)$/m)?.[1]
      if (event && data) {
        try { events.push({ event, data: JSON.parse(data) }) } catch { /* non-JSON */ }
      }
    }
  }
  return events
}

describe('turn abort (P1-12)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('a mid-pipeline crash persists a TurnDebug row and yields a structured retryable error', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })

    const events = await drainEvents(handleChatTurn({
      conversationId: conv.id, customerId: customer.id, message: 'buna', language: 'ro',
    }))

    const error = events.find((e) => e.event === 'error')
    expect(error, JSON.stringify(events.map((e) => e.event))).toBeDefined()
    expect(error!.data.retryable).toBe(true)
    expect(error!.data.traceId).toBeTruthy()

    // the debug record exists despite the crash (fire-and-forget elsewhere,
    // AWAITED on the abort path)
    const rows = await prisma.turnDebug.findMany({ where: { conversationId: conv.id } })
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})
