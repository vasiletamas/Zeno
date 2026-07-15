import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'

describe('ProductContent model (E1.1)', () => {
  beforeAll(async () => {
    await resetDb()
    // E1.8: resetDb seeds+publishes the real v1 content — clear it so the
    // uniqueness probes below own their rows
    await prisma.productContent.deleteMany({})
  })

  it('stores a draft row and enforces (product, addon, field, locale, version) uniqueness', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const row = await prisma.productContent.create({
      data: {
        productId: product.id, field: 'SELL_SPECIFIC_INFO', locale: 'ro',
        content: 'narativ de vanzare fara cifre', version: 1, authoredBy: 'seed',
      },
    })
    expect(row.status).toBe('DRAFT')
    // erratum 1: NULL addonId rows must ALSO be unique — the partial unique
    // index (WHERE "addonId" IS NULL) rejects this duplicate; a plain
    // @@unique would let it through (NULLs are distinct on Postgres).
    await expect(
      prisma.productContent.create({
        data: {
          productId: product.id, field: 'SELL_SPECIFIC_INFO', locale: 'ro',
          content: 'duplicat', version: 1, authoredBy: 'seed',
        },
      }),
    ).rejects.toThrow()
  })

  it('enforces uniqueness for addon-scoped rows too', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    const addon = await prisma.addon.findFirstOrThrow({ where: { productId: product.id } })
    await prisma.productContent.create({
      data: {
        productId: product.id, addonId: addon.id, field: 'SELL_SPECIFIC_ADDON_INFO', locale: 'en',
        content: 'addon narrative', version: 1, authoredBy: 'seed',
      },
    })
    await expect(
      prisma.productContent.create({
        data: {
          productId: product.id, addonId: addon.id, field: 'SELL_SPECIFIC_ADDON_INFO', locale: 'en',
          content: 'duplicate', version: 1, authoredBy: 'seed',
        },
      }),
    ).rejects.toThrow()
  })

  it('Product carries the declared pricing-example grid as data, not code', async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
    expect(product.pricingExampleGrid).toBeDefined() // column exists (value seeded in E1.8)
  })
})
