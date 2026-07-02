import { describe, it, expect } from 'vitest'
import { getRequiredSectionsFor, formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'
import { PHASES, APP_SUBPHASES } from '@/lib/engines/domain-types'

describe('getRequiredSectionsFor (A1 content-preserving mapping)', () => {
  it('DISCOVERY absorbs the old SELECTION extras', () => {
    const s = getRequiredSectionsFor('DISCOVERY', null)
    for (const k of ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing']) expect(s).toContain(k)
  })
  it('APPLICATION/DNT inherits the old CONSENT payload', () => {
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toContain('complianceGuidance')
  })
  it('APPLICATION/QUESTIONNAIRE keeps questionnaireContext + complianceGuidance', () => {
    const s = getRequiredSectionsFor('APPLICATION', 'QUESTIONNAIRE')
    expect(s).toContain('questionnaireContext'); expect(s).toContain('complianceGuidance')
  })
  it('is total over the full phase×subphase matrix (no throw, always includes situationalBriefing)', () => {
    for (const p of PHASES) for (const sub of [...APP_SUBPHASES, null]) {
      expect(getRequiredSectionsFor(p, p === 'APPLICATION' ? sub : null)).toContain('situationalBriefing')
    }
  })
})

describe('formatDerivedBriefing (new vocabulary)', () => {
  it('renders phase, subphase and the engine nextBestAction', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Phase: APPLICATION/DNT')
    expect(text).toContain('Next best action:')
  })
  it('renders blocked actions with machine reason codes so the agent can explain a block', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'COMPLETED', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [] }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Blocked actions:')
    expect(text).toContain('generate_quote (requires_consent')
    expect(text).toContain('NEVER work around a blocked action')
  })
})
