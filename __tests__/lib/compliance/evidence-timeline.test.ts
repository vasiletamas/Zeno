import { describe, it, expect } from 'vitest'
import { buildEvidenceTimeline } from '@/lib/compliance/evidence-timeline'

describe('buildEvidenceTimeline (T14.D4/D5 — references, never raw PII)', () => {
  it('merges ledger, consents, disclosures and verifications into one sorted timeline', () => {
    const tl = buildEvidenceTimeline({
      ledger: [{ id: 'l1', tool: 'sign_dnt', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:05:00Z' }],
      consents: [{ kind: 'gdpr_processing', action: 'granted', scope: null, sourceCommitId: 'l1', createdAt: '2026-07-01T10:05:00Z' }],
      disclosures: [{ kind: 'ipid', contentVersion: 'pc_v4', language: 'ro', createdAt: '2026-07-01T11:00:00Z' }],
      verifications: [{ field: 'cnp', state: 'verified', evidenceRecordId: 'ev_1', createdAt: '2026-07-01T12:00:00Z' }],
    })
    expect(tl.map((e) => e.kind)).toEqual(['commit', 'consent', 'disclosure', 'verification'])
    expect(tl[2].label).toContain('ipid')
    expect(tl[2].label).toContain('pc_v4') // content version in force — M8 pin 1
    expect(JSON.stringify(tl)).not.toMatch(/\d{13}/) // no raw CNP anywhere
  })

  it('sorts by timestamp with stable tie-break by input order (ledger, consents, disclosures, verifications)', () => {
    const at = '2026-07-01T10:00:00Z'
    const tl = buildEvidenceTimeline({
      ledger: [{ id: 'l1', tool: 'open_dnt_session', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: null, phaseTo: null, idempotencyDisposition: 'fresh', targetRef: null, createdAt: at }],
      consents: [{ kind: 'marketing', action: 'revoked', scope: null, sourceCommitId: null, createdAt: at }],
      disclosures: [],
      verifications: [{ field: 'email', state: 'channel_verified', evidenceRecordId: 'ch_1', createdAt: '2026-07-01T09:00:00Z' }],
    })
    expect(tl.map((e) => e.kind)).toEqual(['verification', 'commit', 'consent'])
  })

  it('labels carry field NAMES and provenance states only — never values (T14.D5)', () => {
    const tl = buildEvidenceTimeline({
      ledger: [],
      consents: [],
      disclosures: [],
      verifications: [{ field: 'cnp', state: 'verified', evidenceRecordId: 'ev_9', createdAt: '2026-07-01T12:00:00Z' }],
    })
    expect(tl[0].label).toBe('cnp -> verified (evidence ev_9)')
    expect(tl[0].refs).toEqual({ evidenceRecordId: 'ev_9' })
  })
})
