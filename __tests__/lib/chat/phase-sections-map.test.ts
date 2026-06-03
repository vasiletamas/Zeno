import { describe, it, expect } from 'vitest'
import { getRequiredSectionsForPhase } from '@/lib/chat/phase-sections-map'

describe('getRequiredSectionsForPhase', () => {
  it('DISCOVERY phase includes catalogOverview, capabilityManifest, customerContext', () => {
    const s = getRequiredSectionsForPhase('DISCOVERY')
    expect(s).toContain('catalogOverview')
    expect(s).toContain('capabilityManifest')
    expect(s).toContain('customerContext')
    expect(s).not.toContain('questionnaireContext')
  })
  it('SELECTION phase includes productContext, coachingBriefing, catalogOverview', () => {
    const s = getRequiredSectionsForPhase('SELECTION')
    expect(s).toContain('productContext')
    expect(s).toContain('coachingBriefing')
    expect(s).toContain('catalogOverview')
    expect(s).not.toContain('questionnaireContext')
  })
  it('CONSENT phase includes constraints, complianceGuidance', () => {
    const s = getRequiredSectionsForPhase('CONSENT')
    expect(s).toContain('constraints')
    expect(s).toContain('complianceGuidance')
    expect(s).not.toContain('questionnaireContext')
  })
  it('QUESTIONNAIRE phase includes questionnaireContext, workflowInstructions', () => {
    const s = getRequiredSectionsForPhase('QUESTIONNAIRE')
    expect(s).toContain('questionnaireContext')
    expect(s).toContain('workflowInstructions')
    expect(s).not.toContain('productContext')
  })
  it('QUOTE phase includes productContext, coachingBriefing', () => {
    const s = getRequiredSectionsForPhase('QUOTE')
    expect(s).toContain('productContext')
    expect(s).toContain('coachingBriefing')
  })
  it('CLOSING phase includes productContext, constraints', () => {
    const s = getRequiredSectionsForPhase('CLOSING')
    expect(s).toContain('productContext')
    expect(s).toContain('constraints')
  })
  it('All phases include stateGrounding (alwaysInclude)', () => {
    const phases = ['DISCOVERY', 'SELECTION', 'CONSENT', 'QUESTIONNAIRE', 'QUOTE', 'CLOSING'] as const
    for (const p of phases) expect(getRequiredSectionsForPhase(p)).toContain('stateGrounding')
  })
})
