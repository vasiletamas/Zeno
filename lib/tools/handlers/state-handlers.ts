/**
 * State Handlers
 *
 * get_current_state
 */

import { deriveState } from '@/lib/chat/derive-state'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// get_current_state
// ─────────────────────────────────────────────

export const getStateHandler: ToolHandler = async (_args, context) => {
  try {
    const state = await deriveState(context.conversationId)
    return {
      success: true,
      data: { state },
      message: `Retrieved current state for phase: ${state.phase}`,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to get current state: ${message}` }
  }
}
