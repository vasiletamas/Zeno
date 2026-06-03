import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma BEFORE importing the subject
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUnique: vi.fn() },
    application: { findUnique: vi.fn() },
    answer: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    questionGroup: { findMany: vi.fn() },
    quote: { findFirst: vi.fn() },
    customer: { findUnique: vi.fn() },
    pricingTier: { findUnique: vi.fn() },
    pricingLevel: { findUnique: vi.fn() },
    product: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: vi.fn(),
}))

import { deriveState, type DerivedState } from '@/lib/chat/derive-state'
import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'

describe('deriveState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 1a: Empty conversation (no product, no application) → DISCOVERY phase
  it('returns DISCOVERY phase for conversation with no product or application', async () => {
    const conversationId = 'conv-empty'
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId: null,
      candidateProductId: null,
      dntSignedAt: null,
      dntValidUntil: null,
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: null,
      aiDisclosureAcknowledgedAt: null,
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('DISCOVERY')
    expect(result.product).toBeNull()
    expect(result.selection.tier).toBeNull()
    expect(result.application.exists).toBe(false)
    expect(result.quote).toBeNull()
    expect(result.consents.gdpr).toBe(false)
    expect(result.nextBestAction).toBe(
      'call list_products, then set_candidate_product when the customer names a need'
    )
  })

  // Test 1b: Product set, GDPR not given → CONSENT phase
  it('returns CONSENT phase when product is set but GDPR not consented', async () => {
    const conversationId = 'conv-product-no-consent'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: null,
      dntValidUntil: null,
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: null,
      aiDisclosureAcknowledgedAt: null,
    } as never)

    vi.mocked(prisma.answer.findMany).mockResolvedValue([])
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: productId, code: 'protect', name: { ro: 'Protect', en: 'Protect' } } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CONSENT')
    expect(result.consents.gdpr).toBe(false)
    expect(result.nextBestAction).toContain('record_gdpr_consent')
  })

  // Test 1c: Application OPEN with one missing question → QUESTIONNAIRE phase
  it('returns QUESTIONNAIRE phase when application is OPEN with missing questions', async () => {
    const conversationId = 'conv-app-open'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId,
      customerId: 'cust-1',
      productId,
      candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'),
      dntValidUntil: new Date('2025-01-01'),
    } as never)

    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId,
      conversationId,
      productId,
      status: 'OPEN',
      tierId: 'tier-standard',
      levelId: 'level-1',
      includesAddon: false,
    } as never)

    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      gdprConsentAt: new Date('2024-01-01'),
      aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)

    vi.mocked(resolveGroupCodes).mockResolvedValue(['application', 'bd_medical'])

    vi.mocked(prisma.question.findMany).mockResolvedValue([
      { id: 'q-1', code: 'health_status', groupId: 'grp-app', text: { en: 'Health status?', ro: 'Stare de sănătate?' }, type: 'MULTIPLE_CHOICE' },
      { id: 'q-2', code: 'occupation', groupId: 'grp-app', text: { en: 'Occupation?', ro: 'Ocupație?' }, type: 'OPEN_ENDED' },
    ] as never)

    vi.mocked(prisma.answer.findMany).mockResolvedValue([
      { id: 'ans-1', questionId: 'q-1', conversationId, value: 'good' },
    ] as never)

    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({ id: 'tier-standard', code: 'STANDARD' } as never)
    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({ id: 'level-1', code: 'LEVEL_1' } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('QUESTIONNAIRE')
    expect(result.application.exists).toBe(true)
    expect(result.application.status).toBe('OPEN')
    expect(result.application.answered).toBe(1)
    expect(result.application.required).toBe(2)
    expect(result.application.missing).toEqual(['occupation'])
    expect(result.nextBestAction).toContain('ask the next missing question: occupation')
  })

  // Test 1d: Application COMPLETED, no quote → QUOTE phase
  it('returns QUOTE phase when application is COMPLETED but no DRAFT quote exists', async () => {
    const conversationId = 'conv-app-done'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId, customerId: 'cust-1', productId, candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'), dntValidUntil: new Date('2025-01-01'),
    } as never)
    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId, conversationId, productId, status: 'COMPLETED',
      tierId: 'tier-standard', levelId: 'level-1', includesAddon: false,
    } as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1', gdprConsentAt: new Date('2024-01-01'), aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)
    vi.mocked(prisma.quote.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({ id: 'tier-standard', code: 'STANDARD' } as never)
    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({ id: 'level-1', code: 'LEVEL_1' } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('QUOTE')
    expect(result.quote).toBeNull()
    expect(result.nextBestAction).toContain('call generate_quote')
  })

  // Test 1e: Quote with status ACCEPTED → CLOSING phase
  it('returns CLOSING phase when an ACCEPTED quote exists', async () => {
    const conversationId = 'conv-accepted'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId, customerId: 'cust-1', productId, candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'), dntValidUntil: new Date('2025-01-01'),
    } as never)
    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId, conversationId, productId, status: 'COMPLETED',
      tierId: 'tier-standard', levelId: 'level-1', includesAddon: false,
    } as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1', gdprConsentAt: new Date('2024-01-01'), aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)
    vi.mocked(prisma.quote.findFirst).mockResolvedValue({
      id: 'quote-1', applicationId, status: 'ACCEPTED', premiumAnnual: 500,
    } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CLOSING')
    expect(result.quote).not.toBeNull()
    expect(result.quote?.premiumAnnual).toBe(500)
    expect(result.nextBestAction).toContain('present the quote')
  })

  // Test 1f: Product + tier set, GDPR given, DNT not signed → CONSENT phase (DNT missing)
  it('returns CONSENT phase when DNT is not signed even though product/tier set', async () => {
    const conversationId = 'conv-no-dnt'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId, customerId: 'cust-1', productId, candidateProductId: null,
      dntSignedAt: null, dntValidUntil: null,
    } as never)
    vi.mocked(prisma.application.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1', gdprConsentAt: new Date('2024-01-01'), aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: productId, code: 'protect', name: { ro: 'Protect', en: 'Protect' } } as never)

    const result = await deriveState(conversationId)

    expect(result.phase).toBe('CONSENT')
    expect(result.nextBestAction).toContain('sign_dnt')
  })

  // Test 1g: answers map contains questionCode -> value mapping
  it('builds answers map with question codes (not IDs) as keys', async () => {
    const conversationId = 'conv-answers'
    const applicationId = 'app-1'
    const productId = 'prod-protect'

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: conversationId, customerId: 'cust-1', productId, candidateProductId: null,
      dntSignedAt: new Date('2024-01-01'), dntValidUntil: new Date('2025-01-01'),
    } as never)
    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: applicationId, conversationId, productId, status: 'COMPLETED',
      tierId: 'tier-standard', levelId: 'level-1', includesAddon: false,
    } as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1', gdprConsentAt: new Date('2024-01-01'), aiDisclosureAcknowledgedAt: new Date('2024-01-01'),
    } as never)
    vi.mocked(prisma.question.findMany).mockResolvedValue([
      { id: 'q-1', code: 'HEALTH_STATUS', groupId: 'grp-app' },
      { id: 'q-2', code: 'OCCUPATION', groupId: 'grp-app' },
    ] as never)
    vi.mocked(prisma.answer.findMany).mockResolvedValue([
      { id: 'ans-1', questionId: 'q-1', conversationId, value: 'excellent' },
      { id: 'ans-2', questionId: 'q-2', conversationId, value: 'engineer' },
    ] as never)
    vi.mocked(prisma.quote.findFirst).mockResolvedValue(null as never)
    vi.mocked(prisma.pricingTier.findUnique).mockResolvedValue({ id: 'tier-standard', code: 'STANDARD' } as never)
    vi.mocked(prisma.pricingLevel.findUnique).mockResolvedValue({ id: 'level-1', code: 'LEVEL_1' } as never)

    const result = await deriveState(conversationId)

    expect(result.answers).toEqual({ HEALTH_STATUS: 'excellent', OCCUPATION: 'engineer' })
  })
})
