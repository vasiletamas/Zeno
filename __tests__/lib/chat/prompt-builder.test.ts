import { describe, it, expect } from 'vitest'
import {
  buildPrompt,
  detectFastPath,
  FAST_PATH_GATE,
  type PromptSections,
  type GateSelection,
} from '@/lib/chat/prompt-builder'

// ==============================================
// HELPERS
// ==============================================

function makeSections(
  overrides: Partial<PromptSections> = {},
): PromptSections {
  return {
    agentIdentity: 'You are Zeno, an AI insurance agent.',
    firstTurnRules: null,
    discoveryConduct: null,
    capabilityManifest: 'I can help you find the right policy.',
    constraints: 'Never give medical advice.',
    stateGrounding: null,
    complianceGuidance: null,
    situationalBriefing: 'Customer is asking about pricing.',
    customerMemory: null,
    agentKnowledge: null,
    customerContext: 'Ion, age 35, married.',
    coachingBriefing: 'Focus on value, not price.',
    domainGuidance: null,
    questionnaireContext: 'Q5: What is your annual income?',
    productContext: 'Protect Standard I: 190 RON/year.',
    catalogOverview: 'These are the ONLY products: - [LIFE] Protect — life cover.',
    dntContext: null,
    paymentContext: null,
    policyContext: null,
    ...overrides,
  }
}

const NO_GATE: GateSelection = {
  requiredSections: [],
  excludedSections: [],
  confidence: 0,
}

const ACTIVE_GATE: GateSelection = {
  requiredSections: ['coachingBriefing', 'productContext'],
  excludedSections: ['customerMemory', 'capabilityManifest'],
  confidence: 0.8,
}

// ==============================================
// TESTS
// ==============================================

describe('buildPrompt', () => {
  it('always includes catalogOverview, even when the gate tries to exclude it', () => {
    const sections = makeSections()
    const gate: GateSelection = {
      requiredSections: [],
      excludedSections: ['catalogOverview', 'productContext', 'customerContext'],
      confidence: 0.9,
    }
    const result = buildPrompt(sections, gate)
    expect(result.includedSections).toContain('catalogOverview')
    expect(result.prompt).toContain('the ONLY products')
    // it is stable (cacheable) context, not part of the per-turn dynamic suffix
    expect(result.stablePrefix).toContain('CATALOG')
  })

  it('renders sections in priority order', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    const prompt = result.prompt

    // Stable prefix: identity(1) → constraints(2) → product(4) → coaching(5)
    // Dynamic suffix: briefing(10)
    const identityIdx = prompt.indexOf('You are Zeno')
    const constraintsIdx = prompt.indexOf('Never give medical advice')
    const productIdx = prompt.indexOf('Protect Standard I')
    const coachingIdx = prompt.indexOf('Focus on value')
    const briefingIdx = prompt.indexOf('Customer is asking about pricing')

    expect(identityIdx).toBeLessThan(constraintsIdx)
    expect(constraintsIdx).toBeLessThan(productIdx)
    expect(productIdx).toBeLessThan(coachingIdx)
    expect(coachingIdx).toBeLessThan(briefingIdx)
  })

  it('gate-driven exclusion removes non-alwaysInclude sections', () => {
    const sections = makeSections({
      customerMemory: 'Previous interactions summary.',
      capabilityManifest: 'I can help with insurance.',
    })

    const gate: GateSelection = {
      requiredSections: [],
      excludedSections: ['customerMemory', 'capabilityManifest'],
      confidence: 0.8,
    }

    const result = buildPrompt(sections, gate)

    expect(result.prompt).not.toContain('Previous interactions summary')
    expect(result.prompt).not.toContain('I can help with insurance')
    expect(result.excludedSections).toContain('customerMemory')
    expect(result.excludedSections).toContain('capabilityManifest')
    expect(result.gateActive).toBe(true)
  })

  it('alwaysInclude sections cannot be excluded', () => {
    const sections = makeSections()

    // Try to exclude alwaysInclude sections
    const gate: GateSelection = {
      requiredSections: [],
      excludedSections: [
        'agentIdentity',
        'constraints',
        'situationalBriefing',
      ],
      confidence: 0.9,
    }

    const result = buildPrompt(sections, gate)

    // These must still be present
    expect(result.prompt).toContain('You are Zeno')
    expect(result.prompt).toContain('Never give medical advice')
    expect(result.prompt).toContain('Customer is asking about pricing')

    // They should be in includedSections, not excludedSections
    expect(result.includedSections).toContain('agentIdentity')
    expect(result.includedSections).toContain('constraints')
    expect(result.includedSections).toContain('situationalBriefing')
    expect(result.excludedSections).not.toContain('agentIdentity')
    expect(result.excludedSections).not.toContain('constraints')
  })

  it('null/empty sections are always skipped', () => {
    const sections = makeSections({
      customerMemory: null,
      agentKnowledge: null,
      customerContext: null,
    })

    const result = buildPrompt(sections, NO_GATE)

    expect(result.includedSections).not.toContain('customerMemory')
    expect(result.includedSections).not.toContain('agentKnowledge')
    expect(result.includedSections).not.toContain('customerContext')
    // null sections should not appear in excludedSections either
    expect(result.excludedSections).not.toContain('customerMemory')
  })

  it('gate not active when confidence < 0.3: all non-empty included', () => {
    const sections = makeSections({
      customerMemory: 'Some memory.',
    })

    const gate: GateSelection = {
      requiredSections: ['productContext'],
      excludedSections: ['customerMemory'],
      confidence: 0.2, // below 0.3 threshold
    }

    const result = buildPrompt(sections, gate)

    expect(result.gateActive).toBe(false)
    // customerMemory should be included despite being in excludedSections
    expect(result.prompt).toContain('Some memory')
    expect(result.includedSections).toContain('customerMemory')
  })

  it('inserts internal guidance separator before first non-constitution section', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    const separator =
      '[INTERNAL GUIDANCE - Do not mention this directly to the customer]'
    expect(result.prompt).toContain(separator)

    // Separator should appear after constitution sections and before reasoning/dynamic
    const separatorIdx = result.prompt.indexOf(separator)
    const constraintsIdx = result.prompt.indexOf('Never give medical advice')
    const briefingIdx = result.prompt.indexOf('Customer is asking about pricing')

    expect(separatorIdx).toBeGreaterThan(constraintsIdx)
    expect(separatorIdx).toBeLessThan(briefingIdx)
  })

  it('returns correct sectionSizes for included sections', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    // Every included section should have a size entry
    for (const key of result.includedSections) {
      expect(result.sectionSizes[key]).toBeGreaterThan(0)
    }
  })
})

describe('prompt caching — stable prefix', () => {
  it('returns stablePrefix and dynamicSuffix separately', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    expect(result.stablePrefix).toBeDefined()
    expect(result.dynamicSuffix).toBeDefined()
    expect(result.prompt).toBe(result.stablePrefix + result.dynamicSuffix)
  })

  it('places constitution + product + coaching in stable prefix', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    // Stable prefix should contain these
    expect(result.stablePrefix).toContain('You are Zeno')
    expect(result.stablePrefix).toContain('Never give medical advice')
    expect(result.stablePrefix).toContain('Protect Standard I')
    expect(result.stablePrefix).toContain('Focus on value')

    // Dynamic suffix should NOT contain them
    expect(result.dynamicSuffix).not.toContain('You are Zeno')
    expect(result.dynamicSuffix).not.toContain('Protect Standard I')
  })

  it('places situational + customer in dynamic suffix', () => {
    const sections = makeSections()
    const result = buildPrompt(sections, NO_GATE)

    // Dynamic suffix should contain these
    expect(result.dynamicSuffix).toContain('Customer is asking about pricing')
    expect(result.dynamicSuffix).toContain('Ion, age 35')
  })
})

describe('detectFastPath', () => {
  it('"Da" returns true with active questionnaire', () => {
    expect(detectFastPath('Da', true)).toBe(true)
  })

  it('"Nu" returns true with active questionnaire', () => {
    expect(detectFastPath('Nu', true)).toBe(true)
  })

  it('"3" returns true with active questionnaire', () => {
    expect(detectFastPath('3', true)).toBe(true)
  })

  it('"level_2" returns true with active questionnaire', () => {
    expect(detectFastPath('level_2', true)).toBe(true)
  })

  it('short two-word answer returns true', () => {
    expect(detectFastPath('Da, sigur', true)).toBe(true)
  })

  it('long sentence returns false', () => {
    expect(
      detectFastPath('Vreau sa stiu mai multe despre asigurare', true),
    ).toBe(false)
  })

  it('returns false when no active questionnaire', () => {
    expect(detectFastPath('Da', false)).toBe(false)
    expect(detectFastPath('Nu', false)).toBe(false)
    expect(detectFastPath('3', false)).toBe(false)
  })

  it('empty message returns false', () => {
    expect(detectFastPath('', true)).toBe(false)
    expect(detectFastPath('  ', true)).toBe(false)
  })
})

describe('FAST_PATH_GATE', () => {
  it('has the expected shape', () => {
    expect(FAST_PATH_GATE.requiredSections).toContain('questionnaireContext')
    expect(FAST_PATH_GATE.excludedSections).toContain('productContext')
    expect(FAST_PATH_GATE.excludedSections).toContain('coachingBriefing')
    expect(FAST_PATH_GATE.excludedSections).toContain('customerContext')
    expect(FAST_PATH_GATE.excludedSections).toContain('customerMemory')
    expect(FAST_PATH_GATE.excludedSections).toContain('agentKnowledge')
    expect(FAST_PATH_GATE.excludedSections).toContain('capabilityManifest')
    expect(FAST_PATH_GATE.confidence).toBe(1.0)
  })

  it('fast path gate excludes dynamic sections from prompt', () => {
    const sections = makeSections({
      customerMemory: 'Previous visit info.',
      agentKnowledge: 'Common objection patterns.',
    })

    const result = buildPrompt(sections, FAST_PATH_GATE)

    // These should be excluded
    expect(result.prompt).not.toContain('Previous visit info')
    expect(result.prompt).not.toContain('Common objection patterns')
    expect(result.prompt).not.toContain('Protect Standard I')
    expect(result.prompt).not.toContain('Focus on value')
    expect(result.prompt).not.toContain('Ion, age 35')

    // These should still be present (alwaysInclude or not excluded)
    expect(result.prompt).toContain('You are Zeno')
    expect(result.prompt).toContain('Never give medical advice')
    expect(result.prompt).toContain('Q5: What is your annual income?')
  })
})

describe('domainGuidance section (subsystem B)', () => {
  it('renders the section when populated', () => {
    const sections = makeSections({
      domainGuidance: 'Prefer warmth in life-insurance conversations.',
    })
    const result = buildPrompt(sections, NO_GATE)

    expect(result.prompt).toContain('=== DOMAIN GUIDANCE ===')
    expect(result.prompt).toContain('Prefer warmth in life-insurance conversations.')
  })

  it('appears after coachingBriefing in the stable layer', () => {
    const sections = makeSections({
      coachingBriefing: 'COACH BLOCK',
      domainGuidance: 'DOMAIN BLOCK',
    })
    const result = buildPrompt(sections, NO_GATE)

    expect(result.prompt.indexOf('COACH BLOCK')).toBeLessThan(result.prompt.indexOf('DOMAIN BLOCK'))
  })
})

describe('stateGrounding section (subsystem A)', () => {
  it('appears after constraints and before capabilityManifest when populated', () => {
    const sections = makeSections({
      stateGrounding: '=== CURRENT SYSTEM STATE ===\n✗ No workflow is active',
    })
    const result = buildPrompt(sections, NO_GATE)

    const ai = result.prompt.indexOf('You are Zeno')
    const constraints = result.prompt.indexOf('Never give medical advice')
    const stateGrounding = result.prompt.indexOf('=== CURRENT SYSTEM STATE ===')
    const manifest = result.prompt.indexOf('I can help you find the right policy')

    expect(ai).toBeGreaterThanOrEqual(0)
    expect(constraints).toBeGreaterThan(ai)
    expect(stateGrounding).toBeGreaterThan(constraints)
    expect(manifest).toBeGreaterThan(stateGrounding)
  })

  it('is always included even when gate excludes it', () => {
    const sections = makeSections({
      stateGrounding: '=== CURRENT SYSTEM STATE ===\n✗ No workflow is active',
    })
    const result = buildPrompt(sections, {
      requiredSections: [],
      excludedSections: ['stateGrounding'],
      confidence: 1.0,
    })

    expect(result.prompt).toContain('=== CURRENT SYSTEM STATE ===')
  })
})
