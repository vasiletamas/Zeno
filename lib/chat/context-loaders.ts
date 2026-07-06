/**
 * Context Loaders — Section Content Loaders for All 10 Prompt Sections
 *
 * Each loader fetches data from the DB and formats it into a prompt-ready string.
 * Loaders return string | null (null means the section will be skipped).
 *
 * Three layers:
 * - CONSTITUTION: loadAgentIdentity, loadCapabilityManifest, loadConstraints
 * - REASONING:    situationalBriefing (passed through from gate output)
 * - DYNAMIC:      loadProductContext, loadCoachingBriefing, loadQuestionnaireContext,
 *                 loadCustomerContext, loadCustomerMemory, loadAgentKnowledge
 */

import { prisma } from '@/lib/db'
import { getToolDefinition } from '@/lib/tools/registry'
import { estimateTokens } from '@/lib/chat/token-budget'
import { LRUCache } from '@/lib/cache/lru-cache'
import { findContextHit, type ContextHit } from '@/lib/insights/context-hits'
import { logInfo } from '@/lib/errors/logger'
import { calculateAge } from './age'
import { getNextQuestion, type AnswerScope } from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, type QuestionPhase } from '@/lib/engines/question-groups'
import { workflowStepCodeFor } from './phase-sections-map'
import { getPublishedProductContent, collectPublishedContentIds, registerPublishFlushHook } from '@/lib/products/product-content'
import { derivePricingExamples, type PricingExampleGrid } from '@/lib/engines/pricing-examples'
import type { PromptSections } from './prompt-builder'
import type { DerivedStateV3 } from '@/lib/engines/domain-types'

// ==============================================
// CACHES
// ==============================================

const productContextCache = new LRUCache<string, { text: string | null; contentVersions: string[] }>(5, 10 * 60 * 1000) // 10 min
const coachingBriefingCache = new LRUCache<string, string | null>(5, 10 * 60 * 1000)
const catalogOverviewCache = new LRUCache<string, string>(2, 10 * 60 * 1000) // keyed by language

// E1.3/E1.8 (erratum 6): a ProductContent publish flushes EVERY prompt-side
// cache — a compliance retraction must never serve retired claims until TTL.
registerPublishFlushHook(() => {
  productContextCache.clear()
  coachingBriefingCache.clear()
  catalogOverviewCache.clear()
})

// ==============================================
// TYPES
// ==============================================

/** Shape for Json fields with en/ro keys */
interface LocalizedText {
  en: string
  ro: string
}

/** Minimal product shape for the catalog overview section */
export interface CatalogProductSummary {
  insuranceType: string
  name: LocalizedText
  description: LocalizedText
}

// ==============================================
// CONSTITUTION LAYER
// ==============================================

/**
 * Load agent identity section.
 * Returns the agent's system prompt directly.
 */
export function loadAgentIdentity(
  systemPrompt: string | null,
): string | null {
  return systemPrompt
}

/**
 * Load capability manifest section.
 * Formats allowed tools with their descriptions.
 */
export function loadCapabilityManifest(
  allowedTools: string[],
): string | null {
  if (allowedTools.length === 0) return null

  const toolLines: string[] = []
  for (const name of allowedTools) {
    const def = getToolDefinition(name)
    const description = def?.description ?? 'No description available'
    toolLines.push(`- ${name}: ${description}`)
  }

  return [
    'My tools for this conversation:',
    ...toolLines,
    '',
    'I can only act through these tools.',
  ].join('\n')
}

/**
 * Load constraints section.
 * Returns the constraints text directly.
 */
export function loadConstraints(
  constraints: string | null,
): string | null {
  return constraints
}

// ==============================================
// STATE GROUNDING (constitution layer)
// ==============================================

/**
 * Input shape for loadStateGrounding. Comes from already-loaded turn context.
 */
export interface StateGroundingInput {
  application: {
    id: string
    status: string
    currentQuestionIndex: number | null
    totalQuestions: number | null
  } | null
  product: { code: string; name: unknown } | null
  customer: {
    gdprConsentAt: Date | null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: Date | null
  }
}

function pickProductName(name: unknown): string {
  if (typeof name === 'string') return name
  if (name && typeof name === 'object') {
    const obj = name as Record<string, unknown>
    if (typeof obj.ro === 'string') return obj.ro
    if (typeof obj.en === 'string') return obj.en
  }
  return 'product'
}

function formatStateDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

/**
 * Build the '=== CURRENT SYSTEM STATE ===' section. Pure function: every
 * fact is named explicitly with ✓ (present) or ✗ (absent) so the agent
 * never has to infer reality from silence.
 *
 * See docs/superpowers/specs/2026-05-20-zeno-state-grounding-design.md.
 */
export function loadStateGrounding(input: StateGroundingInput): string {
  const lines: string[] = []
  lines.push('=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===')

  if (input.application) {
    const a = input.application
    const progress = (a.currentQuestionIndex != null && a.totalQuestions != null)
      ? ` (question ${a.currentQuestionIndex}/${a.totalQuestions})`
      : ''
    lines.push(`✓ Active application: ${a.id}${progress}`)
  } else {
    lines.push('✗ No application has been started')
  }

  if (input.product) {
    lines.push(`✓ Selected product: ${input.product.code} — ${pickProductName(input.product.name)}`)
  } else {
    lines.push('✗ No product is selected')
  }

  if (input.customer.gdprConsentAt) {
    const when = formatStateDate(input.customer.gdprConsentAt)
    const scope = input.customer.gdprConsentScope ?? 'unspecified scope'
    lines.push(`✓ GDPR consent: Granted at ${when} for ${scope}`)
  } else {
    lines.push('✗ GDPR consent has NOT been granted by this customer')
  }

  if (input.customer.aiDisclosureAcknowledgedAt) {
    const when = formatStateDate(input.customer.aiDisclosureAcknowledgedAt)
    lines.push(`✓ AI disclosure: Acknowledged at ${when}`)
  } else {
    lines.push('✗ AI disclosure has NOT been acknowledged by this customer')
  }

  lines.push('')
  lines.push('You cannot claim to have completed any of these. To change state, call the matching tool and wait for its success.')

  return lines.join('\n')
}

// ==============================================
// DYNAMIC LAYER
// ==============================================

/**
 * E1.8 (erratum 8, M8 pin 1): the ProductContent version ids injected into
 * the most recent productContext load — the turn-debug writer stamps them
 * so prompt-injected claims are as traceable as tool-returned ones.
 * HAND-OFF: the TurnDebug reducer consumes this when M8's stamping lands
 * (observability block F2).
 */
let lastInjectedProductContentVersions: string[] = []
export function getLastInjectedProductContentVersions(): string[] {
  return lastInjectedProductContentVersions
}

/**
 * Load product context section.
 * Fetches product with pricing tiers, levels, and addons.
 *
 * E1.8 (T11.D5): claims come from PUBLISHED ProductContent key points (the
 * retired EN-only features column is gone) and the pricing anchor is ONE
 * derived example span — min/max base premium labeled base-only vs
 * base+addon (closing the anchoring gap where the base range read as the
 * full price), every number out of the same calculateQuote arithmetic.
 */
export async function loadProductContext(
  productId: string,
  language: 'en' | 'ro',
): Promise<string | null> {
  const cacheKey = `${productId}:${language}`
  const cached = productContextCache.get(cacheKey)
  if (cached !== undefined) {
    lastInjectedProductContentVersions = cached.contentVersions
    return cached.text
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      pricingTiers: {
        where: { isActive: true },
        include: {
          levels: {
            where: { isActive: true },
            orderBy: { orderIndex: 'asc' },
          },
        },
        orderBy: { orderIndex: 'asc' },
      },
      addons: {
        where: { isActive: true },
        include: {
          pricingRules: { orderBy: { minAge: 'asc' } },
          coverageAmounts: { include: { coverageType: true } },
        },
      },
    },
  })

  if (!product) {
    productContextCache.set(cacheKey, { text: null, contentVersions: [] })
    lastInjectedProductContentVersions = []
    return null
  }

  const name = (product.name as unknown as LocalizedText)[language]
  const description = (product.description as unknown as LocalizedText)[language]

  const published = await getPublishedProductContent(product.id)
  const contentVersions = collectPublishedContentIds(published)

  const parts: string[] = []
  parts.push(`Product: ${name}`)
  parts.push(`Type: ${product.insuranceType} / ${product.subType}`)
  parts.push(`Description: ${description}`)

  // Key points — published authored claims only (T11.D2)
  const points = published.fields.KEY_VALUE_PRODUCT_POINTS
  const localizedPoints = points ? ((language === 'ro' ? points.ro : points.en) as string[] | null) : null
  if (localizedPoints && localizedPoints.length > 0) {
    parts.push('')
    parts.push('Key points (published content):')
    for (const point of localizedPoints) {
      parts.push(`- ${point}`)
    }
  }

  // Pricing anchor — ONE derived example span, base-only vs base+addon
  if (product.pricingTiers.length > 0) {
    parts.push('')
    parts.push('Pricing:')
    const grid = product.pricingExampleGrid as unknown as PricingExampleGrid | null
    const examples = grid
      ? derivePricingExamples(
          {
            quoteValidityDays: product.quoteValidityDays,
            tiers: product.pricingTiers.map((t) => ({
              code: t.code,
              name: t.name as { en: string; ro: string },
              levels: t.levels.map((l) => ({ code: l.code, name: l.name as { en: string; ro: string }, premiumAnnual: l.premiumAnnual })),
            })),
            addonRules: (product.addons[0]?.pricingRules ?? []).map((r) => ({ minAge: r.minAge, maxAge: r.maxAge, premiumAnnual: r.premiumAnnual })),
          },
          grid,
        )
      : []
    if (examples.length > 0) {
      const bases = examples.map((e) => e.base.premiumAnnual)
      const withAddon = examples
        .map((e) => e.withAddon)
        .filter((w): w is { premiumAnnual: number; premiumMonthly: number; addonDelta: number } => !!w && 'premiumAnnual' in w)
        .map((w) => w.premiumAnnual)
      const addonSpan = withAddon.length > 0 ? `; with the ${product.addons[0]?.code ?? 'addon'} addon the same examples run ${Math.min(...withAddon)}-${Math.max(...withAddon)} RON/year` : ''
      parts.push(`Example premiums (BASE product only): ${Math.min(...bases)}-${Math.max(...bases)} RON/year across the sampled ages/packages${addonSpan}. Full per-age grid: get_product_info pricing_examples. Customer-specific price: generate_quote only.`)
    } else {
      parts.push('Exact pricing is available only via generate_quote, after the application is complete.')
    }
  }

  // Addons
  for (const addon of product.addons) {
    const addonName = (addon.name as unknown as LocalizedText)[language]
    parts.push('')
    parts.push(`${addon.code} Addon (${addonName}):`)

    // Coverage amounts
    for (const ca of addon.coverageAmounts) {
      const ctName = (ca.coverageType.name as unknown as LocalizedText)[language]
      parts.push(`- ${ctName}: ${ca.amount.toLocaleString()} ${ca.currency}`)
    }

    if (addon.waitingPeriod) {
      parts.push(`- Waiting period: ${addon.waitingPeriod}`)
    }
  }

  const result = parts.join('\n')
  productContextCache.set(cacheKey, { text: result, contentVersions })
  lastInjectedProductContentVersions = contentVersions
  return result
}

// ==============================================
// CATALOG OVERVIEW (always-on breadth grounding)
// ==============================================

function pickLocalized(v: LocalizedText | null | undefined, language: 'en' | 'ro'): string {
  if (!v) return ''
  return v[language] ?? v.ro ?? v.en ?? ''
}

function shortOneLine(s: string, max = 140): string {
  const collapsed = s.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

/**
 * Pure formatter for the catalog overview: one compact line per product,
 * preceded by a header stating these are the ONLY products. This is the
 * agent's breadth grounding — it must never imply a category exists when
 * no product backs it. Specifics (coverages/prices) still come from
 * get_product_info, not from this overview.
 */
export function buildCatalogOverview(
  products: CatalogProductSummary[],
  language: 'en' | 'ro',
): string {
  if (products.length === 0) {
    return language === 'en'
      ? 'The catalog currently has NO active products — there is nothing to sell right now.'
      : 'Catalogul nu conține niciun produs activ în acest moment — nu avem ce vinde acum.'
  }
  const header =
    language === 'en'
      ? 'These are the ONLY products in the catalog (everything we can sell). Any category NOT listed here is NOT available — never imply otherwise:'
      : 'Acestea sunt SINGURELE produse din catalog (tot ce putem vinde). Orice categorie care NU apare aici NU este disponibilă — nu sugera niciodată altceva:'
  const lines = products.map(
    (p) => `- [${p.insuranceType}] ${pickLocalized(p.name, language)} — ${shortOneLine(pickLocalized(p.description, language))}`,
  )
  return [header, ...lines].join('\n')
}

/**
 * Load the catalog overview section. Always returns a string (the empty-catalog
 * case still produces an explicit "nothing to sell" sentinel), so the section
 * is always present and the agent is never left guessing what exists.
 * Cached per language; the catalog is small and changes rarely.
 */
export async function loadCatalogOverview(language: 'en' | 'ro'): Promise<string> {
  const cached = catalogOverviewCache.get(language)
  if (cached !== undefined) return cached

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { insuranceType: true, name: true, description: true },
    orderBy: { insuranceType: 'asc' },
  })

  const result = buildCatalogOverview(
    products.map((p) => ({
      insuranceType: p.insuranceType,
      name: p.name as unknown as LocalizedText,
      description: p.description as unknown as LocalizedText,
    })),
    language,
  )
  catalogOverviewCache.set(language, result)
  return result
}

/** Test/admin hook: clear the cached catalog overview (call after product edits). */
export function flushCatalogOverviewCache(): void {
  catalogOverviewCache.clear()
}

/**
 * E1.3 (erratum 6): publish must invalidate ALL product-content caches —
 * publishProductContent calls this so a compliance retraction never keeps
 * serving retired claims from the prompt-side cache until TTL expiry.
 */
export function flushProductContextCache(): void {
  productContextCache.clear()
}

/**
 * Load coaching briefing section from Product.defaultPlaybook (the
 * per-step playbook source died with the machine, A5.3).
 */
export async function loadCoachingBriefing(
  productId: string | null,
): Promise<string | null> {
  const cacheKey = productId ?? 'null'
  const cached = coachingBriefingCache.get(cacheKey)
  if (cached !== undefined) return cached

  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { defaultPlaybook: true },
    })
    const result = product?.defaultPlaybook ?? null
    coachingBriefingCache.set(cacheKey, result)
    return result
  }

  coachingBriefingCache.set(cacheKey, null)
  return null
}

/**
 * Test-only: flush the cache so unit tests don't bleed between specs.
 */
export function flushCoachingBriefingCache(): void {
  coachingBriefingCache.clear()
}

/**
 * Task 1.2 (D2): the questionnaire surface keyed on the ENGINE's derived
 * (phase, subphase) — the orchestrator patches this after the gate, same
 * pattern as dntContext. Everything else is loadQuestionnaireContext.
 */
export async function loadQuestionnaireContextForState(
  state: Pick<DerivedStateV3, 'phase' | 'subphase'>,
  conversationId: string,
  customerId: string,
  language: 'en' | 'ro',
): Promise<string | null> {
  return loadQuestionnaireContext(conversationId, customerId, workflowStepCodeFor(state.phase, state.subphase), language)
}

/**
 * Load questionnaire context section.
 * Determines active questionnaire from workflowStepCode and finds current question.
 *
 * The walk is the CANONICAL getNextQuestion (C1.7/C1.8) — the same group
 * ordering, visibility graph and progress the pinned get_next_question read
 * uses — never a duplicate group-hardcoded walk that can disagree with the
 * engine's missingCodes (bd_medical, branch-hidden questions).
 */
export async function loadQuestionnaireContext(
  conversationId: string,
  customerId: string,
  workflowStepCode: string | null,
  language: 'en' | 'ro',
): Promise<string | null> {
  if (!workflowStepCode) return null

  const questionnaireType = resolveQuestionnaireType(workflowStepCode)
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { activeApplicationId: true, productId: true, candidateProductId: true },
  })
  if (!conv) return null
  const productId = conv.productId ?? conv.candidateProductId ?? null

  let scope: AnswerScope | null = null
  let phase: QuestionPhase
  if (workflowStepCode === 'dnt_questionnaire') {
    phase = 'dnt'
    const session = await prisma.dntSession.findFirst({
      where: { customerId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { startedAt: 'desc' },
    })
    scope = session ? { kind: 'dntSession', sessionId: session.id } : null
  } else {
    phase = 'application'
    scope = conv.activeApplicationId ? { kind: 'application', applicationId: conv.activeApplicationId } : null
  }
  if (!scope) return null

  const groupCodes = await resolveGroupCodes(productId, phase)
  if (groupCodes.length === 0) return null

  const next = await getNextQuestion(groupCodes, scope)

  const parts: string[] = []
  parts.push(`[ACTIVE QUESTIONNAIRE - ${questionnaireType}]`)

  if (!next) {
    parts.push('')
    parts.push('All questions answered. Questionnaire complete.')
    return parts.join('\n')
  }

  const currentQuestion = next.question
  parts.push(`Progress: ${next.progress.answered}/${next.progress.total}`)

  const questionText = (currentQuestion.text as LocalizedText)[language]
  parts.push('')
  parts.push(`Current question (${currentQuestion.groupCode}):`)
  parts.push(questionText)
  if (currentQuestion.code) {
    const saveTool = phase === 'dnt' ? 'write_dnt_answer' : 'write_question_answer'
    parts.push(`Question code: ${currentQuestion.code} — pass this EXACT code to ${saveTool}.`)
  }
  parts.push(`Type: ${currentQuestion.type}`)

  if (currentQuestion.options) {
    const options = currentQuestion.options as unknown as Array<{
      value: string
      label: LocalizedText
    }>
    if (Array.isArray(options) && options.length > 0) {
      parts.push('Options:')
      for (const opt of options) {
        parts.push(`  - value: "${opt.value}" -> label: "${opt.label[language]}"`)
      }
    }
  }

  // Context hit lookup
  const hit = await findContextHit(
    customerId,
    {
      id: currentQuestion.id,
      insightKey: currentQuestion.insightKey,
      options: currentQuestion.options,
      group: { code: currentQuestion.groupCode },
    },
    conversationId,
  )

  if (hit) {
    parts.push('')
    parts.push(renderContextHitBlock(hit, currentQuestion.groupCode))

    if (currentQuestion.groupCode === 'bd_medical' && hit.category === 'RISK_FACTOR') {
      logInfo({
        layer: 'compliance',
        category: 'context_hit_medical',
        message: 'Medical CONTEXT HIT presented for explicit affirmation',
        context: {
          customerId,
          conversationId,
          questionCode: currentQuestion.code,
          insightKey: hit.key,
          value: hit.value,
          confidence: hit.confidence,
        },
      })
    }
  }

  return parts.join('\n')
}

function renderContextHitBlock(hit: ContextHit, groupCode: string): string {
  const lines: string[] = []
  lines.push('[CONTEXT HIT for current question]')
  lines.push('We already extracted this from the conversation:')
  lines.push(`  field: ${hit.key}`)
  lines.push(`  value: "${hit.value}"`)
  lines.push(`  confidence: ${hit.confidence.toFixed(2)}`)
  lines.push(`  extracted from conversation: ${hit.source}`)
  lines.push('')
  lines.push('INSTRUCTIONS — DO NOT RE-ASK:')
  lines.push('  Instead of asking the original question, confirm the value with the user.')
  lines.push(`  Example phrasing: "Înțeleg că vrei ${hit.value} — confirmi?"`)
  lines.push(`  If user says yes/confirms → call the answer-saving tool with answer="${hit.value}".`)
  lines.push('  If user says no/wants something different → ask the original question normally.')

  if (groupCode === 'bd_medical' && hit.category === 'RISK_FACTOR') {
    lines.push('')
    lines.push('For this medical/risk declaration:')
    lines.push('  Use explicit phrasing — the customer must consciously affirm.')
    lines.push(`  Required pattern: "Pentru declarația medicală oficială: confirmi că ${hit.value}?`)
    lines.push('                     Te rog răspunde cu DA sau NU."')
    lines.push('  Never accept implicit confirmation (e.g. "ok"). Only explicit yes/da.')
  }

  return lines.join('\n')
}

// resolveQuestionGroupCodes died at Task 1.2 (D2): group resolution now
// comes from resolveGroupCodes over the QuestionGroup.phase column — the
// same source the engine and the pinned get_next_question read use.

/**
 * Resolve questionnaire type label from workflow step code.
 */
function resolveQuestionnaireType(workflowStepCode: string): string {
  if (workflowStepCode === 'dnt_questionnaire') return 'DNT'
  if (workflowStepCode === 'application_fill') return 'APPLICATION'
  if (workflowStepCode.includes('bd')) return 'BD MEDICAL'
  return 'UNKNOWN'
}

/**
 * Load customer context section.
 * Formats basic customer info (profile facts live in the B0 provenance store).
 */
export async function loadCustomerContext(
  customerId: string,
): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  })

  if (!customer) return null

  const parts: string[] = []

  // Basic info
  if (customer.name) {
    parts.push(`Name: ${customer.name}`)
  }
  parts.push(`Language: ${customer.language}`)

  if (customer.dateOfBirth) {
    const age = calculateAge(customer.dateOfBirth, new Date())!
    parts.push(`Age: ${age}`)
  }

  if (customer.isAnonymous) {
    parts.push('Status: Anonymous visitor')
  }

  return parts.length > 0 ? parts.join('\n') : null
}

/** Shape of pre-fetched customer data (matches TurnContextCustomer) */
export interface PrefetchedCustomer {
  name: string | null
  dateOfBirth: Date | null
  language: string
  isAnonymous: boolean
}

/**
 * Load customer context section from pre-fetched data.
 * Same formatting logic as loadCustomerContext but takes data directly
 * instead of querying the DB.
 */
export function loadCustomerContextFromData(
  data: PrefetchedCustomer,
): string | null {
  const parts: string[] = []

  // Basic info
  if (data.name) {
    parts.push(`Name: ${data.name}`)
  }
  parts.push(`Language: ${data.language}`)

  if (data.dateOfBirth) {
    const age = calculateAge(data.dateOfBirth, new Date())!
    parts.push(`Age: ${age}`)
  }

  if (data.isAnonymous) {
    parts.push('Status: Anonymous visitor')
  }

  return parts.length > 0 ? parts.join('\n') : null
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_MEMORY_TOKENS = 500

/**
 * Raw `CustomerInsight` row type as returned by Prisma's findMany.
 * Exposed so callers (orchestrator debug path) can pre-fetch once.
 */
export type RawCustomerInsight = Awaited<
  ReturnType<typeof prisma.customerInsight.findMany>
>[number]

/**
 * Fetch the raw CustomerInsight rows for a customer, ordered by confidence
 * then recency. Exposed so the orchestrator's debug path can pre-fetch
 * once and then pass the array into both loadCustomerMemory (for prompt
 * text) and the debug:identity event (for the structured payload).
 */
export async function loadCustomerInsights(
  customerId: string,
): Promise<RawCustomerInsight[]> {
  return prisma.customerInsight.findMany({
    where: { customerId },
    orderBy: [
      { confidence: 'desc' },
      { lastConfirmedAt: 'desc' },
    ],
  })
}

/**
 * Load customer memory section.
 * Queries CustomerInsight table (or uses preloaded rows if provided) and
 * formats insights by category. Marks insights older than 30 days as
 * (unverified).
 */
export async function loadCustomerMemory(
  customerId: string,
  preloadedInsights?: RawCustomerInsight[],
): Promise<string | null> {
  const insights = preloadedInsights ?? (await loadCustomerInsights(customerId))

  if (insights.length === 0) return null

  const now = Date.now()
  const byCategory = new Map<string, string[]>()

  for (const insight of insights) {
    const isStale = now - insight.lastConfirmedAt.getTime() > STALE_THRESHOLD_MS
    const staleMark = isStale ? ' (unverified)' : ''
    const line = `- ${insight.key}: ${insight.value}${staleMark}`

    const existing = byCategory.get(insight.category) ?? []
    existing.push(line)
    byCategory.set(insight.category, existing)
  }

  const parts: string[] = []
  for (const [category, lines] of byCategory) {
    parts.push(`${category}:`)
    parts.push(...lines)
  }

  const text = parts.join('\n')

  const tokens = estimateTokens(text, 'en')
  if (tokens > MAX_MEMORY_TOKENS) {
    const truncated = parts.slice(0, Math.ceil(parts.length * (MAX_MEMORY_TOKENS / tokens)))
    return truncated.join('\n')
  }

  return text
}

const MAX_KNOWLEDGE_TOKENS = 400
const MIN_SAMPLE_SIZE = 5
const MAX_PATTERNS = 5

/**
 * Load agent knowledge section.
 * Queries AgentKnowledge for proven patterns with minimum evidence threshold.
 */
export async function loadAgentKnowledge(
  productId: string | null,
  workflowStepCode: string | null,
): Promise<string | null> {
  const knowledge = await prisma.agentKnowledge.findMany({
    where: {
      isActive: true,
      sampleSize: { gte: MIN_SAMPLE_SIZE },
      OR: [
        { productId: productId ?? undefined },
        { productId: null },
      ],
    },
    orderBy: { successRate: 'desc' },
    take: MAX_PATTERNS,
  })

  if (knowledge.length === 0) return null

  let filtered = knowledge
  if (workflowStepCode) {
    const stepSpecific = knowledge.filter(
      (k) => k.workflowStepCode === workflowStepCode || k.workflowStepCode === null,
    )
    if (stepSpecific.length > 0) filtered = stepSpecific
  }

  const lines = filtered.map((k) => {
    const rate = Math.round(k.successRate * 100)
    return `- [${k.trigger}] ${k.content} (success: ${rate}%, n=${k.sampleSize})`
  })

  return lines.join('\n')
}

// ==============================================
// PER-(PHASE,SUBPHASE) SECTIONS (A4.2 — pure renderers from DerivedStateV3)
// ==============================================

export function loadDntContext(state: DerivedStateV3): string | null {
  // Keyed on the ACTIVE session, not only APPLICATION/DNT: the engine legally
  // opens DNT sessions during DISCOVERY (pre-application), and the model needs
  // this surface there too (2026-07-06 debug report).
  const inDntSubphase = state.phase === 'APPLICATION' && state.subphase === 'DNT'
  if (!inDntSubphase && !state.dnt.sessionActive) return null
  return [
    ...(state.dnt.pendingCode ? [`Current question code: ${state.dnt.pendingCode} — pass this EXACT code to write_dnt_answer for the current answer. To correct an already-answered question use THAT question's own code (write-or-change).`] : []),
    `DNT progress: ${state.dnt.answeredCount}/${state.dnt.totalCount}`,
    `DNT signed: ${state.dnt.signed ? 'yes (valid until ' + state.dnt.validUntil + ')' : 'no'}`,
    `GDPR consent: ${state.consents.gdprProcessing ? 'granted' : 'missing'}`,
    `AI disclosure: ${state.consents.aiDisclosure ? 'acknowledged' : 'missing'}`,
    'The needs analysis (DNT) is a regulatory requirement: complete the remaining questions, then obtain explicit signature via sign_dnt. Consent is captured at signing — never claim consent that is not recorded in state.',
    'NEVER call write_dnt_answer with a value the customer did not explicitly state: if their reply does not answer the pending question (e.g. a bare "da" to a numeric or choice question), re-ask listing the options — do NOT pick a plausible value for them. This is a regulatory record they will sign.',
    // Salvaged questionnaire-facilitation guidance (A5.1 audit):
    'If the customer interrupts with a question or concern, answer it fully FIRST, then offer to resume — never force resumption.',
    'Medical/health questions: frame them before asking (needed for the insurance assessment, treated confidentially), keep a neutral non-judgmental tone, never comment on the answers.',
    // Task 2.2 (D1): the CARD collects, the agent narrates.
    'Active DNT and questionnaire questions render as UI CARDS with tappable option buttons — the card collects the answer. NEVER enumerate the options in prose (no "Opțiuni:" lists — the card already shows them); briefly frame the question in one warm sentence and invite the customer to tap an option on the card.',
    'If the customer TYPES an answer instead of tapping, map it to the EXACT option value from the tool result (e.g. "da, sunt sănătos" on a yes/no question → value "yes"; "lucrez la stat" on the occupation question → value "employee") and pass THAT value to write_dnt_answer — NEVER pass raw free text as the value of an option question.',
  ].join('\n')
}

export function loadPaymentContext(state: DerivedStateV3): string | null {
  if (state.phase !== 'PAYMENT') return null
  return [
    `Schedule: ${state.schedule.exists ? 'active' : 'none'}; next due: ${state.schedule.nextDueAt ?? 'n/a'}`,
    `Last payment status: ${state.schedule.lastPaymentStatus ?? 'none'}`,
    'The sale is closed — no selling, no upgrades. Focus on completing or recovering the payment. If a payment failed, state the failure factually and offer the retry action exposed by the engine.',
  ].join('\n')
}

export function loadPolicyContext(state: DerivedStateV3): string | null {
  if (state.phase !== 'POLICY' || !state.policy) return null
  return [
    `Policy status: ${state.policy.status}`,
    'Language is engine-gated: never describe the policy as active or in force unless status is ACTIVE. Between payment and activation say it is paid and being processed.',
    // Salvaged post-sale guidance (A5.1 audit):
    'The sale is closed — no upsell or cross-sell; the customer needs to feel secure, not pressured.',
    'Claims: lead with empathy and acknowledge the situation before any process talk. You may explain the general process and confirm policy status; you may NOT approve/assess a claim or promise payout amounts or timelines — say plainly that Allianz-Țiriac specialists decide those.',
    'Policy modifications and payment problems are handled by the human Allianz-Țiriac team — offer to route the customer there.',
  ].join('\n')
}

// ==============================================
// CONVENIENCE: LOAD ALL SECTIONS
// ==============================================

/**
 * Load all prompt sections at once.
 * Calls individual loaders in parallel where possible.
 */
export async function loadAllSections(params: {
  agentConfig: { systemPrompt: string | null; constraints: string | null }
  allowedTools: string[]
  productId: string | null
  conversationId: string
  customerId: string
  situationalBriefing: string | null
  language: 'en' | 'ro'
  prefetchedCustomer?: PrefetchedCustomer
  stateGroundingInput: StateGroundingInput
  preloadedInsights?: RawCustomerInsight[]
}): Promise<PromptSections> {
  const {
    agentConfig,
    allowedTools,
    productId,
    conversationId,
    customerId,
    situationalBriefing,
    language,
    prefetchedCustomer,
    stateGroundingInput,
    preloadedInsights,
  } = params

  // Synchronous loaders
  const agentIdentity = loadAgentIdentity(agentConfig.systemPrompt)
  const capabilityManifest = loadCapabilityManifest(allowedTools)
  const constraints = loadConstraints(agentConfig.constraints)
  const stateGrounding = loadStateGrounding(stateGroundingInput)

  // Async loaders — run in parallel
  const [
    catalogOverview,
    productContext,
    coachingBriefing,
    customerContext,
    customerMemory,
    agentKnowledge,
  ] = await Promise.all([
    loadCatalogOverview(language),
    productId ? loadProductContext(productId, language) : null,
    productId ? loadCoachingBriefing(productId) : null,
    prefetchedCustomer
      ? Promise.resolve(loadCustomerContextFromData(prefetchedCustomer))
      : loadCustomerContext(customerId),
    loadCustomerMemory(customerId, preloadedInsights),
    loadAgentKnowledge(productId, null),
  ])

  return {
    agentIdentity,
    capabilityManifest,
    constraints,
    stateGrounding,
    complianceGuidance: null, // injected by orchestrator when compliance checker runs
    situationalBriefing,
    customerMemory,
    agentKnowledge,
    customerContext,
    coachingBriefing,
    domainGuidance: null, // former pack-injection slot; the pack subsystem died in A5.2
    productContext,
    catalogOverview,
    // Rendered from the derived state after the gate resolves (A4.2) — the
    // orchestrator patches these alongside situationalBriefing.
    // questionnaireContext joined them at Task 1.2 (D2): its step code comes
    // from the derived (phase, subphase), which does not exist yet here.
    questionnaireContext: null,
    dntContext: null,
    paymentContext: null,
    policyContext: null,
  }
}
