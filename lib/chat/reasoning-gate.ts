/**
 * Reasoning Gate — Situational Analysis Engine
 *
 * Fires on every customer message before the main LLM call.
 * Produces a structured situational analysis that tells the main agent
 * what to PRIORITIZE and what to AVOID this turn.
 *
 * Exports:
 * - executeReasoningGate(input) — full gate execution with fallback
 * - formatGateBriefing(output) — format output into situationalBriefing section
 * - buildGateContextMessage(input) — format input into compact context string
 * - Types: ReasoningGateInput, ReasoningGateOutput
 */

import { gateway } from '@/lib/llm/gateway'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// TYPES
// ==============================================

export interface ReasoningGateInput {
  lastUserMessage: string
  last3Messages: { role: string; content: string }[]
  hasActiveQuestionnaire: boolean
  currentQuestionText: string | null
  workflowStepCode: string | null
  availableTools: string[]
  customerProfile: {
    name: string | null
    age: number | null
    family: string | null
    occupation: string | null
    isReturningCustomer: boolean
  }
  businessState: {
    selectedProduct: string | null
    dntProgress: string | null
    applicationProgress: string | null
    hasQuote: boolean
    quoteValue: number | null
    hasPolicy: boolean
  }
  // Agent Extensibility fields (sub-project #4)
  currentMode?: string
  availableSkillPacks?: { slug: string; description: string }[]
  activeSkillPacks?: string[]
}

export interface ReasoningGateOutput {
  situationType: string
  complexity: 'simple' | 'moderate' | 'complex'
  confidence: number
  contradictions?: { tension: string; resolution: string; winner: string }[]
  concernActions?: {
    concern: string
    gateAssessment: string
    action: string
    reason: string
  }[]
  requiredSections: string[]
  excludedSections: string[]
  briefing: string
  toolGuidance: { prioritize: string[]; discourage: string[] }
  knowledgeGaps?: string[]
  // New fields for Agent Extensibility (sub-project #4)
  recommendedSkillPacks: string[]
  modeTransition?: string
  complianceRelevant: boolean
}

// ==============================================
// CONSTANTS
// ==============================================

const VALID_COMPLEXITIES = new Set(['simple', 'moderate', 'complex'])

const FALLBACK_OUTPUT: ReasoningGateOutput = {
  situationType: 'unknown',
  complexity: 'moderate',
  confidence: 0,
  requiredSections: [],
  excludedSections: [],
  briefing: '',
  toolGuidance: { prioritize: [], discourage: [] },
  recommendedSkillPacks: [],
  complianceRelevant: false,
}

// ==============================================
// CONTEXT MESSAGE BUILDER
// ==============================================

/**
 * Build a compact context string (~500-800 tokens) from gate input fields.
 */
export function buildGateContextMessage(input: ReasoningGateInput): string {
  const parts: string[] = []

  // Recent conversation
  if (input.last3Messages.length > 0) {
    parts.push('RECENT CONVERSATION:')
    for (const msg of input.last3Messages) {
      const role = msg.role === 'user' ? 'Customer' : 'Agent'
      parts.push(`${role}: ${msg.content}`)
    }
  }

  // Workflow step
  parts.push(
    `\nACTIVE WORKFLOW STEP: ${input.workflowStepCode ?? 'none'}`,
  )

  // Questionnaire
  parts.push(
    `QUESTIONNAIRE ACTIVE: ${input.hasActiveQuestionnaire ? 'Yes' : 'No'}`,
  )
  if (input.currentQuestionText) {
    parts.push(`CURRENT QUESTION: ${input.currentQuestionText}`)
  }

  // Available tools
  parts.push(
    `AVAILABLE TOOLS: ${input.availableTools.length > 0 ? input.availableTools.join(', ') : 'none'}`,
  )

  // Customer profile
  const cp = input.customerProfile
  const profileParts: string[] = []
  if (cp.name) profileParts.push(cp.name)
  if (cp.age != null) profileParts.push(`age ${cp.age}`)
  if (cp.occupation) profileParts.push(cp.occupation)
  if (cp.family) profileParts.push(cp.family)
  if (cp.isReturningCustomer) profileParts.push('(returning customer)')
  parts.push(
    `CUSTOMER: ${profileParts.length > 0 ? profileParts.join(', ') : 'unknown'}`,
  )

  // Business state
  const bs = input.businessState
  const stateParts: string[] = []
  if (bs.selectedProduct) stateParts.push(`Product: ${bs.selectedProduct}`)
  if (bs.dntProgress) stateParts.push(`DNT: ${bs.dntProgress}`)
  if (bs.applicationProgress)
    stateParts.push(`Application: ${bs.applicationProgress}`)
  if (bs.hasQuote)
    stateParts.push(
      `Quote: ${bs.quoteValue != null ? `${bs.quoteValue} RON` : 'yes'}`,
    )
  if (bs.hasPolicy) stateParts.push('Policy: issued')
  parts.push(
    `BUSINESS STATE: ${stateParts.length > 0 ? stateParts.join(' | ') : 'none'}`,
  )

  // Conversation mode and skill packs (Agent Extensibility sub-project #4)
  if (input.currentMode) {
    parts.push(`\n[Conversation Mode] ${input.currentMode}`)
  }

  if (input.activeSkillPacks && input.activeSkillPacks.length > 0) {
    parts.push(`[Active Skill Packs] ${input.activeSkillPacks.join(', ')}`)
  }

  if (input.availableSkillPacks && input.availableSkillPacks.length > 0) {
    parts.push(
      `[Available Skill Packs]\n${input.availableSkillPacks
        .map((p) => `- ${p.slug}: ${p.description}`)
        .join('\n')}`,
    )
  }

  // Current message (last for recency)
  parts.push(`\nCURRENT CUSTOMER MESSAGE: ${input.lastUserMessage}`)

  return parts.join('\n')
}

// ==============================================
// RESPONSE PARSING
// ==============================================

/**
 * Parse gate LLM response into a validated ReasoningGateOutput.
 * Handles markdown code fences, validates enums, clamps confidence.
 */
function parseGateResponse(content: string): ReasoningGateOutput {
  // Strip markdown code fences if present
  let jsonStr = content
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim()
  }

  // Extract JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { ...FALLBACK_OUTPUT }
  }

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

  // Validate complexity
  const complexity = VALID_COMPLEXITIES.has(parsed.complexity as string)
    ? (parsed.complexity as 'simple' | 'moderate' | 'complex')
    : null
  if (!complexity) {
    return { ...FALLBACK_OUTPUT }
  }

  // Clamp confidence to [0, 1]
  const rawConfidence =
    typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  const confidence = Math.max(0, Math.min(1, rawConfidence))

  // Parse arrays safely
  const requiredSections = Array.isArray(parsed.requiredSections)
    ? (parsed.requiredSections as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : []

  const excludedSections = Array.isArray(parsed.excludedSections)
    ? (parsed.excludedSections as unknown[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : []

  // Parse contradictions (optional)
  const contradictions = Array.isArray(parsed.contradictions)
    ? (parsed.contradictions as Record<string, unknown>[])
        .filter(
          (c) =>
            c &&
            typeof c.tension === 'string' &&
            typeof c.resolution === 'string',
        )
        .map((c) => ({
          tension: c.tension as string,
          resolution: c.resolution as string,
          winner: typeof c.winner === 'string' ? c.winner : 'unknown',
        }))
    : undefined

  // Parse concern actions (optional)
  const concernActions = Array.isArray(parsed.concernActions)
    ? (parsed.concernActions as Record<string, unknown>[])
        .filter((c) => c && typeof c.concern === 'string')
        .map((c) => ({
          concern: c.concern as string,
          gateAssessment:
            typeof c.gateAssessment === 'string'
              ? c.gateAssessment
              : 'genuinely_open',
          action: typeof c.action === 'string' ? c.action : 'monitor',
          reason: typeof c.reason === 'string' ? c.reason : '',
        }))
    : undefined

  // Parse tool guidance
  const tg = parsed.toolGuidance as
    | Record<string, unknown>
    | undefined
    | null
  const toolGuidance = {
    prioritize: Array.isArray(tg?.prioritize)
      ? (tg.prioritize as unknown[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : [],
    discourage: Array.isArray(tg?.discourage)
      ? (tg.discourage as unknown[]).filter(
          (t): t is string => typeof t === 'string',
        )
      : [],
  }

  // Parse knowledge gaps (optional)
  const knowledgeGaps = Array.isArray(parsed.knowledgeGaps)
    ? (parsed.knowledgeGaps as unknown[]).filter(
        (g): g is string => typeof g === 'string',
      )
    : undefined

  // Parse recommended skill packs
  const recommendedSkillPacks = Array.isArray(parsed.recommendedSkillPacks)
    ? parsed.recommendedSkillPacks.filter((s: unknown) => typeof s === 'string')
    : []

  // Parse mode transition (optional)
  const modeTransition =
    typeof parsed.modeTransition === 'string'
      ? parsed.modeTransition
      : undefined

  // Parse compliance relevant flag
  const complianceRelevant = parsed.complianceRelevant === true

  return {
    situationType:
      typeof parsed.situationType === 'string'
        ? parsed.situationType
        : 'unknown',
    complexity,
    confidence,
    contradictions:
      contradictions && contradictions.length > 0 ? contradictions : undefined,
    concernActions:
      concernActions && concernActions.length > 0 ? concernActions : undefined,
    requiredSections,
    excludedSections,
    briefing: typeof parsed.briefing === 'string' ? parsed.briefing : '',
    toolGuidance,
    knowledgeGaps:
      knowledgeGaps && knowledgeGaps.length > 0 ? knowledgeGaps : undefined,
    recommendedSkillPacks,
    modeTransition,
    complianceRelevant,
  }
}

// ==============================================
// EXECUTE REASONING GATE
// ==============================================

/**
 * Execute the reasoning gate analysis.
 * Returns a structured output or a safe fallback on any failure — never throws.
 */
export async function executeReasoningGate(
  input: ReasoningGateInput,
): Promise<ReasoningGateOutput> {
  try {
    const contextMessage = buildGateContextMessage(input)

    const response = await gateway.call('reasoning-gate', {
      messages: [{ role: 'user', content: contextMessage }],
    })

    if (!response.content) {
      return { ...FALLBACK_OUTPUT }
    }

    return parseGateResponse(response.content)
  } catch (err: unknown) {
    logWarn({
      layer: 'orchestrator',
      category: 'reasoning_gate',
      message: 'Reasoning gate failed, using fallback',
      error: err,
    })
    return { ...FALLBACK_OUTPUT }
  }
}

// ==============================================
// BRIEFING FORMATTER
// ==============================================

/**
 * Format the gate output into the situationalBriefing prompt section string.
 */
export function formatGateBriefing(output: ReasoningGateOutput): string {
  const parts: string[] = []

  parts.push(`=== SITUATIONAL ANALYSIS (${output.complexity}) ===`)
  parts.push(output.briefing)

  // Contradiction resolutions
  if (output.contradictions && output.contradictions.length > 0) {
    parts.push('')
    parts.push('RESOLVED CONTRADICTIONS:')
    for (const c of output.contradictions) {
      parts.push(
        `- ${c.tension} -> ${c.resolution} (deferred to: ${c.winner})`,
      )
    }
  }

  // Concern lifecycle judgments
  if (output.concernActions && output.concernActions.length > 0) {
    const actionable = output.concernActions.filter(
      (c) => c.action === 'address_now',
    )
    const monitoring = output.concernActions.filter(
      (c) => c.action === 'monitor',
    )

    if (actionable.length > 0) {
      parts.push('')
      parts.push('CONCERNS TO ADDRESS NOW:')
      for (const c of actionable) {
        parts.push(`- ${c.concern} (${c.gateAssessment}): ${c.reason}`)
      }
    }

    if (monitoring.length > 0) {
      parts.push(
        `Monitoring: ${monitoring.map((c) => c.concern).join(', ')}`,
      )
    }
  }

  // Tool guidance
  if (
    output.toolGuidance.prioritize.length > 0 ||
    output.toolGuidance.discourage.length > 0
  ) {
    const prioritize =
      output.toolGuidance.prioritize.length > 0
        ? output.toolGuidance.prioritize.join(', ')
        : 'none specified'
    const discourage =
      output.toolGuidance.discourage.length > 0
        ? output.toolGuidance.discourage.join(', ')
        : 'none'
    parts.push('')
    parts.push(
      `Tool guidance: Prioritize: ${prioritize}. Discourage: ${discourage}.`,
    )
  }

  return parts.join('\n')
}
