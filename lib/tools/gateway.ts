/**
 * Commit Gateway (A2.5)
 *
 * Every state-changing tool call flows through executeCommit, which implements
 * the pinned #8 order: actor → replay detection FIRST → legality
 * (deriveAndExpose) → confirm token (re-issue on stale, never hard-reject) →
 * validation → transactional apply under a per-conversation advisory lock with
 * the CommitLedger row written in the same transaction → post-derive whose
 * pre/post delta IS the advance_phase effect (contradiction #6).
 *
 * Retry policy pin: reads may be retried by the executor; commits are NEVER
 * auto-retried — customer-driven resubmission replays via the ledger (#8).
 */

import { prisma } from '@/lib/db'
import type { Prisma, CommitLedger } from '@/lib/generated/prisma/client'
import { getToolDefinition, getToolHandler } from './registry'
import { validateToolArgs } from './validation'
import { materialArgsHash, stripConfirmArgs } from './args-hash'
import { issueConfirmToken, verifyConfirmToken, confirmSecret } from './confirm-token'
import { TimeoutError, CircuitOpenError } from '@/lib/errors/types'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { REASON_CODES, type CommitActor, type CommitEffect, type CommitResult, type DerivedStateV3, type ReasonCode } from '@/lib/engines/domain-types'
import type { ToolContext, ToolResult } from './types'

type Db = typeof prisma | Prisma.TransactionClient

export interface CommitRequest {
  tool: string
  args: Record<string, unknown>
  actor: CommitActor
  conversationId: string
  customerId: string
  confirmToken?: string
  toolContext: ToolContext
}

/**
 * Replay scope per tool (A2 erratum 4). One-shot commits key on a stable
 * (entity, from-state) targetRef and enforce the strict already_applied
 * conflict rule (same target, different material args after success → reject).
 * Repeatable commits key targetRef on the entity addressed in ARGS (field
 * name, question id/code — never positional state), with the value in the
 * material hash: a same-value resubmit replays, a new value is a fresh commit.
 * Every other commit replays only on identical material args.
 */
const ONE_SHOT = new Set(['sign_dnt', 'accept_quote', 'generate_quote', 'start_application'])

/**
 * State-guarded commits (B2.5): duplicates are answered by the ENGINE with a
 * precise reason (e.g. dnt_session_already_active + the live session id),
 * never by replaying a stale applied envelope — the session may have moved
 * or closed since the original apply, so a replay would lie about state.
 */
const REPLAY_EXEMPT = new Set(['open_dnt_session'])

/**
 * Operator commits (E2.4): resolved by back-office staff, never exposed to
 * the customer-facing agent — they carry no ACTION_RULES entry, so exposure-
 * based legality is REPLACED by the actor gate (operator|system only). The
 * hygiene test excludes them from the registry↔ACTION_RULES parity check.
 */
export const OPERATOR_TOOLS = new Set(['resolve_referral', 'resolve_work_item'])

export function resolveTargetRef(tool: string, args: Record<string, unknown>, state: DerivedStateV3, conversationId: string): string {
  // repeatable commits — addressed entity from ARGS (erratum 4)
  if (tool === 'collect_customer_field') return `field:${String(args.field ?? 'unknown')}`
  if (tool === 'write_dnt_answer') return `dnt_answer:${String(args.questionCode ?? 'unknown')}`
  if (tool === 'save_application_answer') return `app_answer:${String(args.field ?? 'auto')}`
  if (tool === 'set_answer') return `question:${String(args.questionCode ?? 'unknown')}`
  if (tool === 'withdraw_consent') return `consent:${String(args.kind ?? 'unknown')}`
  if (OPERATOR_TOOLS.has(tool)) return `work_item:${String(args.workItemId ?? 'unknown')}`
  // one-shot / entity-scoped commits — stable natural key
  if (tool === 'sign_dnt') return `dnt_session:${state.dnt.activeSessionId ?? 'none'}` // B2.6: customer-scoped renewals may recur per conversation
  if (tool === 'accept_quote' || tool === 'modify_quote') return `quote:${state.quote?.id ?? 'none'}`
  if (tool === 'generate_quote') return `application:${state.application?.id ?? 'none'}`
  if (tool === 'initiate_payment') return `policy:${state.policy?.id ?? 'none'}`
  return `conversation:${conversationId}`
}

/**
 * Interim handler contract for confirmed commits: the legacy handlers gate on
 * literal-true flags that callers no longer send (the gateway owns the
 * two-step, erratum 1). Consent is NEVER injected — since B1.5 the customer's
 * consent decision arrives as the material `consent` argument on sign_dnt and
 * is recorded in the ConsentEvent ledger (contradiction #2, ruling 7).
 */
const CONFIRM_ARG_INJECTION: Record<string, Record<string, unknown>> = {
  sign_dnt: { confirmSignature: true },
  accept_quote: { confirmAcceptance: true },
}

/**
 * M10 invariant (A2.7): infrastructure failure ≠ domain rejection. The tx has
 * rolled back, so state is unchanged and the customer may retry — but commits
 * are NEVER auto-retried by the system; resubmission replays via the ledger.
 * 'pending' is reserved for commits whose handlers record an external check
 * (consumed by later blocks; the outcome value already exists in the envelope).
 */
export function toUnavailable(err: unknown): CommitResult {
  return { outcome: 'unavailable', reason: 'temporarily_unavailable', effects: [], data: { retryable: true, retryAfterMs: 20_000, error: err instanceof Error ? err.name : 'unknown' } }
}

function outcomeForBlocked(reason: ReasonCode): CommitResult['outcome'] {
  if (reason === 'requires_consent') return 'requires_consent'
  if (reason === 'requires_identity') return 'requires_identity'
  if (reason === 'requires_disclosures') return 'requires_disclosures'
  if (reason === 'temporarily_unavailable') return 'unavailable'
  return 'rejected'
}

function stateFingerprint(state: DerivedStateV3): string {
  return [state.phase, state.subphase ?? '-', state.quote?.id ?? '-', state.quote?.validUntil ?? '-', state.application?.id ?? '-', state.dnt.answeredCount].join('|')
}

async function findFreshApplied(db: Db, conversationId: string, tool: string, key: { argsHash?: string; targetRef?: string }): Promise<CommitLedger | null> {
  // indexed lookups keyed directly on argsHash / targetRef (erratum 3) —
  // never latest-row comparison, which interleaved commits defeat.
  return db.commitLedger.findFirst({
    where: { conversationId, tool, outcome: 'applied', idempotencyDisposition: 'fresh', ...key },
    orderBy: { createdAt: 'desc' },
  })
}

async function writeLedger(db: Db, req: CommitRequest, targetRef: string, argsHash: string, envelope: CommitResult, phaseFrom: string, phaseTo: string): Promise<void> {
  await db.commitLedger.create({
    data: {
      conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool,
      targetRef, argsHash, outcome: envelope.outcome, effects: envelope.effects,
      reasonCode: envelope.reason ?? null, phaseFrom, phaseTo,
      idempotencyDisposition: 'fresh', envelope: envelope as unknown as Prisma.InputJsonValue,
    },
  })
}

async function writeReplayRow(db: Db, req: CommitRequest, prior: CommitLedger): Promise<CommitResult> {
  await db.commitLedger.create({
    data: {
      conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool,
      targetRef: prior.targetRef, argsHash: prior.argsHash, outcome: prior.outcome, effects: prior.effects,
      reasonCode: prior.reasonCode, phaseFrom: prior.phaseFrom, phaseTo: prior.phaseTo,
      idempotencyDisposition: 'replay', envelope: prior.envelope as Prisma.InputJsonValue,
    },
  })
  // The ORIGINAL envelope, verbatim — a replay never recomputes.
  return prior.envelope as unknown as CommitResult
}

async function ledgeredReject(db: Db, req: CommitRequest, targetRef: string, argsHash: string, reason: ReasonCode, phase: string): Promise<CommitResult> {
  const envelope: CommitResult = { outcome: 'rejected', reason, effects: [] }
  await writeLedger(db, req, targetRef, argsHash, envelope, phase, phase)
  return envelope
}

export async function executeCommit(req: CommitRequest): Promise<CommitResult> {
  const def = getToolDefinition(req.tool)
  const handler = getToolHandler(req.tool)
  if (!def || !handler || def.kind !== 'commit') return { outcome: 'rejected', reason: 'not_exposed', effects: [] }

  // (1) actor: server-resolved by the caller, recorded on every ledger row.
  const pre = deriveAndExpose(await loadDomainSnapshot(req.conversationId))
  const targetRef = resolveTargetRef(req.tool, req.args, pre.state, req.conversationId)
  const argsHash = materialArgsHash(req.tool, targetRef, req.args)

  // Operator tools have no exposure rule — the server-resolved actor IS the
  // legality check (E2.4), and it outranks replay: a bad actor never gets a
  // replayed envelope. Ledgered like any other reject.
  if (OPERATOR_TOOLS.has(req.tool) && req.actor !== 'operator' && req.actor !== 'system') {
    return ledgeredReject(prisma, req, targetRef, argsHash, 'actor_not_permitted', pre.state.phase)
  }

  // (2) idempotency replay detection FIRST — a replay answers even if the
  // action is now blocked (#8). Fast path outside the lock; re-checked inside
  // (erratum 2). State-guarded commits skip replay: legality answers them.
  const prior = REPLAY_EXEMPT.has(req.tool) ? null : await findFreshApplied(prisma, req.conversationId, req.tool, { argsHash })
  if (prior) return writeReplayRow(prisma, req, prior)
  if (ONE_SHOT.has(req.tool)) {
    const conflict = await findFreshApplied(prisma, req.conversationId, req.tool, { targetRef })
    if (conflict) return ledgeredReject(prisma, req, targetRef, argsHash, 'already_applied', pre.state.phase)
  }

  // (3) legality — replaced by the actor gate above for operator tools
  if (!OPERATOR_TOOLS.has(req.tool) && !pre.actions.available.includes(req.tool)) {
    const blocked = pre.actions.blocked.find((b) => b.action === req.tool)
    const reason = blocked?.reason ?? 'not_exposed'
    const envelope: CommitResult = { outcome: outcomeForBlocked(reason), reason, effects: [], needs: blocked?.params?.needs as string[] | undefined }
    await writeLedger(prisma, req, targetRef, argsHash, envelope, pre.state.phase, pre.state.phase)
    return envelope
  }

  // (4) confirm token — stale/missing → (re-)issue against a fresh state
  // fingerprint, never a hard reject. Issuance is a ledgered attempt
  // (erratum 6). The token may arrive as a dedicated field or inside args.
  const confirmToken = req.confirmToken ?? (typeof req.args.confirmToken === 'string' ? req.args.confirmToken : undefined)
  if (def.requiresConfirmation) {
    const fp = stateFingerprint(pre.state)
    if (!confirmToken || !verifyConfirmToken(confirmSecret(), confirmToken, req.conversationId, req.tool, argsHash, fp)) {
      const envelope: CommitResult = {
        outcome: 'requires_confirmation',
        reason: 'requires_confirmation',
        effects: [],
        confirmToken: issueConfirmToken(confirmSecret(), req.conversationId, req.tool, argsHash, fp),
        data: { preview: { phase: pre.state.phase, quote: pre.state.quote } },
      }
      await writeLedger(prisma, req, targetRef, argsHash, envelope, pre.state.phase, pre.state.phase)
      return envelope
    }
  }

  // (5) domain validation on MATERIAL args only (erratum 1)
  const validation = validateToolArgs(req.tool, stripConfirmArgs(req.args))
  if (!validation.valid) return ledgeredReject(prisma, req, targetRef, argsHash, 'invalid_args', pre.state.phase)

  // (6+7) transactional apply under the per-conversation advisory lock,
  // ledger row in the same transaction, post-derive delta = advance_phase.
  try {
    return await runApplyTransaction(req, def.requiresConfirmation === true, targetRef, argsHash, validation.data ?? {})
  } catch (err) {
    if (err instanceof TimeoutError || err instanceof CircuitOpenError) return toUnavailable(err)
    throw err
  }
}

async function runApplyTransaction(req: CommitRequest, requiresConfirmation: boolean, targetRef: string, argsHash: string, validatedArgs: Record<string, unknown>): Promise<CommitResult> {
  const handler = getToolHandler(req.tool)!
  return prisma.$transaction(async (tx) => {
    // ::text cast because pg_advisory_xact_lock returns void, which the
    // client cannot deserialize.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.conversationId}))::text`
    // Replay re-check INSIDE the lock (erratum 2): two genuinely concurrent
    // identical commits both pass the pre-lock check; the loser replays here.
    const lockedPrior = REPLAY_EXEMPT.has(req.tool) ? null : await findFreshApplied(tx, req.conversationId, req.tool, { argsHash })
    if (lockedPrior) return writeReplayRow(tx, req, lockedPrior)
    if (ONE_SHOT.has(req.tool)) {
      const lockedConflict = await findFreshApplied(tx, req.conversationId, req.tool, { targetRef })
      if (lockedConflict) return ledgeredReject(tx, req, targetRef, argsHash, 'already_applied', lockedConflict.phaseTo ?? 'DISCOVERY')
    }
    const lockedPre = deriveAndExpose(await loadDomainSnapshot(req.conversationId, tx))
    if (!OPERATOR_TOOLS.has(req.tool) && !lockedPre.actions.available.includes(req.tool)) {
      const blocked = lockedPre.actions.blocked.find((b) => b.action === req.tool)
      const reason = blocked?.reason ?? 'not_exposed'
      const envelope: CommitResult = { outcome: outcomeForBlocked(reason), reason, effects: [] }
      await writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, lockedPre.state.phase)
      return envelope
    }
    const effectiveArgs = { ...validatedArgs, ...(requiresConfirmation ? CONFIRM_ARG_INJECTION[req.tool] ?? {} : {}) }
    const handlerResult: ToolResult = await handler(effectiveArgs, { ...req.toolContext, db: tx })
    const post = deriveAndExpose(await loadDomainSnapshot(req.conversationId, tx))
    const effects: CommitEffect[] = []
    let phaseDelta: CommitResult['phaseDelta']
    if (lockedPre.state.phase !== post.state.phase || lockedPre.state.subphase !== post.state.subphase) {
      effects.push('advance_phase')
      phaseDelta = { from: lockedPre.state.phase, to: post.state.phase }
    }
    // Handlers may speak reason codes: an error message prefixed
    // '<reason_code>: ...' maps to that code (and its outcome class) instead
    // of the generic handler_rejected (B2.6 — e.g. requires_consent,
    // dnt_session_incomplete).
    const errPrefix = typeof handlerResult.error === 'string' ? handlerResult.error.split(':')[0].trim() : ''
    const spokenReason = (REASON_CODES as readonly string[]).includes(errPrefix) ? (errPrefix as ReasonCode) : null
    const envelope: CommitResult = handlerResult.success
      ? { outcome: 'applied', effects, phaseDelta, data: { ...handlerResult.data, _uiAction: handlerResult.uiAction, _confirmation: handlerResult.confirmation, _message: handlerResult.message } }
      : { outcome: spokenReason ? outcomeForBlocked(spokenReason) : 'rejected', reason: spokenReason ?? 'handler_rejected', effects: [], data: { error: handlerResult.error } }
    await writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, post.state.phase)
    return envelope
  })
}
