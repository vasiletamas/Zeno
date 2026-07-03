/**
 * Tool Validation
 *
 * Zod schemas per tool. Implemented tools use .strict(),
 * stubs use .passthrough() to allow future argument additions
 * without breaking validation.
 */

import { z, type ZodType } from 'zod'

// ==============================================
// COMMON SCHEMAS
// ==============================================

const InsuranceTypeSchema = z.enum(['LIFE', 'HEALTH', 'PROPERTY', 'AUTO', 'TRAVEL'])

// ==============================================
// PRODUCT / DISCOVERY TOOL SCHEMAS
// ==============================================

const listProductsSchema = z.object({
  insuranceType: InsuranceTypeSchema.optional(),
}).strict()

const getProductInfoSchema = z.object({
  productCode: z.string().optional(),
  productId: z.string().optional(),
}).strict()

const compareProductsSchema = z.object({
  productIds: z.array(z.string()).min(2).max(5),
}).strict()

const getObjectionStrategySchema = z.object({
  objectionType: z.enum([
    'price_base', 'price_addon', 'price_total',
    'no_need', 'have_insurance', 'need_to_think',
    'no_trust', 'low_benefit', 'competitor',
  ]),
}).strict()

// ==============================================
// PROFILE TOOL SCHEMAS
// ==============================================

const getCustomerProfileSchema = z.object({}).strict()

// B4.ADD-1: confidence is GONE (strict rejection); addonIds is the soft
// addon-interest binding.
const setCandidateProductSchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  addonIds: z.array(z.string()).optional(),
}).strict()

// ==============================================
// DNT TOOL SCHEMAS
// ==============================================

const getDntStateSchema = z.object({}).strict()
const getNextQuestionSchema = z.object({}).strict()
const getDntQuestionsSchema = z.object({}).strict()
const getDntNextQuestionSchema = z.object({}).strict()

const openDntSessionSchema = z.object({}).strict()

const writeDntAnswerSchema = z.object({
  questionCode: z.string().min(1, 'Question code is required'),
  value: z.string().min(1, 'Answer value is required'),
}).strict()

// The gateway owns two-step confirmation (A2 erratum 1): confirm-class keys
// are stripped before validation and the ceremony flag is injected server-
// side. Since B1.5 the customer's consent decision is a MATERIAL argument —
// sign_dnt is the sole consent-capturing commit (contradiction #2), so the
// consent object participates in the args hash and the confirm token binds
// to it (a changed consent is a fresh commit, not a replay).
const signDntSchema = z.object({
  consent: z.object({
    gdpr: z.boolean(),
    aiDisclosure: z.boolean(),
  }).optional(),
  confirmSignature: z.boolean().optional(),
  confirmToken: z.string().optional(),
}).strict()

// ==============================================
// APPLICATION TOOL SCHEMAS
// ==============================================

const setApplicationSchema = z.object({
  productId: z.string().optional(),
}).strict()

const writeQuestionAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer is required'),
  // C1.9: addresses the commit for replay scope; validated against the
  // engine's current question when present.
  questionCode: z.string().optional(),
  confirmToken: z.string().optional(), // BD questions are CONFIRM_ALWAYS (T6.D3)
}).strict()

const modifyAnswerSchema = z.object({
  questionCode: z.string().min(1, 'Question code is required'),
  newValue: z.string().min(1, 'New value is required'),
  confirmToken: z.string().optional(),
}).strict()

const selectCoverageSchema = z.object({
  tier: z.string().optional(),
  level: z.string().optional(),
  addon: z.boolean().optional(),
}).strict()

const resumeApplicationSchema = z.object({
  applicationId: z.string().optional(),
}).strict()

const acknowledgeSuitabilityWarningSchema = z.object({}).strict()

const cancelApplicationSchema = z.object({
  reason: z.string().optional(),
  confirmToken: z.string().optional(),
}).strict()

// ==============================================
// QUOTE TOOL SCHEMAS
// ==============================================

const generateQuoteSchema = z.object({
  applicationId: z.string().optional(),
}).strict()

// D2.5 (T7.D6/T7.D3): the elected contract frequency is THE material arg —
// no legacy confirmAcceptance flag (the gateway owns the two-step), no
// monthly (not sellable, D2 erratum 2).
const acceptQuoteSchema = z.object({
  paymentOption: z.enum(['annual', 'semi_annual', 'quarterly']),
  confirmToken: z.string().optional(),
}).strict()

const getQuoteInfoSchema = z.object({
  quoteId: z.string().optional(),
}).strict()

// D1.5: no material args — the gateway owns the two-step (confirm token),
// so there is no literal-true confirmation flag here.
const cancelQuoteSchema = z.object({
  confirmToken: z.string().optional(),
}).strict()

const acknowledgeDisclosuresSchema = z.object({}).strict()

// ==============================================
// DATA COLLECTION
// ==============================================

const collectCustomerFieldSchema = z.object({
  field: z.string().min(1, 'Field name is required'),
  value: z.string().min(1, 'Field value is required'),
}).strict()

// ==============================================
// UTILITY / BACKGROUND SCHEMAS
// ==============================================

const escalateToHumanSchema = z.object({
  reason: z.string().optional(),
  summary: z.string().optional(),
  priority: z.string().optional(),
}).strict()

// ==============================================
// IDENTITY / CHANNEL VERIFICATION (B3.5)
// ==============================================

const startChannelVerificationSchema = z.object({
  channel: z.enum(['email', 'sms']),
  target: z.string().min(3, 'Target contact is required'),
}).strict()

const confirmChannelVerificationSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'The verification code is 6 digits'),
}).strict()

const requestDocumentUploadSchema = z.object({
  kind: z.enum(['id_card']).optional(),
}).strict()

// ==============================================
// OPERATOR QUEUE (E2.4)
// ==============================================

const markSubmittedSchema = z.object({
  policyId: z.string().min(1, 'Policy id is required'),
}).strict()

const activatePolicySchema = z.object({
  policyId: z.string().min(1, 'Policy id is required'),
  allianzPolicyNumber: z.string().min(1, 'The Allianz policy number is mandatory'),
}).strict()

const cancelSubmissionSchema = z.object({
  policyId: z.string().min(1, 'Policy id is required'),
}).strict()

const resolveReferralSchema = z.object({
  workItemId: z.string().min(1, 'Work item id is required'),
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
  resolvedBy: z.string().optional(),
}).strict()

const resolveWorkItemSchema = z.object({
  workItemId: z.string().min(1, 'Work item id is required'),
  decision: z.enum(['resolve', 'dismiss']),
  note: z.string().optional(),
  resolvedBy: z.string().optional(),
}).strict()

// ==============================================
// CONSENT
// ==============================================

const withdrawConsentSchema = z.object({
  kind: z.enum(['gdpr_processing', 'ai_disclosure', 'marketing']),
  scope: z.string().optional(),
}).strict()

// ==============================================
// SCHEMA REGISTRY
// ==============================================

const toolSchemas: Record<string, ZodType> = {
  // Product / Discovery
  list_products: listProductsSchema,
  get_product_info: getProductInfoSchema,
  compare_products: compareProductsSchema,
  get_objection_strategy: getObjectionStrategySchema,

  // Profile
  get_customer_profile: getCustomerProfileSchema,

  // Candidate (B4.ADD-1)
  set_candidate_product: setCandidateProductSchema,

  // DNT
  get_dnt_state: getDntStateSchema,
  get_dnt_questions: getDntQuestionsSchema,
  get_dnt_next_question: getDntNextQuestionSchema,
  open_dnt_session: openDntSessionSchema,
  write_dnt_answer: writeDntAnswerSchema,
  sign_dnt: signDntSchema,

  // Application (B4 lifecycle)
  set_application: setApplicationSchema,
  get_next_question: getNextQuestionSchema,
  write_question_answer: writeQuestionAnswerSchema,
  modify_answer: modifyAnswerSchema,
  select_coverage: selectCoverageSchema,
  resume_application: resumeApplicationSchema,
  cancel_application: cancelApplicationSchema,
  acknowledge_suitability_warning: acknowledgeSuitabilityWarningSchema,
  get_last_application_info: z.object({}).strict(),

  // Quote
  generate_quote: generateQuoteSchema,
  accept_quote: acceptQuoteSchema,
  get_quote_info: getQuoteInfoSchema,
  cancel_quote: cancelQuoteSchema,
  acknowledge_disclosures: acknowledgeDisclosuresSchema,

  // BD Eligibility

  // Payment
  ensure_payment_session: z.object({}).strict(),
  change_payment_option: z.object({ paymentOption: z.enum(['annual', 'semi_annual', 'quarterly']), confirmToken: z.string().optional() }).strict(),
  get_payment_status: z.object({}).strict(),

  // Data Collection
  collect_customer_field: collectCustomerFieldSchema,

  // Utility / Background
  escalate_to_human: escalateToHumanSchema,

  // Consent
  withdraw_consent: withdrawConsentSchema,

  // Identity / channel verification
  start_channel_verification: startChannelVerificationSchema,
  confirm_channel_verification: confirmChannelVerificationSchema,
  request_document_upload: requestDocumentUploadSchema,

  // Operator queue
  resolve_referral: resolveReferralSchema,
  mark_submitted: markSubmittedSchema,
  activate_policy: activatePolicySchema,
  cancel_submission: cancelSubmissionSchema,
  resolve_work_item: resolveWorkItemSchema,
}

// ==============================================
// VALIDATION API
// ==============================================

export interface ValidationResult {
  valid: boolean
  data?: Record<string, unknown>
  errors?: string[]
}

/**
 * Validate tool arguments against the registered Zod schema.
 * Returns parsed data on success, structured errors on failure.
 */
export function validateToolArgs(
  name: string,
  args: unknown,
): ValidationResult {
  const schema = toolSchemas[name]

  if (!schema) {
    // No schema defined — allow through for forward compatibility
    return { valid: true, data: (args ?? {}) as Record<string, unknown> }
  }

  const result = schema.safeParse(args)

  if (result.success) {
    return { valid: true, data: result.data as Record<string, unknown> }
  }

  const errors = result.error.issues.map(
    (e: { path: PropertyKey[]; message: string }) =>
      `${e.path.join('.')}: ${e.message}`,
  )

  return { valid: false, errors }
}
