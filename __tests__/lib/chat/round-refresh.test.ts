import { describe, it, expect } from 'vitest'
import { shouldRefreshExposure, formatRoundRefreshMessage } from '@/lib/chat/round-refresh'

describe('per-round exposure refresh', () => {
  it('refreshes when at least one envelope outcome is applied (NOT only on advance_phase — cascades change legality too)', () => {
    expect(shouldRefreshExposure([{ outcome: 'applied', effects: [] }])).toBe(true)
    expect(shouldRefreshExposure([{ outcome: 'rejected', effects: [] }, { outcome: 'requires_confirmation', effects: [] }])).toBe(false)
  })
  it('renders a compact actions message (phase + available + blocked, no full state dump)', () => {
    const msg = formatRoundRefreshMessage({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' } as never, { available: ['save_application_answer', 'escalate_to_human'], blocked: [{ action: 'generate_quote', reason: 'questionnaire_incomplete' }] })
    expect(msg).toContain('[State update]')
    expect(msg).toContain('APPLICATION/QUESTIONNAIRE')
    expect(msg).toContain('save_application_answer')
    expect(msg).toContain('generate_quote (questionnaire_incomplete)')
  })
})
