import { prisma } from '@/lib/db'

export type InsightCategoryName =
  | 'DEMOGRAPHIC'
  | 'PREFERENCE'
  | 'OBJECTION_PATTERN'
  | 'BUYING_SIGNAL'
  | 'RISK_FACTOR'

export interface InsightKeySpec {
  key: string
  category: InsightCategoryName
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: string[]
}

export const GLOBAL_INSIGHT_KEYS: InsightKeySpec[] = [
  { key: 'age', category: 'DEMOGRAPHIC', type: 'number' },
  { key: 'occupation', category: 'DEMOGRAPHIC', type: 'string' },
  { key: 'familySize', category: 'DEMOGRAPHIC', type: 'number' },
  { key: 'hasSpouse', category: 'DEMOGRAPHIC', type: 'boolean' },
  { key: 'hasChildren', category: 'DEMOGRAPHIC', type: 'boolean' },
  { key: 'incomeLevel', category: 'DEMOGRAPHIC', type: 'enum', options: ['low', 'medium', 'high'] },
  { key: 'smokingStatus', category: 'RISK_FACTOR', type: 'enum', options: ['smoker', 'non_smoker', 'former'] },
  { key: 'hazardousOccupation', category: 'RISK_FACTOR', type: 'boolean' },
  { key: 'chronicConditions', category: 'RISK_FACTOR', type: 'string' },
  { key: 'urgency', category: 'BUYING_SIGNAL', type: 'enum', options: ['immediate', 'weeks', 'exploring'] },
  { key: 'primaryMotivation', category: 'BUYING_SIGNAL', type: 'enum', options: ['family_protection', 'self_protection', 'investment'] },
]

export async function getActiveInsightKeys(
  productId: string | null,
): Promise<InsightKeySpec[]> {
  if (!productId) return GLOBAL_INSIGHT_KEYS

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { insightKeys: true },
  })
  const raw = product?.insightKeys
  if (!Array.isArray(raw)) return GLOBAL_INSIGHT_KEYS
  return [...GLOBAL_INSIGHT_KEYS, ...(raw as unknown as InsightKeySpec[])]
}

export function findKeySpec(
  active: InsightKeySpec[],
  key: string,
): InsightKeySpec | undefined {
  return active.find(spec => spec.key === key)
}
