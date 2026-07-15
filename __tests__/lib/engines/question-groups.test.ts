import { describe, it, expect, vi, beforeEach } from 'vitest'

const groupFindManySpy = vi.fn()
const convFindUniqueSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    questionGroup: { findMany: (...a: unknown[]) => groupFindManySpy(...a) },
    conversation: { findUnique: (...a: unknown[]) => convFindUniqueSpy(...a) },
  },
}))

const { resolveGroupCodes, resolveActiveProductId } = await import('@/lib/engines/question-groups')

describe('resolveGroupCodes', () => {
  beforeEach(() => { groupFindManySpy.mockReset(); convFindUniqueSpy.mockReset() })

  it('selects by phase + (product OR global), ordered, returns codes', async () => {
    groupFindManySpy.mockResolvedValueOnce([{ code: 'application' }, { code: 'bd_medical' }])
    const codes = await resolveGroupCodes('p-protect', 'application')
    expect(codes).toEqual(['application', 'bd_medical'])
    expect(groupFindManySpy).toHaveBeenCalledWith({
      where: { phase: 'application', OR: [{ productId: 'p-protect' }, { productId: null }] },
      orderBy: { orderIndex: 'asc' },
      select: { code: true },
    })
  })

  it('returns [] when nothing matches', async () => {
    groupFindManySpy.mockResolvedValueOnce([])
    expect(await resolveGroupCodes('p-x', 'dnt')).toEqual([])
  })

  it('queries global-only when productId is null', async () => {
    groupFindManySpy.mockResolvedValueOnce([{ code: 'dnt_consent' }])
    await resolveGroupCodes(null, 'dnt')
    expect(groupFindManySpy).toHaveBeenCalledWith({
      where: { phase: 'dnt', OR: [{ productId: null }] },
      orderBy: { orderIndex: 'asc' },
      select: { code: true },
    })
  })

  it('uses an injected db client instead of the global prisma (tx seam)', async () => {
    const injectedFindMany = vi.fn().mockResolvedValueOnce([{ code: 'from_injected' }])
    const injectedDb = { questionGroup: { findMany: injectedFindMany } } as unknown as Parameters<typeof resolveGroupCodes>[2]
    const codes = await resolveGroupCodes('p-protect', 'dnt', injectedDb)
    expect(codes).toEqual(['from_injected'])
    expect(injectedFindMany).toHaveBeenCalledTimes(1)
    expect(groupFindManySpy).not.toHaveBeenCalled()
  })
})

describe('resolveActiveProductId', () => {
  beforeEach(() => { groupFindManySpy.mockReset(); convFindUniqueSpy.mockReset() })

  it('returns knownProductId without a DB call', async () => {
    expect(await resolveActiveProductId('conv-1', 'p-known')).toBe('p-known')
    expect(convFindUniqueSpy).not.toHaveBeenCalled()
  })

  it('prefers committed productId over candidate', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: 'p-committed', candidateProductId: 'p-cand' })
    expect(await resolveActiveProductId('conv-1')).toBe('p-committed')
  })

  it('falls back to candidateProductId when not committed', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: null, candidateProductId: 'p-cand' })
    expect(await resolveActiveProductId('conv-1')).toBe('p-cand')
  })

  it('returns null when neither is set', async () => {
    convFindUniqueSpy.mockResolvedValueOnce({ productId: null, candidateProductId: null })
    expect(await resolveActiveProductId('conv-1')).toBeNull()
  })
})
