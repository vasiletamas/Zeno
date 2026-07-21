/**
 * POST /api/chat access control (spec 2026-07-21 §3.1).
 *
 * The route took `conversationId` AND `customerId` from the request body and
 * passed both straight to the orchestrator. Combined with the identity slice
 * being derived from `conversation.customerId`
 * (lib/engines/snapshot-loader.ts), that let any caller drive a turn inside
 * someone else's conversation — reading their state and writing commits under
 * their identity.
 *
 * These cases assert the REFUSAL paths: the security property is that a
 * mismatched caller is stopped before a single SSE byte or ledger row exists.
 * The admit path runs a full LLM turn and is covered by the sims and the
 * browser pass, not here.
 */
import { it, expect, beforeEach, describe } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import { POST as chatPost } from '@/app/api/chat/route'

beforeEach(async () => { await resetFunnelTables() })

const req = (opts: { cookie?: string; body: unknown }) =>
  new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify(opts.body),
    headers: new Headers({ 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }),
  })

async function conversationFor(customerId: string) {
  const c = await prisma.conversation.create({ data: { customerId, language: 'ro' } })
  return c.id
}

describe.skipIf(!process.env.DATABASE_URL)('/api/chat refuses foreign callers', () => {
  it('refuses a conversation the cookie does not own', async () => {
    const victim = await createCustomer({ isAnonymous: true })
    const attacker = await createCustomer({ isAnonymous: true })
    const conversationId = await conversationFor(victim.id)

    const res = await chatPost(req({
      cookie: `zeno_session=${attacker.id}`,
      body: { conversationId, customerId: victim.id, message: 'buna' },
    }))

    expect(res.status).toBe(403)
    expect(await prisma.message.count({ where: { conversationId } })).toBe(0)
  })

  it('refuses when there is no cookie at all', async () => {
    const victim = await createCustomer({ isAnonymous: true })
    const conversationId = await conversationFor(victim.id)

    const res = await chatPost(req({ body: { conversationId, customerId: victim.id, message: 'buna' } }))

    expect(res.status).toBe(403)
    expect(await prisma.message.count({ where: { conversationId } })).toBe(0)
  })

  /**
   * The body `customerId` must not be able to override the cookie even when
   * the conversation IS the caller's — otherwise a caller drives their own
   * conversation while claiming a verified customer's identity, which is the
   * same tier-borrowing defeat in a different shape.
   */
  it('refuses a body customerId that disagrees with the cookie', async () => {
    const caller = await createCustomer({ isAnonymous: true })
    const other = await createCustomer({ isAnonymous: true })
    const conversationId = await conversationFor(caller.id)

    const res = await chatPost(req({
      cookie: `zeno_session=${caller.id}`,
      body: { conversationId, customerId: other.id, message: 'buna' },
    }))

    expect(res.status).toBe(403)
  })

  // The 429 concurrency guard increments a counter keyed by conversationId.
  // A refused caller must not be able to burn a victim's slots — three of
  // these would 429 the owner out of their own conversation.
  it('a refused caller does not consume the conversation\'s concurrency slots', async () => {
    const victim = await createCustomer({ isAnonymous: true })
    const attacker = await createCustomer({ isAnonymous: true })
    const conversationId = await conversationFor(victim.id)

    for (let i = 0; i < 5; i++) {
      const res = await chatPost(req({
        cookie: `zeno_session=${attacker.id}`,
        body: { conversationId, customerId: victim.id, message: 'buna' },
      }))
      expect(res.status).toBe(403) // never 429 — the slot was never taken
    }
  })
})
