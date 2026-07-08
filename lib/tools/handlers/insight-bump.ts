import { prisma } from '@/lib/db'
import { logInfo, logWarn } from '@/lib/errors/logger'
import { getActiveInsightKeys, findKeySpec } from '@/lib/insights/keys'
import { validateInsightValue } from '@/lib/insights/validate'

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
  /** Task 3.2 (D4): resolves the product-specialized key spec for the typed gate. */
  productId?: string | null
}

export async function bumpInsightOnAnswer(input: BumpInput): Promise<void> {
  const { customerId, conversationId, question, answerValue } = input
  if (!question.insightKey) return

  // Task 3.2 (D4): the SAME typed gate the extractor uses — an answer that
  // violates the key spec never overwrites a stored insight. Keys outside
  // the vocabulary (question-specific insight keys) pass through unchanged.
  const spec = findKeySpec(await getActiveInsightKeys(input.productId ?? null), question.insightKey)
  if (spec) {
    const validation = validateInsightValue(spec, answerValue)
    if (!validation.ok) {
      logWarn({
        layer: 'questionnaire',
        category: 'insight_rejected',
        message: 'Answer value failed the typed key spec — insight not bumped',
        context: { customerId, conversationId, key: question.insightKey, value: answerValue, reason: validation.reason },
      })
      return
    }
  }

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
