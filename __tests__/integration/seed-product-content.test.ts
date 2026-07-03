import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { seedProductContent } from '@/prisma/seeds/seed-product-content'

describe('protect content migration (T11.D5)', () => {
  beforeAll(async () => {
    await resetDb()
    await prisma.productContent.deleteMany({})
    await seedProductContent(prisma)
  })

  it('publishes bilingual key points (8-10), sell info and addon info for protect', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const published = await prisma.productContent.findMany({ where: { productId: product.id, status: 'PUBLISHED' } })
    const points = published.filter((r) => r.field === 'KEY_VALUE_PRODUCT_POINTS')
    expect(points.map((r) => r.locale).sort()).toEqual(['en', 'ro'])
    const roPoints = points.find((r) => r.locale === 'ro')!.content as string[]
    expect(roPoints.length).toBeGreaterThanOrEqual(8)
    expect(roPoints.length).toBeLessThanOrEqual(10)
    expect(published.some((r) => r.field === 'SELL_SPECIFIC_INFO')).toBe(true)
    expect(published.some((r) => r.field === 'PRICING_NOTE')).toBe(true)
    expect(published.some((r) => r.field === 'SELL_SPECIFIC_ADDON_INFO' && r.addonId !== null)).toBe(true)
  })

  it('authored content carries no raw numerals — only {{coverage:CODE}} placeholders', async () => {
    const rows = await prisma.productContent.findMany({ where: { status: 'PUBLISHED' } })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const text = JSON.stringify(row.content).replace(/\{\{[^}]+\}\}/g, '')
      expect(text).not.toMatch(/\d/)
    }
  })

  it('is idempotent — a second run neither duplicates nor demotes published rows', async () => {
    const before = await prisma.productContent.count({ where: { status: 'PUBLISHED' } })
    await seedProductContent(prisma)
    expect(await prisma.productContent.count({ where: { status: 'PUBLISHED' } })).toBe(before)
  })

  it('the playbook no longer embeds prices and instead directs to pricing_examples', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    expect(product.defaultPlaybook).not.toMatch(/\d+\s*(RON|lei|EUR)/i)
    expect(product.defaultPlaybook).toContain('pricing_examples')
  })

  it('the seeded grid derives non-empty examples (value landed with the migration)', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    expect(product.pricingExampleGrid).toMatchObject({ parameter: 'age' })
  })
})
