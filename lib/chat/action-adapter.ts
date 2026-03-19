/**
 * UI Action Adapter
 *
 * Converts frontend UI actions (button clicks, form submissions)
 * into synthetic ToolCall objects that the orchestrator can execute
 * directly through the tool pipeline.
 */

import type { ToolCall } from '@/lib/llm/providers/types'

// ==============================================
// UI ACTION TYPE
// ==============================================

export interface UIAction {
  type: string
  payload: Record<string, unknown>
}

// ==============================================
// ACTION-TO-TOOLCALL MAPPING
// ==============================================

/**
 * Mapping table: UI action type -> tool name.
 * Payload is passed through as tool arguments.
 */
const ACTION_MAP: Record<string, string> = {
  // Product selection
  'select_product': 'set_conversation_product',

  // DNT flow
  'start_dnt': 'start_dnt_questionnaire',
  'answer_dnt': 'save_dnt_answer',
  'sign_dnt': 'sign_dnt',

  // Application flow
  'start_application': 'start_application',
  'answer_question': 'save_application_answer',
  'resume_application': 'resume_application',

  // Quote flow
  'generate_quote': 'generate_quote',
  'accept_quote': 'accept_quote',

  // Utility
  'escalate': 'escalate_to_human',
}

// ==============================================
// ADAPTER
// ==============================================

/**
 * Convert a UIAction to a synthetic ToolCall.
 * Returns null if the action type is not recognized.
 */
export function adaptAction(action: UIAction): ToolCall | null {
  const toolName = ACTION_MAP[action.type]
  if (!toolName) return null

  return {
    id: `synthetic_${action.type}_${Date.now()}`,
    name: toolName,
    arguments: action.payload,
  }
}
