import { prisma } from '@/lib/db'

export async function resetFunnelTables(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Payment","Policy","Quote","Answer","Application","Message","ConversationSummary","TurnTrace","TurnDebug","Conversation","CustomerInsight","Customer" RESTART IDENTITY CASCADE')
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
