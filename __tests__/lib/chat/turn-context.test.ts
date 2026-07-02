import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUniqueOrThrow: vi.fn() },
    customer: { findUnique: vi.fn() },
    message: { findMany: vi.fn() },
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
  workflowSession: {
    id: 'ws-1',
    workflowId: 'wf-1',
    currentStepId: 'step-1',
    currentStep: {
      id: 'step-1',
      code: 'INTRO',
      name: 'Introduction',
      agentInstructions: 'Greet the customer',
      allowedTools: ['tool-a'],
      autoTool: null,
    },
    data: { foo: 'bar' },
  },
  application: {
    status: 'IN_PROGRESS',
    currentQuestionIndex: 2,
    totalQuestions: 10,
    quote: {
      status: 'DRAFT',
      premiumAnnual: 1200,
      policy: { id: 'pol-1' },
    },
  },
}

const baseCustomer = {
  name: 'Ion Popescu',
  dateOfBirth: new Date('1985-06-15'),
  extractedProfile: { smoker: false },
  language: 'ro',
  isAnonymous: false,
  gdprConsentAt: null,
  gdprConsentScope: null,
  aiDisclosureAcknowledgedAt: null,
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
  })

  describe('all 4 queries are issued', () => {
    it('calls all 4 prisma methods exactly once', async () => {
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(baseCustomer as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue(rawMessages as never)

      await loadTurnContext('conv-1', 'cust-1')

      expect(prisma.conversation.findUniqueOrThrow).toHaveBeenCalledTimes(1)
      expect(prisma.customer.findUnique).toHaveBeenCalledTimes(1)
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

      expect(ctx.conversation.workflowSession?.id).toBe('ws-1')
      expect(ctx.conversation.workflowSession?.currentStep.code).toBe('INTRO')
      expect(ctx.conversation.workflowSession?.currentStep.allowedTools).toEqual(['tool-a'])
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
      expect(ctx.customer.extractedProfile).toEqual({ smoker: false })
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
      expect(ctx.customer.extractedProfile).toEqual({})
      expect(ctx.customer.language).toBe('ro')
      expect(ctx.customer.isAnonymous).toBe(true)
      expect(ctx.customer.gdprConsentAt).toBeNull()
      expect(ctx.customer.gdprConsentScope).toBeNull()
      expect(ctx.customer.aiDisclosureAcknowledgedAt).toBeNull()
    })

    it('threads customer consent fields through when populated', async () => {
      const customerWithConsent = {
        ...baseCustomer,
        gdprConsentAt: new Date('2026-05-20T12:48:00Z'),
        gdprConsentScope: 'data_processing_for_quote',
        aiDisclosureAcknowledgedAt: new Date('2026-05-20T12:45:00Z'),
      }
      vi.mocked(prisma.conversation.findUniqueOrThrow).mockResolvedValue(baseConversation as never)
      vi.mocked(prisma.customer.findUnique).mockResolvedValue(customerWithConsent as never)
      vi.mocked(prisma.message.findMany).mockResolvedValue([] as never)

      const ctx = await loadTurnContext('conv-1', 'cust-1')

      expect(ctx.customer.gdprConsentAt).toEqual(new Date('2026-05-20T12:48:00Z'))
      expect(ctx.customer.gdprConsentScope).toBe('data_processing_for_quote')
      expect(ctx.customer.aiDisclosureAcknowledgedAt).toEqual(new Date('2026-05-20T12:45:00Z'))
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
