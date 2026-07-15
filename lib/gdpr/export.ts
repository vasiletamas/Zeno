/**
 * GDPR data-access export (E3.5, M3): compiles EVERYTHING held on a
 * customer into one versioned typed bundle — the bundle IS the access
 * right, so no store is omitted (erratum 4: every read written out).
 * CNP values ride masked through the B0 profile projection; ledger rows
 * are references-not-values (T14.D5) and safe to disclose.
 *
 * Runs on a caller-provided client so approve_export can compile inside
 * the gateway transaction.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { getProfile, getIdentityFacts, getAge } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'

type Db = typeof prisma | Prisma.TransactionClient

export interface CustomerExportBundle {
  schemaVersion: 1
  generatedAt: string
  profile: Record<string, unknown>          // B0 snapshot incl. per-field provenance + identity tier
  consentEvents: unknown[]                  // B1 ledger rows
  conversations: { id: string; startedAt: Date; messages: { role: string; content: string; createdAt: Date }[] }[]
  dnt: unknown[]
  applications: unknown[]
  quotes: unknown[]
  payments: unknown[]
  policies: unknown[]
  documents: unknown[]
  workItems: unknown[]
  commitLedger: unknown[]                   // references-not-values rows (T14.D5 safe to export)
}

export async function compileCustomerExport(customerId: string, db: Db = prisma): Promise<CustomerExportBundle> {
  const profile = await getProfile(customerId)
  const identity = await getIdentityFacts(customerId, db)
  const age = await getAge(customerId, new Date(), db)
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { email: true, phone: true, name: true, language: true, isAnonymous: true, createdAt: true, erasedAt: true },
  })

  const conversations = await db.conversation.findMany({
    where: { customerId },
    select: {
      id: true, startedAt: true,
      messages: { select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
    },
    orderBy: { startedAt: 'asc' },
  })

  const consentEvents = await db.consentEvent.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } })
  const dnt = await db.dnt.findMany({
    where: { customerId },
    include: { sourceSession: { include: { answers: { select: { questionId: true, value: true, answeredAt: true } } } } },
  })
  const applications = await db.application.findMany({
    where: { customerId },
    include: { answers: { where: { status: 'ACTIVE' }, select: { questionId: true, value: true, answeredAt: true } } },
  })
  const quotes = await db.quote.findMany({ where: { customerId } })
  const payments = await db.payment.findMany({ where: { customerId } })
  const policies = await db.policy.findMany({ where: { customerId } })
  const documents = await db.document.findMany({
    where: { customerId },
    select: { id: true, kind: true, version: true, language: true, generatedAt: true, contentHash: true },
  })
  const workItemsAll = await db.workItem.findMany({ select: { id: true, kind: true, status: true, reason: true, refs: true, createdAt: true, resolvedAt: true } })
  const workItems = workItemsAll.filter((i) => (i.refs as { customerId?: string })?.customerId === customerId)
  const commitLedger = await db.commitLedger.findMany({
    where: { customerId },
    select: { id: true, conversationId: true, actor: true, tool: true, targetRef: true, outcome: true, reasonCode: true, idempotencyDisposition: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: {
      ...customer,
      fields: profile.fields,
      conflicts: profile.conflicts,
      identityTier: deriveIdentityTier({ fields: identity.fields, verifiedChannels: identity.verifiedChannels }),
      age,
    },
    consentEvents,
    conversations,
    dnt,
    applications,
    quotes,
    payments,
    policies,
    documents,
    workItems,
    commitLedger,
  }
}
