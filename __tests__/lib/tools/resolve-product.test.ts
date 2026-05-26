import { describe, it, expect, vi, beforeEach } from 'vitest'

const productFindUniqueSpy = vi.fn()
const productFindFirstSpy = vi.fn()
const productFindManySpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => productFindUniqueSpy(...args),
      findFirst: (...args: unknown[]) => productFindFirstSpy(...args),
      findMany: (...args: unknown[]) => productFindManySpy(...args),
    },
  },
}))

const { resolveProductRef, listAvailableProductRefs } = await import('@/lib/tools/resolve-product')

describe('resolveProductRef', () => {
  beforeEach(() => {
    productFindUniqueSpy.mockReset()
    productFindFirstSpy.mockReset()
    productFindManySpy.mockReset()
  })

  it('resolves by exact productId', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' })
    const ref = await resolveProductRef({ productId: 'p1' })
    expect(ref).toEqual({ id: 'p1', code: 'protect', matchedBy: 'id' })
    expect(productFindUniqueSpy).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { id: true, code: true },
    })
  })

  it('resolves by exact productCode (already lowercase)', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' })
    const ref = await resolveProductRef({ productCode: 'protect' })
    expect(ref).toEqual({ id: 'p1', code: 'protect', matchedBy: 'code-exact' })
  })

  it('resolves productCode with mismatched case ("Protect" → "protect")', async () => {
    // exact lookup against the trimmed-but-not-lowercased value misses
    productFindUniqueSpy.mockResolvedValueOnce(null)
    // case-insensitive findFirst hits
    productFindFirstSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' })
    const ref = await resolveProductRef({ productCode: 'Protect' })
    expect(ref).toEqual({ id: 'p1', code: 'protect', matchedBy: 'code-normalized' })
  })

  it('resolves productCode with leading/trailing whitespace', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' })
    const ref = await resolveProductRef({ productCode: '  protect  ' })
    expect(ref).toEqual({ id: 'p1', code: 'protect', matchedBy: 'code-exact' })
    expect(productFindUniqueSpy).toHaveBeenCalledWith({
      where: { code: 'protect' },
      select: { id: true, code: true },
    })
  })

  it('falls back to a single name match when code lookups fail', async () => {
    productFindUniqueSpy.mockResolvedValueOnce(null)
    productFindFirstSpy.mockResolvedValueOnce(null)
    productFindManySpy.mockResolvedValueOnce([{ id: 'p1', code: 'protect' }])
    const ref = await resolveProductRef({ productCode: 'Allianz Protect' })
    expect(ref).toEqual({ id: 'p1', code: 'protect', matchedBy: 'name' })
  })

  it('returns null when the name fallback is ambiguous (>1 match)', async () => {
    productFindUniqueSpy.mockResolvedValueOnce(null)
    productFindFirstSpy.mockResolvedValueOnce(null)
    productFindManySpy.mockResolvedValueOnce([
      { id: 'p1', code: 'protect' },
      { id: 'p2', code: 'protect-plus' },
    ])
    const ref = await resolveProductRef({ productCode: 'Protect' })
    expect(ref).toBeNull()
  })

  it('returns null when neither productId nor productCode is provided', async () => {
    const ref = await resolveProductRef({})
    expect(ref).toBeNull()
    expect(productFindUniqueSpy).not.toHaveBeenCalled()
  })

  it('returns null when nothing matches', async () => {
    productFindUniqueSpy.mockResolvedValueOnce(null)
    productFindFirstSpy.mockResolvedValueOnce(null)
    productFindManySpy.mockResolvedValueOnce([])
    const ref = await resolveProductRef({ productCode: 'unknown-product' })
    expect(ref).toBeNull()
  })

  it('prefers productId over productCode when both are passed and id resolves', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' })
    const ref = await resolveProductRef({ productId: 'p1', productCode: 'wrong-code' })
    expect(ref?.matchedBy).toBe('id')
    expect(productFindUniqueSpy).toHaveBeenCalledTimes(1)
  })

  it('treats whitespace-only inputs as missing', async () => {
    const ref = await resolveProductRef({ productCode: '   ', productId: '   ' })
    expect(ref).toBeNull()
    expect(productFindUniqueSpy).not.toHaveBeenCalled()
  })
})

describe('listAvailableProductRefs', () => {
  beforeEach(() => {
    productFindManySpy.mockReset()
  })

  it('returns only active products with id/code/name', async () => {
    productFindManySpy.mockResolvedValueOnce([
      { id: 'p1', code: 'protect', name: { ro: 'Protect', en: 'Protect' } },
    ])
    const refs = await listAvailableProductRefs()
    expect(refs).toEqual([{ id: 'p1', code: 'protect', name: { ro: 'Protect', en: 'Protect' } }])
    expect(productFindManySpy).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    })
  })
})
