import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'

describe('quote lifecycle schema (D1.1)', () => {
  beforeAll(async () => { await resetDb() })

  it('accepts ISSUED/CANCELLED quote statuses, REFERRED application, frozen-application fields', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
    const product = await prisma.product.findFirstOrThrow()
    const application = await prisma.application.create({
      data: { originConversationId: conversation.id, customerId: customer.id, productId: product.id, status: 'OPEN' },
    })
    const quote = await prisma.quote.create({
      data: {
        applicationId: application.id, productId: product.id, customerId: customer.id,
        premiumAnnual: 300, premiumMonthly: 25, coverages: {}, status: 'ISSUED',
        validUntil: new Date(Date.now() + 86_400_000),
      },
    })
    expect(quote.status).toBe('ISSUED')
    const cancelled = await prisma.quote.update({ where: { id: quote.id }, data: { status: 'CANCELLED' } })
    expect(cancelled.status).toBe('CANCELLED')
    const frozen = await prisma.application.update({
      where: { id: application.id },
      data: { status: 'REFERRED', frozenAt: new Date(), quoteDecision: { outcome: 'referred', reason: 'manual_underwriting', decidedAt: new Date().toISOString() } },
    })
    expect(frozen.status).toBe('REFERRED')
    expect(frozen.frozenAt).not.toBeNull()
  })
})
