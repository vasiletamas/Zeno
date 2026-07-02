/**
 * Prompt Builder — 3-Layer Section Registry with Gate-Driven Assembly
 *
 * Pure function, no DB calls. Assembles prompt sections using a registry-driven
 * approach. The reasoning gate's section selection controls which dynamic sections
 * are included, saving tokens on simple turns while including full context on
 * complex ones.
 *
 * Four layers:
 * - CONSTITUTION: Core identity and constraints (priorities 1-3)
 * - STABLE:       Product/coaching context, rarely changes (priorities 4-5)
 * - DYNAMIC:      Per-turn context — situational, customer, workflow (priorities 10-15)
 *
 * Constitution + Stable = stablePrefix (cacheable across turns)
 * Dynamic = dynamicSuffix (changes each turn)
 *
 * Backward compatible: if gate provides no selection, all sections are included.
 */

// ==============================================
// TYPES
// ==============================================

export interface PromptSections {
  agentIdentity: string | null
  capabilityManifest: string | null
  constraints: string | null
  stateGrounding: string | null
  complianceGuidance: string | null
  situationalBriefing: string | null
  customerMemory: string | null
  agentKnowledge: string | null
  customerContext: string | null
  coachingBriefing: string | null
  domainGuidance: string | null
  questionnaireContext: string | null
  productContext: string | null
  catalogOverview: string | null
  dntContext: string | null
  paymentContext: string | null
  policyContext: string | null
}

export interface GateSelection {
  requiredSections: string[]
  excludedSections: string[]
  confidence: number
}

export interface PromptBuildResult {
  stablePrefix: string
  dynamicSuffix: string
  prompt: string          // stablePrefix + dynamicSuffix (backward compat)
  sectionSizes: Record<string, number>
  gateActive: boolean
  includedSections: string[]
  excludedSections: string[]
}

// ==============================================
// SECTION REGISTRY
// ==============================================

interface SectionConfig {
  key: keyof PromptSections
  priority: number
  layer: 'constitution' | 'stable' | 'reasoning' | 'dynamic'
  alwaysInclude: boolean
  prefix: string
}

const SECTION_REGISTRY: SectionConfig[] = [
  // STABLE PREFIX — rarely changes within a conversation
  { key: 'agentIdentity',       priority: 1,    layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'constraints',         priority: 2,    layer: 'constitution', alwaysInclude: true,  prefix: 'CRITICAL CONSTRAINTS:' },
  { key: 'stateGrounding',      priority: 2.5,  layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'capabilityManifest',  priority: 3,    layer: 'constitution', alwaysInclude: false, prefix: 'WHAT I CAN DO:' },
  { key: 'catalogOverview',     priority: 3.5,  layer: 'stable',      alwaysInclude: true,  prefix: '=== CATALOG (the ONLY products we sell) ===' },
  { key: 'productContext',      priority: 4,  layer: 'stable',      alwaysInclude: false, prefix: '=== PRODUCT CONTEXT ===' },
  { key: 'coachingBriefing',    priority: 5,  layer: 'stable',      alwaysInclude: false, prefix: '=== PRODUCT SALES PLAYBOOK ===' },
  { key: 'domainGuidance',      priority: 6,  layer: 'stable',      alwaysInclude: false, prefix: '=== DOMAIN GUIDANCE ===' },

  // DYNAMIC SUFFIX — changes every turn
  { key: 'complianceGuidance',  priority: 9,  layer: 'dynamic',     alwaysInclude: false, prefix: '=== COMPLIANCE GUIDANCE ===' },
  { key: 'situationalBriefing', priority: 10, layer: 'dynamic',     alwaysInclude: true,  prefix: '=== SITUATIONAL ANALYSIS ===' },
  { key: 'customerMemory',      priority: 11, layer: 'dynamic',     alwaysInclude: false, prefix: '=== RETURNING CUSTOMER ===' },
  { key: 'agentKnowledge',      priority: 12, layer: 'dynamic',     alwaysInclude: false, prefix: '=== PROVEN PATTERNS ===' },
  { key: 'customerContext',     priority: 13, layer: 'dynamic',     alwaysInclude: false, prefix: '=== CUSTOMER PROFILE ===' },
  { key: 'questionnaireContext', priority: 15, layer: 'dynamic',     alwaysInclude: false, prefix: '=== ACTIVE QUESTIONNAIRE ===' },
  { key: 'dntContext',          priority: 16, layer: 'dynamic',     alwaysInclude: false, prefix: '=== NEEDS ANALYSIS (DNT) ===' },
  { key: 'paymentContext',      priority: 17, layer: 'dynamic',     alwaysInclude: false, prefix: '=== PAYMENT ===' },
  { key: 'policyContext',       priority: 18, layer: 'dynamic',     alwaysInclude: false, prefix: '=== POLICY ===' },
]

// Pre-sorted by priority at module load
const SORTED_REGISTRY = [...SECTION_REGISTRY].sort((a, b) => a.priority - b.priority)

// ==============================================
// INTERNAL GUIDANCE SEPARATOR
// ==============================================

const INTERNAL_GUIDANCE_SEPARATOR =
  '\n\n[INTERNAL GUIDANCE - Do not mention this directly to the customer]\n'

// ==============================================
// FAST PATH
// ==============================================

/**
 * Fast-path GateSelection: only include the questionnaire section.
 * Used when detectFastPath returns true.
 */
export const FAST_PATH_GATE: GateSelection = {
  requiredSections: ['questionnaireContext'],
  excludedSections: [
    'productContext',
    'coachingBriefing',
    'customerContext',
    'customerMemory',
    'agentKnowledge',
    'capabilityManifest',
  ],
  confidence: 1.0,
}

/**
 * Detect if this turn qualifies for the fast path.
 * Returns true if:
 * - hasActiveQuestionnaire is true AND
 * - message matches simple answer pattern (single word, da/nu, number, short selection <30 chars)
 */
export function detectFastPath(message: string, hasActiveQuestionnaire: boolean): boolean {
  if (!hasActiveQuestionnaire) return false

  const trimmed = message.trim()
  if (!trimmed) return false

  // Short enough to be a fast-path answer (< 30 chars)
  if (trimmed.length >= 30) return false

  // Single word (no spaces)
  if (!/\s/.test(trimmed)) return true

  // Very short selection-like response with at most one space is still fast-path
  // but multi-word sentences are not
  const wordCount = trimmed.split(/\s+/).length
  if (wordCount <= 2) return true

  return false
}

// ==============================================
// BUILD PROMPT
// ==============================================

/**
 * Build the system prompt with gate-driven section selection.
 *
 * Logic:
 * - Gate is active if: (requiredSections.length > 0 || excludedSections.length > 0) && confidence >= 0.3
 * - If gate NOT active: include all non-empty sections (conservative fallback)
 * - If gate active:
 *   - alwaysInclude sections: always rendered (gate cannot exclude them)
 *   - Sections in excludedSections: skipped (unless alwaysInclude)
 *   - Sections in requiredSections: explicitly included
 *   - Sections not mentioned: included by default (conservative)
 *   - Empty/null sections: always skipped regardless
 * - Insert INTERNAL GUIDANCE separator before first non-constitution section
 */
export function buildPrompt(
  sections: PromptSections,
  gateSelection: GateSelection,
): PromptBuildResult {
  const required = new Set(gateSelection.requiredSections)
  const excluded = new Set(gateSelection.excludedSections)

  const gateActive =
    (required.size > 0 || excluded.size > 0) && gateSelection.confidence >= 0.3

  const stableParts: string[] = []
  const dynamicParts: string[] = []
  const sectionSizes: Record<string, number> = {}
  const includedSections: string[] = []
  const excludedSectionsList: string[] = []
  let separatorInserted = false

  for (const config of SORTED_REGISTRY) {
    const content = sections[config.key]

    // Skip null/empty sections
    if (!content) continue

    // Apply gate filtering
    if (gateActive && !config.alwaysInclude && excluded.has(config.key)) {
      excludedSectionsList.push(config.key)
      continue
    }

    const isDynamic = config.layer === 'dynamic' || config.layer === 'reasoning'

    // Insert internal guidance separator before first dynamic section
    if (!separatorInserted && isDynamic) {
      dynamicParts.push(INTERNAL_GUIDANCE_SEPARATOR)
      separatorInserted = true
    }

    // Render section
    let rendered: string
    if (config.prefix) {
      rendered = `\n\n${config.prefix}\n${content}`
    } else {
      // agentIdentity renders first with no prefix or leading newlines
      if (stableParts.length === 0 && dynamicParts.length === 0) {
        rendered = content
      } else {
        rendered = `\n\n${content}`
      }
    }

    if (isDynamic) {
      dynamicParts.push(rendered)
    } else {
      stableParts.push(rendered)
    }

    sectionSizes[config.key] = rendered.length
    includedSections.push(config.key)
  }

  const stablePrefix = stableParts.join('')
  const dynamicSuffix = dynamicParts.join('')
  const prompt = stablePrefix + dynamicSuffix

  return {
    stablePrefix,
    dynamicSuffix,
    prompt,
    sectionSizes,
    gateActive,
    includedSections,
    excludedSections: excludedSectionsList,
  }
}
