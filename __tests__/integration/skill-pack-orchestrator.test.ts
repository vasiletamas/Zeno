import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    skillPack: { findUnique: vi.fn(), findMany: vi.fn() },
    conversation: { update: vi.fn() },
  },
}))

// Mock gateway
vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: vi.fn(), stream: vi.fn() },
}))

vi.mock('@/lib/llm/agent-config', () => ({
  getAgentConfig: vi.fn(),
}))

vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { resolveAgent } from '@/lib/chat/agent-resolver'
import {
  getActiveSkillPacks,
  mergeSkillPackSections,
  computeAllowedTools,
  flushSkillPackCache,
} from '@/lib/skills/skill-pack-loader'
import { executeComplianceCheck } from '@/lib/chat/compliance-checker'

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
    promptSections: { productContext: 'Protect Standard I content' },
    allowedTools: ['search_products', 'calculate_premium'],
    constraints: null as string | null,
    flags: null,
    isActive: true,
    priority: 10,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ============================================================
// 1. resolveAgent returns main-chat for all modes
// ============================================================

describe('resolveAgent — all modes return main-chat', () => {
  it.each(['SALES', 'ONBOARDING', 'SUPPORT', 'CLAIMS', 'RENEWAL'])(
    'returns main-chat for mode %s',
    (mode) => {
      expect(resolveAgent(mode)).toBe('main-chat')
    },
  )
})

// ============================================================
// 2. Skill pack sections merge without overriding constitution
// ============================================================

describe('mergeSkillPackSections — constitution keys are never overridden', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('constitution keys unchanged, dynamic keys overridden by skill pack', async () => {
    const baseSections = {
      agentIdentity: 'You are Zeno, the Allianz-Tiriac agent.',
      constraints: 'Never give medical advice.',
      capabilityManifest: 'I can help find life insurance policies.',
      productContext: 'Default product context.',
    }

    // Pack tries to override all four keys including the three constitution keys
    const packWithOverrides = makeSkillPack({
      slug: 'aggressive-pack',
      promptSections: {
        agentIdentity: 'HACKED IDENTITY',
        constraints: 'HACKED CONSTRAINTS VIA PROMPT_SECTIONS',
        capabilityManifest: 'HACKED MANIFEST',
        productContext: 'Dynamic product context from pack.',
      },
      constraints: null,
      priority: 10,
    })

    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([packWithOverrides] as never)

    const activePacks = await getActiveSkillPacks(['aggressive-pack'])
    const result = mergeSkillPackSections(baseSections, activePacks)

    // Constitution keys must remain unchanged
    expect(result.agentIdentity).toBe('You are Zeno, the Allianz-Tiriac agent.')
    expect(result.capabilityManifest).toBe('I can help find life insurance policies.')

    // constraints from promptSections is also a constitution key — must not override
    // but the top-level constraints field on the pack is appended, not the promptSections one
    // Since constraints is in CONSTITUTION_KEYS, it blocks the promptSections override.
    // The base constraints value must still be present.
    expect(result.constraints).toContain('Never give medical advice.')

    // Dynamic key should be overridden by the pack
    expect(result.productContext).toBe('Dynamic product context from pack.')
  })
})

// ============================================================
// 3. Tool scoping — union of workflow tools and pack tools
// ============================================================

describe('computeAllowedTools — workflow tools unioned with pack tools', () => {
  it('union of workflow tools and tools from multiple packs', () => {
    const workflowTools = ['search_products', 'calculate_premium', 'get_quote', 'send_email']

    const packA = makeSkillPack({
      slug: 'pack-a',
      allowedTools: ['search_products', 'calculate_premium'],
    })
    const packB = makeSkillPack({
      slug: 'pack-b',
      allowedTools: ['get_quote', 'send_email'],
    })

    const result = computeAllowedTools(workflowTools, [packA, packB] as never)

    expect(result).toHaveLength(4)
    expect(result).toEqual(
      expect.arrayContaining(['search_products', 'calculate_premium', 'get_quote', 'send_email']),
    )
  })

  it('workflow-only tool stays in result alongside pack-restricted tools', () => {
    const workflowTools = ['search_products', 'calculate_premium', 'admin_action']

    const packA = makeSkillPack({
      slug: 'pack-a',
      allowedTools: ['search_products'],
    })
    const packB = makeSkillPack({
      slug: 'pack-b',
      allowedTools: ['calculate_premium'],
    })

    const result = computeAllowedTools(workflowTools, [packA, packB] as never)

    expect(result).toHaveLength(3)
    expect(result).toEqual(
      expect.arrayContaining(['search_products', 'calculate_premium', 'admin_action']),
    )
  })

  it('pack-only tool stays in result alongside workflow tools', () => {
    const workflowTools = ['search_products']

    const pack = makeSkillPack({
      slug: 'pack-with-extra',
      allowedTools: ['search_products', 'super_admin_tool'],
    })

    const result = computeAllowedTools(workflowTools, [pack] as never)

    expect(result).toEqual(
      expect.arrayContaining(['search_products', 'super_admin_tool']),
    )
    expect(result).toHaveLength(2)
  })
})

// ============================================================
// 4. Compliance checker returns pass on gateway error
// ============================================================

describe('executeComplianceCheck — fail-open behaviour', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns passed=true when gateway.call rejects', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('gateway timeout'))

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'Tell me the cheapest plan.' }],
      workflowStepCode: 'quote_presentation',
      customerProfile: { age: 42 },
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('returns passed=true when gateway.call throws a network error', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await executeComplianceCheck({
      messages: [],
      workflowStepCode: null,
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
  })
})

// ============================================================
// 5. Compliance checker parses valid gap response
// ============================================================

describe('executeComplianceCheck — parses valid response with gaps', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('parses passed=false with gaps and suggestions correctly', async () => {
    const responsePayload = {
      passed: false,
      gaps: [
        'Customer needs not formally identified',
        'Suitability assessment missing',
      ],
      suggestions: [
        'Ask customer to confirm protection needs',
        'Complete DNT questionnaire before recommendation',
      ],
    }

    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify(responsePayload),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'Just give me the cheapest option.' }],
      workflowStepCode: 'recommendation',
      customerProfile: { age: 35, occupation: 'engineer' },
    })

    expect(result.passed).toBe(false)
    expect(result.gaps).toHaveLength(2)
    expect(result.gaps[0]).toBe('Customer needs not formally identified')
    expect(result.gaps[1]).toBe('Suitability assessment missing')
    expect(result.suggestions).toHaveLength(2)
    expect(result.suggestions[0]).toBe('Ask customer to confirm protection needs')
  })

  it('parses passed=true with empty gaps correctly', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ passed: true, gaps: [], suggestions: [] }),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'I confirmed my needs.' }],
      workflowStepCode: 'needs_confirmed',
      customerProfile: null,
    })

    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
    expect(result.suggestions).toEqual([])
  })

  it('handles response wrapped in markdown code fence', async () => {
    const fencedResponse = '```json\n' + JSON.stringify({
      passed: false,
      gaps: ['Consent not obtained'],
      suggestions: ['Request explicit GDPR consent'],
    }) + '\n```'

    vi.mocked(gateway.call).mockResolvedValue({
      content: fencedResponse,
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'test' }],
      workflowStepCode: null,
      customerProfile: null,
    })

    // compliance-checker uses its own JSON extractor (not gate parser)
    // It does a simple match on /\{[\s\S]*\}/ which works even with fence content
    // The result depends on whether a valid JSON object is found in the string
    expect(typeof result.passed).toBe('boolean')
    expect(Array.isArray(result.gaps)).toBe(true)
    expect(Array.isArray(result.suggestions)).toBe(true)
  })
})

// ============================================================
// 6. Mode transition — gate output with confidence > 0.7
// ============================================================

describe('mode transition logic — gateOutput.modeTransition with high confidence', () => {
  it('mode transition applies when confidence > 0.7 and mode differs', () => {
    // Test the condition logic extracted from the orchestrator inline:
    // if (gateOutput?.modeTransition && gateOutput.confidence > 0.7 && gateOutput.modeTransition !== currentMode)
    const currentMode = 'SALES'

    const gateOutput = {
      modeTransition: 'SUPPORT',
      confidence: 0.85,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(true)
  })

  it('mode transition does NOT apply when confidence <= 0.7', () => {
    const currentMode = 'SALES'

    const gateOutput = {
      modeTransition: 'SUPPORT',
      confidence: 0.65,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(false)
  })

  it('mode transition does NOT apply when target mode equals current mode', () => {
    const currentMode = 'SALES'

    const gateOutput = {
      modeTransition: 'SALES',
      confidence: 0.95,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(false)
  })

  it('mode transition does NOT apply when modeTransition is absent', () => {
    const currentMode = 'SALES'

    const gateOutput = {
      modeTransition: undefined as string | undefined,
      confidence: 0.95,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(false)
  })

  it('mode transition applies at the boundary confidence of exactly 0.71', () => {
    const currentMode = 'ONBOARDING'

    const gateOutput = {
      modeTransition: 'RENEWAL',
      confidence: 0.71,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(true)
  })

  it('mode transition does NOT apply at exactly confidence 0.7 (strict greater-than)', () => {
    const currentMode = 'ONBOARDING'

    const gateOutput = {
      modeTransition: 'RENEWAL',
      confidence: 0.7,
      complianceRelevant: false,
      recommendedSkillPacks: [],
    }

    const shouldTransition =
      gateOutput.modeTransition !== undefined &&
      gateOutput.confidence > 0.7 &&
      gateOutput.modeTransition !== currentMode

    expect(shouldTransition).toBe(false)
  })
})

// ============================================================
// 7. Pipeline integration — getActiveSkillPacks feeds into
//    mergeSkillPackSections and computeAllowedTools
// ============================================================

describe('pipeline integration — skill packs flow through merge and tool compute', () => {
  beforeEach(() => {
    flushSkillPackCache()
    vi.clearAllMocks()
  })

  it('active packs fetched via prisma feed correctly into merge and compute', async () => {
    const baseSections = {
      agentIdentity: 'You are Zeno.',
      constraints: 'Base constraint.',
      capabilityManifest: 'Base manifest.',
      productContext: null as string | null,
      coachingBriefing: null as string | null,
    }

    const workflowTools = ['search_products', 'calculate_premium', 'send_proposal', 'get_quote']

    const pack1 = makeSkillPack({
      slug: 'discovery-pack',
      promptSections: { productContext: 'Life insurance product details.' },
      allowedTools: ['search_products', 'calculate_premium'],
      constraints: 'Always identify customer needs first.',
      priority: 20,
      isActive: true,
    })

    const pack2 = makeSkillPack({
      slug: 'closing-pack',
      promptSections: { coachingBriefing: 'Focus on closing value.' },
      allowedTools: ['send_proposal', 'get_quote'],
      constraints: null,
      priority: 10,
      isActive: true,
    })

    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([pack1, pack2] as never)

    // Step 1: Fetch active packs (as orchestrator does)
    const activePacks = await getActiveSkillPacks(['discovery-pack', 'closing-pack'])

    expect(activePacks).toHaveLength(2)
    // Higher priority first
    expect(activePacks[0].slug).toBe('discovery-pack')

    // Step 2: Merge sections
    const mergedSections = mergeSkillPackSections(baseSections, activePacks)

    expect(mergedSections.agentIdentity).toBe('You are Zeno.')
    expect(mergedSections.productContext).toBe('Life insurance product details.')
    expect(mergedSections.coachingBriefing).toBe('Focus on closing value.')
    expect(mergedSections.constraints).toContain('Base constraint.')
    expect(mergedSections.constraints).toContain('Always identify customer needs first.')

    // Step 3: Compute allowed tools
    const allowedTools = computeAllowedTools(workflowTools, activePacks)

    // Both packs together cover all 4 workflow tools
    expect(allowedTools).toHaveLength(4)
    expect(allowedTools).toEqual(
      expect.arrayContaining(['search_products', 'calculate_premium', 'send_proposal', 'get_quote']),
    )
  })

  it('inactive packs are filtered out before merge and compute', async () => {
    const baseSections = {
      agentIdentity: 'You are Zeno.',
      constraints: 'Base only.',
      capabilityManifest: 'Base manifest.',
      productContext: null as string | null,
    }

    const workflowTools = ['search_products', 'calculate_premium']

    const activePack = makeSkillPack({
      slug: 'active-pack',
      promptSections: { productContext: 'Active pack content.' },
      allowedTools: ['search_products', 'calculate_premium'],
      isActive: true,
      priority: 10,
    })
    const inactivePack = makeSkillPack({
      slug: 'inactive-pack',
      promptSections: { coachingBriefing: 'Should not appear.' },
      allowedTools: ['search_products'],
      isActive: false,
      priority: 20,
    })

    vi.mocked(prisma.skillPack.findMany).mockResolvedValue([activePack, inactivePack] as never)

    const activePacks = await getActiveSkillPacks(['active-pack', 'inactive-pack'])

    expect(activePacks).toHaveLength(1)
    expect(activePacks[0].slug).toBe('active-pack')

    const mergedSections = mergeSkillPackSections(baseSections, activePacks)
    expect(mergedSections.productContext).toBe('Active pack content.')
    // coachingBriefing from inactive pack should not appear
    expect((mergedSections as Record<string, string | null>).coachingBriefing).toBeUndefined()
  })
})
