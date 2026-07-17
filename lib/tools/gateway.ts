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
import type { ToolContext, ToolHandler, ToolResult } from './types'

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
const ONE_SHOT = new Set(['sign_dnt', 'accept_quote'])

/**
 * State-guarded commits (B2.5): duplicates are answered by the ENGINE with a
 * precise reason (e.g. dnt_session_already_active + the live session id),
 * never by replaying a stale applied envelope — the session may have moved
 * or closed since the original apply, so a replay would lie about state.
 */
const REPLAY_EXEMPT = new Set([
  'open_dnt_session',
  // B3.5: a repeated start with identical args is a RESEND — it must issue a
  // fresh challenge (invalidating the prior), never replay the old envelope.
  'start_channel_verification',
  // C1.9: selection is state-guarded — a cascade may have nulled the facet
  // between two identical commits (tier change invalidates the level), so a
  // replayed envelope would lie. Duplicates are answered by the handler's
  // unchanged path (no-op, no second cascade).
  'select_coverage',
  // D1.4: freeze-at-issue IS the one-shot enforcement (a Quote row in ANY
  // state blocks with application_frozen) — replaying the original applied
  // envelope after cancel/expiry would lie about a dead quote, so duplicates
  // are answered by legality, never by the ledger.
  'generate_quote',
  // D3.3 (erratum 1): the apply IS the idempotency mechanism — it returns
  // the canonical open session (resumed) or supersedes a stale one; a
  // replayed 'started' envelope would hand back a dead clientSecret and
  // break retry-after-failure.
  'ensure_payment_session',
  // T8: intent is state-guarded — after a renounce, an identical re-commit
  // ("m-am răzgândit înapoi") must create a FRESH active row; a replayed
  // applied envelope would point at a dead (renounced) intent. Identical
  // duplicates against a live intent are answered by the handler's
  // unchanged path (select_coverage precedent), never a second row.
  'set_purchase_intent',
  // P1-4: the replay id 'application:none' is constant across re-opens — a
  // cancel_application/cancel_quote nulls the pointer, so an identical
  // set_application would REPLAY the first app's applied envelope and create
  // nothing (the 40x set_application loop, 2026-07-09). Legality state-guards
  // it: application_already_open while one is open, a fresh create when none.
  'set_application',
  // P1-4: zero material args + a per-quote targetRef makes the hash constant,
  // so a disclosure version published after the first ack would REPLAY the
  // stale envelope while accept_quote stays blocked on requires_disclosures.
  // The handler is idempotent (acks only still-missing docs + a @@unique belt),
  // so duplicates are answered by re-running it, never by a stored replay.
  'acknowledge_disclosures',
])

/**
 * Operator commits (E2.4): resolved by back-office staff, never exposed to
 * the customer-facing agent — they carry no ACTION_RULES entry, so exposure-
 * based legality is REPLACED by the actor gate (operator|system only). The
 * hygiene test excludes them from the registry↔ACTION_RULES parity check.
 */
export const OPERATOR_TOOLS = new Set(['resolve_referral', 'resolve_work_item', 'mark_submitted', 'activate_policy', 'cancel_submission', 'approve_erasure', 'approve_export'])

/**
 * P0-3: money commits take an ADDITIONAL customer-scoped advisory lock. The
 * per-conversation lock does not serialize two conversations bound to the same
 * customer's application (resume_application leaves both pointing at it), so
 * without this each could observe no open payment attempt and create a
 * duplicate provider intent + Payment (or two schedules on a shared quote).
 * The customer lock is always taken AFTER the conversation lock (constant
 * order → no deadlock), and only these tools take it.
 */
const MONEY_TOOLS = new Set(['ensure_payment_session', 'change_payment_option', 'accept_quote'])

export function resolveTargetRef(tool: string, args: Record<string, unknown>, state: DerivedStateV3, conversationId: string, customerId?: string): string {
  // repeatable commits — addressed entity from ARGS (erratum 4)
  if (tool === 'collect_customer_field') return `field:${String(args.field ?? 'unknown')}`
  // T8: the intent is CUSTOMER-scoped (one active intent per customer,
  // surviving the conversation) — the ref follows the entity, not the session.
  if (tool === 'set_purchase_intent') return `intent:${customerId ?? 'unknown'}`
  if (tool === 'write_dnt_answer') return `dnt_answer:${String(args.questionCode ?? 'unknown')}`
  // C1.9 + P1-4: the addressed entity is (application INSTANCE, question
  // CODE). Without the application id, a same-value answer to the same
  // question in a LATER application (same conversation, after cancel+reapply)
  // would hash identically and replay the first application's stale envelope,
  // skipping the new write.
  if (tool === 'write_question_answer') return `app_answer:${state.application?.id ?? 'none'}:${String(args.questionCode ?? 'auto')}`
  if (tool === 'modify_answer') return `app_answer:${state.application?.id ?? 'none'}:${String(args.questionCode ?? 'unknown')}`
  // T10: the bulk medical write addresses the application instance; the
  // answers record rides the material hash, so an identical batch resubmit
  // replays and a different toggle set is a fresh commit.
  if (tool === 'write_medical_batch') return `app_answers_batch:${state.application?.id ?? 'none'}`
  if (tool === 'withdraw_consent') return `consent:${String(args.kind ?? 'unknown')}`
  // D4.2: policy-scoped operator commits key on the policy from ARGS
  if (OPERATOR_TOOLS.has(tool) && typeof args.policyId === 'string') return `policy:${args.policyId}`
  if (OPERATOR_TOOLS.has(tool)) return `work_item:${String(args.workItemId ?? 'unknown')}`
  // one-shot / entity-scoped commits — stable natural key
  if (tool === 'sign_dnt') return `dnt_session:${state.dnt.activeSessionId ?? 'none'}` // B2.6: customer-scoped renewals may recur per conversation
  // D2.5: the ref must survive the ISSUED→ACCEPTED transition — an accepted
  // quote leaves state.quote (issued-only slice), so a same-args resubmit
  // would otherwise hash against quote:none and miss its own replay row.
  if (tool === 'accept_quote' || tool === 'cancel_quote' || tool === 'acknowledge_disclosures') return `quote:${state.quote?.id ?? state.acceptedQuote?.id ?? 'none'}`
  if (tool === 'generate_quote' || tool === 'set_application') return `application:${state.application?.id ?? 'none'}`
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
  // accept_quote left at D2.5: the narrow handler takes paymentOption as its
  // material arg — no legacy literal-true flag remains to inject.
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

/**
 * Task 1.1 (D5): verification_already_pending is the ONE block an argument
 * can lift — an explicit resend (resend: true) or a NEW target re-issues the
 * challenge (issueChallenge expires the prior row); a silent same-target
 * re-send is what invalidated the live code in the recorded conversation.
 */
function verificationResendEscape(req: CommitRequest, reason: ReasonCode, state: DerivedStateV3): boolean {
  if (req.tool !== 'start_channel_verification' || reason !== 'verification_already_pending') return false
  if (req.args.resend === true) return true
  const pendingTarget = state.identity.pendingChallenge?.target
  return typeof req.args.target === 'string' && !!pendingTarget && req.args.target.trim().toLowerCase() !== pendingTarget.toLowerCase()
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

/**
 * F2.2 (erratum 2): the row id is minted here and STAMPED into the envelope
 * before the write, so the stored envelope and the returned envelope carry
 * the same ledgerId — the deterministic turn↔ledger join key the legality
 * snapshots and the assertion library use. Returns the stamped envelope.
 */
async function writeLedger(db: Db, req: CommitRequest, targetRef: string, argsHash: string, envelope: CommitResult, phaseFrom: string, phaseTo: string, id?: string): Promise<CommitResult> {
  const rowId = id ?? crypto.randomUUID()
  const stamped: CommitResult = { ...envelope, ledgerId: rowId, disposition: 'fresh' }
  await db.commitLedger.create({
    data: {
      id: rowId,
      conversationId: req.conversationId, customerId: req.customerId, actor: req.actor, tool: req.tool,
      targetRef, argsHash, outcome: stamped.outcome, effects: stamped.effects,
      reasonCode: stamped.reason ?? null, phaseFrom, phaseTo,
      idempotencyDisposition: 'fresh', envelope: stamped as unknown as Prisma.InputJsonValue,
    },
  })
  return stamped
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
  // The ORIGINAL envelope, verbatim — a replay never recomputes. Only the
  // disposition marker changes so callers can count replays (F2.4); the
  // ledgerId stays the ORIGINAL applied row's id (the semantic join target).
  return { ...(prior.envelope as unknown as CommitResult), disposition: 'replay' }
}

/**
 * Lazy expiry (D1.5, T7.D5 — erratum 1): whenever legality computes
 * quote_expired for the targeted commit — cancel_quote and accept_quote share
 * this — the row is normalized to EXPIRED opportunistically (CAS-guarded on
 * ISSUED + past validUntil) before the rejected envelope goes out. No
 * background sweeper: expiry persists exactly when someone acts on the quote.
 */
async function persistQuoteExpiry(db: Db, state: DerivedStateV3): Promise<void> {
  if (!state.quote) return
  await db.quote.updateMany({
    where: { id: state.quote.id, status: 'ISSUED', validUntil: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
}

async function ledgeredReject(db: Db, req: CommitRequest, targetRef: string, argsHash: string, reason: ReasonCode, phase: string): Promise<CommitResult> {
  return writeLedger(db, req, targetRef, argsHash, { outcome: 'rejected', reason, effects: [] }, phase, phase)
}

/**
 * P0-2 (2026-07-15 hardening, Opus rollback pattern): thrown inside the apply
 * tx when the handler fails, so Postgres discards any partial handler writes.
 * Writing the rejected envelope inside the tx and returning normally would
 * COMMIT those partial writes alongside the rejection row. The outer catch
 * ledgers the reject in a SEPARATE transaction — exactly one row, after the
 * rollback. TimeoutError/CircuitOpenError are never wrapped: they keep
 * flowing to toUnavailable (no ledger row, retryable). Handlers whose failing
 * writes are deliberate audit facts opt out via ToolResult.keepWrites.
 */
class HandlerRejection extends Error {
  constructor(
    public readonly envelope: CommitResult,
    public readonly phaseFrom: string,
  ) {
    super(`commit handler rejected: ${envelope.reason}`)
    this.name = 'HandlerRejection'
  }
}

export async function executeCommit(req: CommitRequest): Promise<CommitResult> {
  const def = getToolDefinition(req.tool)
  const handler = getToolHandler(req.tool)
  if (!def || !handler || def.kind !== 'commit') return { outcome: 'rejected', reason: 'not_exposed', effects: [] }

  // (1) actor: server-resolved by the caller, recorded on every ledger row.
  const pre = deriveAndExpose(await loadDomainSnapshot(req.conversationId))
  const targetRef = resolveTargetRef(req.tool, req.args, pre.state, req.conversationId, req.customerId)
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
    if (!verificationResendEscape(req, reason, pre.state)) {
      if (reason === 'quote_expired') await persistQuoteExpiry(prisma, pre.state)
      const envelope: CommitResult = { outcome: outcomeForBlocked(reason), reason, effects: [], needs: blocked?.params?.needs as string[] | undefined }
      return writeLedger(prisma, req, targetRef, argsHash, envelope, pre.state.phase, pre.state.phase)
    }
  }

  // (4) confirm token — stale/missing → (re-)issue against a fresh state
  // fingerprint, never a hard reject. Issuance is a ledgered attempt
  // (erratum 6). The token may arrive as a dedicated field or inside args.
  const confirmToken = req.confirmToken ?? (typeof req.args.confirmToken === 'string' ? req.args.confirmToken : undefined)
  const fp = stateFingerprint(pre.state)
  // C1.5 conditional confirmation: any present token is verified into a
  // `confirmed` context flag, so handlers whose consequence PLAN demands
  // confirmation (sensitivity, T6.D3) can honor the two-step without the
  // static def.requiresConfirmation gate.
  //
  // T7 clause 6 (single-confirmation ruling): GUI-actor commits are confirmed
  // BY CONSTRUCTION — a GUI post originates from a card that rendered exactly
  // the args being committed, so the click IS the human confirmation
  // (equivalent in safety to the confirmToken round-trip, which exists to
  // prevent AGENT self-confirmation). The static gate below never mints a
  // token for gui, and handlers see context.confirmed=true so the conditional
  // (plan-driven) gate never round-trips either. Replay, exposure legality
  // and the in-lock re-checks still apply to gui commits unchanged.
  const confirmed = req.actor === 'gui'
    || (!!confirmToken && verifyConfirmToken(confirmSecret(), confirmToken, req.conversationId, req.tool, argsHash, fp))
  if (def.requiresConfirmation) {
    if (!confirmed) {
      const envelope: CommitResult = {
        outcome: 'requires_confirmation',
        reason: 'requires_confirmation',
        effects: [],
        confirmToken: issueConfirmToken(confirmSecret(), req.conversationId, req.tool, argsHash, fp),
        // _instruction is model-facing: without it the agent retries the tool
        // forever or invents a written-consent protocol (2026-07-06 sign_dnt
        // 80-turn loop) — the confirmation belongs to the CUSTOMER's card click.
        data: {
          preview: { phase: pre.state.phase, quote: pre.state.quote },
          _instruction: 'A confirmation card is now shown to the customer in the chat UI. Do NOT call this tool again yourself — the customer completes the action by tapping Confirm on the card. Briefly invite them to confirm using the card.',
        },
      }
      return writeLedger(prisma, req, targetRef, argsHash, envelope, pre.state.phase, pre.state.phase)
    }
  }

  // (5) domain validation on MATERIAL args only (erratum 1)
  const validation = validateToolArgs(req.tool, stripConfirmArgs(req.args))
  if (!validation.valid) return ledgeredReject(prisma, req, targetRef, argsHash, 'invalid_args', pre.state.phase)

  // (6+7) transactional apply under the per-conversation advisory lock,
  // ledger row in the same transaction, post-derive delta = advance_phase.
  try {
    return await runApplyTransaction(req, def.requiresConfirmation === true, targetRef, argsHash, validation.data ?? {}, confirmed)
  } catch (err) {
    if (err instanceof TimeoutError || err instanceof CircuitOpenError) return toUnavailable(err)
    throw err
  }
}

async function runApplyTransaction(req: CommitRequest, requiresConfirmation: boolean, targetRef: string, argsHash: string, validatedArgs: Record<string, unknown>, confirmed: boolean): Promise<CommitResult> {
  const handler = getToolHandler(req.tool)!
  try {
    return await runApplyTransactionInner(req, requiresConfirmation, targetRef, argsHash, validatedArgs, confirmed, handler)
  } catch (err) {
    // P0-2: the apply tx rolled back (partial handler writes discarded);
    // the rejection is ledgered in its OWN transaction so the audit row
    // survives the rollback — exactly one fresh 'rejected' row per attempt.
    if (err instanceof HandlerRejection) {
      return writeLedger(prisma, req, targetRef, argsHash, err.envelope, err.phaseFrom, err.phaseFrom)
    }
    throw err
  }
}

async function runApplyTransactionInner(req: CommitRequest, requiresConfirmation: boolean, targetRef: string, argsHash: string, validatedArgs: Record<string, unknown>, confirmed: boolean, handler: ToolHandler): Promise<CommitResult> {
  return prisma.$transaction(async (tx) => {
    // ::text cast because pg_advisory_xact_lock returns void, which the
    // client cannot deserialize.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${req.conversationId}))::text`
    // P0-3: money commits ALSO serialize per customer (constant order: after
    // the conversation lock) so two conversations sharing one application
    // cannot each open a payment attempt / accept the same quote.
    if (MONEY_TOOLS.has(req.tool)) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer:' + req.customerId}))::text`
    }
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
      if (!verificationResendEscape(req, reason, lockedPre.state)) {
        if (reason === 'quote_expired') await persistQuoteExpiry(tx, lockedPre.state)
        const envelope: CommitResult = { outcome: outcomeForBlocked(reason), reason, effects: [] }
        return writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, lockedPre.state.phase)
      }
    }
    const effectiveArgs = { ...validatedArgs, ...(requiresConfirmation ? CONFIRM_ARG_INJECTION[req.tool] ?? {} : {}) }
    // C1.5: the ledger row id is minted BEFORE the handler runs so answer
    // revisions written through the consequence applier reference it.
    const commitId = crypto.randomUUID()
    let handlerResult: ToolResult
    try {
      handlerResult = await handler(effectiveArgs, { ...req.toolContext, db: tx, confirmed, commitId })
    } catch (err) {
      // A2.7 boundary: infrastructure failures keep flowing to toUnavailable
      // (tx rolls back, NO ledger row, retryable). Any other throw is a
      // handler failure — roll back and ledger the reject outside (P0-2).
      if (err instanceof TimeoutError || err instanceof CircuitOpenError) throw err
      throw new HandlerRejection(
        { outcome: 'rejected', reason: 'handler_rejected', effects: [], data: { error: err instanceof Error ? err.message : String(err) } },
        lockedPre.state.phase,
      )
    }
    // C1.5 conditional confirmation: the handler's consequence plan demands
    // a confirm round-trip and no verified token arrived — mint one against
    // the locked pre-state; the plan preview is what the customer approves.
    // The handler has written nothing (contract on ToolResult.requiresConfirmation).
    if (handlerResult.requiresConfirmation) {
      const envelope: CommitResult = {
        outcome: 'requires_confirmation',
        reason: 'requires_confirmation',
        effects: [],
        confirmToken: issueConfirmToken(confirmSecret(), req.conversationId, req.tool, argsHash, stateFingerprint(lockedPre.state)),
        // Same model-facing instruction as the static requiresConfirmation
        // path — the confirmation belongs to the customer's card click.
        data: {
          preview: handlerResult.requiresConfirmation.preview,
          _instruction: 'A confirmation card is now shown to the customer in the chat UI. Do NOT call this tool again yourself — the customer completes the action by tapping Confirm on the card. Briefly invite them to confirm using the card.',
        },
      }
      return writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, lockedPre.state.phase)
    }
    if (!handlerResult.success) {
      // Handlers may speak reason codes: an error message prefixed
      // '<reason_code>: ...' maps to that code (and its outcome class) instead
      // of the generic handler_rejected (B2.6 — e.g. requires_consent,
      // dnt_session_incomplete).
      const errPrefix = typeof handlerResult.error === 'string' ? handlerResult.error.split(':')[0].trim() : ''
      const spokenReason = (REASON_CODES as readonly string[]).includes(errPrefix) ? (errPrefix as ReasonCode) : null
      const handlerNeeds = Array.isArray((handlerResult.data as { needs?: unknown } | undefined)?.needs)
        ? ((handlerResult.data as { needs: string[] }).needs)
        : undefined
      const envelope: CommitResult = { outcome: spokenReason ? outcomeForBlocked(spokenReason) : 'rejected', reason: spokenReason ?? 'handler_rejected', effects: [], needs: handlerNeeds, data: { ...handlerResult.data, error: handlerResult.error } }
      // T7.D4 escape: deliberate audit writes (generate_quote's quoteDecision)
      // commit together with the rejection row — the handler opted in.
      if (handlerResult.keepWrites) {
        return writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, lockedPre.state.phase)
      }
      // P0-2: everything the handler wrote is discarded with the tx; the
      // outer catch ledgers this envelope in its own transaction.
      throw new HandlerRejection(envelope, lockedPre.state.phase)
    }
    let post: ReturnType<typeof deriveAndExpose>
    try {
      post = deriveAndExpose(await loadDomainSnapshot(req.conversationId, tx))
    } catch (e) {
      // E3 (M3): the ONE legitimate conversation destroyer is the GDPR
      // erasure apply (never-contracted customers lose the conversation
      // rows) — the post-state equals the locked pre-state for ledger
      // purposes. Any other loader failure is a real bug: rethrow.
      if (req.tool !== 'approve_erasure') throw e
      post = lockedPre
    }
    // handler-declared domain effects (B4) merge with the gateway's own
    // advance_phase delta; C1's planner supersedes handler declarations.
    const effects: CommitEffect[] = [...(handlerResult.effects ?? [])]
    let phaseDelta: CommitResult['phaseDelta']
    if (lockedPre.state.phase !== post.state.phase || lockedPre.state.subphase !== post.state.subphase) {
      effects.push('advance_phase')
      phaseDelta = { from: lockedPre.state.phase, to: post.state.phase }
    }
    // D1.4: a referral is an APPLIED state change with its own outcome word
    const envelope: CommitResult = handlerResult.referred
      ? { outcome: 'referred', reason: handlerResult.referred.reason as ReasonCode, effects, phaseDelta, data: { ...handlerResult.data, _message: handlerResult.message } }
      : { outcome: 'applied', effects, phaseDelta, data: { ...handlerResult.data, _uiAction: handlerResult.uiAction, _confirmation: handlerResult.confirmation, _message: handlerResult.message } }
    return writeLedger(tx, req, targetRef, argsHash, envelope, lockedPre.state.phase, post.state.phase, commitId)
  })
}
