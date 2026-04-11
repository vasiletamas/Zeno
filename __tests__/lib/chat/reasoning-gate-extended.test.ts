import { describe, it, expect } from 'vitest'
import type { ReasoningGateOutput } from '@/lib/chat/reasoning-gate'

describe('ReasoningGateOutput extended fields', () => {
  it('type includes recommendedSkillPacks', () => {
    const output: ReasoningGateOutput = {
      situationType: 'discovery',
      complexity: 'simple',
      confidence: 0.9,
      requiredSections: [],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['life-insurance-discovery'],
      complianceRelevant: false,
    }
    expect(output.recommendedSkillPacks).toEqual(['life-insurance-discovery'])
  })

  it('type includes modeTransition', () => {
    const output: ReasoningGateOutput = {
      situationType: 'post-sale',
      complexity: 'simple',
      confidence: 0.85,
      requiredSections: [],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['post-sale-support'],
      modeTransition: 'SUPPORT',
      complianceRelevant: false,
    }
    expect(output.modeTransition).toBe('SUPPORT')
  })

  it('type includes complianceRelevant', () => {
    const output: ReasoningGateOutput = {
      situationType: 'recommendation',
      complexity: 'complex',
      confidence: 0.95,
      requiredSections: ['productContext'],
      excludedSections: [],
      briefing: 'test',
      toolGuidance: { prioritize: [], discourage: [] },
      recommendedSkillPacks: ['life-insurance-closing'],
      complianceRelevant: true,
    }
    expect(output.complianceRelevant).toBe(true)
  })
})
