import type { DomainSnapshot } from '@/lib/engines/domain-types'
export function makeSnapshot(overrides: Partial<DomainSnapshot> = {}): DomainSnapshot {
  return {
    conversationId: 'conv-1', customerId: 'cust-1',
    product: { id: 'p1', code: 'protect', insuranceType: 'LIFE' }, candidateProductId: null,
    identity: { tier: 'anonymous', fields: {} },
    consents: { gdprProcessing: false, aiDisclosure: false, marketing: false },
    dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false },
    application: null, quote: null, acceptedQuote: null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null },
    policy: null, eligibility: { verdict: 'unknown' }, suitability: { verdict: 'unknown' },
    openItems: [], circuit: { openTools: [] }, degraded: [], answers: {},
    ...overrides,
  }
}
