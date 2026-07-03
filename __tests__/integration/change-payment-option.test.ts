import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getPaymentStatus } from '@/lib/tools/handlers/payment-handlers'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

const change = (fx: { customerId: string; conversationId: string }, args: Record<string, unknown>) =>
  executeCommit({ tool: 'change_payment_option', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('change_payment_option (D3.4, T8.D5 — pre-capture re-rating)', () => {
  beforeEach(async () => { await resetDb() })

  it('supersedes the schedule with re-rated rows and NEVER mutates the accepted Quote', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' })
    const before = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    const ask = await change(fx, { paymentOption: 'annual' })
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await change(fx, { paymentOption: 'annual', confirmToken: ask.confirmToken })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('re_rating')
    const data = res.data as { oldScheduleId: string; newScheduleId: string; oldTotalMinor: number; newTotalMinor: number }
    const oldS = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: data.oldScheduleId } })
    expect(oldS.status).toBe('SUPERSEDED')
    expect(oldS.supersededById).toBe(data.newScheduleId)
    const newS = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: data.newScheduleId }, include: { installments: true } })
    expect(newS.frequency).toBe('annual')
    expect(newS.installments).toHaveLength(1)
    expect(newS.installments[0].amountMinor).toBe(Math.round(before.premiumAnnual * 100))
    const after = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(after).toEqual(before) // acceptance evidence is immutable (contradiction #3)
    // the reads follow the supersession chain
    const status = await getPaymentStatus({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect((status.data as { frequency: string }).frequency).toBe('annual')
  })

  it('rejected(schedule_already_captured) once any installment is PAID', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly', settleFirstInstallment: true })
    const res = await change(fx, { paymentOption: 'annual' })
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('schedule_already_captured')
  })
})
