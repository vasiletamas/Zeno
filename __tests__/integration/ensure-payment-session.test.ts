import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import type { CommitActor } from '@/lib/engines/domain-types'

const ensure = (fx: { customerId: string; conversationId: string }, actor: CommitActor = 'agent') =>
  executeCommit({ tool: 'ensure_payment_session', args: {}, actor, customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('ensure_payment_session (D3.3, T8.D4 — single-open-attempt invariant)', () => {
  beforeEach(async () => { await resetDb() })

  it('first call mode=started; second call resumes the open session — never two capturable PENDING rows', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
    const a = await ensure(fx)
    expect(a.outcome).toBe('applied')
    expect((a.data as { mode: string }).mode).toBe('started')
    const b = await ensure(fx, 'gui')
    expect(b.outcome).toBe('applied')
    expect((b.data as { mode: string }).mode).toBe('resumed')
    const pending = await prisma.payment.findMany({ where: { customerId: fx.customerId, status: 'PENDING' } })
    expect(pending).toHaveLength(1) // the invariant, structurally
    expect(await prisma.payment.count({ where: { customerId: fx.customerId, status: 'SUPERSEDED' } })).toBeLessThanOrEqual(1)
  })

  it('after a FAILED settlement the next call is mode=retried with a fresh intent', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
    await ensure(fx)
    const p = await prisma.payment.findFirstOrThrow({ where: { status: 'PENDING' } })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_fail', event: 'payment_failed', providerPaymentId: p.providerPaymentId!, failureReason: 'card_declined' })
    const b = await ensure(fx)
    expect(b.outcome).toBe('applied')
    expect((b.data as { mode: string }).mode).toBe('retried')
    expect(await prisma.payment.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('a STALE open attempt is superseded — provider-cancelled, marked SUPERSEDED, fresh intent created', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
    await ensure(fx)
    const stale = await prisma.payment.findFirstOrThrow({ where: { status: 'PENDING' } })
    await prisma.payment.update({ where: { id: stale.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } })
    const b = await ensure(fx)
    expect(b.outcome).toBe('applied')
    expect((b.data as { mode: string }).mode).toBe('started')
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('SUPERSEDED')
    expect(await prisma.payment.count({ where: { status: 'PENDING' } })).toBe(1)
  })

  it('settled schedule -> rejected(no_due_installment)', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual', settle: true })
    const res = await ensure(fx)
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('no_due_installment')
  })
})
