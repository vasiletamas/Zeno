/**
 * T6 (P5.6): DNT facts promoted to durable customer facts at signature.
 *
 * Occupation, family size, minor children, education and income source used
 * to die inside DntAnswer rows. sign_dnt lifts them — in the SAME commit
 * transaction, non-fatally (the marketing consent lift precedent) — to:
 *   - CustomerProfileField (provenance 'declared', source 'dnt', RAW option
 *     values; no Customer-column mirrors)
 *   - the insight vocabulary (occupation, familySize, hasChildren) through
 *     the same typed gate the extractor uses, confidence 0.9 (a declared
 *     questionnaire answer beats an inferred extraction).
 */
import type { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { setDeclaredField, type ProfileFieldName } from '@/lib/customer/profile-service'
import { GLOBAL_INSIGHT_KEYS, findKeySpec } from '@/lib/insights/keys'
import { validateInsightValue } from '@/lib/insights/validate'

type Db = typeof prisma | Prisma.TransactionClient

const DECLARED_CONFIDENCE = 0.9

const PROFILE_MAP: ReadonlyArray<{ code: string; field: ProfileFieldName }> = [
  { code: 'DNT_OCCUPATION', field: 'occupation' },
  { code: 'DNT_FAMILY_SIZE', field: 'familySize' },
  { code: 'DNT_MINOR_CHILDREN', field: 'minorChildren' },
  { code: 'DNT_EDUCATION', field: 'education' },
  { code: 'DNT_INCOME_SOURCE', field: 'incomeSource' },
]

export interface DntPromotionPlan {
  profileFields: { field: ProfileFieldName; value: string }[]
  insights: { key: 'occupation' | 'familySize' | 'hasChildren'; value: string }[]
}

/** Pure mapping: which answers become which durable facts. Missing answers are skipped. */
export function deriveDntPromotion(answersByCode: Record<string, string>): DntPromotionPlan {
  const has = (code: string): boolean => {
    const v = answersByCode[code]
    return v !== undefined && v.trim() !== ''
  }

  const profileFields: DntPromotionPlan['profileFields'] = []
  for (const { code, field } of PROFILE_MAP) {
    if (has(code)) profileFields.push({ field, value: answersByCode[code] })
  }

  const insights: DntPromotionPlan['insights'] = []
  if (has('DNT_OCCUPATION')) {
    insights.push({ key: 'occupation', value: answersByCode.DNT_OCCUPATION })
  }
  if (has('DNT_FAMILY_SIZE')) {
    const raw = answersByCode.DNT_FAMILY_SIZE
    // '5+' fails Number() — normalize to the lower bound for the numeric key
    insights.push({ key: 'familySize', value: raw === '5+' ? '5' : raw })
  }
  if (has('DNT_MINOR_CHILDREN')) {
    insights.push({ key: 'hasChildren', value: String(answersByCode.DNT_MINOR_CHILDREN !== '0') })
  }
  return { profileFields, insights }
}

/**
 * Applies the plan on the CALLER's db (the sign_dnt commit transaction).
 * Insight writes ride the same typed gate as the extractor; source is the
 * conversation, like every other insight.
 */
export async function promoteDntFacts(
  db: Db,
  customerId: string,
  conversationId: string,
  answersByCode: Record<string, string>,
): Promise<void> {
  const plan = deriveDntPromotion(answersByCode)

  for (const f of plan.profileFields) {
    await setDeclaredField(customerId, f.field, f.value, 'dnt', db)
  }

  for (const ins of plan.insights) {
    const spec = findKeySpec(GLOBAL_INSIGHT_KEYS, ins.key)
    if (!spec) continue
    const validation = validateInsightValue(spec, ins.value)
    if (!validation.ok) continue
    await db.customerInsight.upsert({
      where: { customerId_key: { customerId, key: ins.key } },
      update: {
        value: validation.value,
        confidence: DECLARED_CONFIDENCE,
        source: conversationId,
        lastConfirmedAt: new Date(),
      },
      create: {
        customerId,
        productId: null, // global vocabulary keys
        category: spec.category,
        key: ins.key,
        value: validation.value,
        confidence: DECLARED_CONFIDENCE,
        source: conversationId,
      },
    })
  }
}
