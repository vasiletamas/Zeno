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
  description: 'collect_customer_field replayed in a LATER turn whose user message re-supplies the value — the customer really was re-asked',
  run: (e) => {
    // A re-ask is CUSTOMER-FACING: the replay must land in a later turn than
    // the fresh apply AND that turn's user message must carry the value (the
    // customer had to repeat it). Same-turn duplicates and verbatim tool-call
    // macro repeats (user says 'da', the model re-sends known fields) are the
    // idempotency layer working — those are tracked by idempotent_replay.
    // Turn attribution anchors on the USER MESSAGE createdAt (same DB clock
    // as the ledger) — replay envelopes carry the ORIGINAL ledgerId and
    // TurnDebug timestamps are persist-time, so neither joins reliably.
    const anchors = e.turns
      .map((t) => ({ idx: t.messageIndex, at: Date.parse(e.messages[t.messageIndex]?.createdAt ?? '') }))
      .filter((a) => !Number.isNaN(a.at))
      .sort((a, b) => a.at - b.at)
    const turnAt = (createdAt: string): number | undefined => {
      const ts = Date.parse(createdAt)
      if (Number.isNaN(ts)) return undefined
      let hit: number | undefined
      for (const a of anchors) {
        if (ts >= a.at) hit = a.idx
        else break
      }
      return hit
    }
    const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
    const freshTurn = new Map<string, number>()
    for (const l of e.ledger) {
      if (l.tool === 'collect_customer_field' && l.idempotencyDisposition === 'fresh' && l.targetRef) {
        const turn = turnAt(l.createdAt)
        if (turn !== undefined) freshTurn.set(l.targetRef, turn)
      }
    }
    return e.ledger
      .filter((l) => l.tool === 'collect_customer_field' && l.idempotencyDisposition === 'replay')
      .filter((l) => {
        const replayTurn = turnAt(l.createdAt)
        const firstTurn = l.targetRef ? freshTurn.get(l.targetRef) : undefined
        // unknown joins stay flagged (conservative — pre-F2 exports)
        if (replayTurn === undefined || firstTurn === undefined) return true
        if (replayTurn <= firstTurn) return false
        const t = turnByIndex.get(replayTurn)
        if (!t) return true
        const field = l.targetRef?.startsWith('field:') ? l.targetRef.slice('field:'.length) : null
        const replayCall = t.toolCalls.find((c) => c.name === 'collect_customer_field'
          && (c.args as { field?: string })?.field === field)
        const v = (replayCall?.args as { value?: unknown } | undefined)?.value
        return typeof v === 'string' && v.length > 0 && (t.userMessage ?? '').includes(v)
      })
      .map((l): Finding => ({ checkId: 'known_field_reasked', severity: 'warn', turn: turnAt(l.createdAt) ?? null, evidence: { targetRef: l.targetRef } }))
  },
}
