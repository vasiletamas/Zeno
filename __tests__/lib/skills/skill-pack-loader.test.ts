import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getSkillPack,
  getActiveSkillPacks,
  mergeSkillPackSections,
  computeAllowedTools,
  flushSkillPackCache,
} from '@/lib/skills/skill-pack-loader'

// ============================================================
// MOCKS
// ============================================================

vi.mock('@/lib/db', () => ({
  prisma: {
    skillPack: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'

// ============================================================
// HELPERS
// ============================================================

function makeSkillPack(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pack-1',
    slug: 'life-insurance-basic',
    name: 'Life Insurance Basic',
    category: 'PRODUCT',
    description: 'Basic life insurance skill pack',
    promptSections: { productContext: 'Protect Standard I content', coachingBriefing: 'Focus on value' },
    allowedTools: ['search_products', 'calculate_premium'],
    constraints: 'Always disclose policy limits.',
    flags: { persuasive: true },
    isActive: true,
    priority: 10,
    agents: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ============================================================
// getSkillPack tests
// ============================================================

describe('getSkillPack', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('loads a skill pack by slug', async () => {
    const pack = makeSkillPack()
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as any)

    const result = await getSkillPack('life-insurance-basic')

    expect(prisma.skillPack.findUnique).toHaveBeenCalledWith({
      where: { slug: 'life-insurance-basic' },
    })
    expect(result).toEqual(pack)
  })

  it('caches result on second call (findUnique called only once)', async () => {
    const pack = makeSkillPack()
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as any)

    await getSkillPack('life-insurance-basic')
    await getSkillPack('life-insurance-basic')

    expect(prisma.skillPack.findUnique).toHaveBeenCalledTimes(1)
  })

  it('throws on inactive skill pack', async () => {
    const pack = makeSkillPack({ isActive: false })
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(pack as any)

    await expect(getSkillPack('life-insurance-basic')).rejects.toThrow(
      'SkillPack life-insurance-basic is inactive',
    )
  })

  it('throws on unknown slug', async () => {
    vi.mocked(prisma.skillPack.findUnique).mockResolvedValue(null)

    await expect(getSkillPack('unknown-slug')).rejects.toThrow(
      'SkillPack unknown-slug not found',
    )
  })
})

// ============================================================
// getActiveSkillPacks tests
// ============================================================

describe('getActiveSkillPacks', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('returns empty array for empty slugs', async () => {
    const result = await getActiveSkillPacks([])
    expect(result).toEqual([])
    expect(prisma.skillPack.findMany).not.toHaveBeenCalled()
  })

  it('returns packs sorted by priority descending', async () => {
    const packLow = makeSkillPack({ slug: 'pack-low', priority: 5 })
    const packHigh = makeSkillPack({ slug: 'pack-high', priority: 20 })
    const packMid = makeSkillPack({ slug: 'pack-mid', priority: 10 })
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([packLow, packHigh, packMid] as any)

    const result = await getActiveSkillPacks(['pack-low', 'pack-high', 'pack-mid'])

    expect(result[0].slug).toBe('pack-high')
    expect(result[1].slug).toBe('pack-mid')
    expect(result[2].slug).toBe('pack-low')
  })

  it('filters out inactive packs silently', async () => {
    const activePack = makeSkillPack({ slug: 'active-pack', isActive: true })
    const inactivePack = makeSkillPack({ slug: 'inactive-pack', isActive: false })
    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([activePack, inactivePack] as any)

    const result = await getActiveSkillPacks(['active-pack', 'inactive-pack'])

    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('active-pack')
  })
})

// ============================================================
// mergeSkillPackSections tests
// ============================================================

describe('mergeSkillPackSections', () => {
  const baseSections = {
    agentIdentity: 'You are Zeno.',
    constraints: 'Never give medical advice.',
    capabilityManifest: 'I can help find policies.',
    productContext: null as string | null,
    coachingBriefing: null as string | null,
    situationalBriefing: null as string | null,
  }

  it('merges pack sections into base sections', () => {
    const packs = [
      makeSkillPack({
        promptSections: { productContext: 'Product details here' },
        constraints: null,
        priority: 10,
      }),
    ]

    const result = mergeSkillPackSections(baseSections, packs as any)

    expect(result.productContext).toBe('Product details here')
  })

  it('never overrides constitution layer (agentIdentity, constraints key from promptSections, capabilityManifest)', () => {
    const packs = [
      makeSkillPack({
        promptSections: {
          agentIdentity: 'Hacked identity',
          capabilityManifest: 'Hacked manifest',
          productContext: 'Legitimate product context',
        },
        constraints: null,
        priority: 10,
      }),
    ]

    const result = mergeSkillPackSections(baseSections, packs as any)

    expect(result.agentIdentity).toBe('You are Zeno.')
    expect(result.capabilityManifest).toBe('I can help find policies.')
    expect(result.productContext).toBe('Legitimate product context')
  })

  it('higher priority pack wins on conflicts', () => {
    const lowPriorityPack = makeSkillPack({
      slug: 'low',
      promptSections: { coachingBriefing: 'Low priority coaching' },
      constraints: null,
      priority: 5,
    })
    const highPriorityPack = makeSkillPack({
      slug: 'high',
      promptSections: { coachingBriefing: 'High priority coaching' },
      constraints: null,
      priority: 20,
    })
    // packs must be sorted descending by priority (highest first)
    const packs = [highPriorityPack, lowPriorityPack]

    const result = mergeSkillPackSections(baseSections, packs as any)

    expect(result.coachingBriefing).toBe('High priority coaching')
  })

  it('appends pack constraints to base constraints (not replaces)', () => {
    const packs = [
      makeSkillPack({
        promptSections: {},
        constraints: 'Always disclose policy limits.',
        priority: 10,
      }),
    ]

    const result = mergeSkillPackSections(baseSections, packs as any)

    expect(result.constraints).toContain('Never give medical advice.')
    expect(result.constraints).toContain('Always disclose policy limits.')
  })

  it('returns base sections unchanged when no packs', () => {
    const result = mergeSkillPackSections(baseSections, [])

    expect(result).toEqual(baseSections)
  })
})

// ============================================================
// computeAllowedTools tests
// ============================================================

describe('computeAllowedTools', () => {
  it('returns intersection of workflow tools and pack tools', () => {
    const workflowTools = ['search_products', 'calculate_premium', 'send_email']
    const packs = [
      makeSkillPack({ allowedTools: ['search_products', 'calculate_premium', 'admin_tool'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining(['search_products', 'calculate_premium']))
    expect(result).not.toContain('send_email')
    expect(result).not.toContain('admin_tool')
  })

  it('returns workflow tools when no packs active', () => {
    const workflowTools = ['search_products', 'calculate_premium']

    const result = computeAllowedTools(workflowTools, [])

    expect(result).toEqual(['search_products', 'calculate_premium'])
  })

  it('unions tools from multiple packs before intersecting', () => {
    const workflowTools = ['search_products', 'calculate_premium', 'send_email', 'get_quote']
    const packs = [
      makeSkillPack({ slug: 'pack-a', allowedTools: ['search_products', 'calculate_premium'] }),
      makeSkillPack({ slug: 'pack-b', allowedTools: ['send_email', 'get_quote'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual(expect.arrayContaining(['search_products', 'calculate_premium', 'send_email', 'get_quote']))
    expect(result).toHaveLength(4)
  })

  it('returns empty array when no overlap', () => {
    const workflowTools = ['admin_tool', 'restricted_action']
    const packs = [
      makeSkillPack({ allowedTools: ['search_products', 'calculate_premium'] }),
    ]

    const result = computeAllowedTools(workflowTools, packs as any)

    expect(result).toEqual([])
  })
})
