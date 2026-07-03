import type { DomainSnapshot } from '@/lib/engines/domain-types'
import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'

// C2.6: the default product carries the parsed protect ruleset, exactly as
// the loader supplies it; eligibilityFacts default empty → verdict 'unknown'
// (never a wall), so pre-C2 tests keep their exposure behavior.
const PROTECT_RULES = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)

export function makeSnapshot(overrides: Partial<DomainSnapshot> = {}): DomainSnapshot {
  return {
    conversationId: 'conv-1', customerId: 'cust-1',
    product: { id: 'p1', code: 'protect', insuranceType: 'LIFE', eligibilityRules: PROTECT_RULES }, candidateProductId: null,
    identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: null },
    consents: { gdprProcessing: false, aiDisclosure: false, marketing: false, gdprWithdrawn: false, hasAnyEvents: false },
    dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
    application: null, resumableApplication: null, quote: null, acceptedQuote: null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null },
    policy: null, eligibilityFacts: {},
    documents: { requirementsByTool: {}, validated: [] },
    openItems: [], circuit: { openTools: [] }, degraded: [], answers: {},
    ...overrides,
  }
}
