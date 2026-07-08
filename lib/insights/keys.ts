import { prisma } from '@/lib/db'
import type { InsightCategory } from '@/lib/generated/prisma/client'

export interface InsightKeySpec {
  key: string
  category: InsightCategory
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
  // Task 3.1 (D3): the PREFERENCE vocabulary — the "Știu că te interesa
  // Optim" memory class. Tier/level values are PRODUCT-defined, so products
  // specialize these to enums via Product.insightKeys (override by key).
  { key: 'preferredTier', category: 'PREFERENCE', type: 'string' },
  { key: 'preferredLevel', category: 'PREFERENCE', type: 'string' },
  { key: 'addonInterest', category: 'PREFERENCE', type: 'string' },
  { key: 'budgetSensitivity', category: 'PREFERENCE', type: 'enum', options: ['low', 'medium', 'high'] },
  { key: 'preferredPaymentFrequency', category: 'PREFERENCE', type: 'enum', options: ['monthly', 'quarterly', 'semi_annual', 'annual', 'integral'] },
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
  // Product keys OVERRIDE globals by key (Task 3.1): the product speaks its
  // own tier/level enum where the global spec can only say 'string'.
  const productKeys = raw as unknown as InsightKeySpec[]
  const overridden = new Set(productKeys.map((k) => k.key))
  return [...GLOBAL_INSIGHT_KEYS.filter((k) => !overridden.has(k.key)), ...productKeys]
}

export function findKeySpec(
  active: InsightKeySpec[],
  key: string,
): InsightKeySpec | undefined {
  return active.find(spec => spec.key === key)
}
