import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAbTestFindMany = vi.fn()
const mockAbTestUpdate = vi.fn()
const mockConversationUpdate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    aBTestVariant: {
      findMany: (...args: unknown[]) => mockAbTestFindMany(...args),
      update: (...args: unknown[]) => mockAbTestUpdate(...args),
    },
    conversation: {
      update: (...args: unknown[]) => mockConversationUpdate(...args),
    },
  },
}))

const { applyABTestVariant } = await import('@/lib/self-improvement/ab-test-assigner')

describe('applyABTestVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('swaps skill pack slug when assigned to variant B', async () => {
    mockAbTestFindMany.mockResolvedValue([
      {
        id: 'test-1',
        skillPackSlugA: 'discovery-v1',
        skillPackSlugB: 'discovery-v2',
        splitRatio: 1.0, // 100% go to B
        isActive: true,
      },
    ])
    mockAbTestUpdate.mockResolvedValue({})
    mockConversationUpdate.mockResolvedValue({})

    const slugs = ['discovery-v1', 'closing']
    const result = await applyABTestVariant(slugs, 'conv-1')

    expect(result).toContain('discovery-v2')
    expect(result).toContain('closing')
    expect(result).not.toContain('discovery-v1')
  })

  it('keeps original slug when assigned to variant A', async () => {
    mockAbTestFindMany.mockResolvedValue([
      {
        id: 'test-2',
        skillPackSlugA: 'discovery-v1',
        skillPackSlugB: 'discovery-v2',
        splitRatio: 0.0, // 0% go to B — all stay on A
        isActive: true,
      },
    ])
    mockAbTestUpdate.mockResolvedValue({})

    const slugs = ['discovery-v1']
    const result = await applyABTestVariant(slugs, 'conv-2')

    expect(result).toContain('discovery-v1')
    expect(result).not.toContain('discovery-v2')
  })

  it('returns original slugs when no active tests exist', async () => {
    mockAbTestFindMany.mockResolvedValue([])

    const slugs = ['discovery-v1', 'closing']
    const result = await applyABTestVariant(slugs, 'conv-3')

    expect(result).toEqual(['discovery-v1', 'closing'])
  })
})
