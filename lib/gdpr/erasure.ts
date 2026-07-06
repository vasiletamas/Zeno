/**
 * GDPR erasure executor (E3.2, M3): executes the retention table's
 * dispositions and NOTHING else — every mutation here is the direct
 * consequence of one declared policy row, reported per class.
 *
 * Runs on a CALLER-provided client (E3 erratum 9): approve_erasure passes
 * the gateway's transaction client so the erasure, the WorkItem resolution
 * and the ledger row land atomically. Sequential awaits only — the tx
 * client is single-connection.
 *
 * The report's class order follows DATA_CLASSES; the EXECUTION order is
 * dependency-safe (documents before quotes before applications before
 * conversations; TurnDebug before its conversations die). Quotes referenced
 * by a PaymentSchedule survive even for never-contracted customers — the
 * schedule is a retained financial record and the quote is its acceptance
 * evidence (FK + retention coherence).
 */
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { DATA_CLASSES, dispositionFor, type DataClass, type RetentionDisposition } from '@/lib/gdpr/retention-policy'

type Db = typeof prisma | Prisma.TransactionClient

export const ERASED_MARKER = '[erased_per_gdpr_request]'

export interface ErasureReport {
  customerId: string
  executedBy: string
  hasContracted: boolean
  classResults: { dataClass: DataClass; disposition: RetentionDisposition; affected: number }[]
}

export async function executeErasure(customerId: string, executedBy: string, db: Db = prisma): Promise<ErasureReport> {
  const hasContracted =
    (await db.policy.count({ where: { customerId } })) > 0 ||
    (await db.payment.count({ where: { customerId } })) > 0
  const ctx = { hasContracted }
  const affectedByClass = new Map<DataClass, number>()
  const bump = (dc: DataClass, n: number) => affectedByClass.set(dc, (affectedByClass.get(dc) ?? 0) + n)

  const conversationIds = (await db.conversation.findMany({ where: { customerId }, select: { id: true } })).map((c) => c.id)

  // ── customer_profile (erase in both contexts) ────────────────────────
  bump('customer_profile', (await db.customerInsight.deleteMany({ where: { customerId } })).count)
  bump('customer_profile', (await db.customerProfileField.deleteMany({ where: { customerId } })).count)

  // ── dnt_unsigned_sessions (erase; the signed Dnt's source survives) ──
  const draftSessions = (await db.dntSession.findMany({ where: { customerId, dnt: { is: null } }, select: { id: true } })).map((s) => s.id)
  if (draftSessions.length > 0) {
    await db.dntAnswer.deleteMany({ where: { sessionId: { in: draftSessions } } })
    bump('dnt_unsigned_sessions', (await db.dntSession.deleteMany({ where: { id: { in: draftSessions } } })).count)
  }

  // ── P0-3: the CNP inside SURVIVING (signed) sessions is profile data —
  // scrub it (new writes persist the mask, but legacy rows hold plaintext).
  const cnpQuestion = await db.question.findFirst({ where: { code: 'DNT_CNP' }, select: { id: true } })
  if (cnpQuestion) {
    const survivingSessions = (await db.dntSession.findMany({ where: { customerId }, select: { id: true } })).map((s) => s.id)
    if (survivingSessions.length > 0) {
      bump('customer_profile', (await db.dntAnswer.updateMany({
        where: { sessionId: { in: survivingSessions }, questionId: cnpQuestion.id },
        data: { value: ERASED_MARKER },
      })).count)
    }
  }

  // ── turn_debug (erase in both contexts; before conversations die) ────
  if (conversationIds.length > 0) {
    bump('turn_debug', (await db.turnDebug.deleteMany({ where: { conversationId: { in: conversationIds } } })).count)
  }

  // ── documents_evidence (erase when never contracted; KYC retained when contracted)
  if (dispositionFor('documents_evidence', ctx) === 'erase') {
    bump('documents_evidence', (await db.document.deleteMany({ where: { customerId } })).count)
    bump('documents_evidence', (await db.customerDocument.deleteMany({ where: { customerId } })).count)
  }

  // ── quotes (erase when never contracted, minus schedule-referenced) ──
  if (dispositionFor('quotes', ctx) === 'erase') {
    const quoteIds = (await db.quote.findMany({ where: { customerId }, select: { id: true } })).map((q) => q.id)
    if (quoteIds.length > 0) {
      const withSchedules = new Set(
        (await db.paymentSchedule.findMany({ where: { quoteId: { in: quoteIds } }, select: { quoteId: true } })).map((s) => s.quoteId),
      )
      const deletable = quoteIds.filter((id) => !withSchedules.has(id))
      if (deletable.length > 0) {
        await db.disclosureAck.deleteMany({ where: { quoteId: { in: deletable } } })
        await db.document.deleteMany({ where: { quoteId: { in: deletable } } })
        bump('quotes', (await db.quote.deleteMany({ where: { id: { in: deletable } } })).count)
      }
    }
  }

  // ── applications (erase when never contracted, minus quote-referenced)
  if (dispositionFor('applications', ctx) === 'erase') {
    const appIds = (await db.application.findMany({ where: { customerId }, select: { id: true } })).map((a) => a.id)
    if (appIds.length > 0) {
      const stillQuoted = new Set(
        (await db.quote.findMany({ where: { applicationId: { in: appIds } }, select: { applicationId: true } })).map((q) => q.applicationId),
      )
      const deletable = appIds.filter((id) => !stillQuoted.has(id))
      await db.answer.deleteMany({ where: { applicationId: { in: deletable } } })
      await db.suitabilityWarningAck.deleteMany({ where: { applicationId: { in: deletable } } })
      if (deletable.length > 0) {
        bump('applications', (await db.application.deleteMany({ where: { id: { in: deletable } } })).count)
      }
    }
  }

  // ── conversations_messages ────────────────────────────────────────────
  if (conversationIds.length > 0) {
    if (dispositionFor('conversations_messages', ctx) === 'erase') {
      await db.message.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.conversationSummary.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.turnTrace.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.conversationScore.deleteMany({ where: { conversationId: { in: conversationIds } } })
      await db.simulationConversation.deleteMany({ where: { conversationId: { in: conversationIds } } })
      bump('conversations_messages', (await db.conversation.deleteMany({ where: { id: { in: conversationIds } } })).count)
    } else {
      // anonymize_retain: the audit trail stays, the customer's words go
      bump('conversations_messages', (await db.message.updateMany({
        where: { conversationId: { in: conversationIds }, role: 'user' },
        data: { content: ERASED_MARKER, toolCalls: Prisma.DbNull, toolResults: Prisma.DbNull },
      })).count)
      await db.conversationSummary.updateMany({
        where: { conversationId: { in: conversationIds } },
        data: { summary: ERASED_MARKER },
      })
    }
  }

  // ── customer_identity (tombstone in both contexts — the row survives,
  //    the person leaves; erase vs anonymize_retain differ only in intent)
  await db.customer.update({
    where: { id: customerId },
    data: {
      name: null, email: null, phone: null, dateOfBirth: null,
      cnpEncrypted: null, cnpIv: null, cnpTag: null, address: Prisma.DbNull,
      isAnonymous: true, erasedAt: new Date(),
    },
  })
  bump('customer_identity', 1)
  bump('customer_identity', (await db.verificationChallenge.deleteMany({ where: { customerId } })).count)
  const user = await db.user.findUnique({ where: { customerId } })
  if (user) {
    await db.user.update({ where: { id: user.id }, data: { isActive: false, email: `erased-${customerId}@gdpr.invalid` } })
    bump('customer_identity', 1)
  }

  // ── work_items (anonymize_retain: the decision record survives, PII goes)
  const allItems = await db.workItem.findMany({ select: { id: true, kind: true, refs: true } })
  const customerItems = allItems.filter((i) => (i.refs as { customerId?: string })?.customerId === customerId)
  for (const item of customerItems) {
    await db.workItem.update({
      where: { id: item.id },
      data: {
        reason: ERASED_MARKER,
        // a stored GDPR_EXPORT bundle IS the customer's data — it goes with them
        ...(item.kind === 'GDPR_EXPORT' ? { payload: Prisma.DbNull } : {}),
      },
    })
  }
  bump('work_items', customerItems.length)

  return {
    customerId,
    executedBy,
    hasContracted,
    classResults: DATA_CLASSES.map((dataClass) => ({
      dataClass,
      disposition: dispositionFor(dataClass, ctx),
      affected: affectedByClass.get(dataClass) ?? 0,
    })),
  }
}
