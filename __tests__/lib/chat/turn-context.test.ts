import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUniqueOrThrow: vi.fn() },
    customer: { findUnique: vi.fn() },
    consentEvent: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
    // B4: the application loads via the activeApplicationId pointer
    application: { findUnique: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { loadTurnContext } = await import('@/lib/chat/turn-context')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseConversation = {
  id: 'conv-1',
  status: 'ACTIVE',
  messageCount: 5,
  mode: 'SALES',
  productId: 'prod-1',
  product: { id: 'prod-1', code: 'PROD-1', name: { ro: 'Produs 1', en: 'Product 1' } },
  activeApplicationId: 'app-1', // B4 pointer — the application row is mocked separately
}

const baseApplication = {
  status: 'IN_PROGRESS',
  currentQuestionIndex: 2,
  totalQuestions: 10,
  quote: {
    status: 'ISSUED',
    premiumAnnual: 1200,
    policy: { id: 'pol-1' },
  },
}

const baseCustomer = {
  name: 'Ion Popescu',
  dateOfBirth: new Date('1985-06-15'),
  language: 'ro',
  isAnonymous: false,
}

const rawMessages = [
  { role: 'assistant', content: 'Hello!', createdAt: new Date('2024-01-01T10:00:02Z') },
  { role: 'user', content: 'Hi there', createdAt: new Date('2024-01-01T10:00:01Z') },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadTurnContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Consent ledger defaults to empty; tests that need consent facts mock rows.
    vi.mocked(prisma.consentEvent.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.application.findUnique).mockResolvedValue(baseApplication as never)
  })

  describe('all 4 queries are issued', () => {
    it('calls all 4 prisma methods exactly once', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue(rawMessages as never)

      await loadTurnContext('conv-1', 'cust-1')

      expect(prisma.conversation.findUniqueOrThrow).toHaveBeenCalledTimes(1)
      expect(prisma.customer.findUnique).toHaveBeenCalledTimes(1)
      expect(prisma.consentEvent.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.message.findMany).toHaveBeenCalledTimes(1)
    })

    it('queries conversation by conversationId', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      await loadTurnContext('conv-1', 'cust-1')

      expect(prisma.conversation.findUniqueOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conv-1' } }),
      )
    })

    it('queries customer by customerId', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      await loadTurnContext('conv-1', 'cust-1')

      expect(prisma.customer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1' } }),
      )
    })

    it('queries messages with desc order and take 10', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      await loadTurnContext('conv-1', 'cust-1')

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conv-1' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      )
    })

    it('returns workflowSession with currentStep', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

    })

    it('returns application with quote and policy', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.conversation.application?.status).toBe('IN_PROGRESS')
      expect(ctx.conversation.application?.quote?.premiumAnnual).toBe(1200)
      expect(ctx.conversation.application?.quote?.policy?.id).toBe('pol-1')
    })

    it('returns customer data', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.customer.name).toBe('Ion Popescu')
      expect(ctx.customer.dateOfBirth).toEqual(new Date('1985-06-15'))
      expect(ctx.customer.language).toBe('ro')
      expect(ctx.customer.isAnonymous).toBe(false)
    })

  })

  describe('messages returned in chronological order', () => {
    it('reverses descending DB result to chronological order', async () => {
      // DB returns newest-first (desc)
      const descMessages = [
        { role: 'user', content: 'Second message', createdAt: new Date('2024-01-01T10:00:02Z') },
        { role: 'assistant', content: 'First message', createdAt: new Date('2024-01-01T10:00:01Z') },
      ]

      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue(descMessages as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      // After reversal: oldest first
      expect(ctx.recentMessages[0].content).toBe('First message')
      expect(ctx.recentMessages[1].content).toBe('Second message')
    })

    it('returns messages with correct role and content fields', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue(rawMessages as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.recentMessages[0].role).toBe('user')
      expect(ctx.recentMessages[0].content).toBe('Hi there')
      expect(ctx.recentMessages[1].role).toBe('assistant')
      expect(ctx.recentMessages[1].content).toBe('Hello!')
    })
  })

  describe('empty data returns correct defaults', () => {
    it('returns empty recentMessages array when no messages', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.recentMessages).toEqual([])
    })


    it('handles null customer gracefully with anonymous defaults', async () => {
      const convWithNullMode = { ...baseConversation, mode: null }
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(convWithNullMode as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.customer.name).toBeNull()
      expect(ctx.customer.dateOfBirth).toBeNull()
      expect(ctx.customer.language).toBe('ro')
      expect(ctx.customer.isAnonymous).toBe(true)
      expect(ctx.customer.gdprConsentAt).toBeNull()
      expect(ctx.customer.gdprConsentScope).toBeNull()
      expect(ctx.customer.aiDisclosureAcknowledgedAt).toBeNull()
    })

    it('derives consent facts from the ConsentEvent ledger (latest event per kind wins)', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.consentEvent.findMany).mockResolvedValue([
        { kind: 'gdpr_processing', action: 'granted', scope: 'data_processing_for_quote', createdAt: new Date('2026-05-20T12:48:00Z') },
        { kind: 'ai_disclosure', action: 'granted', scope: null, createdAt: new Date('2026-05-20T12:45:00Z') },
      ] as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.customer.gdprConsentAt).toEqual(new Date('2026-05-20T12:48:00Z'))
      expect(ctx.customer.gdprConsentScope).toBe('data_processing_for_quote')
      expect(ctx.customer.aiDisclosureAcknowledgedAt).toEqual(new Date('2026-05-20T12:45:00Z'))
    })

    it('a later withdrawal wins over an earlier grant', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.consentEvent.findMany).mockResolvedValue([
        { kind: 'gdpr_processing', action: 'granted', scope: 'sales', createdAt: new Date('2026-05-20T12:48:00Z') },
        { kind: 'gdpr_processing', action: 'withdrawn', scope: null, createdAt: new Date('2026-05-21T09:00:00Z') },
      ] as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.customer.gdprConsentAt).toBeNull()
      expect(ctx.customer.gdprConsentScope).toBeNull()
    })

    it('threads product code and name through', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.conversation.product?.code).toBe('PROD-1')
      expect(ctx.conversation.product?.name).toEqual({ ro: 'Produs 1', en: 'Product 1' })
    })

    it('defaults mode to SALES when null', async () => {
      const convWithNullMode = { ...baseConversation, mode: null }
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(convWithNullMode as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.conversation.mode).toBe('SALES')
    })

  })
})
