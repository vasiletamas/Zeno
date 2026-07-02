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

// ==============================================
// DNT TOOL SCHEMAS
// ==============================================

const getDntStateSchema = z.object({}).strict()
const getDntQuestionsSchema = z.object({}).strict()
const getDntNextQuestionSchema = z.object({}).strict()

const openDntSessionSchema = z.object({}).strict()

const writeDntAnswerSchema = z.object({
  questionCode: z.string().min(1, 'Question code is required'),
  value: z.string().min(1, 'Answer value is required'),
}).strict()

const saveDntAnswerSchema = z.object({
  questionId: z.string().optional(),
  answer: z.string().min(1, 'Answer is required'),
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

const startApplicationSchema = z.object({
  productId: z.string().optional(),
}).strict()

const saveApplicationAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer is required'),
  field: z.string().optional(),
}).strict()

const resumeApplicationSchema = z.object({
  applicationId: z.string().optional(),
}).strict()

const cancelApplicationSchema = z.object({
  reason: z.string().optional(),
}).strict()

// ==============================================
// QUOTE TOOL SCHEMAS
// ==============================================

const generateQuoteSchema = z.object({
  applicationId: z.string().optional(),
}).strict()

const acceptQuoteSchema = z.object({
  quoteId: z.string().optional(),
  confirmAcceptance: z.boolean().optional(),
  confirmToken: z.string().optional(),
}).strict()

const getQuoteDetailsSchema = z.object({
  quoteId: z.string().optional(),
}).strict()

const modifyQuoteSchema = z.object({}).strict()

// ==============================================
// BD ELIGIBILITY
// ==============================================

const checkBdEligibilitySchema = z.object({
  applicationId: z.string().optional(),
}).strict()

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

  // DNT
  get_dnt_state: getDntStateSchema,
  get_dnt_questions: getDntQuestionsSchema,
  get_dnt_next_question: getDntNextQuestionSchema,
  open_dnt_session: openDntSessionSchema,
  write_dnt_answer: writeDntAnswerSchema,
  save_dnt_answer: saveDntAnswerSchema,
  sign_dnt: signDntSchema,

  // Application
  start_application: startApplicationSchema,
  save_application_answer: saveApplicationAnswerSchema,
  resume_application: resumeApplicationSchema,
  cancel_application: cancelApplicationSchema,

  // Quote
  generate_quote: generateQuoteSchema,
  accept_quote: acceptQuoteSchema,
  get_quote_details: getQuoteDetailsSchema,
  modify_quote: modifyQuoteSchema,

  // BD Eligibility
  check_bd_eligibility: checkBdEligibilitySchema,

  // Payment
  initiate_payment: z.object({}).strict(),

  // Data Collection
  collect_customer_field: collectCustomerFieldSchema,

  // Utility / Background
  escalate_to_human: escalateToHumanSchema,

  // Consent
  withdraw_consent: withdrawConsentSchema,
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
