/**
 * Questionnaire Engine
 *
 * Shared logic for DNT, Application, and BD medical questionnaire flows.
 * All three use the same Question table but different QuestionGroups.
 *
 * Design: Pure functions (validateAnswer, checkForFlags, deriveFlags) take
 * pre-fetched data and return results. DB wrapper functions
 * (getNextQuestion, calculateProgress) do DB I/O then delegate to pure
 * functions. Visibility comes from computeVisibleSet over the typed
 * QuestionDependency graph — the ONE dependency store (C1.8, T6.D1); the
 * legacy parentQuestionId/showWhenValue mechanism is retired.
 */

import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'
import { computeVisibleSet } from './dependency-graph'
import { loadDependencyGraph } from './dependency-graph-loader'

// Injectable client (same convention as question-groups.ts): callers running
// inside the commit gateway's transaction MUST pass their tx client — the
// global client cannot see rows written in the open transaction, so the
// post-write next-question walk re-serves the just-answered question
// (2026-07-06 user-found stale-card defect).
type Db = typeof prisma | Prisma.TransactionClient

// ==========================================
// TYPES
// ==========================================

export interface QuestionData {
  id: string
  code: string | null
  groupId: string
  groupCode: string
  text: { en: string; ro: string }
  helpText: { en: string; ro: string } | null
  type: string
  options: unknown
  validationRules: unknown
  orderIndex: number
  isRequired: boolean
}

// ==========================================
// PURE FUNCTIONS
// ==========================================

/**
 * Strip Romanian diacritics for fuzzy comparison.
 */
function stripDiacritics(str: string): string {
  return str
    .replace(/[ăâ]/g, 'a')
    .replace(/[ĂÂ]/g, 'A')
    .replace(/[îÎ]/g, i => i === 'î' ? 'i' : 'I')
    .replace(/[șȘ]/g, s => s === 'ș' ? 's' : 'S')
    .replace(/[țȚ]/g, t => t === 'ț' ? 't' : 'T')
}

/**
 * Normalize a boolean-like answer to "true" or "false".
 * Returns null if not recognized as boolean.
 */
function normalizeBooleanValue(value: string): string | null {
  const lower = value.toLowerCase().trim()
  if (['true', 'yes', 'da', '1'].includes(lower)) return 'true'
  if (['false', 'no', 'nu', '0'].includes(lower)) return 'false'
  return null
}

// shouldShowQuestion (parentQuestionId/showWhenValue) was retired in C1.8 —
// visibility is computeVisibleSet over the typed dependency graph, shared
// with the consequence planner and the domain snapshot (T6.D1).

/**
 * Validate an answer based on the question type.
 *
 * Returns normalized value and validity status.
 */
export function validateAnswer(
  question: { type: string; options: unknown; validationRules: unknown },
  value: string,
): { valid: boolean; normalizedValue: string; error?: string } {
  const trimmedValue = value.trim()

  if (trimmedValue === '') {
    return { valid: false, normalizedValue: '', error: 'Answer is required' }
  }

  switch (question.type) {
    case 'BOOLEAN': {
      const normalized = normalizeBooleanValue(trimmedValue)
      if (normalized === null) {
        return {
          valid: false,
          normalizedValue: trimmedValue,
          error: 'Please answer with yes/no, da/nu, or true/false',
        }
      }
      return { valid: true, normalizedValue: normalized }
    }

    case 'MULTIPLE_CHOICE':
    case 'DROPDOWN': {
      const options = parseOptions(question.options)
      if (!options || options.length === 0) {
        return { valid: true, normalizedValue: trimmedValue }
      }
      const matched = fuzzyMatchOption(trimmedValue, options)
      if (matched) {
        return { valid: true, normalizedValue: matched.value }
      }
      const validValues = options.map(o => o.value).join(', ')
      return {
        valid: false,
        normalizedValue: trimmedValue,
        error: `Invalid option. Valid options: ${validValues}`,
      }
    }

    case 'MULTI_SELECT': {
      const options = parseOptions(question.options)
      if (!options || options.length === 0) {
        return { valid: true, normalizedValue: trimmedValue }
      }
      const values = trimmedValue.split(',').map(v => v.trim()).filter(v => v !== '')
      if (values.length === 0) {
        return { valid: false, normalizedValue: trimmedValue, error: 'Please select at least one option' }
      }
      const normalizedValues: string[] = []
      for (const val of values) {
        const matched = fuzzyMatchOption(val, options)
        if (!matched) {
          // Same self-healing shape as the DROPDOWN branch: the model cannot
          // see prior-turn tool results, so the error must carry the options.
          return {
            valid: false,
            normalizedValue: trimmedValue,
            error: `Invalid option: "${val}". Valid options: ${options.map(o => o.value).join(', ')}`,
          }
        }
        normalizedValues.push(matched.value)
      }
      return { valid: true, normalizedValue: normalizedValues.join(',') }
    }

    case 'OPEN_ENDED': {
      const rules = parseValidationRules(question.validationRules)
      if (rules.minLength !== undefined && trimmedValue.length < rules.minLength) {
        return {
          valid: false,
          normalizedValue: trimmedValue,
          error: `Please enter at least ${rules.minLength} characters`,
        }
      }
      if (rules.maxLength !== undefined && trimmedValue.length > rules.maxLength) {
        return {
          valid: false,
          normalizedValue: trimmedValue,
          error: `Please enter at most ${rules.maxLength} characters`,
        }
      }
      if (rules.pattern) {
        const regex = new RegExp(rules.pattern)
        if (!regex.test(trimmedValue)) {
          return {
            valid: false,
            normalizedValue: trimmedValue,
            error: rules.customMessage || 'Invalid format',
          }
        }
      }
      return { valid: true, normalizedValue: trimmedValue }
    }

    case 'NUMBER': {
      const num = Number(trimmedValue)
      if (isNaN(num)) {
        return { valid: false, normalizedValue: trimmedValue, error: 'Please enter a valid number' }
      }
      const rules = parseValidationRules(question.validationRules)
      if (rules.min !== undefined && num < rules.min) {
        return {
          valid: false,
          normalizedValue: trimmedValue,
          error: `Value must be at least ${rules.min}`,
        }
      }
      if (rules.max !== undefined && num > rules.max) {
        return {
          valid: false,
          normalizedValue: trimmedValue,
          error: `Value must be at most ${rules.max}`,
        }
      }
      return { valid: true, normalizedValue: String(num) }
    }

    case 'DATE': {
      const date = new Date(trimmedValue)
      if (isNaN(date.getTime())) {
        return { valid: false, normalizedValue: trimmedValue, error: 'Please enter a valid date' }
      }
      return { valid: true, normalizedValue: date.toISOString() }
    }

    default:
      return { valid: true, normalizedValue: trimmedValue }
  }
}

/**
 * Check if an answer should trigger a flag (3-tier system).
 *
 * Looks for `flagAnswers` or `flags` array in validationRules.
 * Each entry: { value: string, action: 'flag'|'escalate'|'reject', reason: string }
 */
export function checkForFlags(
  validationRules: unknown,
  value: string,
): { flagged: boolean; action: 'flag' | 'escalate' | 'reject' | null; reason: string | null } {
  const rules = parseValidationRules(validationRules)
  const flags = rules.flagAnswers || rules.flags || []

  if (!Array.isArray(flags) || flags.length === 0) {
    return { flagged: false, action: null, reason: null }
  }

  const normalizedBool = normalizeBooleanValue(value)
  const valueStr = value.trim()

  for (const flag of flags) {
    if (!flag || typeof flag !== 'object') continue

    const flagEntry = flag as { value: string; action?: string; reason?: string }
    let matched = false

    // Exact match
    if (flagEntry.value === valueStr) {
      matched = true
    }

    // Boolean normalization: flag.value "true" matches "yes"/"da"/"1"/etc.
    if (!matched && flagEntry.value === 'true' && normalizedBool === 'true') {
      matched = true
    }
    if (!matched && flagEntry.value === 'false' && normalizedBool === 'false') {
      matched = true
    }

    if (matched) {
      const action = (flagEntry.action || 'flag') as 'flag' | 'escalate' | 'reject'
      return {
        flagged: true,
        action,
        reason: flagEntry.reason || `Answer "${valueStr}" flagged for ${action}`,
      }
    }
  }

  return { flagged: false, action: null, reason: null }
}

export interface DerivedFlag {
  questionCode: string
  answer: string
  reason: string | null
  action: 'flag' | 'escalate' | 'reject'
}

/**
 * Flags DERIVED from active answer revisions (C1.5, erratum 10 / T6.D2):
 * pure recomputation over the active view, so a corrected answer can never
 * leave a zombie flag behind. The consequence applier persists the result
 * (plus PAUSED/OPEN status recompute) inside the commit transaction.
 */
export function deriveFlags(
  activeAnswers: Record<string, string>,
  questionRules: { code: string; validationRules: unknown }[],
): DerivedFlag[] {
  const flags: DerivedFlag[] = []
  for (const q of questionRules) {
    const value = activeAnswers[q.code]
    if (value === undefined) continue
    const result = checkForFlags(q.validationRules, value)
    if (result.flagged && result.action) {
      flags.push({ questionCode: q.code, answer: value, reason: result.reason, action: result.action })
    }
  }
  return flags
}

// ==========================================
// HELPERS (PRIVATE)
// ==========================================

interface ParsedOption {
  value: string
  label?: { en?: string; ro?: string } | string
}

function parseOptions(raw: unknown): ParsedOption[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as ParsedOption[]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

interface ParsedRules {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  customMessage?: string
  flagAnswers?: Array<{ value: string; action?: string; reason?: string }>
  flags?: Array<{ value: string; action?: string; reason?: string }>
  [key: string]: unknown
}

function parseValidationRules(raw: unknown): ParsedRules {
  if (!raw) return {}
  if (typeof raw === 'object' && raw !== null) return raw as ParsedRules
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ParsedRules
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Fuzzy match an input value against options list.
 * Case-insensitive, strips Romanian diacritics.
 */
function fuzzyMatchOption(
  input: string,
  options: ParsedOption[],
): ParsedOption | null {
  const normalized = stripDiacritics(input.toLowerCase().trim())

  for (const opt of options) {
    // Match against option value (case-insensitive + diacritics)
    if (stripDiacritics(opt.value.toLowerCase()) === normalized) {
      return opt
    }

    // Match against option label text (if bilingual)
    if (opt.label) {
      if (typeof opt.label === 'string') {
        if (stripDiacritics(opt.label.toLowerCase()) === normalized) {
          return opt
        }
      } else {
        if (opt.label.en && stripDiacritics(opt.label.en.toLowerCase()) === normalized) {
          return opt
        }
        if (opt.label.ro && stripDiacritics(opt.label.ro.toLowerCase()) === normalized) {
          return opt
        }
      }
    }
  }

  // Second pass (B2.7 live lesson): customers answer "da" to a label like
  // "DA, pentru toate produsele" — accept a prefix that ends at a word
  // boundary, but ONLY when it identifies exactly one option.
  const labelStrings = (opt: ParsedOption): string[] => {
    const out = [opt.value]
    if (typeof opt.label === 'string') out.push(opt.label)
    else if (opt.label) {
      if (opt.label.en) out.push(opt.label.en)
      if (opt.label.ro) out.push(opt.label.ro)
    }
    return out
  }
  const isWordBoundaryPrefix = (candidate: string): boolean =>
    candidate.startsWith(normalized) &&
    (candidate.length === normalized.length || !/[a-z0-9]/i.test(candidate[normalized.length]))
  const prefixMatches = options.filter((opt) =>
    labelStrings(opt).some((l) => isWordBoundaryPrefix(stripDiacritics(l.toLowerCase()))),
  )
  if (normalized.length > 0 && prefixMatches.length === 1) return prefixMatches[0]

  return null
}

// ==========================================
// DB WRAPPER FUNCTIONS
// ==========================================

/**
 * Where a questionnaire's answers live (T3.D6 generalization, B2.3):
 * application-scoped Answer rows (B4.1 re-key — the conversation scope
 * died with Answer.conversationId) or session-scoped DntAnswer rows.
 */
export type AnswerScope =
  | { kind: 'application'; applicationId: string }
  | { kind: 'dntSession'; sessionId: string }

async function loadScopedAnswers(scope: AnswerScope, questionIds: string[], db: Db = prisma): Promise<Map<string, string>> {
  const rows = scope.kind === 'application'
    ? await db.answer.findMany({ where: { applicationId: scope.applicationId, questionId: { in: questionIds }, status: 'ACTIVE' } })
    : await db.dntAnswer.findMany({ where: { sessionId: scope.sessionId, questionId: { in: questionIds } } })
  return new Map(rows.map(a => [a.questionId, a.value]))
}

/**
 * Find the next unanswered, visible question across the given groups.
 *
 * 1. Load all questions for the group codes, ordered by group.orderIndex then question.orderIndex
 * 2. Load all answers in the given scope
 * 3. Build answersMap (questionId -> value)
 * 4. Iterate: first visible + unanswered question is returned
 * 5. Progress: count visible answered / visible total
 */
export async function getNextQuestion(
  groupCodes: string[],
  scope: AnswerScope,
  // B4.6 prefill-as-proposals (T5.D5): questionCode → prior answer. A match
  // rides back as suggestedAnswer — a PROPOSAL the customer must confirm
  // via a real save commit, never a silently copied answer.
  proposals?: Map<string, string>,
  db: Db = prisma,
): Promise<{ question: QuestionData; progress: { answered: number; total: number }; suggestedAnswer?: string } | null> {
  // Load all question groups matching the codes
  const groups = await db.questionGroup.findMany({
    where: { code: { in: groupCodes } },
    orderBy: { orderIndex: 'asc' },
  })

  if (groups.length === 0) return null

  const groupIds = groups.map(g => g.id)
  const groupCodeMap = new Map(groups.map(g => [g.id, g.code]))

  // Load all questions for these groups
  const questions = await db.question.findMany({
    where: { groupId: { in: groupIds } },
    orderBy: [{ groupId: 'asc' }, { orderIndex: 'asc' }],
  })

  if (questions.length === 0) return null

  // Sort by group orderIndex then question orderIndex
  const groupOrderMap = new Map(groups.map(g => [g.id, g.orderIndex]))
  questions.sort((a, b) => {
    const groupOrderA = groupOrderMap.get(a.groupId) ?? 0
    const groupOrderB = groupOrderMap.get(b.groupId) ?? 0
    if (groupOrderA !== groupOrderB) return groupOrderA - groupOrderB
    return a.orderIndex - b.orderIndex
  })

  // Load answers in the given scope
  const questionIds = questions.map(q => q.id)
  const answersMap = await loadScopedAnswers(scope, questionIds, db)

  // Visibility from the ONE dependency store (C1.8)
  const visible = await visibleCodesForScope(questions, answersMap, scope, db)

  // Find visible questions and next unanswered
  let nextQuestion: QuestionData | null = null
  let visibleCount = 0
  let answeredCount = 0

  for (const q of questions) {
    if (q.code && !visible.has(q.code)) {
      continue
    }

    visibleCount++

    if (answersMap.has(q.id)) {
      answeredCount++
    } else if (!nextQuestion) {
      nextQuestion = {
        id: q.id,
        code: q.code,
        groupId: q.groupId,
        groupCode: groupCodeMap.get(q.groupId) || '',
        text: q.text as { en: string; ro: string },
        helpText: q.helpText as { en: string; ro: string } | null,
        type: q.type,
        options: q.options,
        validationRules: q.validationRules,
        orderIndex: q.orderIndex,
        isRequired: q.isRequired,
      }
    }
  }

  if (!nextQuestion) return null

  const suggestedAnswer = nextQuestion.code ? proposals?.get(nextQuestion.code) : undefined
  return {
    question: nextQuestion,
    progress: { answered: answeredCount, total: visibleCount },
    ...(suggestedAnswer !== undefined ? { suggestedAnswer } : {}),
  }
}

/**
 * Calculate progress for a set of question groups.
 */
export async function calculateProgress(
  groupCodes: string[],
  scope: AnswerScope,
  db: Db = prisma,
): Promise<{ answered: number; total: number; percentage: number }> {
  // Load groups
  const groups = await db.questionGroup.findMany({
    where: { code: { in: groupCodes } },
    orderBy: { orderIndex: 'asc' },
  })

  if (groups.length === 0) return { answered: 0, total: 0, percentage: 0 }

  const groupIds = groups.map(g => g.id)

  // Load questions
  const questions = await db.question.findMany({
    where: { groupId: { in: groupIds } },
  })

  if (questions.length === 0) return { answered: 0, total: 0, percentage: 0 }

  // Load answers in the given scope
  const questionIds = questions.map(q => q.id)
  const answersMap = await loadScopedAnswers(scope, questionIds, db)

  // Visibility from the ONE dependency store (C1.8)
  const visible = await visibleCodesForScope(questions, answersMap, scope, db)

  // Count visible and answered
  let total = 0
  let answered = 0

  for (const q of questions) {
    if (q.code && !visible.has(q.code)) continue
    total++
    if (answersMap.has(q.id)) answered++
  }

  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0

  return { answered, total, percentage }
}

/**
 * The scope's visible question codes via computeVisibleSet (C1.8): answers
 * keyed by CODE, selection facts from the application (DNT sessions carry
 * none). Questions without a code cannot be gated and stay visible.
 */
async function visibleCodesForScope(
  questions: { id: string; code: string | null }[],
  answersMap: Map<string, string>,
  scope: AnswerScope,
  db: Db = prisma,
): Promise<Set<string>> {
  const codes: string[] = []
  const answers: Record<string, string> = {}
  for (const q of questions) {
    if (!q.code) continue
    codes.push(q.code)
    const v = answersMap.get(q.id)
    if (v !== undefined) answers[q.code] = v
  }
  let selection: { tier: string | null; level: string | null; addon: boolean | null } = { tier: null, level: null, addon: null }
  if (scope.kind === 'application') {
    const app = await db.application.findUnique({ where: { id: scope.applicationId }, include: { tier: true, level: true } })
    if (app) selection = { tier: app.tier?.code ?? null, level: app.level?.code ?? null, addon: app.includesAddon }
  }
  const graph = await loadDependencyGraph(db)
  return computeVisibleSet(graph, codes, { answers, selection })
}
