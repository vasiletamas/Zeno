/**
 * P2-8 (2026-07-15 hardening): a fresh quote must not be self-cancellable by
 * the model. cancel_quote is exposed only once the CUSTOMER has spoken after
 * the quote was issued — an unsolicited model cancel is blocked with
 * customer_intent_required (the 2026-07-09 self-cancel → 40x set_application
 * loop entry). A real customer-driven cancel (a message after issuance) still
 * works.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { buildIssuedQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

describe('cancel_quote customer-intent guard (P2-8)', () => {
  beforeEach(async () => { await resetDb() })

  it('an unsolicited cancel on a just-issued quote (no customer message after) is blocked', async () => {
    const fx = await buildIssuedQuote()
    const snap = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(snap.actions.available).not.toContain('cancel_quote')
    const res = await executeCommit({ tool: 'cancel_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('customer_intent_required')
    // the quote is untouched
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })).status).toBe('ISSUED')
  })

  it('a customer message after the quote unlocks cancel_quote (customer-driven cancel still works)', async () => {
    const fx = await buildIssuedQuote()
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    // the customer speaks AFTER seeing the quote — explicit intent
    await prisma.message.create({
      data: { conversationId: fx.conversationId, role: 'user', content: 'actually, cancel this — I changed my mind', createdAt: new Date(quote.createdAt.getTime() + 1000) },
    })
    const snap = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(snap.actions.available).toContain('cancel_quote')
    const ask = await executeCommit({ tool: 'cancel_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    expect(ask.outcome).toBe('requires_confirmation')
    const done = await executeCommit({ tool: 'cancel_quote', args: {}, actor: 'gui', customerId: fx.customerId, conversationId: fx.conversationId, confirmToken: ask.confirmToken, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    expect(done.outcome).toBe('applied')
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })).status).toBe('CANCELLED')
  })
})
