/**
 * Prompt Builder — 3-Layer Section Registry with Gate-Driven Assembly
 *
 * Pure function, no DB calls. Assembles prompt sections using a registry-driven
 * approach. The reasoning gate's section selection controls which dynamic sections
 * are included, saving tokens on simple turns while including full context on
 * complex ones.
 *
 * Three layers:
 * - CONSTITUTION: Core identity and constraints (priorities 1-5)
 * - REASONING:    Gate situational analysis (priority 10)
 * - DYNAMIC:      Gate-selected context sections (priorities 20-26)
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
  situationalBriefing: string | null
  customerMemory: string | null
  agentKnowledge: string | null
  customerContext: string | null
  coachingBriefing: string | null
  workflowInstructions: string | null
  questionnaireContext: string | null
  productContext: string | null
}

export interface GateSelection {
  requiredSections: string[]
  excludedSections: string[]
  confidence: number
}

export interface PromptBuildResult {
  prompt: string
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
  layer: 'constitution' | 'reasoning' | 'dynamic'
  alwaysInclude: boolean
  prefix: string
}

const SECTION_REGISTRY: SectionConfig[] = [
  // CONSTITUTION LAYER
  { key: 'agentIdentity',       priority: 1,  layer: 'constitution', alwaysInclude: true,  prefix: '' },
  { key: 'capabilityManifest',  priority: 2,  layer: 'constitution', alwaysInclude: false, prefix: 'WHAT I CAN DO:' },
  { key: 'constraints',         priority: 5,  layer: 'constitution', alwaysInclude: true,  prefix: 'CRITICAL CONSTRAINTS:' },

  // REASONING LAYER
  { key: 'situationalBriefing', priority: 10, layer: 'reasoning',    alwaysInclude: true,  prefix: '=== SITUATIONAL ANALYSIS ===' },

  // DYNAMIC LAYER
  { key: 'customerMemory',       priority: 20, layer: 'dynamic', alwaysInclude: false, prefix: '=== RETURNING CUSTOMER ===' },
  { key: 'agentKnowledge',       priority: 21, layer: 'dynamic', alwaysInclude: false, prefix: '=== PROVEN PATTERNS ===' },
  { key: 'customerContext',      priority: 22, layer: 'dynamic', alwaysInclude: false, prefix: '=== CUSTOMER PROFILE ===' },
  { key: 'coachingBriefing',     priority: 23, layer: 'dynamic', alwaysInclude: false, prefix: '=== PRODUCT SALES PLAYBOOK ===' },
  { key: 'workflowInstructions', priority: 24, layer: 'dynamic', alwaysInclude: true,  prefix: '=== ACTIVE WORKFLOW ===' },
  { key: 'questionnaireContext', priority: 25, layer: 'dynamic', alwaysInclude: false, prefix: '=== ACTIVE QUESTIONNAIRE ===' },
  { key: 'productContext',       priority: 26, layer: 'dynamic', alwaysInclude: false, prefix: '=== PRODUCT CONTEXT ===' },
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
 * Fast-path GateSelection: only include questionnaire + workflow sections.
 * Used when detectFastPath returns true.
 */
export const FAST_PATH_GATE: GateSelection = {
  requiredSections: ['questionnaireContext', 'workflowInstructions'],
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

  const parts: string[] = []
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

    // Insert internal guidance separator before first non-constitution section
    if (!separatorInserted && config.layer !== 'constitution') {
      parts.push(INTERNAL_GUIDANCE_SEPARATOR)
      separatorInserted = true
    }

    // Render section
    let rendered: string
    if (config.prefix) {
      rendered = `\n\n${config.prefix}\n${content}`
    } else {
      // agentIdentity renders first with no prefix or leading newlines
      if (parts.length === 0 && !separatorInserted) {
        rendered = content
      } else if (parts.length === 0) {
        rendered = content
      } else {
        rendered = `\n\n${content}`
      }
    }

    parts.push(rendered)
    sectionSizes[config.key] = rendered.length
    includedSections.push(config.key)
  }

  const prompt = parts.join('')

  return {
    prompt,
    sectionSizes,
    gateActive,
    includedSections,
    excludedSections: excludedSectionsList,
  }
}
