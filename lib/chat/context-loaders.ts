/**
 * Context Loaders — Section Content Loaders for All 10 Prompt Sections
 *
 * Each loader fetches data from the DB and formats it into a prompt-ready string.
 * Loaders return string | null (null means the section will be skipped).
 *
 * Three layers:
 * - CONSTITUTION: loadAgentIdentity, loadCapabilityManifest, loadConstraints
 * - REASONING:    situationalBriefing (passed through from gate output)
 * - DYNAMIC:      loadProductContext, loadCoachingBriefing, loadWorkflowInstructions,
 *                 loadQuestionnaireContext, loadCustomerContext, loadCustomerMemory,
 *                 loadAgentKnowledge
 */

import { prisma } from '@/lib/db'
import { getToolDefinition } from '@/lib/tools/registry'
import { estimateTokens } from '@/lib/chat/token-budget'
import { LRUCache } from '@/lib/cache/lru-cache'
import { findContextHit, type ContextHit } from '@/lib/insights/context-hits'
import { logInfo } from '@/lib/errors/logger'
import type { PromptSections } from './prompt-builder'

// ==============================================
// CACHES
// ==============================================

const productContextCache = new LRUCache<string, string | null>(5, 10 * 60 * 1000) // 10 min
const coachingBriefingCache = new LRUCache<string, string | null>(5, 10 * 60 * 1000)

// ==============================================
// TYPES
// ==============================================

/** Shape of workflow session data passed in from orchestrator */
export interface WorkflowSessionData {
  currentStepCode: string
  currentStepName: string
  agentInstructions: string | null
  allowedTools: string[]
  data: unknown
}

/** Shape for Json fields with en/ro keys */
interface LocalizedText {
  en: string
  ro: string
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
  workflowSession: {
    currentStep: { code: string; name: string }
    status: string
  } | null
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

  if (input.workflowSession) {
    const s = input.workflowSession
    lines.push(`✓ Active workflow: ${s.currentStep.code} (${s.currentStep.name})`)
  } else {
    lines.push('✗ No workflow is active')
  }

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
 * Load product context section.
 * Fetches product with pricing tiers, levels, and addons.
 */
export async function loadProductContext(
  productId: string,
  language: 'en' | 'ro',
): Promise<string | null> {
  const cacheKey = `${productId}:${language}`
  const cached = productContextCache.get(cacheKey)
  if (cached !== undefined) return cached

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
    productContextCache.set(cacheKey, null)
    return null
  }

  const name = (product.name as unknown as LocalizedText)[language]
  const description = (product.description as unknown as LocalizedText)[language]

  const parts: string[] = []
  parts.push(`Product: ${name}`)
  parts.push(`Type: ${product.insuranceType} / ${product.subType}`)
  parts.push(`Description: ${description}`)

  // Key features
  if (product.features.length > 0) {
    parts.push('')
    parts.push('Key Features:')
    for (const feature of product.features) {
      parts.push(`- ${feature}`)
    }
  }

  // Pricing tiers and levels
  if (product.pricingTiers.length > 0) {
    parts.push('')
    parts.push('Pricing:')
    for (const tier of product.pricingTiers) {
      const tierName = (tier.name as unknown as LocalizedText)[language]
      const levelParts = tier.levels.map((level) => {
        const levelName = (level.name as unknown as LocalizedText)[language]
        return `${levelName} = ${level.premiumAnnual} RON/year`
      })
      parts.push(`${tierName}: ${levelParts.join(', ')}`)
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

    // Age-based pricing rules
    if (addon.pricingRules.length > 0) {
      const ageParts = addon.pricingRules.map(
        (rule) =>
          `${rule.minAge}-${rule.maxAge} = ${rule.premiumAnnual} RON/year`,
      )
      parts.push(`- Age-based pricing: ${ageParts.join(', ')}`)
    }

    if (addon.waitingPeriod) {
      parts.push(`- Waiting period: ${addon.waitingPeriod}`)
    }
  }

  const result = parts.join('\n')
  productContextCache.set(cacheKey, result)
  return result
}

/**
 * Load coaching briefing section.
 * Returns the product's default sales playbook.
 */
export async function loadCoachingBriefing(
  productId: string,
): Promise<string | null> {
  const cached = coachingBriefingCache.get(productId)
  if (cached !== undefined) return cached

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { defaultPlaybook: true },
  })

  const result = product?.defaultPlaybook ?? null
  coachingBriefingCache.set(productId, result)
  return result
}

/**
 * Load workflow instructions section.
 * Formats current step, agent instructions, and available tools.
 */
export function loadWorkflowInstructions(
  workflowSession: WorkflowSessionData | null,
): string | null {
  if (!workflowSession) return null

  const parts: string[] = []
  parts.push(
    `Workflow step: ${workflowSession.currentStepName} (${workflowSession.currentStepCode})`,
  )

  if (workflowSession.agentInstructions) {
    parts.push('')
    parts.push('YOUR INSTRUCTIONS FOR THIS STEP:')
    parts.push(workflowSession.agentInstructions)
  }

  if (workflowSession.allowedTools.length > 0) {
    parts.push('')
    parts.push('TOOLS YOU CAN USE NOW:')
    for (const tool of workflowSession.allowedTools) {
      parts.push(`- ${tool}`)
    }
  }

  // Include collected data if available
  if (workflowSession.data) {
    const data = workflowSession.data as unknown as Record<string, unknown>
    const entries = Object.entries(data).filter(
      ([, v]) => v != null && v !== '',
    )
    if (entries.length > 0) {
      parts.push('')
      parts.push('DATA COLLECTED SO FAR:')
      for (const [key, value] of entries) {
        parts.push(`- ${key}: ${String(value)}`)
      }
    }
  }

  return parts.join('\n')
}

/**
 * Load questionnaire context section.
 * Determines active questionnaire from workflowStepCode and finds current question.
 */
export async function loadQuestionnaireContext(
  conversationId: string,
  customerId: string,
  workflowStepCode: string | null,
  language: 'en' | 'ro',
): Promise<string | null> {
  if (!workflowStepCode) return null

  const groupCodes = resolveQuestionGroupCodes(workflowStepCode)
  if (groupCodes.length === 0) return null

  const questionnaireType = resolveQuestionnaireType(workflowStepCode)

  const questions = await prisma.question.findMany({
    where: { group: { code: { in: groupCodes } } },
    include: { group: true },
    orderBy: [
      { group: { orderIndex: 'asc' } },
      { orderIndex: 'asc' },
    ],
  })

  if (questions.length === 0) return null

  const questionIds = questions.map((q) => q.id)
  const answers = await prisma.answer.findMany({
    where: { conversationId, questionId: { in: questionIds } },
  })

  const answeredIds = new Set(answers.map((a) => a.questionId))
  const currentQuestion = questions.find((q) => !answeredIds.has(q.id))
  const answeredCount = answeredIds.size
  const totalCount = questions.length

  const parts: string[] = []
  parts.push(`[ACTIVE QUESTIONNAIRE - ${questionnaireType}]`)
  parts.push(`Progress: ${answeredCount}/${totalCount}`)

  if (!currentQuestion) {
    parts.push('')
    parts.push('All questions answered. Questionnaire complete.')
    return parts.join('\n')
  }

  const questionText = (currentQuestion.text as unknown as LocalizedText)[language]
  parts.push('')
  parts.push(`Current question (${currentQuestion.group.code}):`)
  parts.push(questionText)
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
      group: { code: currentQuestion.group.code },
    },
    conversationId,
  )

  if (hit) {
    parts.push('')
    parts.push(renderContextHitBlock(hit, currentQuestion.group.code))

    if (currentQuestion.group.code === 'bd_medical' && hit.category === 'RISK_FACTOR') {
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

/**
 * Resolve question group codes from workflow step code.
 */
function resolveQuestionGroupCodes(workflowStepCode: string): string[] {
  if (workflowStepCode === 'dnt_questionnaire') {
    return [
      'dnt_consent',
      'dnt_general',
      'dnt_life_type',
      'dnt_life_financial',
      'dnt_life_investment',
      'dnt_sustainability',
    ]
  }

  if (workflowStepCode === 'application_fill') {
    return ['application']
  }

  if (workflowStepCode.includes('bd')) {
    return ['bd_medical']
  }

  return []
}

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
 * Formats basic customer info and extracted profile data.
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
    const age = calculateAge(customer.dateOfBirth)
    parts.push(`Age: ${age}`)
  }

  if (customer.isAnonymous) {
    parts.push('Status: Anonymous visitor')
  }

  // Extracted profile (from profile-extractor agent)
  if (customer.extractedProfile) {
    const profile = customer.extractedProfile as unknown as Record<
      string,
      unknown
    >

    // Demographics
    if (profile.occupation && typeof profile.occupation === 'string') {
      parts.push(`Occupation: ${profile.occupation}`)
    }
    if (profile.incomeLevel && typeof profile.incomeLevel === 'string') {
      parts.push(`Income level: ${profile.incomeLevel}`)
    }
    if (profile.education && typeof profile.education === 'string') {
      parts.push(`Education: ${profile.education}`)
    }

    // Family
    if (profile.familySize != null) {
      parts.push(`Family size: ${String(profile.familySize)}`)
    }
    if (profile.hasSpouse != null) {
      parts.push(`Has spouse: ${String(profile.hasSpouse)}`)
    }
    if (profile.hasChildren != null) {
      parts.push(`Has children: ${String(profile.hasChildren)}`)
    }
    if (profile.minorChildren != null) {
      parts.push(`Minor children: ${String(profile.minorChildren)}`)
    }

    // Motivations and interests
    if (Array.isArray(profile.motivations) && profile.motivations.length > 0) {
      parts.push(
        `Motivations: ${(profile.motivations as string[]).join(', ')}`,
      )
    }
    if (Array.isArray(profile.interests) && profile.interests.length > 0) {
      parts.push(`Interests: ${(profile.interests as string[]).join(', ')}`)
    }
  }

  return parts.length > 0 ? parts.join('\n') : null
}

/** Shape of pre-fetched customer data (matches TurnContextCustomer) */
export interface PrefetchedCustomer {
  name: string | null
  dateOfBirth: Date | null
  extractedProfile: Record<string, unknown>
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
    const age = calculateAge(data.dateOfBirth)
    parts.push(`Age: ${age}`)
  }

  if (data.isAnonymous) {
    parts.push('Status: Anonymous visitor')
  }

  // Extracted profile
  const profile = data.extractedProfile

  // Demographics
  if (profile.occupation && typeof profile.occupation === 'string') {
    parts.push(`Occupation: ${profile.occupation}`)
  }
  if (profile.incomeLevel && typeof profile.incomeLevel === 'string') {
    parts.push(`Income level: ${profile.incomeLevel}`)
  }
  if (profile.education && typeof profile.education === 'string') {
    parts.push(`Education: ${profile.education}`)
  }

  // Family
  if (profile.familySize != null) {
    parts.push(`Family size: ${String(profile.familySize)}`)
  }
  if (profile.hasSpouse != null) {
    parts.push(`Has spouse: ${String(profile.hasSpouse)}`)
  }
  if (profile.hasChildren != null) {
    parts.push(`Has children: ${String(profile.hasChildren)}`)
  }
  if (profile.minorChildren != null) {
    parts.push(`Minor children: ${String(profile.minorChildren)}`)
  }

  // Motivations and interests
  if (Array.isArray(profile.motivations) && profile.motivations.length > 0) {
    parts.push(
      `Motivations: ${(profile.motivations as string[]).join(', ')}`,
    )
  }
  if (Array.isArray(profile.interests) && profile.interests.length > 0) {
    parts.push(`Interests: ${(profile.interests as string[]).join(', ')}`)
  }

  return parts.length > 0 ? parts.join('\n') : null
}

/**
 * Calculate age from date of birth.
 */
function calculateAge(dateOfBirth: Date): number {
  const today = new Date()
  let age = today.getFullYear() - dateOfBirth.getFullYear()
  const monthDiff = today.getMonth() - dateOfBirth.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < dateOfBirth.getDate())
  ) {
    age--
  }
  return age
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_MEMORY_TOKENS = 500

/**
 * Load customer memory section.
 * Queries CustomerInsight table and formats insights by category.
 * Marks insights older than 30 days as (unverified).
 */
export async function loadCustomerMemory(
  customerId: string,
): Promise<string | null> {
  const insights = await prisma.customerInsight.findMany({
    where: { customerId },
    orderBy: [
      { confidence: 'desc' },
      { lastConfirmedAt: 'desc' },
    ],
  })

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
  workflowSession: WorkflowSessionData | null
  workflowStepCode: string | null
  situationalBriefing: string | null
  language: 'en' | 'ro'
  prefetchedCustomer?: PrefetchedCustomer
  stateGroundingInput: StateGroundingInput
}): Promise<PromptSections> {
  const {
    agentConfig,
    allowedTools,
    productId,
    conversationId,
    customerId,
    workflowSession,
    workflowStepCode,
    situationalBriefing,
    language,
    prefetchedCustomer,
    stateGroundingInput,
  } = params

  // Synchronous loaders
  const agentIdentity = loadAgentIdentity(agentConfig.systemPrompt)
  const capabilityManifest = loadCapabilityManifest(allowedTools)
  const constraints = loadConstraints(agentConfig.constraints)
  const workflowInstructions = loadWorkflowInstructions(workflowSession)
  const stateGrounding = loadStateGrounding(stateGroundingInput)

  // Async loaders — run in parallel
  const [
    productContext,
    coachingBriefing,
    questionnaireContext,
    customerContext,
    customerMemory,
    agentKnowledge,
  ] = await Promise.all([
    productId ? loadProductContext(productId, language) : null,
    productId ? loadCoachingBriefing(productId) : null,
    loadQuestionnaireContext(conversationId, customerId, workflowStepCode, language),
    prefetchedCustomer
      ? Promise.resolve(loadCustomerContextFromData(prefetchedCustomer))
      : loadCustomerContext(customerId),
    loadCustomerMemory(customerId),
    loadAgentKnowledge(productId, workflowStepCode),
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
    workflowInstructions,
    questionnaireContext,
    productContext,
  }
}
