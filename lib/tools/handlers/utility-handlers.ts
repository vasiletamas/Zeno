/**
 * Utility Handlers
 *
 * escalate_to_human
 */

import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// escalate_to_human
// ─────────────────────────────────────────────

export const escalateToHuman: ToolHandler = async (args, context) => {
  const reason = (args.reason as string | undefined) ?? 'unspecified'
  const priority = (args.priority as string | undefined) ?? 'medium'

  try {
    // Update Conversation status -> IDLE
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { status: 'IDLE' },
    })

    // Log escalation (console for now; DB persistence in Phase B)
    console.log(`[ESCALATION] Conversation ${context.conversationId}:`, {
      reason,
      priority,
      customerId: context.customerId,
      timestamp: new Date().toISOString(),
    })

    return {
      success: true,
      data: {
        escalated: true,
        reason,
        priority,
      },
      message:
        'Conversation escalated to a human agent. A specialist will follow up shortly with full context of this conversation.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
