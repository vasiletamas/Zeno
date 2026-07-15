/**
 * Consent service — the append-only write path for ConsentEvent rows and the
 * DB-backed read path for the derived consent state. Rows are never updated
 * or deleted (withdrawal blocks processing, never erases history).
 */
import { prisma } from '@/lib/db'
import { deriveConsents, type ConsentEventLike, type DerivedConsents } from '@/lib/customer/consent'
import type { Prisma } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export async function appendConsentEvents(
  customerId: string,
  events: { kind: 'gdpr_processing' | 'ai_disclosure' | 'marketing'; action: 'granted' | 'withdrawn'; scope?: string }[],
  sourceCommitId?: string,
  tx: Db = prisma,
): Promise<void> {
  await tx.consentEvent.createMany({ data: events.map(e => ({ customerId, ...e, sourceCommitId })) })
}

export async function loadDerivedConsents(customerId: string, db: Db = prisma): Promise<DerivedConsents> {
  const rows = await db.consentEvent.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } })
  return deriveConsents(rows as unknown as ConsentEventLike[])
}
