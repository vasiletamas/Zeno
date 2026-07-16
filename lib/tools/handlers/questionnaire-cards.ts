/**
 * Questionnaire cards — the ONE builder for both questionnaire families
 * (T9/T12, docs/plans/2026-07-15-design-questionnaire-ux-standard.md).
 *
 * The UX standard holds BY CONSTRUCTION: dnt-handlers, application-handlers,
 * select-coverage-handlers and the reload re-derive (lib/chat/
 * derive-pending-card.ts) all build their `show_question` cards and their
 * conduct-bearing `_message`s here, so the two families can never drift
 * apart in shape or wording. A future questionnaire that uses this module
 * gets the standard for free; one that bypasses it fails the parity ratchet
 * (ui-action-registry + diagnostics).
 */

export type QuestionnaireGroupType = 'dnt' | 'application'

/**
 * The minimal question shape a card needs — satisfied by both raw Prisma
 * Question rows (dnt-handlers' sessionNextQuestion) and the engine's
 * QuestionData (getNextQuestion). Localized objects ride the payload
 * untouched; the CARD localizes, never the server.
 */
export interface CardQuestion {
  id: string
  code: string | null
  text: unknown
  helpText?: unknown
  type: string
  options: unknown
  validationRules: unknown
}

export interface CardProgress {
  answered: number
  total: number
}

export interface QuestionCardAction {
  type: 'show_question'
  payload: Record<string, unknown>
}

/**
 * Clause 2 (canonical wording): the conduct instruction is SERVER-owned —
 * embedded in every questionnaire tool `_message`, never left to the prompt.
 * The card renders the question and options; the model contributes at most
 * one short invite line.
 */
export const CONDUCT_LINE =
  'A question card is shown to the customer with all the options — NEVER list the options in prose (no "Opțiuni:" lists) and never repeat the question text; invite the customer to answer on the card in ONE short line.'

/**
 * Clause 1/3: the `show_question` card for the next pending question —
 * unified shape for BOTH families (the payload question carries
 * validationRules for both; historically only DNT did). Returns undefined
 * when there is no next question (completion paths emit review cards — T7/
 * T11 — never a question card).
 */
export function questionCard(
  groupType: QuestionnaireGroupType,
  next: CardQuestion | null | undefined,
  progress: CardProgress,
): QuestionCardAction | undefined {
  if (!next) return undefined
  return {
    type: 'show_question',
    payload: {
      question: {
        id: next.id,
        code: next.code,
        text: next.text as { en: string; ro: string },
        helpText: (next.helpText ?? null) as { en: string; ro: string } | null,
        type: next.type,
        options: next.options,
        validationRules: next.validationRules,
      },
      // normalized: calculateProgress adds a percentage field the card
      // contract does not carry — the payload is exactly {answered, total}
      progress: { answered: progress.answered, total: progress.total },
      groupType,
    },
  }
}

/**
 * Clause 2: the save-path `_message`. Has-next embeds CONDUCT_LINE (DNT
 * keeps its Next-question-code prefix and typed-fallback hint — B2.7 live
 * lesson: agents guess codes without it); completion strings are the
 * pre-existing ones, untouched (T7/T11 own the completion cards).
 */
export function savedMessage(
  groupType: QuestionnaireGroupType,
  next: { code: string | null } | null | undefined,
  progress: CardProgress,
): string {
  if (!next) {
    return groupType === 'dnt'
      ? 'All DNT questions answered. Ready for signature (sign_dnt).'
      : 'Application questionnaire complete. If sensitive medical answers were collected, sign_medical_declarations must confirm them (one card) before the quote; otherwise generate the quote.'
  }
  const remaining = progress.total - progress.answered
  return groupType === 'dnt'
    ? `Answer saved. Next question code: ${next.code}. ${remaining} remaining. ${CONDUCT_LINE} If the customer types instead, call write_dnt_answer with questionCode "${next.code}".`
    : `Answer saved. ${remaining} questions remaining. ${CONDUCT_LINE}`
}

/**
 * Clause 3 rejection threading: a validation/grounding/code-mismatch REJECT
 * must re-emit the SAME question card so the customer is never stranded
 * card-less. The gateway rolls the apply tx back on {success:false} and the
 * rejection envelope spreads handler `data` (gateway.ts) — the executor
 * lifts `_uiAction` on ANY outcome (executor.ts), so threading the card
 * through `data._uiAction` is the one path that survives the rollback.
 */
export function rejectReemit<T extends Record<string, unknown>>(
  data: T | undefined,
  card: QuestionCardAction | undefined,
): Record<string, unknown> {
  return { ...(data ?? {}), ...(card ? { _uiAction: card } : {}) }
}
