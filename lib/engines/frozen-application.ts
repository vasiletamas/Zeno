/**
 * Frozen-application predicate (D1.7, T7.D1/T13.D2) — pure, no DB.
 *
 * Once a quote is issued the application is a sealed audit record: every
 * selection/answer mutation is engine-illegal with application_frozen. The
 * recovery path is cancel_quote + a NEW application (B4 prefill), never
 * in-place modification. Registered as an exposure-predicate input consumed
 * by deriveAndExpose (erratum 2: decision-core helper, never called from
 * handlers directly).
 */
export const MUTATING_APPLICATION_ACTIONS = [
  'select_coverage', 'modify_answer', 'set_answer', 'write_question_answer',
] as const

export interface FreezeFacts { frozenAt: Date | null; quoteExists: boolean }

export function mutationBlockedReason(facts: FreezeFacts, action: string): 'application_frozen' | null {
  if (!(MUTATING_APPLICATION_ACTIONS as readonly string[]).includes(action)) return null
  return facts.frozenAt !== null || facts.quoteExists ? 'application_frozen' : null
}
