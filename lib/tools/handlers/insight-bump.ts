import { prisma } from '@/lib/db'
import { logInfo, logWarn } from '@/lib/errors/logger'

export interface BumpInput {
  customerId: string
  conversationId: string
  question: {
    id: string
    code: string | null
    insightKey: string | null
    group: { code: string }
  }
  answerValue: string
  previousInsightValue?: string
  previousInsightCategory?: string
}

export async function bumpInsightOnAnswer(input: BumpInput): Promise<void> {
  const { customerId, conversationId, question, answerValue } = input
  if (!question.insightKey) return

  try {
    await prisma.customerInsight.update({
      where: { customerId_key: { customerId, key: question.insightKey } },
      data: {
        value: answerValue,
        source: conversationId,
        lastConfirmedAt: new Date(),
      },
    })
  } catch (err) {
    // Insight doesn't exist yet (no prior extraction) — not an error worth alarming on.
    logWarn({
      layer: 'questionnaire',
      category: 'insight_bump_skip',
      message: 'No insight to bump (likely no prior extraction)',
      context: { customerId, key: question.insightKey },
      error: err,
    })
    return
  }

  // bd_medical compliance resolution log
  if (
    question.group.code === 'bd_medical' &&
    input.previousInsightCategory === 'RISK_FACTOR'
  ) {
    const userAffirmation =
      input.previousInsightValue === answerValue ? 'confirmed' : 'denied'
    logInfo({
      layer: 'compliance',
      category: 'context_hit_medical_resolution',
      message: 'Medical CONTEXT HIT resolution recorded',
      context: {
        customerId,
        conversationId,
        questionCode: question.code,
        insightKey: question.insightKey,
        previousValue: input.previousInsightValue,
        answeredValue: answerValue,
        userAffirmation,
      },
    })
  }
}
