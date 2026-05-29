/**
 * UI Action Adapter
 *
 * Converts frontend UI actions (button clicks, form submissions)
 * into synthetic ToolCall objects that the orchestrator can execute
 * directly through the tool pipeline.
 *
 * B2 redesign: switch-based routing with payload-conditional logic
 * for question group routing (DNT vs Application vs BD Medical).
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
// ADAPTER
// ==============================================

/**
 * Convert a UIAction to a synthetic ToolCall.
 * Returns null if the action type is not recognized.
 */
export function adaptAction(action: UIAction): ToolCall | null {
  switch (action.type) {
    // ── Product selection (tier + level from ProductCard) ──
    case 'select_tier':
      return {
        id: `action_${Date.now()}`,
        name: 'save_application_answer',
        arguments: {
          answer: String(action.payload.tierCode),
          field: 'PACKAGE_CHOICE',
        },
      }

    case 'select_level':
      return {
        id: `action_${Date.now()}`,
        name: 'save_application_answer',
        arguments: {
          answer: String(action.payload.levelCode),
          field: 'PREMIUM_LEVEL',
        },
      }

    // ── Question answering (routes by groupType) ──
    case 'answer_question': {
      const groupType = action.payload.groupType as string
      const toolName = groupType === 'dnt' ? 'save_dnt_answer' : 'save_application_answer'
      return {
        id: `action_${Date.now()}`,
        name: toolName,
        arguments: { answer: String(action.payload.answer) },
      }
    }

    // ── Quote actions ──
    case 'accept_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'accept_quote',
        arguments: { confirmAcceptance: true },
      }

    case 'modify_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'modify_quote',
        arguments: {},
      }

    // ── Data collection ──
    case 'submit_field':
      return {
        id: `action_${Date.now()}`,
        name: 'collect_customer_field',
        arguments: {
          field: String(action.payload.field),
          value: String(action.payload.value),
        },
      }

    // ── BD continue/decline ──
    case 'bd_continue':
      return {
        id: `action_${Date.now()}`,
        name: 'save_application_answer',
        arguments: { answer: 'continue_without_bd' },
      }

    // ── B1 legacy mappings ──
    case 'start_dnt':
      return {
        id: `action_${Date.now()}`,
        name: 'start_dnt_questionnaire',
        arguments: action.payload,
      }

    case 'answer_dnt':
      return {
        id: `action_${Date.now()}`,
        name: 'save_dnt_answer',
        arguments: action.payload,
      }

    case 'sign_dnt':
      return {
        id: `action_${Date.now()}`,
        name: 'sign_dnt',
        arguments: action.payload,
      }

    case 'start_application':
      return {
        id: `action_${Date.now()}`,
        name: 'start_application',
        arguments: action.payload,
      }

    case 'resume_application':
      return {
        id: `action_${Date.now()}`,
        name: 'resume_application',
        arguments: action.payload,
      }

    case 'generate_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'generate_quote',
        arguments: action.payload,
      }

    case 'escalate':
      return {
        id: `action_${Date.now()}`,
        name: 'escalate_to_human',
        arguments: action.payload,
      }

    default:
      return null
  }
}
