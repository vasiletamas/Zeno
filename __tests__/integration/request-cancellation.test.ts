import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildActivatedPolicy, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import type { CommitActor } from '@/lib/engines/domain-types'

const cancel = (fx: { customerId: string; conversationId: string }, args: Record<string, unknown> = {}, actor: CommitActor = 'agent') =>
  executeCommit({ tool: 'request_cancellation', args, actor, customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('request_cancellation (D4.5 — free-look) with refund execution', () => {
  beforeEach(async () => { await resetDb() })

  it('in window: requires_confirmation -> CANCELLED + every captured payment REFUNDED', async () => {
    const fx = await buildActivatedPolicy() // freeLookEndsAt in the future
    const ask = await cancel(fx)
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await cancel(fx, { confirmToken: ask.confirmToken })
    expect(res.outcome, JSON.stringify({ reason: res.reason })).toBe('applied')
    expect(res.effects).toContain('terminal')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('CANCELLED')
    const payments = await prisma.payment.findMany({ where: { customerId: fx.customerId, status: 'REFUNDED' } })
    expect(payments.length).toBeGreaterThanOrEqual(1) // PaymentStatus.REFUNDED finally has a writer
  })

  it('outside window: rejected(outside_free_look), policy untouched', async () => {
    const fx = await buildActivatedPolicy()
    await prisma.policy.update({ where: { id: fx.policyId }, data: { freeLookEndsAt: new Date(Date.now() - 86_400_000) } })
    const res = await cancel(fx)
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('outside_free_look')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('ACTIVE')
  })

  it('operator cancel_submission on a SUBMITTED paid policy refunds every capture (erratum 4, contradiction #5)', async () => {
    const fx = await buildActivatedPolicy({ stopAt: 'SUBMITTED' })
    const res = await executeCommit({ tool: 'cancel_submission', args: { policyId: fx.policyId }, actor: 'operator', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    expect(res.outcome, JSON.stringify({ reason: res.reason })).toBe('applied')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('CANCELLED')
    expect(await prisma.payment.count({ where: { customerId: fx.customerId, status: 'REFUNDED' } })).toBeGreaterThanOrEqual(1)
  })
})
