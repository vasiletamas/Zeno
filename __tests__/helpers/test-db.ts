import { prisma } from '@/lib/db'
import { seedProduct } from '@/prisma/seeds/seed-product'
import { seedQuestions } from '@/prisma/seeds/seed-questions'

/**
 * The ONE truncate list for the real-DB integration ring (plan A2.ADD-1).
 * Later packages APPEND table names here — never create a second list.
 * Order is irrelevant: TRUNCATE ... CASCADE follows FKs (which also empties
 * dependents like User/Referral/WorkflowSession/ConversationScore/
 * SimulationConversation via their references into this set).
 */
export const DOMAIN_TABLES: string[] = [
  'Payment',
  'Policy',
  'Quote',
  'Answer',
  'Application',
  'Message',
  'ConversationSummary',
  'TurnTrace',
  'TurnDebug',
  'Conversation',
  'CustomerInsight',
  'Customer',
]

export async function resetFunnelTables(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${DOMAIN_TABLES.map((t) => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`,
  )
}

/**
 * Truncate every domain table, then restore catalog data (product catalog +
 * question groups) via the idempotent seed entrypoints, on the SAME '@/lib/db'
 * client the code under test uses (single-client rule — never a second client
 * via the `datasources` constructor option).
 */
export async function resetDb(): Promise<void> {
  await resetFunnelTables()
  await seedProduct(prisma)
  await seedQuestions(prisma)
}

export async function ensureTestProduct() {
  const existing = await prisma.product.findFirst({ where: { code: 'protect' } })
  if (existing) return existing
  return prisma.product.create({
    data: {
      code: 'protect',
      name: { ro: 'Protect', en: 'Protect' },
      description: { ro: '-', en: '-' },
      insuranceType: 'LIFE',
      subType: 'TERM',
      eligibility: {},
      defaultPlaybook: '-',
      pricingExplanation: '-',
      targetCustomer: '-',
      targetAgeRange: '18-65',
      contractTerm: '-',
      gracePeriod: '-',
      territoryCoverage: 'RO',
      isActive: true,
    },
  })
}
