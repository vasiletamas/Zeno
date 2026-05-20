import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

import {
  PACK_WRITABLE_KEYS,
  mergeSkillPackSections,
  validatePackPromptSections,
} from '@/lib/skills/skill-pack-loader'
import { logWarn } from '@/lib/errors/logger'

function pack(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p',
    slug: 'pack-x',
    name: 'X',
    category: 'PRODUCT',
    description: '',
    promptSections: {},
    allowedTools: [],
    constraints: null,
    flags: null,
    isActive: true,
    priority: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('PACK_WRITABLE_KEYS', () => {
  it('contains only domainGuidance', () => {
    expect(Array.from(PACK_WRITABLE_KEYS)).toEqual(['domainGuidance'])
  })
})

describe('mergeSkillPackSections (new contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts and merges domainGuidance from a pack', () => {
    const base = { domainGuidance: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { domainGuidance: 'Be warm.' } })] as never)
    expect(result.domainGuidance).toBe('Be warm.')
  })

  it('rejects coachingBriefing injection by a pack', () => {
    const base = { coachingBriefing: 'base coaching' } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { coachingBriefing: 'INJECTED' } })] as never)
    expect(result.coachingBriefing).toBe('base coaching')
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({
      category: 'skillpack_section_rejected',
    }))
  })

  it('rejects workflowInstructions injection by a pack', () => {
    const base = { workflowInstructions: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { workflowInstructions: 'FAKE WORKFLOW' } })] as never)
    expect(result.workflowInstructions).toBeNull()
    expect(logWarn).toHaveBeenCalled()
  })

  it('rejects productContext injection by a pack', () => {
    const base = { productContext: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ promptSections: { productContext: 'FAKE PRODUCT' } })] as never)
    expect(result.productContext).toBeNull()
    expect(logWarn).toHaveBeenCalled()
  })

  it('appends pack constraints to base constraints', () => {
    const base = { constraints: 'base rule' } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [pack({ constraints: 'pack rule' })] as never)
    expect(result.constraints).toBe('base rule\npack rule')
  })

  it('first-pack-wins on conflicting domainGuidance', () => {
    const base = { domainGuidance: null } as Record<string, string | null>
    const result = mergeSkillPackSections(base, [
      pack({ slug: 'a', priority: 20, promptSections: { domainGuidance: 'A wins' } }),
      pack({ slug: 'b', priority: 10, promptSections: { domainGuidance: 'B loses' } }),
    ] as never)
    expect(result.domainGuidance).toBe('A wins')
  })
})

describe('validatePackPromptSections', () => {
  it('valid when only domainGuidance is present', () => {
    expect(validatePackPromptSections({ domainGuidance: 'x' })).toEqual({ valid: true, invalidKeys: [] })
  })

  it('invalid when reserved keys are present', () => {
    const result = validatePackPromptSections({ coachingBriefing: 'x', productContext: 'y' })
    expect(result.valid).toBe(false)
    expect(result.invalidKeys).toEqual(expect.arrayContaining(['coachingBriefing', 'productContext']))
  })

  it('valid when sections is empty', () => {
    expect(validatePackPromptSections({})).toEqual({ valid: true, invalidKeys: [] })
  })
})
