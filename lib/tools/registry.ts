/**
 * Tool Registry
 *
 * Central registry of all tool definitions, handlers, and execution
 * classification. Tools are registered with their metadata (from the
 * brand-book spec) and handlers. The registry converts tool definitions
 * to LLM format on demand.
 */

import type { LLMToolDefinition } from '@/lib/llm/providers/types'
import type { ToolDefinition, ToolHandler, ToolContext, ToolResult } from './types'
import { prisma } from '@/lib/db'
import { LRUCache } from '@/lib/cache/lru-cache'
import { resolveProductRef, listAvailableProductRefs } from './resolve-product'
import { shapeProductInfo, type RawProduct } from './shape-product-info'
import { calculateAge } from '@/lib/chat/age'

// --- Handler imports ---
import { getDntState, getDntQuestions, getDntNextQuestion, openDntSession, writeDntAnswer, signDnt } from './handlers/dnt-handlers'
import { startApplication, saveApplicationAnswer, resumeApplication, cancelApplication } from './handlers/application-handlers'
import { changeSelection } from './handlers/change-selection-handlers'
import { setAnswer } from './handlers/set-answer-handlers'
import { generateQuote, getQuoteDetails, acceptQuote, modifyQuote } from './handlers/quote-handlers'
import { compareProducts } from './handlers/product-handlers'
import { previewProductRequirements } from './handlers/preview-handlers'
import { getStateHandler } from './handlers/state-handlers'
import { setCandidateProduct } from './handlers/candidate-handlers'
import { switchProduct } from './handlers/product-switch-handler'
import { getCustomerProfile } from './handlers/profile-handlers'
import { withdrawConsent } from './handlers/consent-handlers'
import { getObjectionStrategy } from './handlers/objection-handlers'
import { checkBdEligibility } from './handlers/bd-handlers'
import { collectCustomerField } from './handlers/data-handlers'
import { escalateToHuman } from './handlers/utility-handlers'
import { initiatePayment } from './handlers/payment-handlers'
import { resolveReferral, resolveWorkItem } from './handlers/operator-handlers'
import { startChannelVerification, confirmChannelVerification } from './handlers/identity-handlers'

// ==============================================
// INTERNAL STORAGE
// ==============================================

const definitions = new Map<string, ToolDefinition>()
const handlers = new Map<string, ToolHandler>()

// ==============================================
// REGISTRATION API
// ==============================================

export function registerTool(
  name: string,
  definition: Omit<ToolDefinition, 'name'>,
  handler: ToolHandler,
): void {
  definitions.set(name, { name, ...definition })
  handlers.set(name, handler)
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return definitions.get(name)
}

export function getToolHandler(name: string): ToolHandler | undefined {
  return handlers.get(name)
}

export function getAllToolNames(): string[] {
  return Array.from(definitions.keys())
}

export function getRegisteredToolNames(): string[] {
  return Array.from(definitions.keys()).sort()
}

const toolsCache = new LRUCache<string, LLMToolDefinition[]>(5, 5 * 60 * 1000) // 5 min TTL

/**
 * Convert registered tools to LLM function-calling format.
 * Optionally filter to a subset of tool names.
 */
export function getToolsForLLM(allowedTools?: string[]): LLMToolDefinition[] {
  const cacheKey = allowedTools ? allowedTools.sort().join(',') : '__all__'
  const cached = toolsCache.get(cacheKey)
  if (cached) return cached

  const result: LLMToolDefinition[] = []
  for (const [name, def] of definitions) {
    if (allowedTools && !allowedTools.includes(name)) continue
    result.push({
      type: 'function',
      function: {
        name,
        description: def.description,
        parameters: def.parameters,
      },
    })
  }

  // Deterministic sort for stable serialization (prompt cache optimization)
  result.sort((a, b) => a.function.name.localeCompare(b.function.name))

  toolsCache.set(cacheKey, result)
  return result
}

// ==============================================
// STATUS MESSAGE POOLS (verbatim from brand book S16)
// ==============================================

const STATUS_GENERATE_QUOTE = {
  ro: [
    'Calculez... numerele sunt prietenele mele',
    'Negociez cu matematica \u00een favoarea ta',
    'Caut cea mai bun\u0103 variant\u0103 pentru tine',
    'Un moment, verific toate combina\u021biile',
    'Consult tabelele Allianz... ele nu se gr\u0103besc',
  ],
  en: [
    'Crunching the numbers for you',
    'Negotiating with math on your behalf',
    'Finding the best option for your situation',
    'One moment, checking all combinations',
    'Consulting the Allianz tables... they take their time',
  ],
}

const STATUS_SIGN_DNT = {
  ro: [
    'Se semneaz\u0103 documentul... partea oficial\u0103',
    'Pun \u0219tampila digital\u0103, ca la carte',
    'Preg\u0103tesc actele... promit c\u0103 e ultima birocra\u021bie',
    'Se finalizeaz\u0103 documenta\u021bia. Aproape gata.',
  ],
  en: [
    'Signing the document... the official part',
    'Applying the digital stamp, by the book',
    'Preparing the paperwork... last bit of bureaucracy, I promise',
    'Finalizing the documentation. Almost done.',
  ],
}

const STATUS_ACCEPT_QUOTE = {
  ro: [
    'Se activeaz\u0103 protec\u021bia ta... momentul cel mare',
    'Conectez totul la Allianz. \u00cenc\u0103 o secund\u0103.',
    'Preg\u0103tesc poli\u021ba ta. Merit\u0103 s\u0103rb\u0103torit.',
    'Ultimii pa\u0219i... familia ta va fi protejat\u0103',
  ],
  en: [
    'Activating your protection... the big moment',
    'Connecting everything to Allianz. One more second.',
    'Preparing your policy. Worth celebrating.',
    'Final steps... your family will be protected',
  ],
}

const STATUS_CHECK_BD_ELIGIBILITY = {
  ro: [
    'Analizez r\u0103spunsurile tale',
    'Verific eligibilitatea...',
  ],
  en: [
    'Analyzing your answers',
    'Checking eligibility...',
  ],
}

const STATUS_OBJECTION_STRATEGY = {
  ro: [
    'Zeno se g\u00e2nde\u0219te...',
    'Hmm, un moment...',
    'Bun\u0103 \u00eentrebare. Stai pu\u021bin.',
  ],
  en: [
    'Zeno is thinking...',
    'Hmm, one moment...',
    'Good question. Bear with me.',
  ],
}

const STATUS_INITIATE_PAYMENT = {
  ro: [
    'Pregătesc plata... un moment',
    'Conectez sistemul de plată',
  ],
  en: [
    'Preparing payment... one moment',
    'Connecting payment system',
  ],
}

const STATUS_PRODUCT_LOOKUP = {
  ro: [
    'Verific detaliile... s\u0103 fiu precis',
    'Consult catalogul Allianz',
    'Un moment, nu vreau s\u0103-\u021bi dau informa\u021bii gre\u0219ite',
  ],
  en: [
    'Checking the details... want to be precise',
    'Consulting the Allianz catalog',
    'One moment, don\'t want to give you wrong info',
  ],
}

const STATUS_GET_PRODUCT_INFO = {
  ro: [
    'Verific detaliile produsului... un moment',
    'Caut datele exacte ale produsului',
    'Citesc fi\u0219a produsului pentru tine',
  ],
  en: [
    'Looking up product details... one moment',
    'Reading the product datasheet',
    'Pulling the exact product info',
  ],
}

const STATUS_SET_CANDIDATE_PRODUCT = {
  ro: [
    'Confirm produsul selectat',
    'Salvez alegerea ta',
    '\u00cenregistrez produsul ales',
  ],
  en: [
    'Confirming the selected product',
    'Saving your choice',
    'Recording the selected product',
  ],
}

const STATUS_SWITCH_PRODUCT = {
  ro: ['Schimb produsul selectat', 'Trec la noul produs', 'Re\u00eencarc op\u021biunile pentru noul produs'],
  en: ['Switching to a new product', 'Loading new product options', 'Updating your selection'],
}

// ==============================================
// REAL HANDLERS (list_products, get_product_info kept from A2)
// ==============================================

/**
 * list_products — query products from DB, optionally filtered by insuranceType.
 */
const listProductsHandler: ToolHandler = async (
  args: Record<string, unknown>,
  _context: ToolContext,
): Promise<ToolResult> => {
  try {
    const where: Record<string, unknown> = { isActive: true }
    if (args.insuranceType && typeof args.insuranceType === 'string') {
      where.insuranceType = args.insuranceType
    }

    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        insuranceType: true,
        subType: true,
        targetCustomer: true,
        premiumRange: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    return {
      success: true,
      data: { products: products as unknown as Record<string, unknown>[], count: products.length },
      message: products.length > 0
        ? `Found ${products.length} product(s).`
        : 'No products found matching the criteria.',
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to list products: ${message}` }
  }
}

/**
 * get_product_info — fetch a single product by code or id.
 */
const getProductInfoHandler: ToolHandler = async (
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> => {
  try {
    const productCode = args.productCode as string | undefined
    const productId = args.productId as string | undefined

    if (!productCode && !productId) {
      return { success: false, error: 'Either productCode or productId is required.' }
    }

    const ref = await resolveProductRef({ productCode, productId })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Product not found: "${productCode ?? productId}". ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    const product = await prisma.product.findUnique({
      where: { id: ref.id },
      include: {
        pricingTiers: {
          where: { isActive: true },
          include: {
            levels: {
              where: { isActive: true },
              include: { coverageAmounts: { include: { coverageType: true } } },
              orderBy: { orderIndex: 'asc' as const },
            },
          },
          orderBy: { orderIndex: 'asc' as const },
        },
        addons: {
          where: { isActive: true },
          include: {
            pricingRules: true,
            coverageAmounts: { include: { coverageType: true } },
          },
        },
      },
    })

    if (!product) {
      return { success: false, error: `Product not found after resolve: ${ref.id}` }
    }

    // Resolve the customer's age (best-effort) to trim age-banded coverages.
    // Any failure here just means we return all age bands. Reads the
    // dateOfBirth mirror column, which the B0 profile-service maintains.
    let age: number | undefined
    try {
      const customer = await prisma.customer.findUnique({
        where: { id: context.customerId },
        select: { dateOfBirth: true },
      })
      if (customer?.dateOfBirth) {
        age = calculateAge(customer.dateOfBirth, new Date()) ?? undefined
      }
    } catch {
      // age is optional — fall back to all bands
    }

    return {
      success: true,
      data: { product: shapeProductInfo(product as unknown as RawProduct, { age }) as unknown as Record<string, unknown> },
      message: `Product details for ${product.code}.`,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: `Failed to get product info: ${message}` }
  }
}

// ==============================================
// DEFAULT ROLES
// ==============================================

const ALL_ROLES: ToolDefinition['allowedRoles'] = ['CUSTOMER', 'OPERATOR', 'ADMIN']
const ADMIN_OPERATOR: ToolDefinition['allowedRoles'] = ['OPERATOR', 'ADMIN']

// ==============================================
// TOOL REGISTRATIONS — exposure is owned by lib/engines/derive-and-expose.ts
// ==============================================

// --- Product / Discovery ---

registerTool('list_products', {
  description: 'List available insurance products, optionally filtered by insurance type.',
  parameters: {
    type: 'object',
    properties: {
      insuranceType: {
        type: 'string',
        description: 'Filter by insurance type (e.g. LIFE, HEALTH).',
      },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_PRODUCT_LOOKUP,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 300_000,
  kind: 'read',
}, listProductsHandler)

registerTool('get_product_info', {
  description: 'Get detailed information about a specific insurance product by code or id.',
  parameters: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description:
          "Preferred identifier. Use the exact 'id' value returned by list_products " +
          "(a cuid like 'cmozcrkyz0007bs0ynxjnvclz'). Always prefer productId over productCode " +
          "when you have it.",
      },
      productCode: {
        type: 'string',
        description:
          "Fallback identifier. The exact 'code' value from list_products " +
          "(lowercase slug, e.g. 'protect'). This is NOT the display name — " +
          "do not pass values like 'Protect' or 'Allianz Protect'.",
      },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_GET_PRODUCT_INFO,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  // Not cacheable: output is shaped per customer age, and the tool cache keys
  // on args only (no customer context) — caching would leak one customer's
  // age-trimmed result to another. The lookup + pure shaping is cheap.
  cacheable: false,
  kind: 'read',
}, getProductInfoHandler)

registerTool('compare_products', {
  description: 'Compare two or more insurance products side by side.',
  parameters: {
    type: 'object',
    properties: {
      productIds: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Array of 2-5 product IDs (cuid values from list_products), not display names.",
      },
    },
    required: ['productIds'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_PRODUCT_LOOKUP,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 300_000,
  kind: 'read',
}, compareProducts)

registerTool('preview_product_requirements', {
  description:
    'Preview which questions would carry over (already answered) vs remain missing ' +
    'if the customer switches to a candidate product. Read-only, no writes.',
  parameters: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'The candidate product ID (cuid from list_products) to preview requirements for.' },
    },
    required: ['productId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: false,
  kind: 'read',
}, previewProductRequirements)

registerTool('get_current_state', {
  description: 'Get the current conversation state (phase, product, selection, consents, application, quote, answers, next action).',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: false,
  kind: 'read',
}, getStateHandler)

registerTool('set_candidate_product', {
  description:
    "Set or update the candidate product the conversation is currently focused on. " +
    "Use when the customer's intent is clear enough that you can confidently say 'we are talking about X.' " +
    "Re-call to raise/lower confidence or to change the candidate if the customer pivots. " +
    "The candidate is a SOFT binding for the presentation phase; it does NOT start an application.",
  parameters: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description:
          "Product ID to set as the candidate (cuid from list_products, NOT the display name or code).",
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Your confidence (0-100) that the customer is converging on this product.',
      },
    },
    required: ['productId', 'confidence'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_SET_CANDIDATE_PRODUCT,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, setCandidateProduct)

registerTool('switch_product', {
  description:
    'Switch to a different insurance product within the same conversation. ' +
    'Resets any prior tier/level/addon selections (invalid for the new product), ' +
    'expires any DRAFT quote, and recomputes required questions. Shared answers carry over automatically.',
  parameters: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'Product ID to switch to (cuid from list_products, NOT the display name or code).' },
    },
    required: ['productId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_SWITCH_PRODUCT,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, switchProduct)

registerTool('get_objection_strategy', {
  description: 'Get a strategy for handling a specific customer objection type.',
  parameters: {
    type: 'object',
    properties: {
      objectionType: {
        type: 'string',
        enum: [
          'price_base', 'price_addon', 'price_total',
          'no_need', 'have_insurance', 'need_to_think',
          'no_trust', 'low_benefit', 'competitor',
        ],
        description: 'Type of objection to handle.',
      },
    },
    required: ['objectionType'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_OBJECTION_STRATEGY,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  cacheable: true,
  cacheTtlMs: 600_000,
  kind: 'read',
}, getObjectionStrategy)

// --- Profile ---

registerTool('get_customer_profile', {
  description: 'Retrieve the customer profile including extracted information.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  kind: 'read',
}, getCustomerProfile)

// --- DNT (Declaration of Needs and Testing) ---

registerTool('get_dnt_state', {
  description: 'Report the customer\'s DNT state: validity, coverage, expiry, and the active questionnaire session summary if one exists.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  kind: 'read',
}, getDntState)

registerTool('get_dnt_questions', {
  description: 'Preview the DNT questionnaire: the default-visible questions for the product in focus (no session required).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  kind: 'read',
}, getDntQuestions)

registerTool('get_dnt_next_question', {
  description: 'Get the next unanswered question of the customer\'s ACTIVE DNT session, with progress.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false,
  kind: 'read',
}, getDntNextQuestion)

registerTool('open_dnt_session', {
  description: 'Open a DNT questionnaire session for the product in focus. The engine decides NEW vs UPDATE from the customer\'s DNT history; UPDATE pre-fills prior answers for review.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, openDntSession)

registerTool('write_dnt_answer', {
  description: 'Write or change one answer of the ACTIVE DNT session by question code. Changing an answer never cascades.',
  parameters: {
    type: 'object',
    properties: {
      questionCode: { type: 'string', description: 'The DNT question code (e.g. DNT_OCCUPATION).' },
      value: { type: 'string', description: 'The answer value.' },
    },
    required: ['questionCode', 'value'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, writeDntAnswer)

registerTool('sign_dnt', {
  description: 'Sign the completed DNT document. Signing is the consent-capturing step: pass the customer\'s explicit GDPR-processing consent and AI-disclosure acknowledgment.',
  parameters: {
    type: 'object',
    properties: {
      consent: {
        type: 'object',
        properties: {
          gdpr: { type: 'boolean', description: 'Customer explicitly consents to GDPR data processing.' },
          aiDisclosure: { type: 'boolean', description: 'Customer acknowledges the AI-assistance disclosure.' },
        },
        required: ['gdpr', 'aiDisclosure'],
        additionalProperties: false,
      },
    },
    required: ['consent'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_SIGN_DNT,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, signDnt)

// --- Application ---

registerTool('start_application', {
  description: 'Start a new insurance application for the selected product.',
  parameters: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'Product ID to apply for.' },
      tierCode: { type: 'string', description: 'Optional. Pricing tier code (e.g. "standard", "optim") the customer already chose conversationally. Resolves to Application.tierId and records the PACKAGE_CHOICE answer so it is not re-asked.' },
      levelCode: { type: 'string', description: 'Optional. Pricing level code (e.g. "level_2") within the tier. Requires tierCode. Resolves to Application.levelId and records the PREMIUM_LEVEL answer.' },
      includesAddon: { type: 'boolean', description: 'Optional. Whether the customer chose the add-on. Sets Application.includesAddon and records the BD_ADDON_INTEREST answer.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, startApplication)

registerTool('save_application_answer', {
  description: 'Save an answer to the current application question.',
  parameters: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The customer\'s answer.' },
      field: { type: 'string', description: 'Optional: specific field code to set (e.g. PACKAGE_CHOICE, PREMIUM_LEVEL).' },
    },
    required: ['answer'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, saveApplicationAnswer)

registerTool('set_answer', {
  description:
    'Answer any question by its code, within the active DNT or application groups. ' +
    'Supports editing previously answered questions. ' +
    'Special codes PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST also update Application tier/level/addon.',
  parameters: {
    type: 'object',
    properties: {
      questionCode: { type: 'string', description: 'The question code to answer (e.g. "HAS_DEPENDENTS", "PACKAGE_CHOICE", "PREMIUM_LEVEL", "BD_ADDON_INTEREST").' },
      value: { type: 'string', description: 'The answer value (will be normalized based on question type).' },
    },
    required: ['questionCode', 'value'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, setAnswer)

registerTool('resume_application', {
  description: 'Resume a previously paused application.',
  parameters: {
    type: 'object',
    properties: {
      applicationId: { type: 'string', description: 'Application ID to resume.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, resumeApplication)

registerTool('cancel_application', {
  description: 'Cancel the current application.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Reason for cancellation.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, cancelApplication)

registerTool('change_selection', {
  description: 'Change the insurance package tier, premium level, or add-on selection on an existing application (same product). Automatically expires any active quote so a new one can be generated with the updated selection.',
  parameters: {
    type: 'object',
    properties: {
      tier: { type: 'string', description: 'Pricing tier code to switch to (e.g. "standard", "optim"). Omit to keep the current tier.' },
      level: { type: 'string', description: 'Premium level code to switch to (e.g. "level_1", "level_2"). Omit to keep the current level.' },
      addon: { type: 'boolean', description: 'true to include the add-on, false to remove it, omit to keep current.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: {
    ro: ['Actualizez selecția ta...', 'Salvez noile alegeri', 'Modific pachetul'],
    en: ['Updating your selection...', 'Saving your new choices', 'Modifying your package'],
  },
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, changeSelection)

// --- Quote ---

registerTool('generate_quote', {
  description: 'Generate an insurance quote based on the completed application.',
  parameters: {
    type: 'object',
    properties: {
      applicationId: { type: 'string', description: 'Application ID to generate a quote for.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_GENERATE_QUOTE,
  allowedRoles: ALL_ROLES,
  sideEffect: 'quote',
  kind: 'commit',
}, generateQuote)

registerTool('accept_quote', {
  description: 'Accept the quote and proceed to policy issuance.',
  parameters: {
    type: 'object',
    properties: {
      quoteId: { type: 'string', description: 'Quote ID to accept.' },
      confirmAcceptance: { type: 'boolean', description: 'Customer confirms acceptance.' },
    },
    required: ['confirmAcceptance'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_ACCEPT_QUOTE,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, acceptQuote)

registerTool('get_quote_details', {
  description: 'Get detailed breakdown of a generated quote.',
  parameters: {
    type: 'object',
    properties: {
      quoteId: { type: 'string', description: 'Quote ID to retrieve.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'read',
}, getQuoteDetails)

registerTool('modify_quote', {
  description: 'Expire the current quote and reopen the application for package re-selection.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, modifyQuote)

// --- BD Eligibility ---

registerTool('check_bd_eligibility', {
  description: 'Check medical questionnaire eligibility for BD (Boli Diverse) products.',
  parameters: {
    type: 'object',
    properties: {
      applicationId: { type: 'string', description: 'Application ID to check eligibility for.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_CHECK_BD_ELIGIBILITY,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, checkBdEligibility)

// --- Payment ---

registerTool('initiate_payment', {
  description: 'Initiate a payment for the current policy. Creates a payment intent and shows the inline payment UI.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_INITIATE_PAYMENT,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, initiatePayment)

// --- Data Collection ---

registerTool('collect_customer_field', {
  description: 'Validate and save a single customer data field (name, cnp, email, phone, dateOfBirth). Returns the next field to collect or success when all are done.',
  parameters: {
    type: 'object',
    properties: {
      field: { type: 'string', description: 'Field to save: name, cnp, dateOfBirth, email, phone, address.' },
      value: { type: 'string', description: 'The value for the field.' },
    },
    required: ['field', 'value'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, collectCustomerField)

// --- Utility / Background ---

registerTool('escalate_to_human', {
  description: 'Escalate the conversation to a human agent.',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['complex_question', 'customer_request', 'technical_issue', 'compliance_concern'],
        description: 'Reason for escalation.',
      },
      summary: { type: 'string', description: 'Brief summary of the issue.' },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
        description: 'Priority level.',
      },
    },
    required: ['reason', 'summary'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, escalateToHuman)

// --- Identity / channel verification (B3.5) ---

registerTool('start_channel_verification', {
  description:
    'Send the customer a 6-digit verification code (plus a one-click link) to the email address or phone number THEY provided. ' +
    'Verifying a channel raises the identity tier (needed before accepting a quote). ' +
    'Never reveals whether the address belongs to an existing account. Re-calling resends a fresh code.',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: ['email', 'sms'], description: 'Which channel to verify.' },
      target: { type: 'string', description: 'The email address or Romanian phone number the customer gave, exactly as provided.' },
    },
    required: ['channel', 'target'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, startChannelVerification)

registerTool('confirm_channel_verification', {
  description:
    'Confirm the pending channel verification with the 6-digit code the customer read back from their email/SMS. ' +
    'Only call it AFTER the customer told you the code — never guess or invent one. ' +
    'If the contact already belongs to an existing account, verifying proves ownership and the conversation continues on that account.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The 6-digit code exactly as the customer gave it.' },
    },
    required: ['code'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, confirmChannelVerification)

// --- Operator queue (E2.4) ---
// Never agent-exposed: no ACTION_RULES entry; the gateway's OPERATOR_TOOLS
// actor gate (operator|system only) replaces exposure-based legality.

registerTool('resolve_referral', {
  description:
    'Resolve an underwriting REFERRAL work item: approve restores the application and resumes quote generation; reject terminates the application and notifies the customer.',
  parameters: {
    type: 'object',
    properties: {
      workItemId: { type: 'string', description: 'The REFERRAL work item to resolve.' },
      decision: { type: 'string', enum: ['approve', 'reject'], description: 'The underwriting decision.' },
      note: { type: 'string', description: 'Underwriter note; on reject it is recorded as the underwriter reason on the application.' },
      resolvedBy: { type: 'string', description: 'Identity of the resolving operator (defaults to the actor).' },
    },
    required: ['workItemId', 'decision'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ADMIN_OPERATOR,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, resolveReferral)

registerTool('resolve_work_item', {
  description: 'Resolve or dismiss a generic work item (escalation, alert flag).',
  parameters: {
    type: 'object',
    properties: {
      workItemId: { type: 'string', description: 'The work item to close.' },
      decision: { type: 'string', enum: ['resolve', 'dismiss'], description: 'resolve = handled; dismiss = no action needed.' },
      note: { type: 'string', description: 'Optional resolution note.' },
      resolvedBy: { type: 'string', description: 'Identity of the resolving operator (defaults to the actor).' },
    },
    required: ['workItemId', 'decision'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ADMIN_OPERATOR,
  kind: 'commit',
}, resolveWorkItem)

registerTool('withdraw_consent', {
  description: 'Withdraw a previously granted consent (gdpr_processing, ai_disclosure, or marketing). Data is preserved; processing stops.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['gdpr_processing', 'ai_disclosure', 'marketing'],
        description: 'Which consent to withdraw.',
      },
      scope: { type: 'string', description: 'Optional scope note.' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'consent',
  kind: 'commit',
}, withdrawConsent)

