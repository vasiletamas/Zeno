import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeErasure } from '@/lib/gdpr/erasure'

/** Minimal contracted evidence: application → quote → policy row chain. */
async function seedPolicyFor(customerId: string) {
  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
  const app = await prisma.application.create({ data: { customerId, productId: product.id, status: 'COMPLETED' } })
  const quote = await prisma.quote.create({
    data: {
      applicationId: app.id, productId: product.id, customerId,
      premiumAnnual: 190, premiumMonthly: 15.83, coverages: {}, status: 'ACCEPTED',
      validUntil: new Date(Date.now() + 30 * 86400e3),
    },
  })
  await prisma.policy.create({
    data: {
      quoteId: quote.id, customerId, productId: product.id,
      premiumAnnual: 190, premiumMonthly: 15.83, coverageSummary: {}, status: 'ACTIVE',
    },
  })
}

describe('GDPR erasure executor (E3.2, M3)', () => {
  beforeEach(async () => { await resetDb() })

  it('never-contracted customer: conversations/messages/insights fully deleted, identity tombstoned', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ion Pop', email: 'ion@x.ro', phone: '0700000000' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await prisma.message.create({ data: { conversationId: conv.id, role: 'user', content: 'date personale' } })
    await prisma.customerInsight.create({ data: { customerId: customer.id, key: 'budgetPreference', category: 'BUYING_SIGNAL', value: 'lowest', source: 'test' } })

    const report = await executeErasure(customer.id, 'operator:op-1', prisma)

    expect(await prisma.conversation.count({ where: { customerId: customer.id } })).toBe(0)
    expect(await prisma.customerInsight.count({ where: { customerId: customer.id } })).toBe(0)
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
    expect(after).toMatchObject({ name: null, email: null, phone: null, isAnonymous: true })
    expect(after.erasedAt).not.toBeNull()
    expect(report.classResults.find((c) => c.dataClass === 'conversations_messages')!.disposition).toBe('erase')
  })

  it('contracted customer: policy retained, conversations anonymized not deleted, quote kept as acceptance evidence', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Ana M', email: 'ana@x.ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await prisma.message.create({ data: { conversationId: conv.id, role: 'user', content: 'CNP-ul meu este secret' } })
    await prisma.message.create({ data: { conversationId: conv.id, role: 'assistant', content: 'am inteles' } })
    await seedPolicyFor(customer.id)

    const report = await executeErasure(customer.id, 'operator:op-1', prisma)

    expect(await prisma.policy.count({ where: { customerId: customer.id } })).toBeGreaterThan(0)
    expect(await prisma.quote.count({ where: { customerId: customer.id } })).toBe(1)
    expect(await prisma.conversation.count({ where: { customerId: customer.id } })).toBe(1)
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: conv.id, role: 'user' } })
    expect(msg.content).toBe('[erased_per_gdpr_request]')
    const assistant = await prisma.message.findFirstOrThrow({ where: { conversationId: conv.id, role: 'assistant' } })
    expect(assistant.content).toBe('am inteles') // assistant messages retained
    expect(report.classResults.find((c) => c.dataClass === 'policies')!.disposition).toBe('retain_mandated')
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
    expect(after.name).toBeNull()
    expect(after.erasedAt).not.toBeNull()
  })

  it('signed DNT survives erasure (IDD retention); unsigned draft sessions are deleted', async () => {
    const customer = await prisma.customer.create({ data: { name: 'Radu' } })
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const signedSession = await prisma.dntSession.create({ data: { customerId: customer.id, productId: product.id, type: 'NEW', status: 'SIGNED' } })
    await prisma.dnt.create({ data: { customerId: customer.id, signedAt: new Date(), validUntil: new Date(Date.now() + 365 * 86400e3), productTypesCovered: ['LIFE'], sourceSessionId: signedSession.id } })
    await prisma.dntSession.create({ data: { customerId: customer.id, productId: product.id, type: 'NEW', status: 'CANCELLED' } })

    await executeErasure(customer.id, 'operator:op-1', prisma)

    expect(await prisma.dnt.count({ where: { customerId: customer.id } })).toBe(1)
    expect(await prisma.dntSession.count({ where: { customerId: customer.id } })).toBe(1) // only the signed source survives
  })
})
