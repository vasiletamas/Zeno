import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findMany: vi.fn() },
    questionGroup: { findMany: vi.fn() },
    answer: { findMany: vi.fn() },
    application: { findUnique: vi.fn() },
    questionDependency: { findMany: vi.fn() },
    dntSession: { findFirst: vi.fn() },
    dntAnswer: { findMany: vi.fn() },
    customerInsight: { findUnique: vi.fn() },
    // B4: loadQuestionnaireContext resolves the active-application pointer
    conversation: { findUnique: vi.fn().mockResolvedValue({ activeApplicationId: 'app-1', productId: 'p1', candidateProductId: null }) },
  },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { logInfo } = await import('@/lib/errors/logger')
const { loadQuestionnaireContext } = await import('@/lib/chat/context-loaders')

// Task 1.2 (D2): the loader walks via the canonical getNextQuestion — the
// mocks carry the group rows and flat question rows that walk reads.
const APP_GROUP = { id: 'g1', code: 'application', orderIndex: 6 }
const APP_QUESTION = {
  id: 'q1',
  code: 'PACKAGE_CHOICE',
  groupId: 'g1',
  text: { en: 'Which package?', ro: 'Ce pachet?' },
  helpText: null,
  type: 'DROPDOWN',
  options: [
    { value: 'Standard', label: { en: 'Standard', ro: 'Standard' } },
    { value: 'Optim', label: { en: 'Optim', ro: 'Optim' } },
  ],
  validationRules: null,
  insightKey: 'selectedTier',
  orderIndex: 1,
  isRequired: true,
}

describe('loadQuestionnaireContext — CONTEXT HIT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ activeApplicationId: 'app-1', productId: 'p1', candidateProductId: null } as never)
    vi.mocked(prisma.questionGroup.findMany).mockResolvedValue([APP_GROUP] as never)
    vi.mocked(prisma.question.findMany).mockResolvedValue([APP_QUESTION] as never)
    vi.mocked(prisma.answer.findMany).mockResolvedValue([])
    vi.mocked(prisma.application.findUnique).mockResolvedValue({ tier: null, level: null, includesAddon: false } as never)
    vi.mocked(prisma.questionDependency.findMany).mockResolvedValue([])
  })

  it('appends CONTEXT HIT block when matching insight exists', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue({
      id: 'i1', customerId: 'cust-1', productId: null,
      category: 'PREFERENCE', key: 'selectedTier', value: 'Standard',
      confidence: 0.9, source: 'conv-1',
      lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as never)

    const result = await loadQuestionnaireContext('conv-1', 'cust-1', 'application_fill', 'ro')

    expect(result).toContain('[CONTEXT HIT for current question]')
    expect(result).toContain('field: selectedTier')
    expect(result).toContain('value: "Standard"')
    expect(result).toContain('confidence: 0.90')
    expect(result).toContain('INSTRUCTIONS — DO NOT RE-ASK')
  })

  it('does NOT append CONTEXT HIT when no insight', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(null)

    const result = await loadQuestionnaireContext('conv-1', 'cust-1', 'application_fill', 'ro')

    expect(result).not.toContain('CONTEXT HIT')
    expect(result).toContain('[ACTIVE QUESTIONNAIRE')
  })

  it('does NOT append CONTEXT HIT when question.insightKey is null', async () => {
    vi.mocked(prisma.question.findMany).mockResolvedValue([
      { ...APP_QUESTION, insightKey: null },
    ] as never)

    const result = await loadQuestionnaireContext('conv-1', 'cust-1', 'application_fill', 'ro')

    expect(result).not.toContain('CONTEXT HIT')
    expect(prisma.customerInsight.findUnique).not.toHaveBeenCalled()
  })

  it('injects explicit-DA phrasing for bd_medical RISK_FACTOR hits and logs compliance audit', async () => {
    const medQuestion = {
      ...APP_QUESTION,
      id: 'q2',
      code: 'BD_SMOKING',
      groupId: 'g2',
      type: 'BOOLEAN',
      options: null,
      insightKey: 'smokingStatus',
    }
    vi.mocked(prisma.questionGroup.findMany).mockResolvedValue([{ id: 'g2', code: 'bd_medical', orderIndex: 7 }] as never)
    vi.mocked(prisma.question.findMany).mockResolvedValue([medQuestion] as never)
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue({
      id: 'i2', customerId: 'cust-1', productId: null,
      category: 'RISK_FACTOR', key: 'smokingStatus', value: 'non_smoker',
      confidence: 0.9, source: 'conv-1',
      lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as never)

    const result = await loadQuestionnaireContext('conv-1', 'cust-1', 'application_fill', 'ro')

    expect(result).toContain('Pentru declarația medicală oficială')
    expect(result).toContain('DA sau NU')
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'context_hit_medical' }),
    )
  })
})
