import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'

describe('coupled-flip schema (D2.1)', () => {
  beforeAll(async () => { await resetDb() })

  it('persists schedule + installments + payment event + disclosure ack + ARCHIVED conversation', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, status: 'ARCHIVED', archivedAt: new Date() } })
    expect(conv.status).toBe('ARCHIVED')
    const product = await prisma.product.findFirstOrThrow()
    const app = await prisma.application.create({ data: { originConversationId: conv.id, customerId: customer.id, productId: product.id, status: 'COMPLETED' } })
    const quote = await prisma.quote.create({ data: { applicationId: app.id, productId: product.id, customerId: customer.id, premiumAnnual: 300, premiumMonthly: 25, coverages: {}, status: 'ACCEPTED', acceptedAt: new Date(), paymentFrequency: 'quarterly', validUntil: new Date() } })
    const schedule = await prisma.paymentSchedule.create({
      data: { quoteId: quote.id, customerId: customer.id, frequency: 'quarterly', status: 'PENDING_FIRST_CAPTURE', totalInstallments: 4,
        installments: { create: [{ sequence: 1, dueAt: new Date(), amountMinor: 7500 }] } },
      include: { installments: true },
    })
    const payment = await prisma.payment.create({ data: { installmentId: schedule.installments[0].id, customerId: customer.id, amountMinor: 7500, provider: 'MOCK', providerPaymentId: 'mock_1', status: 'PENDING' } })
    expect(payment.installmentId).toBe(schedule.installments[0].id)
    await prisma.paymentEvent.create({ data: { provider: 'MOCK', providerEventId: 'evt_1', kind: 'payment_succeeded', payload: {} } })
    await expect(prisma.paymentEvent.create({ data: { provider: 'MOCK', providerEventId: 'evt_1', kind: 'payment_succeeded', payload: {} } })).rejects.toThrow() // unique inbox key
    const doc = await prisma.document.create({ data: { kind: 'IPID', version: 1, language: 'ro', storageKey: 'test/ipid.pdf', contentHash: 'abc', source: 'STATIC_PER_PRODUCT_VERSION', productId: product.id } })
    await prisma.disclosureAck.create({ data: { quoteId: quote.id, customerId: customer.id, documentId: doc.id, kind: 'IPID', version: 1, language: 'ro', actor: 'agent' } })
    expect((await prisma.disclosureAck.count())).toBe(1)
    // @@unique([quoteId, kind, version, language]) — one ack per document identity
    await expect(prisma.disclosureAck.create({ data: { quoteId: quote.id, customerId: customer.id, documentId: doc.id, kind: 'IPID', version: 1, language: 'ro', actor: 'agent' } })).rejects.toThrow()
  })
})
