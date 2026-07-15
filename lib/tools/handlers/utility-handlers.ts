/**
 * Utility Handlers
 *
 * escalate_to_human — persists an ESCALATION WorkItem through the commit
 * gateway (E2.2). Conversation status is untouched: it carries zero funnel
 * semantics (contradiction #11).
 */

import { createWorkItem } from '@/lib/work-items/service'
import type { ToolHandler } from '@/lib/tools/types'

const PRIORITY_MAP: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'> = {
  low: 'LOW', medium: 'MEDIUM', high: 'HIGH', urgent: 'URGENT',
}

export const escalateToHuman: ToolHandler = async (args, context) => {
  const reason = (args.reason as string | undefined) ?? 'unspecified'
  const priority = PRIORITY_MAP[(args.priority as string | undefined) ?? 'medium'] ?? 'MEDIUM'
  try {
    // Absorb repeats while an escalation is LIVE for this conversation
    // (run cmr9ayiad 2026-07-06: 45 fresh escalations in one conversation —
    // different reason texts defeat ledger idempotency, so the check lives
    // here, like recordPaymentAnomaly's OPEN-alert absorption).
    const live = await context.db.workItem.findFirst({
      where: {
        kind: 'ESCALATION',
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        refs: { path: ['conversationId'], equals: context.conversationId },
      },
      select: { id: true },
    })
    if (live) {
      return {
        success: false,
        error: `already_escalated: a colleague has already been notified for this conversation (work item ${live.id}). Do NOT escalate again — reassure the customer that a specialist will follow up, and keep helping where you can.`,
      }
    }
    const item = await createWorkItem(
      {
        kind: 'ESCALATION', reason, priority,
        refs: { conversationId: context.conversationId, customerId: context.customerId },
        createdBy: 'agent',
      },
      context.db,
    )
    return {
      success: true,
      data: { escalated: true, workItemId: item.id, reason, priority },
      message: 'Escalation recorded. A specialist will follow up with full context of this conversation.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
