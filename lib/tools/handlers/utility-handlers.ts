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
