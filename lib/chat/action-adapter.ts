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
      // D2.5: paymentOption is MATERIAL — it must ride both the first click
      // and the confirm round-trip (the token is bound to its args hash).
      return {
        id: `action_${Date.now()}`,
        name: 'accept_quote',
        arguments: {
          ...(action.payload.paymentOption ? { paymentOption: String(action.payload.paymentOption) } : {}),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    // D1.7 (erratum 3): the change button cancels the quote — post-quote
    // mutation is engine-illegal; recovery is a NEW application (T13.D2).
    // Tokenless first click → the gateway answers requires_confirmation.
    case 'cancel_quote':
      return {
        id: `action_${Date.now()}`,
        name: 'cancel_quote',
        arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {},
      }

    // ── Payment (D3.5, M4): the Pay button rides the SAME commit as the
    // agent — mode (started|resumed|retried) is engine OUTPUT, never input ──
    case 'pay_now':
      return {
        id: `action_${Date.now()}`,
        name: 'ensure_payment_session',
        arguments: {},
      }

    // T30: settlement already ran server-side (the card POSTs
    // /api/payments/confirm before this action); the post injects the ONLY
    // payment read so the orchestrator narrates the verified outcome + policy
    // over the injected result — never settles on the client's say-so.
    case 'payment_complete':
      return {
        id: `action_${Date.now()}`,
        name: 'get_payment_status',
        arguments: {},
      }

    // ── Identity verification (B3.ADD-2) ──
    case 'otp_submit':
      return {
        id: `action_${Date.now()}`,
        name: 'confirm_channel_verification',
        arguments: { code: String(action.payload.code ?? '') },
      }

    case 'otp_resend':
      // T29: the [Retrimite codul] button re-issues the SAME challenge —
      // resend:true is the gateway's verificationResendEscape, so the
      // pending-challenge wall does not reject the GUI click.
      return {
        id: `action_${Date.now()}`,
        name: 'start_channel_verification',
        arguments: {
          channel: String(action.payload.channel ?? ''),
          target: String(action.payload.target ?? ''),
          resend: true,
        },
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

    // ── C1.5 sensitive-answer confirm round-trips (P0-6, 2026-07-06) ──
    // The BD medical confirm card posts the SAME commit with the token; the
    // material args (answer/newValue + questionCode) ride along so the token
    // binds to the identical args hash.
    case 'write_question_answer':
      return {
        id: `action_${Date.now()}`,
        name: 'write_question_answer',
        arguments: {
          answer: String(action.payload.answer ?? ''),
          ...(action.payload.questionCode ? { questionCode: String(action.payload.questionCode) } : {}),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    case 'modify_answer':
      return {
        id: `action_${Date.now()}`,
        name: 'modify_answer',
        arguments: {
          questionCode: String(action.payload.questionCode ?? ''),
          newValue: String(action.payload.newValue ?? ''),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    // T6.D3 deviation (2026-07-06): the batch medical-declaration signature —
    // the confirm card posts the SAME commit with the gateway-issued token.
    case 'sign_medical_declarations':
      return {
        id: `action_${Date.now()}`,
        name: 'sign_medical_declarations',
        arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {},
      }

    // P2-15: the remaining confirmable commits' card round-trips — material
    // args ride along so the token binds to the identical args hash.
    case 'cancel_application':
      return {
        id: `action_${Date.now()}`,
        name: 'cancel_application',
        arguments: {
          ...(action.payload.reason ? { reason: String(action.payload.reason) } : {}),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    case 'change_payment_option':
      return {
        id: `action_${Date.now()}`,
        name: 'change_payment_option',
        arguments: {
          ...(action.payload.paymentOption ? { paymentOption: String(action.payload.paymentOption) } : {}),
          ...(action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {}),
        },
      }

    case 'request_cancellation':
      return {
        id: `action_${Date.now()}`,
        name: 'request_cancellation',
        arguments: action.payload.confirmToken ? { confirmToken: String(action.payload.confirmToken) } : {},
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
