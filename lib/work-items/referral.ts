/**
 * REFERRAL WorkItem creation — called by D1's generate_quote referred branch
 * INSIDE its transaction (pass the tx client, E2 erratum 7); the function is
 * the contract until D1 lands.
 */
import { prisma } from '@/lib/db'
import type { Prisma, WorkItem } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export async function createReferralWorkItem(
  input: { applicationId: string; customerId: string; conversationId: string; reason: string },
  db: Db = prisma,
): Promise<WorkItem> {
  const existing = await db.workItem.findFirst({
    where: { kind: 'REFERRAL', status: 'OPEN', refs: { path: ['applicationId'], equals: input.applicationId } },
  })
  if (existing) return existing
  return db.workItem.create({
    data: {
      kind: 'REFERRAL', status: 'OPEN', priority: 'HIGH', reason: input.reason,
      refs: { applicationId: input.applicationId, customerId: input.customerId, conversationId: input.conversationId },
      createdBy: 'system',
    },
  })
}
