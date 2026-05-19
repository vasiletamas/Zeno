import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: { update: vi.fn() },
  },
}))
vi.mock('@/lib/errors/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { logInfo } = await import('@/lib/errors/logger')
const { bumpInsightOnAnswer } = await import('@/lib/tools/handlers/insight-bump')

describe('bumpInsightOnAnswer', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('no-ops when question has no insightKey', async () => {
    await bumpInsightOnAnswer({
      customerId: 'c1',
      conversationId: 'conv-1',
      question: { id: 'q1', code: 'X', insightKey: null, group: { code: 'application' } },
      answerValue: 'Standard',
    })
    expect(prisma.customerInsight.update).not.toHaveBeenCalled()
  })

  it('bumps lastConfirmedAt and overwrites value when answer differs', async () => {
    vi.mocked(prisma.customerInsight.update).mockResolvedValue({} as never)
    await bumpInsightOnAnswer({
      customerId: 'c1',
      conversationId: 'conv-1',
      question: {
        id: 'q1', code: 'PACKAGE_CHOICE', insightKey: 'selectedTier',
        group: { code: 'application' },
      },
      answerValue: 'Optim',
    })
    expect(prisma.customerInsight.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId_key: { customerId: 'c1', key: 'selectedTier' } },
        data: expect.objectContaining({
          value: 'Optim',
          lastConfirmedAt: expect.any(Date),
          source: 'conv-1',
        }),
      }),
    )
  })

  it('writes bd_medical resolution log with userAffirmation="confirmed" when answer matches previous insight', async () => {
    vi.mocked(prisma.customerInsight.update).mockResolvedValue({
      category: 'RISK_FACTOR', value: 'non_smoker',
    } as never)
    await bumpInsightOnAnswer({
      customerId: 'c1',
      conversationId: 'conv-1',
      question: {
        id: 'q3', code: 'BD_SMOKER', insightKey: 'smokingStatus',
        group: { code: 'bd_medical' },
      },
      answerValue: 'non_smoker',
      previousInsightValue: 'non_smoker',
      previousInsightCategory: 'RISK_FACTOR',
    })
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'context_hit_medical_resolution',
        context: expect.objectContaining({ userAffirmation: 'confirmed' }),
      }),
    )
  })

  it('logs userAffirmation="denied" when answer differs from previous insight', async () => {
    vi.mocked(prisma.customerInsight.update).mockResolvedValue({} as never)
    await bumpInsightOnAnswer({
      customerId: 'c1',
      conversationId: 'conv-1',
      question: {
        id: 'q3', code: 'BD_SMOKER', insightKey: 'smokingStatus',
        group: { code: 'bd_medical' },
      },
      answerValue: 'smoker',
      previousInsightValue: 'non_smoker',
      previousInsightCategory: 'RISK_FACTOR',
    })
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'context_hit_medical_resolution',
        context: expect.objectContaining({ userAffirmation: 'denied' }),
      }),
    )
  })
})
