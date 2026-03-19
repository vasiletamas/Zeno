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
}).passthrough()

const setConversationProductSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  confidence: z.number().min(0).max(100).optional(),
}).passthrough()

const getObjectionStrategySchema = z.object({
  objectionType: z.enum([
    'price_base', 'price_addon', 'price_total',
    'no_need', 'have_insurance', 'need_to_think',
    'no_trust', 'low_benefit', 'competitor',
  ]),
}).passthrough()

// ==============================================
// PROFILE TOOL SCHEMAS
// ==============================================

const getCustomerProfileSchema = z.object({}).passthrough()

const updateCustomerProfileSchema = z.object({
  age: z.number().optional(),
  occupation: z.string().optional(),
  familySize: z.number().optional(),
  hasSpouse: z.boolean().optional(),
  hasChildren: z.boolean().optional(),
  incomeLevel: z.enum(['low', 'medium', 'high']).optional(),
  motivations: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
}).passthrough()

// ==============================================
// DNT TOOL SCHEMAS
// ==============================================

const checkDntStatusSchema = z.object({
  insuranceType: InsuranceTypeSchema.optional(),
}).passthrough()

const startDntQuestionnaireSchema = z.object({
  insuranceType: InsuranceTypeSchema,
}).passthrough()

const saveDntAnswerSchema = z.object({
  questionId: z.string().optional(),
  answer: z.string().min(1, 'Answer is required'),
}).passthrough()

const signDntSchema = z.object({
  confirmSignature: z.boolean().refine((val) => val === true, {
    message: 'Signature confirmation is required',
  }),
  gdprConsent: z.boolean().refine((val) => val === true, {
    message: 'GDPR consent is required',
  }),
}).passthrough()

// ==============================================
// APPLICATION TOOL SCHEMAS
// ==============================================

const startApplicationSchema = z.object({
  productId: z.string().optional(),
}).passthrough()

const saveApplicationAnswerSchema = z.object({
  answer: z.string().min(1, 'Answer is required'),
}).passthrough()

const resumeApplicationSchema = z.object({
  applicationId: z.string().optional(),
}).passthrough()

const getApplicationStatusSchema = z.object({}).passthrough()

// ==============================================
// QUOTE TOOL SCHEMAS
// ==============================================

const generateQuoteSchema = z.object({
  applicationId: z.string().optional(),
}).passthrough()

const acceptQuoteSchema = z.object({
  quoteId: z.string().optional(),
  confirmAcceptance: z.boolean().refine((val) => val === true, {
    message: 'Confirmation is required to accept the quote',
  }),
}).passthrough()

const getQuoteDetailsSchema = z.object({
  quoteId: z.string().optional(),
}).passthrough()

// ==============================================
// BD ELIGIBILITY
// ==============================================

const checkBdEligibilitySchema = z.object({
  applicationId: z.string().optional(),
}).passthrough()

// ==============================================
// UTILITY / BACKGROUND SCHEMAS
// ==============================================

const escalateToHumanSchema = z.object({
  reason: z.enum(['complex_question', 'customer_request', 'technical_issue', 'compliance_concern']),
  summary: z.string().min(10, 'Summary must be at least 10 characters'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
}).passthrough()

const profileExtractorSchema = z.object({
  messageContent: z.string().min(1),
}).passthrough()

const summarizerSchema = z.object({
  conversationId: z.string().min(1),
  maxLength: z.number().min(50).max(2000).optional(),
}).passthrough()

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

  // Quote
  generate_quote: generateQuoteSchema,
  accept_quote: acceptQuoteSchema,
  get_quote_details: getQuoteDetailsSchema,

  // BD Eligibility
  check_bd_eligibility: checkBdEligibilitySchema,

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
