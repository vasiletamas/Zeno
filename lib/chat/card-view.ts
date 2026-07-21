/**
 * Client card-truth reducer (spec 2026-07-20 §2). PURE module — no React, no
 * prisma — the CANONICAL home of the shared card-entry type: the server
 * derivation (lib/chat/derive-active-cards.ts) extends `ActiveCardEntry`
 * with its required hint; the client consumes the entry shape as-is.
 *
 * Contract: absence from cardsState = resolved/superseded; ✓ is only ever
 * derived from server state (kills the `answeredValue ?? value` empty-✓).
 */

export type ActiveCardStatus = 'active' | 'expired' | 'deferred'

export interface ActiveCardEntry {
  /** Semantic key: data_field:<field> | otp:<channel> | question:<code> | confirm:<tool>. */
  key: string
  status: ActiveCardStatus
  /** Renderable payload — INPUT cards only (data_field/otp/question). */
  uiAction?: { type: string; payload: Record<string, unknown> } | null
  /** Briefing conduct hint — server-authored; optional on the client mirror. */
  hint?: string
}

export type CardViewStatus =
  | 'interactive'
  | 'submitting'
  | 'inert_resolved'
  | 'inert_expired'
  | 'inert_released'

/**
 * The ONE shared key for a code-less question card (the T10 medical BATCH
 * card and any question payload whose code is null). Used by BOTH the server
 * derivation and the client key mappers — a drifted literal here is exactly
 * the class of bug the SSOT exists to kill.
 */
export const QUESTION_BATCH_KEY = 'question:batch'

/** `question:<code>` with the shared batch fallback (?? semantics: only
 * null/undefined fall back — mirrors the emitters' `code ?? 'batch'`). */
export function questionKeyFor(code: string | null | undefined): string {
  return code == null ? QUESTION_BATCH_KEY : `question:${code}`
}

/** Semantic key for a RENDERED card (ui_action payload). Presentation cards
 * (quote/product/review/confirm/…) have no key in v1 — they keep the legacy
 * newest-wins rendering. */
export function cardKeyForUiAction(ui: { type: string; payload: Record<string, unknown> }): string | null {
  switch (ui.type) {
    case 'show_data_field':
      return typeof ui.payload.field === 'string' ? `data_field:${ui.payload.field}` : null
    case 'show_otp_entry':
      return typeof ui.payload.channel === 'string' ? `otp:${ui.payload.channel}` : null
    case 'show_question':
    case 'show_medical_batch': {
      // questionCard() nests the code under payload.question; the batch card
      // carries none — both roads meet questionKeyFor's fallback.
      const code = (ui.payload.code
        ?? (ui.payload.question as { code?: string | null } | undefined)?.code
        ?? null) as string | null
      return questionKeyFor(code)
    }
    default:
      return null // presentation cards keep legacy rendering in v1
  }
}

/**
 * Semantic key for a SUBMITTED action — the types are the REAL literals the
 * cards post (enumerated against lib/chat/action-adapter.ts + the rich card
 * builders, 2026-07-21):
 *  - submit_field            (inline-data-form → collect_customer_field)
 *  - otp_submit / otp_resend (otp-entry-card → confirm/start_channel_verification)
 *  - answer_question         (question-card via rich-content; + legacy answer_dnt)
 *  - medical_batch           (medical-batch-card → write_medical_batch)
 *  - write_question_answer / modify_answer (question confirm round-trips)
 * Everything else (coverage picks, quote/acceptance/payment/sign flows) is
 * not an input-card submission and yields null.
 */
export function cardKeyForAction(action: { type: string; payload: Record<string, unknown> }): string | null {
  switch (action.type) {
    case 'submit_field':
      return typeof action.payload.field === 'string' ? `data_field:${action.payload.field}` : null
    case 'otp_submit':
    case 'otp_resend':
      // pre-threading otp_submit payloads carry only { code } — email is the
      // only channel those legacy cards were ever emitted for
      return `otp:${String(action.payload.channel ?? 'email')}`
    case 'answer_question':
    case 'answer_dnt':
    case 'write_question_answer':
    case 'modify_answer': {
      const code = (action.payload.questionCode ?? action.payload.code ?? null) as string | null
      // NO fallback to QUESTION_BATCH_KEY here (unlike cardKeyForUiAction,
      // where a code-less RENDERED card is legitimately the batch card): a
      // submit that names no question addresses no keyed card. BdResultCard's
      // continue/decline post `answer_question` with no code — keying them to
      // question:batch would spuriously lock a co-rendered medical-batch card
      // into `submitting`.
      return code == null ? null : questionKeyFor(code)
    }
    case 'medical_batch':
      return QUESTION_BATCH_KEY
    default:
      return null
  }
}

/**
 * The reducer: rendered card + server card set + in-flight key → view status.
 * - null key: presentation card — no derived-state claim, renders by its own
 *   legacy semantics (callers treat inert_resolved as "not state-driven").
 * - submitting wins while the click's turn is in flight.
 * - absence from the set = resolved/superseded ("no longer needed").
 */
export function cardView(
  key: string | null,
  cardsState: ActiveCardEntry[],
  submittingKey: string | null,
): { status: CardViewStatus } {
  if (key === null) return { status: 'inert_resolved' }
  if (submittingKey === key) return { status: 'submitting' }
  const entry = cardsState.find((c) => c.key === key)
  if (!entry) return { status: 'inert_resolved' }
  if (entry.status === 'expired') return { status: 'inert_expired' }
  if (entry.status === 'deferred') return { status: 'inert_released' }
  return { status: 'interactive' }
}
