import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    customer: { findUnique: vi.fn() },
    customerInsight: { findMany: vi.fn() },
    agentKnowledge: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
    answer: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/tools/registry', () => ({
  getToolDefinition: vi.fn(),
}))

vi.mock('@/lib/chat/token-budget', () => ({
  estimateTokens: vi.fn().mockReturnValue(10),
}))

const { prisma } = await import('@/lib/db')

const { loadAllSections, loadCustomerContextFromData } = await import(
  '@/lib/chat/context-loaders'
)

describe('loadAllSections with prefetchedCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mocks for parallel loaders that always run
    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([])
    vi.mocked(prisma.agentKnowledge.findMany).mockResolvedValue([])
    vi.mocked(prisma.question.findMany).mockResolvedValue([])
    vi.mocked(prisma.answer.findMany).mockResolvedValue([])
  })

  it('does NOT call prisma.customer.findUnique when prefetchedCustomer is provided', async () => {
    const prefetchedCustomer = {
      name: 'Ion Popescu',
      dateOfBirth: new Date('1985-06-15'),
      extractedProfile: {
        occupation: 'Engineer',
        incomeLevel: 'middle',
        familySize: 4,
        hasChildren: true,
        motivations: ['family protection'],
      } as Record<string, unknown>,
      language: 'ro',
      isAnonymous: false,
    }

    const result = await loadAllSections({
      agentConfig: { systemPrompt: 'You are Zeno.', constraints: null },
      allowedTools: [],
      productId: null,
      conversationId: 'conv-1',
      customerId: 'cust-1',
      workflowSession: null,
      workflowStepCode: null,
      situationalBriefing: null,
      language: 'ro',
      prefetchedCustomer,
    })

    // prisma.customer.findUnique must NOT have been called
    expect(prisma.customer.findUnique).not.toHaveBeenCalled()

    // The returned customerContext should contain the pre-fetched data
    expect(result.customerContext).not.toBeNull()
    expect(result.customerContext).toContain('Ion Popescu')
    expect(result.customerContext).toContain('Engineer')
    expect(result.customerContext).toContain('family protection')
    expect(result.customerContext).toContain('Family size: 4')
  })

  it('calls prisma.customer.findUnique when prefetchedCustomer is NOT provided', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({
      id: 'cust-1',
      name: 'Maria Ionescu',
      dateOfBirth: new Date('1990-01-01'),
      extractedProfile: {},
      language: 'ro',
      isAnonymous: false,
      email: null,
      phone: null,
      externalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    await loadAllSections({
      agentConfig: { systemPrompt: 'You are Zeno.', constraints: null },
      allowedTools: [],
      productId: null,
      conversationId: 'conv-1',
      customerId: 'cust-1',
      workflowSession: null,
      workflowStepCode: null,
      situationalBriefing: null,
      language: 'ro',
    })

    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
    })
  })
})

describe('loadCustomerContextFromData', () => {
  it('formats all fields from pre-fetched customer data', () => {
    const data = {
      name: 'Ion Popescu',
      dateOfBirth: new Date('1985-06-15'),
      extractedProfile: {
        occupation: 'Software developer',
        incomeLevel: 'high',
        education: 'Masters',
        familySize: 3,
        hasSpouse: true,
        hasChildren: true,
        minorChildren: 1,
        motivations: ['family protection', 'retirement'],
        interests: ['term life', 'investment'],
      } as Record<string, unknown>,
      language: 'ro',
      isAnonymous: false,
    }

    const result = loadCustomerContextFromData(data)

    expect(result).toContain('Name: Ion Popescu')
    expect(result).toContain('Language: ro')
    expect(result).toContain('Age:')
    expect(result).toContain('Occupation: Software developer')
    expect(result).toContain('Income level: high')
    expect(result).toContain('Education: Masters')
    expect(result).toContain('Family size: 3')
    expect(result).toContain('Has spouse: true')
    expect(result).toContain('Has children: true')
    expect(result).toContain('Minor children: 1')
    expect(result).toContain('Motivations: family protection, retirement')
    expect(result).toContain('Interests: term life, investment')
    // Not anonymous, so should NOT contain 'Anonymous visitor'
    expect(result).not.toContain('Anonymous visitor')
  })

  it('handles anonymous customer with null fields', () => {
    const data = {
      name: null,
      dateOfBirth: null,
      extractedProfile: {} as Record<string, unknown>,
      language: 'en',
      isAnonymous: true,
    }

    const result = loadCustomerContextFromData(data)

    expect(result).toContain('Language: en')
    expect(result).toContain('Status: Anonymous visitor')
    expect(result).not.toContain('Name:')
    expect(result).not.toContain('Age:')
  })

  it('returns null when no data produces output', () => {
    // Even with minimal data, language is always included so result should not be null
    const data = {
      name: null,
      dateOfBirth: null,
      extractedProfile: {} as Record<string, unknown>,
      language: 'ro',
      isAnonymous: false,
    }

    const result = loadCustomerContextFromData(data)
    // Should have at least Language: ro
    expect(result).toContain('Language: ro')
  })
})
