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
import { shapeProductInfo, type RawProduct, type DerivedProductInputs } from './shape-product-info'
import { getAge } from '@/lib/customer/profile-service'
import { derivePricingExamples, pricingTreeNeedsFx, type PricingExampleGrid, type PricingTree } from '@/lib/engines/pricing-examples'
import { getFxProvider } from '@/lib/engines/fx'
import { deriveEligibilityBounds, parseEligibilityRuleSet, type EligibilityBounds } from '@/lib/engines/eligibility'
import { getPublishedProductContent, type PublishedProductContent, type PublishedFieldSet } from '@/lib/products/product-content'
import type { LocalizedContent } from './shape-product-info'

// --- Handler imports ---
import { getDntState, getDntQuestions, getDntNextQuestion, openDntSession, writeDntAnswer, signDnt } from './handlers/dnt-handlers'
import { setApplication, getNextQuestionInfo, writeQuestionAnswer, modifyAnswer, resumeApplication, cancelApplication, getLastApplicationInfo, signMedicalDeclarations } from './handlers/application-handlers'
import { selectCoverage } from './handlers/select-coverage-handlers'
import { writeMedicalBatch } from './handlers/medical-batch-handlers'
import { acknowledgeSuitabilityWarning } from './handlers/suitability-handlers'
import { generateQuote, getQuoteInfo, getAcceptanceBundle, acceptQuote, cancelQuote, acknowledgeDisclosures } from './handlers/quote-handlers'
import { compareProducts } from './handlers/product-handlers'
import { previewProductRequirements } from './handlers/preview-handlers'
import { getStateHandler } from './handlers/state-handlers'
import { setCandidateProduct } from './handlers/candidate-handlers'
import { setPurchaseIntent } from './handlers/intent-handlers'
import { getCustomerProfile } from './handlers/profile-handlers'
import { withdrawConsent } from './handlers/consent-handlers'
import { getObjectionStrategy } from './handlers/objection-handlers'
import { collectCustomerField } from './handlers/data-handlers'
import { escalateToHuman } from './handlers/utility-handlers'
import { ensurePaymentSession, getPaymentStatus, changePaymentOption } from './handlers/payment-handlers'
import { resolveReferral, resolveWorkItem } from './handlers/operator-handlers'
import { markSubmitted, activatePolicy, cancelSubmission } from './handlers/policy-operator-handlers'
import { getPolicyInfo, requestCancellation } from './handlers/policy-handlers'
import { requestErasure, requestDataExport, approveErasure, approveExport } from './handlers/gdpr-handlers'
import { getOpenItems } from './handlers/open-items-handlers'
import { startChannelVerification, confirmChannelVerification, requestDocumentUpload } from './handlers/identity-handlers'
import { availableVerificationChannels, type VerificationChannel } from '@/lib/channels/availability'

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

/** Registered commit tools — the key space of the #1 identity table (ADD-1). */
export function listCommitTools(): string[] {
  return getRegisteredToolNames().filter((n) => definitions.get(n)?.kind === 'commit')
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

// ── E1.7 (erratum 5): concrete derived-input mappers ─────────────────

/** The prisma include tree → the pure PricingTree derivePricingExamples eats.
 * T18: currency rides along so a mixed-denomination rate card converts. */
function buildPricingTree(product: {
  quoteValidityDays: number
  pricingTiers: { code: string; name: unknown; levels: { code: string; name: unknown; premiumAnnual: number; currency: string }[] }[]
  addons: { pricingRules: { minAge: number; maxAge: number; premiumAnnual: number; currency: string }[] }[]
}): PricingTree {
  return {
    quoteValidityDays: product.quoteValidityDays,
    tiers: product.pricingTiers.map((t) => ({
      code: t.code,
      name: t.name as { en: string; ro: string },
      levels: t.levels.map((l) => ({ code: l.code, name: l.name as { en: string; ro: string }, premiumAnnual: l.premiumAnnual, currency: l.currency })),
    })),
    addonRules: (product.addons[0]?.pricingRules ?? []).map((r) => ({ minAge: r.minAge, maxAge: r.maxAge, premiumAnnual: r.premiumAnnual, currency: r.currency })),
  }
}

function fieldSetToLocalized(set: PublishedFieldSet | undefined): LocalizedContent | null {
  if (!set) return null
  return { ro: set.ro, en: set.en }
}

/** Product-level published fields → the shaper's content slice. */
function mapPublished(published: PublishedProductContent): DerivedProductInputs['content'] {
  return {
    keyValueProductPoints: fieldSetToLocalized(published.fields.KEY_VALUE_PRODUCT_POINTS),
    sellSpecificInfo: fieldSetToLocalized(published.fields.SELL_SPECIFIC_INFO),
    pricingNote: fieldSetToLocalized(published.fields.PRICING_NOTE),
    contentVersions: collectVersionIds(published),
  }
}

/** Addon-scoped published fields re-keyed by addon CODE for the shaper. */
function mapAddonPublished(
  published: PublishedProductContent,
  addons: { id: string; code: string }[],
): DerivedProductInputs['addonContent'] {
  const out: DerivedProductInputs['addonContent'] = {}
  for (const addon of addons) {
    const fields = published.addonFields[addon.id]
    if (!fields) continue
    out[addon.code] = { sellSpecificAddonInfo: fieldSetToLocalized(fields.SELL_SPECIFIC_ADDON_INFO) }
  }
  return out
}

/** Every published contentId across product AND addon field sets (M8 stamps). */
function collectVersionIds(published: PublishedProductContent): string[] {
  const ids: string[] = []
  for (const set of Object.values(published.fields)) ids.push(...set.contentIds)
  for (const addonFields of Object.values(published.addonFields)) {
    for (const set of Object.values(addonFields)) ids.push(...set.contentIds)
  }
  return ids
}

/**
 * get_product_info — fetch a single product by code or id.
 *
 * E1.7: the payload's numbers are ENGINE-DERIVED (pricing_examples via
 * calculateQuote over Product.pricingExampleGrid; eligibility_bounds from
 * the typed rules) and its claims are PUBLISHED ProductContent only.
 * contentVersions ride the data envelope for M8 turn-stamping.
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

    // B0: the ONE derived-age source (DOB else declaredAge — never a guess);
    // failure just means all age bands are returned.
    let age: number | undefined
    try {
      age = (await getAge(context.customerId)) ?? undefined
    } catch {
      // age is optional — fall back to all bands
    }

    const grid = product.pricingExampleGrid as unknown as PricingExampleGrid | null
    const pricingTree = buildPricingTree(product)
    // T18: a mixed-denomination rate card needs the FX reference exactly once
    const pricingFx = grid && pricingTreeNeedsFx(pricingTree) ? await getFxProvider().getReference('EUR', 'RON') : null
    const pricingExamples = grid ? derivePricingExamples(pricingTree, grid, pricingFx) : []

    let eligibilityBounds: EligibilityBounds = { minAge: null, maxAge: null, otherRuleCodes: [] }
    try {
      eligibilityBounds = deriveEligibilityBounds(parseEligibilityRuleSet(product.eligibility))
    } catch {
      // legacy/informal rule shapes yield no numbers — presentation must not invent them
    }

    const published = await getPublishedProductContent(product.id)
    const derived: DerivedProductInputs = {
      pricingExamples,
      eligibilityBounds,
      content: mapPublished(published),
      addonContent: mapAddonPublished(published, product.addons),
    }

    return {
      success: true,
      data: {
        product: shapeProductInfo(product as unknown as RawProduct, { age, derived }) as unknown as Record<string, unknown>,
        contentVersions: derived.content.contentVersions,
      },
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
    "The candidate is a SOFT binding for the presentation phase; it does NOT start an application. " +
    "Once an application is open the product is frozen — NEVER call this to push a sale forward " +
    "(accepting an offer goes through accept_quote; identity gaps through collect_customer_field / start_channel_verification).",
  parameters: {
    type: 'object',
    properties: {
      productId: {
        type: 'string',
        description:
          "The product to set as the candidate: its code (e.g. 'protect') or its id from list_products. NEVER an application, quote, or conversation id, and never an id you did not read from a tool result in THIS conversation.",
      },
      addonIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional add-on codes the customer showed interest in (soft binding, like the candidate itself).',
      },
    },
    required: ['productId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: STATUS_SET_CANDIDATE_PRODUCT,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, setCandidateProduct)

registerTool('set_purchase_intent', {
  description:
    'Record the customer\'s purchase intent — call it THE MOMENT the customer commits to buying or to a quote ' +
    '("vreau să-l cumpăr", "fă-mi o ofertă", "hai să mergem mai departe" in a product context). ' +
    'Pass the goal ("quote" or "purchase"), the productCode, and optionally the config they converged on (tier/level/addon — advisory; selection truth stays with select_coverage). ' +
    'One durable commitment: from then on the funnel proceeds WITHOUT re-asking readiness. ' +
    'A newer intent supersedes the prior one. If the customer explicitly withdraws ("nu mai vreau", "m-am răzgândit"), call it with {renounce: true} — the intent is marked renounced.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', enum: ['quote', 'purchase'], description: 'What the customer committed to: an offer (quote) or the purchase itself.' },
      productCode: { type: 'string', description: "The product the commitment is about (e.g. 'protect')." },
      config: {
        type: 'object',
        properties: {
          tier: { type: 'string', description: 'Pricing tier code the customer converged on, if any.' },
          level: { type: 'string', description: 'Premium level code, if any.' },
          addon: { type: 'boolean', description: 'Whether the add-on is part of the commitment.' },
        },
        additionalProperties: false,
        description: 'Advisory snapshot of the converged configuration — selection truth stays with select_coverage.',
      },
      renounce: { type: 'boolean', description: 'true = the customer explicitly withdrew their commitment; marks the active intent renounced.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, setPurchaseIntent)

// switch_product retired in B4 (T5.D3: product is FROZEN on the application;
// changing product = cancel + set_application on the new candidate)

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

// --- Application (B4 lifecycle) ---
// start_application/set_answer/change_selection retired: set_application
// freezes product only; select_coverage is the sole selection writer.

registerTool('set_application', {
  description:
    'Open the insurance application for the product in focus. Freezes the PRODUCT only — ' +
    'coverage (tier/level/addon) is chosen separately with select_coverage, and the needs analysis (DNT) gates the questionnaire. ' +
    'One live application per customer and product; resume_application continues an existing one.',
  parameters: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'Optional explicit product ID (defaults to the product/candidate in focus).' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, setApplication)

registerTool('get_next_question', {
  description:
    'The next unanswered application question with progress and branching_metadata — the structured provenance of WHY the ' +
    'question appears (which dependency edge fired on which answer/selection). Use the metadata to explain new questions; never paraphrase gates from memory.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false, // pure read — Task 5.3: the default-true left it in the writing partition, so missing_consequences fired on every call
  kind: 'read',
}, getNextQuestionInfo)

registerTool('write_question_answer', {
  description:
    'Save the customer\'s answer to the current application question. Pass the question\'s code (from the previous result\'s nextQuestion.code ' +
    'or get_next_question) so the commit is addressed precisely. First writes never need confirmation — the sensitive medical set is affirmed ONCE at the end via sign_medical_declarations.',
  parameters: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The customer\'s answer.' },
      questionCode: { type: 'string', description: 'The code of the question being answered (e.g. BD_CANCER_HISTORY).' },
      confirmToken: { type: 'string', description: 'Confirmation token from a prior requires_confirmation envelope.' },
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
}, writeQuestionAnswer)

registerTool('write_medical_batch', {
  description:
    'Save the customer\'s answers to ALL the visible BD medical condition questions in ONE commit — the batch card\'s ' +
    '"Niciuna dintre acestea nu mi se aplică" button posts every condition as "false"; per-condition toggles post the exceptions. ' +
    'Values are the option literals "true"/"false" keyed by question code (e.g. {"BD_CANCER_HISTORY":"false"}). ' +
    'Per-question consequences (eligibility, cascades) apply exactly as the sequential path; the typed fallback stays write_question_answer, one question at a time.',
  parameters: {
    type: 'object',
    properties: {
      answers: {
        type: 'object',
        description: 'Map of BD question code → "true" | "false".',
        additionalProperties: { type: 'string', enum: ['true', 'false'] },
      },
    },
    required: ['answers'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, writeMedicalBatch)

registerTool('modify_answer', {
  description:
    'Correct a previously answered application question by its code. The consequence planner computes the full cascade ' +
    '(invalidated dependents, added/removed questions, eligibility, status) — a sensitive correction shows a confirmation card the CUSTOMER completes; never re-call this tool yourself.',
  parameters: {
    type: 'object',
    properties: {
      questionCode: { type: 'string', description: 'The code of the question to modify (e.g. HEALTH_DECLARATION_CONFIRM).' },
      newValue: { type: 'string', description: 'The corrected answer.' },
      confirmToken: { type: 'string', description: 'Confirmation token from a prior requires_confirmation envelope.' },
    },
    required: ['questionCode', 'newValue'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'save',
  kind: 'commit',
}, modifyAnswer)

registerTool('sign_medical_declarations', {
  description:
    'Sign the batch medical declaration — ONE confirmation card affirming ALL the sensitive medical answers together (T6.D3 deviation 2026-07-06, sign_dnt precedent). ' +
    'The first call shows the card with the declarations preview; the CUSTOMER completes it — never re-call this tool yourself. ' +
    'Exposed after the last sensitive question is answered; required before generate_quote.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, signMedicalDeclarations)

registerTool('select_coverage', {
  description:
    'Choose or change the coverage: pricing tier (e.g. "standard", "optim"), premium level (e.g. "level_1") or the add-on. ' +
    'THE only way to set them — they are not questionnaire questions. ONE facet per call (tier, then level, then addon): ' +
    'each change carries its own consequences (a tier change invalidates the level; the addon toggle adds/removes the medical questionnaire). ' +
    'Once a quote exists the selection is frozen — cancel the quote and open a new application to change it.',
  parameters: {
    type: 'object',
    properties: {
      tier: { type: 'string', description: 'Pricing tier code. Omit to keep the current tier.' },
      level: { type: 'string', description: 'Premium level code within the tier. Omit to keep the current level.' },
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
}, selectCoverage)

registerTool('acknowledge_suitability_warning', {
  description:
    'Record the customer\'s explicit acknowledgement of a suitability warning (demands-and-needs mismatch) so the quote can proceed. ' +
    'Use ONLY after presenting the mismatch reasons from the blocked generate_quote and the customer explicitly chooses to continue. Takes no arguments — the engine records its own current verdict.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'consent',
  kind: 'commit',
}, acknowledgeSuitabilityWarning)

registerTool('resume_application', {
  description: 'Resume the customer\'s existing application — works across conversations and channels. Unpauses a PAUSED application and returns the current position (next question, progress, selection).',
  parameters: {
    type: 'object',
    properties: {
      applicationId: { type: 'string', description: 'Optional explicit application ID (defaults to the customer\'s resumable application).' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, resumeApplication)

registerTool('cancel_application', {
  description: 'Cancel the current application — terminal and confirmed with the customer first. A cancelled application cannot be resumed; a new one can be opened.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Reason for cancellation.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, cancelApplication)

registerTool('get_last_application_info', {
  description:
    'Read the customer\'s most recent COMPLETED application and return its answers as PROPOSALS for the new one. ' +
    'Each proposal must be confirmed with the customer question by question — never copy silently.',
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
}, getLastApplicationInfo)

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
  description:
    'Accept the issued quote with the customer\'s ELECTED payment frequency. Two-step: the first call shows a confirmation card — the CUSTOMER completes it; never re-call this tool yourself. ' +
    'Acceptance freezes the price into a payment schedule — the policy is issued at the first successful payment, not here. Requires acknowledged disclosures and a verified channel.',
  parameters: {
    type: 'object',
    properties: {
      paymentOption: { type: 'string', enum: ['annual', 'semi_annual', 'quarterly'], description: 'The payment frequency the customer chose (get_quote_info lists options with amounts).' },
    },
    required: ['paymentOption'],
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

registerTool('get_quote_info', {
  description:
    'Get the quote: premiums, coverages, the EFFECTIVE status (a time-expired quote reads EXPIRED) and the payment options ' +
    'the customer may elect at acceptance (frequency + amount — the contract frequency is chosen at accept_quote, not before).',
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
  sideEffects: false, // pure read — Task 5.3: the default-true left it in the writing partition, so missing_consequences fired on every call
  kind: 'read',
}, getQuoteInfo)

registerTool('get_acceptance_bundle', {
  description:
    'Show the ONE acceptance card for the issued quote: disclosure document links (IPID, terms & conditions), the acknowledgment checkbox and the payment-frequency ' +
    'comparison with the Accept button — the CUSTOMER completes it on the card. Use when the customer is ready to review and accept the offer.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false, // pure read — the card is the only output
  kind: 'read',
}, getAcceptanceBundle)

registerTool('acknowledge_disclosures', {
  description:
    'Record the customer\'s acknowledgement of the pre-contractual disclosure documents (IPID, terms & conditions) for the issued quote. ' +
    'Use ONLY after presenting the documents (get_quote_info lists them with download links). Required before the quote can be accepted. Takes no arguments.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, acknowledgeDisclosures)

registerTool('cancel_quote', {
  description:
    'Cancel the issued quote — terminal; the first call shows a confirmation card the CUSTOMER completes (never re-call this tool yourself). ' +
    'The frozen application stays as the record of what was priced: to get a different quote, start a NEW application (previous answers are offered as prefill proposals). This is the only change path once a quote exists.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, cancelQuote)

// modify_quote retired at D1.7 (T13.D2): the quote is immutable once issued —
// cancel_quote + a new application is the only change path.

// check_bd_eligibility was retired in C1.ADD-2 (T13.D7): the bd rule lives
// as ELIGIBILITY edges in the dependency graph — answering a BD question
// re-evaluates eligibility inside the consequence plan, no separate tool.

// --- Payment ---

registerTool('get_payment_status', {
  description:
    'Get the payment plan state: installments with amounts and statuses, next due amount, captures so far, last failure. ' +
    'The ONLY payment read — answers from the schedule, the live money truth from acceptance onward.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false, // pure read — Task 5.3: the default-true left it in the writing partition, so missing_consequences fired on every call
  kind: 'read',
}, getPaymentStatus)

registerTool('ensure_payment_session', {
  description:
    'Start, resume or retry the payment for the next due installment — ONE tool for all three; the mode is decided by the engine and returned, never passed in. ' +
    'Guarantees a single open payment attempt (a stale one is superseded, never stacked). Shows the inline payment UI.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: STATUS_INITIATE_PAYMENT,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, ensurePaymentSession)

registerTool('change_payment_option', {
  description:
    'Change the payment frequency BEFORE any installment is captured; the first call shows a confirmation card the CUSTOMER completes (never re-call this tool yourself). ' +
    'Re-rates the schedule from the accepted premium — the quote itself never changes. Once the first installment is paid the frequency is fixed.',
  parameters: {
    type: 'object',
    properties: {
      paymentOption: { type: 'string', enum: ['annual', 'semi_annual', 'quarterly'], description: 'The new payment frequency.' },
    },
    required: ['paymentOption'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, changePaymentOption)

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

// T20 (P3.5): the manifest derives from provider config at module load — the
// description names EXACTLY the deliverable channels (no advertised "or phone
// number" while no SMS provider exists), so the model is never told about a
// channel the schema and handler would reject.
const VERIFICATION_CHANNELS = availableVerificationChannels()
const VERIFICATION_TARGET_NOUN: Record<VerificationChannel, string> = {
  email: 'email address',
  sms: 'phone number',
}
const verificationTargetPhrase = VERIFICATION_CHANNELS.map((c) => VERIFICATION_TARGET_NOUN[c]).join(' or ')

registerTool('start_channel_verification', {
  description:
    `Send the customer a 6-digit verification code (plus a one-click link) to the ${verificationTargetPhrase} THEY provided. ` +
    'Verifying a channel raises the identity tier (needed before accepting a quote). ' +
    'Never reveals whether the address belongs to an existing account. ' +
    'While a code is already pending, do NOT call this again for the same address (it would invalidate the code the customer is reading) — pass resend: true ONLY when the customer explicitly asks for a new code.',
  parameters: {
    type: 'object',
    properties: {
      channel: { type: 'string', enum: VERIFICATION_CHANNELS, description: `Which channel to verify. Available: ${VERIFICATION_CHANNELS.join(', ')} — a channel is offered ONLY while its delivery provider is configured.` },
      target: { type: 'string', description: `The ${verificationTargetPhrase} the customer gave, exactly as provided.` },
      resend: { type: 'boolean', description: 'Set true ONLY when the customer explicitly asked for a new code while one is already pending.' },
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

registerTool('request_document_upload', {
  description:
    'Show the customer a secure control to upload a required identity document (ID card photo). ' +
    'The image goes straight to the validation pipeline — you never see or handle it. ' +
    'Use when a required document blocks a step (e.g. before payment).',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['id_card'], description: 'The document kind to request (default id_card).' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, requestDocumentUpload)

// --- Operator queue (E2.4) ---
// Never agent-exposed: no ACTION_RULES entry; the gateway's OPERATOR_TOOLS
// actor gate (operator|system only) replaces exposure-based legality.

registerTool('get_policy_info', {
  description:
    'Get the customer\'s policy: engine-gated statusCode (paid_processing | submitted_to_insurer | policy_active | policy_cancelled | policy_lapsed | policy_expired — NEVER claim the policy is in force unless policy_active), ' +
    'Allianz number, effective dates, free-look deadline, payment plan summary and documents. The single policy read.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffects: false, // pure read — Task 5.3: the default-true left it in the writing partition, so missing_consequences fired on every call
  kind: 'read',
}, getPolicyInfo)

registerTool('request_cancellation', {
  description:
    'Cancel the ACTIVE policy within the free-look window; the first call shows a confirmation card the CUSTOMER completes (never re-call this tool yourself). ' +
    'Terminal: the policy is cancelled and every captured payment is refunded. Outside the window this is rejected — offer escalation to a colleague instead.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
  requiresConfirmation: true,
}, requestCancellation)

registerTool('mark_submitted', {
  description: 'Operator: mark a paid policy as submitted to the insurer (PENDING_SUBMISSION → SUBMITTED).',
  parameters: {
    type: 'object',
    properties: {
      policyId: { type: 'string', description: 'The policy to mark submitted.' },
    },
    required: ['policyId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ['ADMIN', 'OPERATOR'],
  sideEffect: 'lifecycle',
  kind: 'commit',
}, markSubmitted)

registerTool('activate_policy', {
  description: 'Operator: activate a submitted policy with its Allianz policy number (SUBMITTED → ACTIVE). Writes activation/effective dates and freezes the free-look window.',
  parameters: {
    type: 'object',
    properties: {
      policyId: { type: 'string', description: 'The policy to activate.' },
      allianzPolicyNumber: { type: 'string', description: 'The Allianz policy number — mandatory.' },
    },
    required: ['policyId', 'allianzPolicyNumber'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ['ADMIN', 'OPERATOR'],
  sideEffect: 'lifecycle',
  kind: 'commit',
}, activatePolicy)

registerTool('cancel_submission', {
  description: 'Operator: cancel a pre-activation policy (Allianz rejection) — PENDING_SUBMISSION/SUBMITTED → CANCELLED. Captured payments are refunded.',
  parameters: {
    type: 'object',
    properties: {
      policyId: { type: 'string', description: 'The policy whose submission to cancel.' },
    },
    required: ['policyId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ['ADMIN', 'OPERATOR'],
  sideEffect: 'lifecycle',
  kind: 'commit',
}, cancelSubmission)

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

// E4.3 (M2 spec amendment): get_open_items is the ONE list read —
// get_application_list and get_quote_list are NOT registered.
registerTool('get_open_items', {
  description:
    "List the customer's open items — paused applications, pending quotes, due installments, expiring DNT, policies in progress — each with the next available action.",
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
  // Not cacheable: output depends on live state.
  cacheable: false,
  kind: 'read',
}, getOpenItems)

registerTool('request_erasure', {
  description:
    'Record the customer\'s GDPR right-to-erasure request as an operator work item. NOTHING is deleted immediately — an operator reviews and approves; ' +
    'legally retained records (policies, payments, signed questionnaire) survive per the retention policy. Available even after a consent withdrawal.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Optional context from the conversation (why the customer asked).' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, requestErasure)

registerTool('request_data_export', {
  description:
    'Record the customer\'s GDPR data-access request (a copy of everything we hold on them) as an operator work item. ' +
    'Requires a verified channel — the engine answers requires_identity otherwise. The bundle is delivered via the dashboard after operator approval.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Optional context from the conversation.' },
    },
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: true,
  statusMessage: null,
  allowedRoles: ALL_ROLES,
  kind: 'commit',
}, requestDataExport)

registerTool('approve_erasure', {
  description: 'Operator: approve a GDPR_ERASURE work item — executes the retention-driven erasure job and records the per-class report on the item.',
  parameters: {
    type: 'object',
    properties: {
      workItemId: { type: 'string', description: 'The GDPR_ERASURE work item to approve.' },
    },
    required: ['workItemId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ADMIN_OPERATOR,
  sideEffect: 'lifecycle',
  kind: 'commit',
}, approveErasure)

registerTool('approve_export', {
  description: 'Operator: approve a GDPR_EXPORT work item — compiles the versioned data-access bundle and stores it on the item for dashboard download.',
  parameters: {
    type: 'object',
    properties: {
      workItemId: { type: 'string', description: 'The GDPR_EXPORT work item to approve.' },
    },
    required: ['workItemId'],
    additionalProperties: false,
  },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ADMIN_OPERATOR,
  kind: 'commit',
}, approveExport)

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

