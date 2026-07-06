import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { createDocument, getProductDisclosureDocuments } from '@/lib/documents/registry'
import { seedDocuments } from '@/prisma/seeds/seed-documents'

describe('document registry (D2.2)', () => {
  beforeEach(async () => { await resetDb(); await seedDocuments(prisma) })

  it('seeds IPID + TERMS for protect in ro and en with content hashes', async () => {
    const product = await prisma.product.findFirstOrThrow()
    const docs = await getProductDisclosureDocuments(product.id, 'ro')
    expect(docs.map((d) => d.kind).sort()).toEqual(['IPID', 'TERMS'])
    expect(docs.every((d) => d.contentHash.length > 0)).toBe(true)
    expect((await getProductDisclosureDocuments(product.id, 'en')).length).toBe(2) // M6: both locales mandatory
  })

  it('createDocument stores bytes via the storage provider and returns a row with sha256 contentHash', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const doc = await createDocument({ kind: 'PAYMENT_RECEIPT', language: 'ro', customerId: customer.id, bytes: Buffer.from('receipt'), source: 'GENERATED' })
    expect(doc.contentHash).toBe('6f32860910ca0fb2a20c7fda143666b09dbf8db5238195c90a586fb542ff0cad') // sha256('receipt'), erratum 5
    const loaded = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    expect(loaded.storageKey).toMatch(/PAYMENT_RECEIPT/)
  })

  it('reseeding does not duplicate — latest version per kind wins', async () => {
    await seedDocuments(prisma)
    const product = await prisma.product.findFirstOrThrow()
    const docs = await getProductDisclosureDocuments(product.id, 'ro')
    expect(docs.map((d) => d.kind).sort()).toEqual(['IPID', 'TERMS'])
  })
})
