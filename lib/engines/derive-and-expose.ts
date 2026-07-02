import type { DomainSnapshot, Phase, AppSubphase } from './domain-types'

export function derivePhase(s: DomainSnapshot): { phase: Phase; subphase: AppSubphase | null } {
  if (s.policy !== null) return { phase: 'POLICY', subphase: null }
  if (s.acceptedQuote !== null && s.schedule.exists) return { phase: 'PAYMENT', subphase: null }
  if (s.quote !== null && !s.quote.expired) return { phase: 'QUOTE', subphase: null }
  if (s.application !== null) {
    if (!s.dnt.valid) return { phase: 'APPLICATION', subphase: 'DNT' }
    if (s.application.missingCodes.length > 0) return { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }
    return { phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' }
  }
  return { phase: 'DISCOVERY', subphase: null }
}
