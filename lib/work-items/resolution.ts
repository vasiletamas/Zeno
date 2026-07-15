/**
 * Route-facing work-item resolution orchestrator (E2.4 — M5).
 *
 * Follow-up commits (the approve→generate_quote re-run, the reject→outbound
 * notification) CANNOT run inside the resolve_referral gateway transaction:
 * a nested executeCommit would try to take the same per-conversation
 * advisory lock from a second connection and deadlock. So each step here is
 * its own top-level ledgered commit, sequenced by this orchestrator.
 *
 * Lives outside lib/tools/handlers on purpose: the registry imports the
 * operator handlers, and this module imports the gateway (which imports the
 * registry) — keeping the orchestrator here avoids that import cycle.
 */
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { sendCustomerNotification } from '@/lib/engagement/outbound-notifier'
import type { CommitEffect, CommitResult } from '@/lib/engines/domain-types'
import type { ToolContext } from '@/lib/tools/types'

type ReferralRefs = { applicationId: string; customerId: string; conversationId: string }

export async function resolveWorkItemDecision(input: {
  workItemId: string
  decision: 'approve' | 'reject' | 'resolve' | 'dismiss'
  note?: string
  resolvedBy: string
}): Promise<CommitResult> {
  const item = await prisma.workItem.findUnique({ where: { id: input.workItemId } })
  if (!item) return { outcome: 'rejected', reason: 'invalid_args', effects: [], data: { error: `work_item_not_found: ${input.workItemId}` } }
  const refs = item.refs as Partial<ReferralRefs>
  const conversationId = refs.conversationId ?? ''
  const customerId = refs.customerId ?? ''
  const toolContext: ToolContext = { customerId, conversationId, language: 'ro', db: prisma, actor: 'operator' }

  if (item.kind === 'REFERRAL' && (input.decision === 'approve' || input.decision === 'reject')) {
    const resolved = await executeCommit({
      tool: 'resolve_referral', actor: 'operator', conversationId, customerId,
      args: { workItemId: input.workItemId, decision: input.decision, note: input.note, resolvedBy: input.resolvedBy },
      toolContext,
    })
    if (resolved.outcome !== 'applied') return resolved

    if (input.decision === 'approve') {
      const quote = await executeCommit({ tool: 'generate_quote', actor: 'system', conversationId, customerId, args: {}, toolContext: { ...toolContext, actor: 'system' } })
      // E4.ADD-1: transactional notice on approve too — exempt from
      // marketing consent; dedupeKey makes a replayed resolution send-once.
      await sendCustomerNotification({
        customerId, conversationId, kind: 'referral_approved',
        dedupeKey: `referral_resolved:${input.workItemId}`,
        subject: { ro: 'Cererea ta a fost aprobată', en: 'Your application was approved' },
        html: {
          ro: '<p>Vești bune — cererea ta a fost analizată și aprobată, iar oferta te așteaptă.</p><p><a href="{{magicLink}}">Revino în conversație</a> ca să o vezi.</p>',
          en: '<p>Good news — your application was reviewed and approved, and your quote is ready.</p><p><a href="{{magicLink}}">Return to the conversation</a> to see it.</p>',
        },
      })
      return { outcome: 'applied', effects: ['re_rating' as CommitEffect], data: { workItemId: input.workItemId, quote: quote.data, quoteOutcome: quote.outcome } }
    }

    await sendCustomerNotification({
      customerId, conversationId, kind: 'referral_rejected',
      dedupeKey: `referral_resolved:${input.workItemId}`,
      subject: { ro: 'Actualizare despre cererea ta', en: 'An update on your application' },
      html: {
        ro: '<p>Cererea ta a fost analizată și nu poate continua. Te putem ajuta cu alternative.</p><p><a href="{{magicLink}}">Revino în conversație</a> — îți explicăm opțiunile.</p>',
        en: '<p>Your application was reviewed and cannot proceed. We can help with alternatives.</p><p><a href="{{magicLink}}">Return to the conversation</a> and we will walk through your options.</p>',
      },
    })
    return { outcome: 'applied', effects: ['terminal' as CommitEffect], data: { workItemId: input.workItemId } }
  }

  // E3 (erratum 8): GDPR approvals from the queue run the SAME gateway
  // commits the tests/scripts use — approval was never meant to be
  // reachable only via direct executeCommit calls.
  if (item.kind === 'GDPR_ERASURE' && input.decision === 'approve') {
    return executeCommit({
      tool: 'approve_erasure', actor: 'operator', conversationId, customerId,
      args: { workItemId: input.workItemId },
      toolContext,
    })
  }
  if (item.kind === 'GDPR_EXPORT' && input.decision === 'approve') {
    return executeCommit({
      tool: 'approve_export', actor: 'operator', conversationId, customerId,
      args: { workItemId: input.workItemId },
      toolContext,
    })
  }

  if (input.decision === 'resolve' || input.decision === 'dismiss') {
    return executeCommit({
      tool: 'resolve_work_item', actor: 'operator', conversationId, customerId,
      args: { workItemId: input.workItemId, decision: input.decision, note: input.note, resolvedBy: input.resolvedBy },
      toolContext,
    })
  }

  return { outcome: 'rejected', reason: 'invalid_args', effects: [], data: { error: 'invalid_decision_for_kind' } }
}
