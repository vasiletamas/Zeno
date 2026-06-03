import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueSpy = vi.fn()
const findFirstSpy = vi.fn()
const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { product: { findUnique: (...a: unknown[]) => findUniqueSpy(...a), findFirst: (...a: unknown[]) => findFirstSpy(...a), findMany: (...a: unknown[]) => findManySpy(...a) } } }))
const { resolveProductRef } = await import('@/lib/tools/resolve-product')

describe('resolveProductRef – tolerant', () => {
  beforeEach(() => { findUniqueSpy.mockReset(); findFirstSpy.mockReset(); findManySpy.mockReset() })

  it('resolves "home" via alias to property (no diacritics → diacritic query is skipped)', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)   // 1. exact code
    findFirstSpy.mockResolvedValueOnce(null)    // 2. case-insensitive code
    findManySpy.mockResolvedValueOnce([])       // 3. name substring
    // 'home' has no diacritics → the diacritic findFirst is GUARDED OUT (not called)
    findFirstSpy.mockResolvedValueOnce({ id: 'p-prop', code: 'property' }) // 4. alias findFirst
    const ref = await resolveProductRef({ productCode: 'home' })
    expect(ref).toEqual({ id: 'p-prop', code: 'property', matchedBy: 'alias' })
    expect(findFirstSpy).toHaveBeenCalledTimes(2) // ci + alias only (diacritic skipped)
  })

  it('resolves "locuință" via diacritic-normalized code', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)   // 1. exact
    findFirstSpy.mockResolvedValueOnce(null)    // 2. ci
    findManySpy.mockResolvedValueOnce([])       // 3. name
    findFirstSpy.mockResolvedValueOnce({ id: 'p-prop', code: 'locuinta' }) // 4. diacritic findFirst (locuință→locuinta, runs)
    const ref = await resolveProductRef({ productCode: 'locuință' })
    expect(ref).toEqual({ id: 'p-prop', code: 'locuinta', matchedBy: 'code-normalized' })
  })

  it('returns null when nothing matches', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)   // 1. exact
    findFirstSpy.mockResolvedValueOnce(null)    // 2. ci
    findManySpy.mockResolvedValueOnce([])       // 3. name
    // 'nonsense': no diacritics (diacritic skipped) AND no alias → returns null
    const ref = await resolveProductRef({ productCode: 'nonsense' })
    expect(ref).toBeNull()
  })
})
