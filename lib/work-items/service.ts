/**
 * WorkItem service — the M5 operator-queue spine.
 *
 * Writers pass the gateway transaction client (context.db) so WorkItem rows
 * land atomically with the CommitLedger row (#8 step 6, E2 erratum 8).
 */
import { prisma } from '@/lib/db'
import type { Prisma, WorkItem, WorkItemKind, WorkItemPriority, WorkItemStatus } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

export interface WorkItemRefs {
  customerId?: string
  conversationId?: string
  applicationId?: string
  quoteId?: string
  policyId?: string
}

export async function createWorkItem(
  input: {
    kind: WorkItemKind
    reason: string
    refs: WorkItemRefs
    createdBy: string
    priority?: WorkItemPriority
    payload?: unknown
  },
  db: Db = prisma,
): Promise<WorkItem> {
  return db.workItem.create({
    data: {
      kind: input.kind,
      reason: input.reason,
      refs: input.refs as object,
      createdBy: input.createdBy,
      priority: input.priority ?? 'MEDIUM',
      payload: input.payload === undefined ? undefined : (input.payload as object),
    },
  })
}

export async function listWorkItems(
  filter: { status?: WorkItemStatus; kind?: WorkItemKind } = {},
  db: Db = prisma,
): Promise<WorkItem[]> {
  return db.workItem.findMany({
    where: { ...(filter.status && { status: filter.status }), ...(filter.kind && { kind: filter.kind }) },
    orderBy: { createdAt: 'desc' },
  })
}
