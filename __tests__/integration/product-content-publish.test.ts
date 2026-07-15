import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { publishProductContent, getPublishedProductContent, invalidateProductContentCache } from '@/lib/products/product-content'

describe('ProductContent publish workflow (E1.3, T11.D2)', () => {
  let productId: string
  beforeAll(async () => { await resetDb() })
  beforeEach(async () => {
    await prisma.productContent.deleteMany({})
    invalidateProductContentCache()
    productId = (await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })).id
  })

  it('refuses to publish when a locale is missing — reason missing_locale', async () => {
    await prisma.productContent.create({ data: { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'doar romana', version: 1, authoredBy: 't' } })
    const r = await publishProductContent({ productId, addonId: null, field: 'SELL_SPECIFIC_INFO', version: 1, approvedBy: 'op-1' })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'missing_locale' })
    const rows = await prisma.productContent.findMany({ where: { productId } })
    expect(rows.every((x) => x.status === 'DRAFT')).toBe(true)
  })

  it('publishes both locales atomically, retires the prior published version, surfaces version stamps', async () => {
    await prisma.productContent.createMany({ data: [
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'v unu', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'en', content: 'v one', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: 'v doi', version: 2, authoredBy: 't' },
      { productId, field: 'SELL_SPECIFIC_INFO', locale: 'en', content: 'v two', version: 2, authoredBy: 't' },
    ] })
    const r = await publishProductContent({ productId, addonId: null, field: 'SELL_SPECIFIC_INFO', version: 2, approvedBy: 'op-1' })
    expect(r.outcome).toBe('applied')
    const published = await prisma.productContent.findMany({ where: { productId, status: 'PUBLISHED' } })
    expect(published).toHaveLength(2)
    expect(published.every((x) => x.version === 2 && x.approvedBy === 'op-1')).toBe(true)
    const retired = await prisma.productContent.findMany({ where: { productId, status: 'RETIRED' } })
    expect(retired).toHaveLength(2)
    const read = await getPublishedProductContent(productId)
    expect(read.fields.SELL_SPECIFIC_INFO).toMatchObject({ version: 2, ro: 'v doi', en: 'v two' })
    expect(read.fields.SELL_SPECIFIC_INFO!.contentIds).toHaveLength(2) // M8 turn-snapshot stamps
  })

  it('rejects numerals at publish time — reason numerals_in_authored_content', async () => {
    await prisma.productContent.createMany({ data: [
      { productId, field: 'PRICING_NOTE', locale: 'ro', content: 'costa 190 lei', version: 1, authoredBy: 't' },
      { productId, field: 'PRICING_NOTE', locale: 'en', content: 'costs vary by level', version: 1, authoredBy: 't' },
    ] })
    const r = await publishProductContent({ productId, addonId: null, field: 'PRICING_NOTE', version: 1, approvedBy: 'op-1' })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'numerals_in_authored_content' })
  })

  it('renders {{coverage:CODE}} placeholders from live coverage rows at read time', async () => {
    await prisma.productContent.createMany({ data: [
      { productId, field: 'PRICING_NOTE', locale: 'ro', content: 'acoperire pana la {{coverage:TREATMENT_COSTS}}', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
      { productId, field: 'PRICING_NOTE', locale: 'en', content: 'covered up to {{coverage:TREATMENT_COSTS}}', version: 1, authoredBy: 't', status: 'PUBLISHED', publishedAt: new Date() },
    ] })
    const read = await getPublishedProductContent(productId)
    // seeded TREATMENT_COSTS addon coverage: 2,000,000 EUR
    expect(read.fields.PRICING_NOTE!.en).toBe('covered up to 2,000,000 EUR')
  })
})
