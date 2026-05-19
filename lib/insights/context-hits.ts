import { prisma } from '@/lib/db'
import { logWarn } from '@/lib/errors/logger'

const DEFAULT_THRESHOLD = 0.8

export interface QuestionForLookup {
  id: string
  insightKey: string | null
  options: unknown
  group: { code: string }
}

export interface ContextHit {
  key: string
  value: string
  confidence: number
  source: string
  lastConfirmedAt: Date
  category: string
}

export async function findContextHit(
  customerId: string,
  question: QuestionForLookup,
  conversationId: string,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<ContextHit | null> {
  if (!question.insightKey) return null

  const insight = await prisma.customerInsight.findUnique({
    where: { customerId_key: { customerId, key: question.insightKey } },
  })

  if (!insight) return null
  if (insight.confidence < threshold) return null

  // Scoping rules
  const isMedicalGroup = question.group.code === 'bd_medical'
  const requiresSameConv =
    insight.category === 'PREFERENCE' ||
    (isMedicalGroup && insight.category === 'RISK_FACTOR')

  if (requiresSameConv && insight.source !== conversationId) return null

  // Option validation
  if (Array.isArray(question.options) && question.options.length > 0) {
    const optionValues = (question.options as Array<{ value: string }>).map(o => o.value)
    if (!optionValues.includes(insight.value)) {
      logWarn({
        layer: 'questionnaire',
        category: 'extractor_value_mismatch',
        message: 'Insight value does not match question options',
        context: {
          customerId,
          questionId: question.id,
          insightKey: question.insightKey,
          value: insight.value,
          allowedOptions: optionValues,
        },
      })
      return null
    }
  }

  return {
    key: insight.key,
    value: insight.value,
    confidence: insight.confidence,
    source: insight.source,
    lastConfirmedAt: insight.lastConfirmedAt,
    category: insight.category,
  }
}
