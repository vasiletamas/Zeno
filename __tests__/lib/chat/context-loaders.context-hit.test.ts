import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findMany: vi.fn() },
    answer: { findMany: vi.fn() },
    customerInsight: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { logInfo } = await import('@/lib/errors/logger')
const { loadQuestionnaireContext } = await import('@/lib/chat/context-loaders')

const APP_QUESTION = {
  id: 'q1',
  code: 'PACKAGE_CHOICE',
  text: { en: 'Which package?', ro: 'Ce pachet?' },
  type: 'DROPDOWN',
  options: [
    { value: 'Standard', label: { en: 'Standard', ro: 'Standard' } },
    { value: 'Optim', label: { en: 'Optim', ro: 'Optim' } },
  ],
  insightKey: 'selectedTier',
  orderIndex: 1,
  group: { code: 'application', orderIndex: 6 },
}

describe('loadQuestionnaireContext — CONTEXT HIT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.question.findMany).mockResolvedValue([APP_QUESTION] as never)
    vi.mocked(prisma.answer.findMany).mockResolvedValue([])
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
      type: 'BOOLEAN',
      options: null,
      insightKey: 'smokingStatus',
      group: { code: 'bd_medical', orderIndex: 7 },
    }
    vi.mocked(prisma.question.findMany).mockResolvedValue([medQuestion] as never)
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue({
      id: 'i2', customerId: 'cust-1', productId: null,
      category: 'RISK_FACTOR', key: 'smokingStatus', value: 'non_smoker',
      confidence: 0.9, source: 'conv-1',
      lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    } as never)

    const result = await loadQuestionnaireContext('conv-1', 'cust-1', 'bd_questionnaire', 'ro')

    expect(result).toContain('Pentru declarația medicală oficială')
    expect(result).toContain('DA sau NU')
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'context_hit_medical' }),
    )
  })
})
