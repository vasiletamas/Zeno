/**
 * Snapshot literals for spec translations (F1.6, T12.D3 — NO mocked prisma).
 *
 * Deviation from the plan literal: Block A's REAL DomainSnapshot (see
 * lib/engines/domain-types.ts) differs from the plan's June sketch, and the
 * engine ring already maintains a faithful factory — reuse it rather than
 * fork a second literal ("if field names differ, adjust THIS literal only").
 */
import type { DomainSnapshot } from '@/lib/engines/domain-types'
export { makeSnapshot } from '@/__tests__/lib/engines/snapshot-fixtures'

/** Open application, questionnaire incomplete. */
export const OPEN_APP = {
  id: 'app-1', status: 'OPEN' as const, tier: null, level: null, addon: null,
  answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false,
}

/** Completed application ready for quote generation / carrying a quote. */
export const COMPLETED_APP = {
  ...OPEN_APP, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [],
}

/** Valid signed DNT covering LIFE — legacy slice + B2 aggregate facts. */
export const VALID_DNT: DomainSnapshot['dnt'] = {
  signed: true, valid: true, validUntil: '2099-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'],
  answeredCount: 5, totalCount: 5, sessionActive: false,
  latest: { status: 'ACTIVE', signedAt: '2026-06-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z', productTypesCovered: ['LIFE'] },
  activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {},
}

/** Live active DNT session (mid-questionnaire). */
export const ACTIVE_SESSION_DNT: DomainSnapshot['dnt'] = {
  signed: false, valid: false, validUntil: null, coversProductTypes: [],
  answeredCount: 0, totalCount: 5, sessionActive: true,
  latest: null, activeSessionId: 'ds-1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 5, facts: {},
}

/** Issued, unexpired quote with no outstanding disclosures. */
export const ISSUED_QUOTE: NonNullable<DomainSnapshot['quote']> = {
  id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2099-01-01T00:00:00.000Z',
  expired: false, disclosuresRequired: [],
}

/** verified_channel identity — the accept_quote hard gate (T4-R6). */
export const VERIFIED_IDENTITY: DomainSnapshot['identity'] = {
  tier: 'verified_channel',
  fields: { email: { provenance: 'verified' } },
  verifiedChannels: ['email'],
  pendingChallenge: null,
}
