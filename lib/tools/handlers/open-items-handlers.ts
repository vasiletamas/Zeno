/**
 * get_open_items (E4.3, M2): ONE read replacing the catalog's four —
 * get_application_list and get_quote_list are NOT built (M2 spec
 * amendment). Items come from the pure deriveOpenItems over the SAME
 * deriveAndExpose output the turn runs on (#6 — one exposure computation),
 * so every nextAction is a currently-exposed action end to end.
 */
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { deriveOpenItems } from '@/lib/engines/open-items'
import type { ToolHandler } from '@/lib/tools/types'

export const getOpenItems: ToolHandler = async (_args, context) => {
  try {
    const snapshot = await loadDomainSnapshot(context.conversationId, context.db)
    const { state, actions } = deriveAndExpose(snapshot)
    const items = deriveOpenItems(state, actions, new Date())
    return {
      success: true,
      data: { items: items as unknown as Record<string, unknown>[], availableActions: actions.available },
      message: items.length === 0 ? 'No open items for this customer.' : `${items.length} open item(s) found.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
