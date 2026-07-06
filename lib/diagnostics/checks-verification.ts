/**
 * Verification-flow ratchets (Task 4.2, D7 — 2026-07-06 triage): the
 * recorded conversation typed digits into a live challenge and the model
 * re-sent the code instead of confirming, killing the close. These checks
 * read the turn_start legality snapshot (pendingChallenge) + tool calls.
 */
import type { DiagnosticCheck, Finding } from './types'

type TurnState = { identity?: { pendingChallenge?: unknown } }

function pendingAtTurnStart(t: { legality?: { point: string; state: TurnState }[] }): boolean {
  const state = t.legality?.find((l) => l.point === 'turn_start')?.state
  return state?.identity?.pendingChallenge != null
}

/** 4–8 digits, optionally space/dash separated — a typed OTP shape. */
const DIGIT_ONLY = /^\s*\d(?:[\s-]*\d){3,7}\s*$/

export const verificationCodeIgnored: DiagnosticCheck = {
  id: 'verification_code_ignored',
  description: 'Digit-only user message while a challenge was pending, and no confirm_channel_verification call that turn',
  run: (e) => e.turns
    .filter((t) => pendingAtTurnStart(t as never)
      && DIGIT_ONLY.test(t.userMessage ?? '')
      && !t.toolCalls.some((c) => c.name === 'confirm_channel_verification'))
    .map((t): Finding => ({ checkId: 'verification_code_ignored', severity: 'error', turn: t.messageIndex, evidence: { userMessage: t.userMessage } })),
}

const RESEND_REQUEST = /retrimite|alt cod|cod nou|resend|n-?am primit|nu (l-?)?am primit|new code/i

export const challengeResentWhilePending: DiagnosticCheck = {
  id: 'challenge_resent_while_pending',
  description: 'start_channel_verification called while a challenge was live, without an explicit customer resend request',
  run: (e) => e.turns.flatMap((t) => t.toolCalls
    .filter((c) => c.name === 'start_channel_verification'
      && (c.args as { resend?: unknown })?.resend !== true
      && pendingAtTurnStart(t as never)
      && !RESEND_REQUEST.test(t.userMessage ?? ''))
    .map((c): Finding => ({ checkId: 'challenge_resent_while_pending', severity: 'warn', turn: t.messageIndex, evidence: { args: c.args } }))),
}

export const knownFieldReasked: DiagnosticCheck = {
  id: 'known_field_reasked',
  description: 'collect_customer_field replayed idempotently — the agent re-collected a field it already had',
  run: (e) => e.ledger
    .filter((l) => l.tool === 'collect_customer_field' && l.idempotencyDisposition === 'replay')
    .map((l): Finding => ({ checkId: 'known_field_reasked', severity: 'warn', turn: null, evidence: { targetRef: l.targetRef } })),
}
