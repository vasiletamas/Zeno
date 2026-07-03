import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { buildIssuedQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

const cq = (fx: { customerId: string; conversationId: string }, confirmToken?: string) =>
  executeCommit({ tool: 'cancel_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, confirmToken, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('cancel_quote commit (D1.5)', () => {
  beforeEach(async () => { await resetDb() })

  it('first call returns requires_confirmation with a token; confirmed call CAS-cancels and re-opens the recovery path', async () => {
    const fx = await buildIssuedQuote()
    const first = await cq(fx)
    expect(first.outcome).toBe('requires_confirmation')
    expect(first.confirmToken).toBeTruthy()
    const second = await cq(fx, first.confirmToken)
    expect(second.outcome).toBe('applied')
    expect(second.effects).toContain('terminal')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('CANCELLED')
    // erratum 7 (recovery, T13.D2): the pointer is released — a NEW
    // application (prefilled via B4 proposals) is the only change path
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: fx.conversationId } })).activeApplicationId).toBeNull()
    const post = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(post.actions.available).toContain('set_application')
    expect(post.actions.available).not.toContain('cancel_quote')
  })

  it('commit attempt on a time-expired quote persists EXPIRED opportunistically and rejects with quote_expired', async () => {
    const fx = await buildIssuedQuote({ validUntil: new Date(Date.now() - 1000) })
    const res = await cq(fx)
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('quote_expired')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('EXPIRED') // opportunistic write (T7.D5, erratum 1: a gateway concern)
  })

  it('cancel on an ACCEPTED quote is rejected (transition table)', async () => {
    const fx = await buildIssuedQuote()
    await prisma.quote.update({ where: { id: fx.quoteId }, data: { status: 'ACCEPTED' } })
    const res = await cq(fx)
    expect(res.outcome).toBe('rejected')
  })
})
