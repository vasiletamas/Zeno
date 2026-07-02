import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '../helpers/test-db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { setDeclaredField } from '@/lib/customer/profile-service'

describe.skipIf(!process.env.DATABASE_URL)('loadDomainSnapshot (integration)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('maps a fresh anonymous conversation to the empty target snapshot', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
    const snap = await loadDomainSnapshot(conv.id)
    expect(snap.product?.code).toBe(product.code)
    expect(snap.identity.tier).toBe('anonymous')
    expect(snap.application).toBeNull()
    expect(snap.quote).toBeNull()
    expect(snap.policy).toBeNull()
    expect(snap.schedule.exists).toBe(false)
    expect(snap.dnt.signed).toBe(false)
  })

  it('derives dnt.valid=false when the customer Dnt is expired (aggregate source, B2)', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
    // B3.2: the tier is derived from the provenance store, not isAnonymous —
    // a full consistent declared KYC set puts the customer at 'declared'.
    await setDeclaredField(customer.id, 'name', 'Ana Pop', 'test')
    await setDeclaredField(customer.id, 'cnp', '1980418089861', 'test')
    await setDeclaredField(customer.id, 'dateOfBirth', '1998-04-18', 'test')
    await setDeclaredField(customer.id, 'email', 'ana@example.ro', 'test')
    await setDeclaredField(customer.id, 'phone', '0712345678', 'test')
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
    const session = await prisma.dntSession.create({ data: { customerId: customer.id, productId: product.id, type: 'NEW', status: 'SIGNED' } })
    await prisma.dnt.create({ data: { customerId: customer.id, signedAt: new Date('2024-01-01'), validUntil: new Date('2024-12-31'), productTypesCovered: ['LIFE'], sourceSessionId: session.id } })
    const snap = await loadDomainSnapshot(conv.id)
    expect(snap.dnt.signed).toBe(true)
    expect(snap.dnt.valid).toBe(false)
    expect(snap.identity.tier).toBe('declared')
  })
})
