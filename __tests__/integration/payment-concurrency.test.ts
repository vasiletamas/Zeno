/**
 * P0-3 (2026-07-15 hardening): two conversations for the SAME customer can
 * point at the same accepted application (resume_application binds a second
 * conversation without clearing the first). Both then satisfy
 * ensure_payment_session legality against the same schedule. The gateway lock
 * was keyed by CONVERSATION, so the two took different locks, each observed no
 * open attempt, and each created a provider intent + PENDING Payment — a
 * double-capturable session.
 *
 * Fix: a customer-scoped advisory lock for money commits + a partial unique
 * index (one PENDING Payment per installment) as the DB backstop.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

beforeEach(async () => { await resetDb() })

const ensure = (customerId: string, conversationId: string) =>
  executeCommit({ tool: 'ensure_payment_session', args: {}, actor: 'agent', customerId, conversationId, toolContext: fixtureCtx(customerId, conversationId) })

it('two conversations bound to one accepted application create exactly ONE open payment attempt', async () => {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  // a second conversation pointed at the same application (what resume_application leaves)
  const conv2 = await prisma.conversation.create({
    data: { customerId: fx.customerId, productId: (await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })).productId, activeApplicationId: fx.applicationId },
  })

  const [r1, r2] = await Promise.all([ensure(fx.customerId, fx.conversationId), ensure(fx.customerId, conv2.id)])

  // both calls succeed; at most one CREATES an attempt, the other RESUMES it
  const outcomes = [r1.outcome, r2.outcome]
  expect(outcomes.filter((o) => o === 'applied').length).toBeGreaterThanOrEqual(1)

  // the invariant: exactly one PENDING Payment for the first installment
  const firstInstallment = await prisma.installment.findFirstOrThrow({ where: { scheduleId: fx.scheduleId }, orderBy: { sequence: 'asc' } })
  const pending = await prisma.payment.findMany({ where: { installmentId: firstInstallment.id, status: 'PENDING' } })
  expect(pending).toHaveLength(1)
})

it('the DB rejects a second open PENDING payment for one installment (partial unique backstop)', async () => {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  const firstInstallment = await prisma.installment.findFirstOrThrow({ where: { scheduleId: fx.scheduleId }, orderBy: { sequence: 'asc' } })
  await prisma.payment.create({
    data: { installmentId: firstInstallment.id, customerId: fx.customerId, amountMinor: firstInstallment.amountMinor, provider: 'MOCK', providerPaymentId: `mock_${crypto.randomUUID()}`, status: 'PENDING' },
  })
  await expect(
    prisma.payment.create({
      data: { installmentId: firstInstallment.id, customerId: fx.customerId, amountMinor: firstInstallment.amountMinor, provider: 'MOCK', providerPaymentId: `mock_${crypto.randomUUID()}`, status: 'PENDING' },
    }),
  ).rejects.toThrow()
})
