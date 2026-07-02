/**
 * Questionnaire Engine
 *
 * Shared logic for DNT, Application, and BD medical questionnaire flows.
 * All three use the same Question/Answer tables but different QuestionGroups.
 *
 * Design: Pure functions (shouldShowQuestion, validateAnswer, checkForFlags)
 * take pre-fetched data and return results. DB wrapper functions
 * (getNextQuestion, calculateProgress) do DB I/O then delegate to pure functions.
 */

import { prisma } from '@/lib/db'

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
  parentQuestionId: string | null
  showWhenValue: string | null
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

/**
 * Evaluate conditional visibility for a question.
 *
 * - If parentQuestionId is null: always visible
 * - If parent not answered: hidden
 * - If showWhenValue matches parent answer: visible
 */
export function shouldShowQuestion(
  question: { parentQuestionId: string | null; showWhenValue: string | null },
  answersMap: Map<string, string>,
): boolean {
  // No parent → always visible
  if (!question.parentQuestionId) {
    return true
  }

  // Parent not answered → hidden
  const parentAnswer = answersMap.get(question.parentQuestionId)
  if (parentAnswer === undefined) {
    return false
  }

  // No condition → visible if parent answered
  if (question.showWhenValue === null || question.showWhenValue === undefined) {
    return true
  }

  const showWhen = question.showWhenValue

  // Comma-separated values: show if parent answer matches any
  if (showWhen.includes(',')) {
    const allowedValues = showWhen.split(',').map(v => v.trim())
    return allowedValues.includes(parentAnswer)
  }

  // Boolean normalization: "true"/"false" showWhenValue
  if (showWhen === 'true' || showWhen === 'false') {
    const normalizedAnswer = normalizeBooleanValue(parentAnswer)
    return normalizedAnswer === showWhen
  }

  // Exact string match
  return parentAnswer === showWhen
}

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
          return {
            valid: false,
            normalizedValue: trimmedValue,
            error: `Invalid option: "${val}"`,
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
  return null
}

// ==========================================
// DB WRAPPER FUNCTIONS
// ==========================================

/**
 * Where a questionnaire's answers live (T3.D6 generalization, B2.3):
 * conversation-scoped Answer rows (legacy + application flow until B4) or
 * session-scoped DntAnswer rows. B4 adds the application scope.
 */
export type AnswerScope =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'dntSession'; sessionId: string }

async function loadScopedAnswers(scope: AnswerScope, questionIds: string[]): Promise<Map<string, string>> {
  const rows = scope.kind === 'conversation'
    ? await prisma.answer.findMany({ where: { conversationId: scope.conversationId, questionId: { in: questionIds } } })
    : await prisma.dntAnswer.findMany({ where: { sessionId: scope.sessionId, questionId: { in: questionIds } } })
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
): Promise<{ question: QuestionData; progress: { answered: number; total: number } } | null> {
  // Load all question groups matching the codes
  const groups = await prisma.questionGroup.findMany({
    where: { code: { in: groupCodes } },
    orderBy: { orderIndex: 'asc' },
  })

  if (groups.length === 0) return null

  const groupIds = groups.map(g => g.id)
  const groupCodeMap = new Map(groups.map(g => [g.id, g.code]))

  // Load all questions for these groups
  const questions = await prisma.question.findMany({
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
  const answersMap = await loadScopedAnswers(scope, questionIds)

  // Find visible questions and next unanswered
  let nextQuestion: QuestionData | null = null
  let visibleCount = 0
  let answeredCount = 0

  for (const q of questions) {
    const questionForVisibility = {
      parentQuestionId: q.parentQuestionId,
      showWhenValue: q.showWhenValue,
    }

    if (!shouldShowQuestion(questionForVisibility, answersMap)) {
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
        parentQuestionId: q.parentQuestionId,
        showWhenValue: q.showWhenValue,
        orderIndex: q.orderIndex,
        isRequired: q.isRequired,
      }
    }
  }

  if (!nextQuestion) return null

  return {
    question: nextQuestion,
    progress: { answered: answeredCount, total: visibleCount },
  }
}

/**
 * Calculate progress for a set of question groups.
 */
export async function calculateProgress(
  groupCodes: string[],
  scope: AnswerScope,
): Promise<{ answered: number; total: number; percentage: number }> {
  // Load groups
  const groups = await prisma.questionGroup.findMany({
    where: { code: { in: groupCodes } },
    orderBy: { orderIndex: 'asc' },
  })

  if (groups.length === 0) return { answered: 0, total: 0, percentage: 0 }

  const groupIds = groups.map(g => g.id)

  // Load questions
  const questions = await prisma.question.findMany({
    where: { groupId: { in: groupIds } },
  })

  if (questions.length === 0) return { answered: 0, total: 0, percentage: 0 }

  // Load answers in the given scope
  const questionIds = questions.map(q => q.id)
  const answersMap = await loadScopedAnswers(scope, questionIds)

  // Count visible and answered
  let total = 0
  let answered = 0

  for (const q of questions) {
    const vis = { parentQuestionId: q.parentQuestionId, showWhenValue: q.showWhenValue }
    if (!shouldShowQuestion(vis, answersMap)) continue
    total++
    if (answersMap.has(q.id)) answered++
  }

  const percentage = total > 0 ? Math.round((answered / total) * 100) : 0

  return { answered, total, percentage }
}
