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
    // ── Coverage selection (B4.4: select_coverage is the sole writer) ──
    case 'select_tier':
      return {
        id: `action_${Date.now()}`,
        name: 'select_coverage',
        arguments: { tier: String(action.payload.tierCode) },
      }

    case 'select_level':
      return {
        id: `action_${Date.now()}`,
        name: 'select_coverage',
        arguments: { level: String(action.payload.levelCode) },
      }

    case 'select_coverage':
      return {
        id: `action_${Date.now()}`,
        name: 'select_coverage',
        arguments: action.payload,
      }

    // ── Question answering (routes by groupType) ──
    case 'answer_question': {
      const groupType = action.payload.groupType as string
      if (groupType === 'dnt') {
        // B2: session-scoped answering is keyed by question CODE
        return {
          id: `action_${Date.now()}`,
          name: 'write_dnt_answer',
          arguments: { questionCode: String(action.payload.questionCode ?? action.payload.code ?? ''), value: String(action.payload.answer) },
        }
      }
      // C1.9: the question CODE addresses the commit (replay scope) — a
      // same-value answer to a DIFFERENT question must never replay.
      const qCode = action.payload.questionCode ?? action.payload.code
      return {
        id: `action_${Date.now()}`,
        name: 'write_question_answer',
        arguments: { answer: String(action.payload.answer), ...(qCode ? { questionCode: String(qCode) } : {}) },
      }
    }

    // ── Quote actions ──
    // No self-confirmed buttons (M4/A3.5): the first click carries NO confirm
    // flag — the gateway answers requires_confirmation with a token, the GUI
    // confirm dialog round-trips it.
    case 'accept_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'accept_quote',
        arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {},
      }

    case 'modify_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'modify_quote',
        arguments: {},
      }

    // ── Identity verification (B3.ADD-2) ──
    case 'otp_submit':
      return {
        id: `action_${Date.now()}`,
        name: 'confirm_channel_verification',
        arguments: { code: String(action.payload.code ?? '') },
      }

    case 'document_uploaded':
      // The pipeline already ran server-side in the upload route; the GUI
      // event refreshes the derived state so exposure sees the validated doc.
      return {
        id: `action_${Date.now()}`,
        name: 'get_current_state',
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

    // ── BD continue-without-addon: a selection fact, not an answer (B4.4) ──
    case 'bd_continue':
      return {
        id: `action_${Date.now()}`,
        name: 'select_coverage',
        arguments: { addon: false },
      }

    // ── B1 legacy mappings ──
    case 'start_dnt':
      return {
        id: `action_${Date.now()}`,
        name: 'open_dnt_session',
        arguments: action.payload,
      }

    case 'answer_dnt':
      return {
        id: `action_${Date.now()}`,
        name: 'write_dnt_answer',
        arguments: {
          questionCode: String(action.payload.questionCode ?? action.payload.code ?? ''),
          value: String(action.payload.value ?? action.payload.answer ?? ''),
        },
      }

    case 'sign_dnt':
      // The consent object is MATERIAL (B1.5): it must ride along from the
      // first click so the confirm token binds to the same args hash.
      return {
        id: `action_${Date.now()}`,
        name: 'sign_dnt',
        arguments: {
          ...(action.payload.consent ? { consent: action.payload.consent } : {}),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    // legacy GUI action name; the tool is set_application since B4.3
    case 'start_application':
    case 'set_application':
      return {
        id: `action_${Date.now()}`,
        name: 'set_application',
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
