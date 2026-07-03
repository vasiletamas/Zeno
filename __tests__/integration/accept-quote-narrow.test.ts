import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildAcceptReadyQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

const accept = (fx: { customerId: string; conversationId: string }, args: Record<string, unknown>) =>
  executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('accept_quote narrow commit (D2.5, T7.D6)', () => {
  beforeEach(async () => { await resetDb() })

  it('CAS ISSUED->ACCEPTED, persists paymentOption+acceptedAt, creates schedule, NO Policy, conversation stays ACTIVE', async () => {
    const fx = await buildAcceptReadyQuote()
    const ask = await accept(fx, { paymentOption: 'quarterly' })
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await accept(fx, { paymentOption: 'quarterly', confirmToken: ask.confirmToken })
    expect(res.outcome).toBe('applied')
    expect(res.phaseDelta).toEqual({ from: 'QUOTE', to: 'PAYMENT' })
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.status).toBe('ACCEPTED')
    expect(quote.paymentFrequency).toBe('quarterly')
    expect(quote.acceptedAt).not.toBeNull()
    const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: fx.quoteId }, include: { installments: true } })
    expect(schedule.status).toBe('PENDING_FIRST_CAPTURE')
    expect(schedule.installments).toHaveLength(4)
    expect(schedule.installments.reduce((s, i) => s + i.amountMinor, 0)).toBe(Math.round(quote.premiumAnnual * 100))
    expect(await prisma.policy.count()).toBe(0) // THE FLIP: no Policy at accept
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: fx.conversationId } })
    expect(conv.status).toBe('ACTIVE') // contradiction #11
  })

  it('replay with same paymentOption returns the ORIGINAL envelope; different option -> rejected(already_applied)', async () => {
    const fx = await buildAcceptReadyQuote()
    const ask = await accept(fx, { paymentOption: 'annual' })
    const first = await accept(fx, { paymentOption: 'annual', confirmToken: ask.confirmToken })
    expect(first.outcome, JSON.stringify({ reason: first.reason, data: first.data, ask: ask.outcome })).toBe('applied')
    const replay = await accept(fx, { paymentOption: 'annual', confirmToken: ask.confirmToken })
    expect(replay.outcome, JSON.stringify({ reason: replay.reason })).toBe(first.outcome)
    expect(await prisma.paymentSchedule.count()).toBe(1) // no second effect
    const conflicting = await accept(fx, { paymentOption: 'quarterly' })
    expect(conflicting.outcome).toBe('rejected')
    expect(conflicting.reason).toBe('already_applied')
  })

  it('unacked disclosures block with requires_disclosures; below verified_channel blocks with requires_identity', async () => {
    const noAck = await buildAcceptReadyQuote({ withoutDisclosureAck: true })
    const blockedDisc = await accept(noAck, { paymentOption: 'annual' })
    expect(blockedDisc.outcome).toBe('requires_disclosures')
    expect(blockedDisc.needs).toEqual(expect.arrayContaining(['IPID', 'TERMS']))

    const unverified = await buildAcceptReadyQuote({ withoutVerifiedChannel: true })
    const blockedId = await accept(unverified, { paymentOption: 'annual' })
    expect(blockedId.outcome).toBe('requires_identity')
  })
})
