/**
 * Interim DNT validity lookup (B2.1).
 *
 * Aggregate-only: does the customer hold an ACTIVE, unexpired Dnt covering
 * the product type? Callers keep their legacy Conversation-stamp check
 * inline (short-circuiting ahead of this) until B2.6 drops the columns;
 * B2.2's pure isDntValidFor takes over this predicate.
 */
import { prisma } from '@/lib/db'
import type { Prisma, ProductType } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export async function hasValidDnt(
  customerId: string,
  productType: ProductType,
  db: Db = prisma,
): Promise<boolean> {
  const dnt = await db.dnt.findFirst({
    where: { customerId, status: 'ACTIVE', validUntil: { gt: new Date() }, productTypesCovered: { has: productType } },
    orderBy: { signedAt: 'desc' },
  })
  return dnt !== null
}
