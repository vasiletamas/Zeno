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

const setConversationProductSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  confidence: z.number().min(0).max(100).optional(),
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

const updateCustomerProfileSchema = z.record(z.string(), z.unknown())

// ==============================================
// DNT TOOL SCHEMAS
// ==============================================

const checkDntStatusSchema = z.object({
  insuranceType: InsuranceTypeSchema.optional(),
}).strict()

const startDntQuestionnaireSchema = z.object({
  insuranceType: InsuranceTypeSchema,
}).strict()

const saveDntAnswerSchema = z.object({
  questionId: z.string().optional(),
  answer: z.string().min(1, 'Answer is required'),
}).strict()

const signDntSchema = z.object({
  confirmSignature: z.literal(true, {
    message: 'Signature confirmation is required',
  }),
  gdprConsent: z.literal(true, {
    message: 'GDPR consent is required',
  }),
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

const getApplicationStatusSchema = z.object({}).strict()

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
  confirmAcceptance: z.literal(true, {
    message: 'Confirmation is required to accept the quote',
  }),
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

const profileExtractorSchema = z.object({
  messageContent: z.string().min(1),
}).strict()

const summarizerSchema = z.object({
  conversationId: z.string().min(1),
  maxLength: z.number().min(50).max(2000).optional(),
}).strict()

// ==============================================
// SCHEMA REGISTRY
// ==============================================

const toolSchemas: Record<string, ZodType> = {
  // Product / Discovery
  list_products: listProductsSchema,
  get_product_info: getProductInfoSchema,
  compare_products: compareProductsSchema,
  set_conversation_product: setConversationProductSchema,
  get_objection_strategy: getObjectionStrategySchema,

  // Profile
  get_customer_profile: getCustomerProfileSchema,
  update_customer_profile: updateCustomerProfileSchema,

  // DNT
  check_dnt_status: checkDntStatusSchema,
  start_dnt_questionnaire: startDntQuestionnaireSchema,
  save_dnt_answer: saveDntAnswerSchema,
  sign_dnt: signDntSchema,

  // Application
  start_application: startApplicationSchema,
  save_application_answer: saveApplicationAnswerSchema,
  resume_application: resumeApplicationSchema,
  get_application_status: getApplicationStatusSchema,
  cancel_application: cancelApplicationSchema,

  // Quote
  generate_quote: generateQuoteSchema,
  accept_quote: acceptQuoteSchema,
  get_quote_details: getQuoteDetailsSchema,
  modify_quote: modifyQuoteSchema,

  // BD Eligibility
  check_bd_eligibility: checkBdEligibilitySchema,

  // Data Collection
  collect_customer_field: collectCustomerFieldSchema,

  // Utility / Background
  escalate_to_human: escalateToHumanSchema,
  profile_extractor: profileExtractorSchema,
  summarizer: summarizerSchema,
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
