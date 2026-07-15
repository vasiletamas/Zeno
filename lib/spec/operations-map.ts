/**
 * Scenario-facing operation name -> implemented tool name (F1.2, T12 Risks §1).
 * The .feature and catalog keep speaking operation names; a tool rename is a
 * one-line change here instead of suite-wide churn.
 *
 * Reconciled against the SHIPPED tool registry (lib/tools/registry.ts) and
 * the delivered 2026-07-03 catalog, which already carries the amended
 * surface (T8.D4 single payment-recovery commit, tiered identity):
 * - get_policy_status / get_policy_documents -> get_policy_info (one read)
 * - identify_customer -> start_channel_verification (B3 flow entry point;
 *   confirm_channel_verification completes it)
 * - get_product_addon_info -> get_product_info (addon detail rides the
 *   product-info shape)
 * - resume_payment / retry_payment (retired pre-T8.D4 names) ->
 *   ensure_payment_session
 */
export const OPERATIONS_MAP = {
  get_customer_info: 'get_customer_profile', // M2
  get_customer_profile: 'get_customer_profile',
  get_open_items: 'get_open_items',
  identify_customer: 'start_channel_verification',
  withdraw_consent: 'withdraw_consent',
  escalate_to_human: 'escalate_to_human',
  list_products: 'list_products',
  get_product_info: 'get_product_info',
  get_product_addon_info: 'get_product_info',
  set_candidate_product: 'set_candidate_product',
  set_application: 'set_application',
  select_coverage: 'select_coverage',
  // DNT — contradiction #7 pinned 6-tool surface
  get_dnt_state: 'get_dnt_state',
  get_dnt_questions: 'get_dnt_questions',
  get_dnt_next_question: 'get_dnt_next_question',
  start_dnt_session: 'open_dnt_session',
  update_dnt: 'open_dnt_session',
  open_dnt_session: 'open_dnt_session',
  get_dnt_session_details: 'get_dnt_state',
  write_dnt_answer: 'write_dnt_answer',
  modify_dnt_answer: 'write_dnt_answer',
  sign_dnt: 'sign_dnt',
  // questionnaire / quote / payment / policy
  get_next_question: 'get_next_question',
  write_question_answer: 'write_question_answer',
  modify_answer: 'modify_answer',
  resume_application: 'resume_application',
  get_last_application_info: 'get_last_application_info',
  cancel_application: 'cancel_application',
  generate_quote: 'generate_quote',
  get_quote_info: 'get_quote_info',
  acknowledge_disclosures: 'acknowledge_disclosures',
  accept_quote: 'accept_quote',
  cancel_quote: 'cancel_quote',
  get_payment_status: 'get_payment_status',
  ensure_payment_session: 'ensure_payment_session',
  resume_payment: 'ensure_payment_session',
  retry_payment: 'ensure_payment_session',
  change_payment_option: 'change_payment_option',
  get_policy_status: 'get_policy_info',
  get_policy_documents: 'get_policy_info',
  request_cancellation: 'request_cancellation',
} as const
export type SpecOperation = keyof typeof OPERATIONS_MAP
export function toToolName(op: SpecOperation): string { return OPERATIONS_MAP[op] }
/** Dropped per M2 spec amendment; F3 removes their catalog rows. */
export const DROPPED_OPERATIONS = ['get_application_list', 'get_quote_list'] as const
