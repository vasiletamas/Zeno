/**
 * uiAction registry (T29) — the single source of truth for the three action-
 * type surfaces: what tool handlers EMIT, what rich-content RENDERS, and what
 * the GUI can POST back through the action adapter. The parity test
 * (__tests__/lib/chat/ui-action-parity.test.ts) holds the sets together by
 * scanning the renderer/handler sources; the unrendered_ui_action diagnostics
 * check (lib/diagnostics/checks-ui.ts) ratchets recorded conversations.
 *
 * Ratchet origin (2026-07-15, conv cmrm3fgku00056g0y4eb2hsme): the customer
 * was told "Folosește controlul securizat afișat" while show_document_upload
 * fell through rich-content's silent default — emitted, ledgered, never seen.
 */

/**
 * Every uiAction type a tool handler or the orchestrator can emit TODAY.
 * Grep-anchored: handlers' `uiAction: { type: '...' }` literals plus the
 * orchestrator-synthesized confirm_required.
 */
export const EMITTED_UI_ACTION_TYPES: readonly string[] = [
  'show_question', // questionnaire-cards questionCard (T9: shared by dnt-handlers, application-handlers, select-coverage-handlers, derive-pending-card)
  'show_data_field', // data-handlers
  'show_otp_entry', // identity-handlers startChannelVerification
  'show_document_upload', // identity-handlers requestDocumentUpload
  'show_payment', // payment-handlers (started/resumed/retried)
  'show_quote', // quote-handlers generate path
  'show_quote_accepted', // quote-handlers accept path
  'confirm_required', // orchestrator requires_confirmation envelopes (agent-path only since T7: gui commits are confirmed by construction)
  'show_dnt_review', // questionnaire-cards buildDntReviewCard (T7: DNT completion review/sign card)
  'show_medical_review', // questionnaire-cards buildMedicalReviewCard (T11: medical completion review/sign card)
  'show_medical_batch', // questionnaire-cards medicalBatchCard (T10: the ONE bulk BD-conditions card — "none of these apply" + toggles)
  // Later tasks register here when their emitters land (comment only — the
  // parity test fails on an unregistered emission): 'show_acceptance' (T22).
]

/**
 * Renderer cases with NO live emitter — kept for the offline drivers that
 * synthesize them; they must never count as unaccounted renderer drift.
 */
export const RENDER_ONLY_UI_ACTION_TYPES: readonly string[] = [
  'show_product_cards', // e2e client-simulator + lib/simulation driver + playwright demo
  'show_product_card', // legacy single-card variant of the above (sims)
  'show_bd_result', // e2e client-simulator + lib/simulation driver (BD verdicts)
  'show_bd_rejected', // e2e client-simulator + lib/simulation driver (BD verdicts)
  'show_payment_success', // sim/e2e terminal stop signal
]

/**
 * Every type rich-content has a switch case for — maintained beside the
 * renderer; the parity test asserts this list equals the actual `case`
 * literals AND equals EMITTED ∪ RENDER_ONLY exactly.
 */
export const RENDERED_UI_ACTION_TYPES: readonly string[] = [
  'show_product_cards',
  'show_product_card',
  'show_question',
  'confirm_required',
  'show_quote',
  'show_bd_result',
  'show_bd_rejected',
  'show_quote_accepted',
  'show_data_field',
  'show_payment',
  'show_payment_success',
  'show_document_upload',
  'show_otp_entry',
  'show_dnt_review',
  'show_medical_review',
  'show_medical_batch',
]

/**
 * Every `{type}` the client can POST: rich-content onAction call sites,
 * confirm-required-card CONFIRMABLE_TOOLS round-trips, and the identity
 * cards. Each must have an adaptAction case (parity test, per-type fixture).
 */
export const CLIENT_POSTED_ACTION_TYPES: readonly string[] = [
  'select_tier',
  'answer_question',
  'medical_batch', // T10: the batch card's "none of these apply" / Continuă posts
  'accept_quote',
  'cancel_quote',
  'submit_field',
  'otp_submit',
  'otp_resend',
  'document_uploaded',
  // confirm_required card round-trips (CONFIRMABLE_TOOLS minus the two quote
  // actions already listed above)
  'sign_dnt',
  'write_question_answer',
  'modify_answer',
  'sign_medical_declarations',
  'cancel_application',
  'change_payment_option',
  'request_cancellation',
  // T30: settlement already ran server-side (/api/payments/confirm); the
  // post injects a get_payment_status read so the orchestrator narrates it
  'payment_complete',
]

/**
 * Client-posted types with NO adapter case yet — each is a known gap a named
 * task removes; the parity test locks them as non-adapting until then.
 * Empty since T30 adapted payment_complete.
 */
export const KNOWN_UNADAPTED_CLIENT_ACTIONS: readonly string[] = []
