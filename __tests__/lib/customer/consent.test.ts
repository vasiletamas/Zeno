import { describe, it, expect } from 'vitest'
import { deriveConsents } from '@/lib/customer/consent'
import { consentBlocksCommit } from '@/lib/engines/consent-rules'
const ev = (kind: 'gdpr_processing' | 'ai_disclosure' | 'marketing', action: 'granted' | 'withdrawn', at: string) => ({ kind, action, createdAt: new Date(at) })

describe('deriveConsents (pure reducer)', () => {
  it('latest event per kind wins; absent → false', () => {
    const c = deriveConsents([ev('gdpr_processing', 'granted', '2026-01-01'), ev('gdpr_processing', 'withdrawn', '2026-02-01'), ev('marketing', 'granted', '2026-01-05')])
    expect(c).toEqual({ gdprProcessing: false, aiDisclosure: false, marketing: true, gdprWithdrawn: true })
  })
  it('fresh customer (zero events) is NOT in the withdrawn state (B1 erratum 1)', () => {
    expect(deriveConsents([])).toEqual({ gdprProcessing: false, aiDisclosure: false, marketing: false, gdprWithdrawn: false })
  })
  it('re-grant after withdrawal clears gdprWithdrawn', () => {
    const c = deriveConsents([ev('gdpr_processing', 'granted', '2026-01-01'), ev('gdpr_processing', 'withdrawn', '2026-02-01'), ev('gdpr_processing', 'granted', '2026-03-01')])
    expect(c).toMatchObject({ gdprProcessing: true, gdprWithdrawn: false })
  })
})

describe('consentBlocksCommit (halt predicate)', () => {
  const withdrawn = { gdprProcessing: false, aiDisclosure: false, marketing: false, gdprWithdrawn: true }
  it('gdpr withdrawn blocks writing commits with reason, exempting the re-grant/withdraw/escalation floor', () => {
    expect(consentBlocksCommit(withdrawn, 'select_coverage')).toEqual({ blocked: true, reason: 'gdpr_processing_withdrawn' })
    expect(consentBlocksCommit(withdrawn, 'withdraw_consent')).toEqual({ blocked: false })
    expect(consentBlocksCommit(withdrawn, 'sign_dnt')).toEqual({ blocked: false })
    expect(consentBlocksCommit(withdrawn, 'escalate_to_human')).toEqual({ blocked: false })
    expect(consentBlocksCommit({ ...withdrawn, gdprProcessing: true, gdprWithdrawn: false }, 'select_coverage')).toEqual({ blocked: false })
  })
  it('the DNT-session commits are exempt so the re-grant path stays reachable (B1 erratum 2)', () => {
    expect(consentBlocksCommit(withdrawn, 'start_dnt_questionnaire')).toEqual({ blocked: false })
    expect(consentBlocksCommit(withdrawn, 'save_dnt_answer')).toEqual({ blocked: false })
  })
  it('a fresh customer with no events is never halted (talk is free, consent captured AT signing)', () => {
    const fresh = { gdprProcessing: false, aiDisclosure: false, marketing: false, gdprWithdrawn: false }
    expect(consentBlocksCommit(fresh, 'set_candidate_product')).toEqual({ blocked: false })
    expect(consentBlocksCommit(fresh, 'start_application')).toEqual({ blocked: false })
  })
})
