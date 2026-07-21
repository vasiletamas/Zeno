import type { DomainSnapshot } from '@/lib/engines/domain-types'
import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'

// C2.6: the default product carries the parsed protect ruleset, exactly as
// the loader supplies it; eligibilityFacts default empty → verdict 'unknown'
// (never a wall), so pre-C2 tests keep their exposure behavior.
const PROTECT_RULES = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)

/**
 * 2026-07-21 (spec §3.2, ruling R2): the default fixture now carries a PROVEN
 * CHANNEL. The DNT and questionnaire commits gained `channelProven: true`
 * rows, so an unverified default would turn every suite that merely passes
 * THROUGH the questionnaire — briefing wording, objective derivation, DNT
 * exposure — into an identity test, obscuring what each is actually pinning.
 *
 * The gate itself is pinned where it belongs, against explicitly unverified
 * snapshots: identity-requirements.test.ts (the rows and the channel clause)
 * and derive-and-expose.test.ts ("an unverified customer cannot reach the
 * DNT"). Override `identity` to test the blocked side.
 *
 * NOTE the tier stays 'anonymous': a consumed challenge does NOT lift the
 * contact tier (deriveIdentityTier needs email AND phone). That asymmetry is
 * exactly why `channelProven` exists — see identity-requirements.ts.
 */
export function makeSnapshot(overrides: Partial<DomainSnapshot> = {}): DomainSnapshot {
  return {
    conversationId: 'conv-1', customerId: 'cust-1',
    product: { id: 'p1', code: 'protect', insuranceType: 'LIFE', eligibilityRules: PROTECT_RULES }, candidateProductId: null,
    identity: { tier: 'anonymous', fields: {}, verifiedChannels: ['email'], pendingChallenge: null },
    consents: { gdprProcessing: false, aiDisclosure: false, marketing: false, gdprWithdrawn: false, hasAnyEvents: false },
    dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
    application: null, resumableApplication: null, quote: null, acceptedQuote: null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null },
    policy: null, eligibilityFacts: {}, suitabilityAcks: [],
    documents: { requirementsByTool: {}, validated: [] },
    openItems: [], circuit: { openTools: [] }, degraded: [], answers: {},
    ...overrides,
  }
}
