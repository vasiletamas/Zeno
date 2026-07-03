import type { DomainSnapshot, Phase, AppSubphase } from './domain-types'
import type { BlockedAction, DeriveAndExposeResult, DerivedStateV3, ReasonCode } from './domain-types'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS, type IdentityRequirementsTable } from './identity-requirements'
import { consentBlocksCommit } from './consent-rules'
import { dntExposure, type DntFact, type ProductTypeStr } from './dnt-rules'
import { applicationExposure, canTransition, type AppStatus } from './application-rules'
import { acceptQuoteLegality } from './accept-quote-legality'
import { freeLookDecision } from './policy-machine'
import { mutationBlockedReason } from './frozen-application'
import { evaluateEligibility, deriveEligibilityBounds } from './eligibility'
import { evaluateSuitability, type SuitabilityResult } from './suitability'

/**
 * Adapt the snapshot's DNT aggregate facts to the pure #12 exposure
 * predicates (B2). Governs the new 6-tool surface progressively: reads +
 * open_dnt_session from B2.4, write_dnt_answer from B2.5, sign_dnt at B2.6.
 */
function dntExposureFromSnapshot(s: DomainSnapshot): ReturnType<typeof dntExposure> {
  const latest: DntFact | null = s.dnt.latest
    ? { status: s.dnt.latest.status, signedAt: new Date(s.dnt.latest.signedAt), validUntil: new Date(s.dnt.latest.validUntil), productTypesCovered: s.dnt.latest.productTypesCovered as ProductTypeStr[] }
    : null
  return dntExposure({
    productTypeInFocus: (s.product?.insuranceType as ProductTypeStr) ?? null,
    latestDnt: latest,
    activeSession: s.dnt.activeSessionId ? { id: s.dnt.activeSessionId } : null,
    sessionHasPendingQuestion: s.dnt.activeSessionId !== null && s.dnt.sessionAnswered < s.dnt.sessionTotal,
    sessionFinished: s.dnt.activeSessionId !== null && s.dnt.sessionTotal > 0 && s.dnt.sessionAnswered >= s.dnt.sessionTotal,
    openApplicationProductType: s.application !== null && s.product ? (s.product.insuranceType as ProductTypeStr) : null,
    now: new Date(),
  })
}

const dntRule = (action: string, kind: 'read' | 'commit'): ActionRule => ({
  action,
  kind,
  exposedWhen: (s) => dntExposureFromSnapshot(s).available.includes(action),
  blockedReason: (s) => {
    const b = dntExposureFromSnapshot(s).blocked.find((x) => x.action === action)
    return b ? { reason: b.reason as ReasonCode, params: b.params } : null
  },
})

/**
 * Adapt the snapshot's application slice to the pure B4.2 lifecycle rules:
 * the T5.D1 DNT gate lives in questionnaire exposure, selection
 * incompleteness is a generate_quote blocked-reason (#10).
 */
function appExposureFromSnapshot(s: DomainSnapshot): ReturnType<typeof applicationExposure> {
  return applicationExposure({
    application: s.application
      ? { exists: true, status: s.application.status as AppStatus, tier: s.application.tier, level: s.application.level, addon: s.application.addon, answersComplete: s.application.missingCodes.length === 0, hasAnswers: s.application.answeredCount > 0 }
      : { exists: false, status: 'OPEN', tier: null, level: null, addon: null, answersComplete: false, hasAnswers: false },
    dntValidForProduct: s.dnt.valid && (s.product ? s.dnt.coversProductTypes.includes(s.product.insuranceType) : false),
  })
}

/**
 * D1.7: the snapshot's merged frozen fact (frozenAt set OR a Quote row in
 * ANY state) feeds the pure predicate's quoteExists slot — one OR either way.
 */
const freezeFacts = (s: DomainSnapshot) => ({ frozenAt: null, quoteExists: s.application?.frozen ?? false })

const appRule = (action: string): ActionRule => ({
  action,
  kind: 'commit',
  exposedWhen: (s) => appExposureFromSnapshot(s).available.includes(action) && mutationBlockedReason(freezeFacts(s), action) === null,
  blockedReason: (s) => {
    // D1.7 (T7.D1): the freeze outranks lifecycle reasons — the precise
    // recovery answer for a mutating action is application_frozen
    // (cancel_quote + a new application), never a generic status block.
    const frozen = s.application !== null ? mutationBlockedReason(freezeFacts(s), action) : null
    if (frozen) return { reason: frozen }
    const b = appExposureFromSnapshot(s).blocked.find((x) => x.action === action)
    if (b) return { reason: b.reason as ReasonCode, params: b.params }
    // precise terminal answers the lifecycle rules stay silent about
    if (s.application) {
      if (action === 'cancel_application' && !canTransition(s.application.status as AppStatus, 'CANCELLED')) return { reason: 'illegal_status_transition' }
      if (action === 'resume_application' && s.application.status === 'REFERRED') return { reason: 'with_underwriter' }
    }
    return null
  },
})

/**
 * Engine version stamp carried in every per-turn legality snapshot
 * (debug:gate payload) so recompute-and-diff replay can tell which rule set
 * produced a historical exposure (T14.D2). Bump on ANY change to derivePhase,
 * ACTION_RULES, or NEXT_BEST_PRIORITY.
 */
export const engineVersion = '1.33.0' // 1.33.0: get_open_items read exposed (E4.3, M2 — the ONE list read); 1.32.0: request_erasure/request_data_export exposed (E3, M3) — erasure always offerable and consent-halt exempt, export behind the verified_channel identity row; 1.31.0: set_application ineligible block params carry the derived age bounds (E1.6, T11.D4); 1.30.0: request_cancellation exposed via the deterministic free-look rule (D4.5, T9.D2) — outside_free_look precise block; 1.29.0: get_policy_info customer-scoped read + POLICY phase derives from the customer-scoped policy (D4.4, T9.D5/D6); 1.28.0: change_payment_option exposed pre-capture only (D3.4, T8.D5); 1.27.0: ensure_payment_session replaces the legacy initiate tool (D3.3, T8.D4); 1.26.0: get_payment_status read exposed on schedule existence (D3.2); 1.22.0: modify_quote eliminated (D1.7, T13.D2) — mutating actions blocked application_frozen via the pure frozen-application predicate; recovery is cancel_quote + a new application; 1.23.0: acknowledge_disclosures exposed on the live issued quote (D2.3, T7.D2); 1.24.0: accept_quote legality through the pure acceptQuoteLegality predicate (D2.5, T7.D6) — expiry → transition → verified_channel identity → disclosure acks; 1.25.0: the payment commit rides the schedule (D2.8) — due PENDING installment exposes, settled answers no_due_installment, no Policy prerequisite

export function derivePhase(s: DomainSnapshot): { phase: Phase; subphase: AppSubphase | null } {
  if (s.policy !== null) return { phase: 'POLICY', subphase: null }
  if (s.acceptedQuote !== null && s.schedule.exists) return { phase: 'PAYMENT', subphase: null }
  if (s.quote !== null && !s.quote.expired) return { phase: 'QUOTE', subphase: null }
  if (s.application !== null) {
    if (!s.dnt.valid) return { phase: 'APPLICATION', subphase: 'DNT' }
    if (s.application.missingCodes.length > 0) return { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }
    return { phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' }
  }
  return { phase: 'DISCOVERY', subphase: null }
}

type Derived = { phase: Phase; subphase: AppSubphase | null; eligibility: DerivedStateV3['eligibility']; suitability: SuitabilityResult | null }
export interface ActionRule {
  action: string
  kind: 'read' | 'commit'
  exposedWhen: (s: DomainSnapshot, d: Derived) => boolean
  blockedReason?: (s: DomainSnapshot, d: Derived) => { reason: ReasonCode; params?: Record<string, unknown> } | null
}
const always = () => true

/**
 * The suitability verdict (C3.3, M7): derived ONLY after sign_dnt — before
 * the signed needs analysis no fit claim is possible — from the product's
 * typed rules over the signed DNT facts. Null when unsigned or rule-less.
 */
export function deriveSuitability(s: DomainSnapshot): SuitabilityResult | null {
  const rules = s.product?.suitabilityRules
  if (!rules || !s.dnt.signed) return null
  return evaluateSuitability(rules, s.dnt.facts)
}

/**
 * The discovery eligibility verdict (C2.6, #9): ONE evaluator over the
 * product's typed rules — subject 'product' (addon rules are the consequence
 * planner's and the D1 gate's business). Facts = identity-class facts from
 * the B0 derivation plus prefixed active-answer facts. No rules → unknown.
 */
/**
 * C3.4 (M7.2b, erratum 2): the documented-warning state. In warn_and_allow
 * mode a non-suitable verdict demands the customer's acknowledgement for
 * THIS ruleset version before a quote; hard_block mode rejects outright
 * (D1's gateSuitability mirrors this — one predicate, two hosts).
 */
function suitabilityAckNeeded(s: DomainSnapshot, d: Derived): boolean {
  const rules = s.product?.suitabilityRules
  if (!rules || !d.suitability || d.suitability.verdict === 'suitable') return false
  if (rules.mode !== 'warn_and_allow') return false
  return !s.suitabilityAcks.some((a) => a.ruleSetVersion === rules.version)
}

function suitabilityHardBlocked(s: DomainSnapshot, d: Derived): boolean {
  const rules = s.product?.suitabilityRules
  return !!rules && rules.mode === 'hard_block' && d.suitability?.verdict === 'unsuitable'
}

export function deriveEligibility(s: DomainSnapshot): DerivedStateV3['eligibility'] {
  const rules = s.product?.eligibilityRules
  if (!rules) return { verdict: 'unknown', missingFacts: [], failedReasons: [] }
  const facts = {
    ...s.eligibilityFacts,
    ...Object.fromEntries(Object.entries(s.answers).map(([c, v]) => [`answer:${c}`, v])),
  }
  const r = evaluateEligibility(rules, facts, 'product')
  return { verdict: r.verdict, missingFacts: r.missingFacts, failedReasons: r.failedRules.map((f) => f.reason) }
}

export const ACTION_RULES: ActionRule[] = [
  { action: 'list_products', kind: 'read', exposedWhen: always },
  { action: 'get_product_info', kind: 'read', exposedWhen: always },
  { action: 'compare_products', kind: 'read', exposedWhen: always },
  { action: 'preview_product_requirements', kind: 'read', exposedWhen: always },
  { action: 'get_current_state', kind: 'read', exposedWhen: always },
  { action: 'get_objection_strategy', kind: 'read', exposedWhen: always },
  { action: 'get_customer_profile', kind: 'read', exposedWhen: always },
  dntRule('get_dnt_state', 'read'),
  dntRule('get_dnt_questions', 'read'),
  dntRule('get_dnt_next_question', 'read'),
  dntRule('open_dnt_session', 'commit'),
  dntRule('write_dnt_answer', 'commit'),
  { action: 'get_quote_info', kind: 'read', exposedWhen: (s) => s.quote !== null || s.acceptedQuote !== null },
  { action: 'get_last_application_info', kind: 'read', exposedWhen: always }, // B4.6 prefill-as-proposals read
  { action: 'get_open_items', kind: 'read', exposedWhen: always }, // E4.3 (M2): the ONE list read
  // C1.ADD-1: the pinned questionnaire read — next question + progress +
  // structured branching provenance (T13.D1)
  { action: 'get_next_question', kind: 'read', exposedWhen: (s) => s.application !== null },
  { action: 'escalate_to_human', kind: 'commit', exposedWhen: always },
  // E3 (M3): GDPR rights are always offerable — erasure to anyone (the right
  // cannot hide behind the identity data it erases), export behind the
  // verified_channel IDENTITY_REQUIREMENTS row; both survive the consent
  // halt (HALT_EXEMPT). The requests only persist WorkItems — deletion and
  // disclosure are operator approvals.
  { action: 'request_erasure', kind: 'commit', exposedWhen: always },
  { action: 'request_data_export', kind: 'commit', exposedWhen: always },
  { action: 'set_candidate_product', kind: 'commit', exposedWhen: always },
  { action: 'collect_customer_field', kind: 'commit', exposedWhen: always },
  { action: 'withdraw_consent', kind: 'commit', exposedWhen: (s) => s.consents.hasAnyEvents },
  // B3.5: verification is offerable at any point (soft, never a wall pre-gate);
  // confirm only makes sense while a live challenge is pending.
  { action: 'start_channel_verification', kind: 'commit', exposedWhen: always },
  { action: 'confirm_channel_verification', kind: 'commit', exposedWhen: (s) => s.identity.pendingChallenge !== null },
  // B3.7: offerable while any product-required document is still unvalidated
  { action: 'request_document_upload', kind: 'commit', exposedWhen: (s) => Object.values(s.documents.requirementsByTool).flat().some((k) => !s.documents.validated.includes(k)) },
  dntRule('sign_dnt', 'commit'),
  // B4.3: set_application freezes PRODUCT only — NO DNT pre-gate (T5.D1);
  // the questionnaire exposure below carries the DNT ordering flip. C2.6
  // (erratum 3, T11.D4): a decided INELIGIBLE verdict blocks with the first
  // failed-rule reason; 'unknown' is normal in discovery and never a wall.
  { action: 'set_application', kind: 'commit', exposedWhen: (s, d) => (s.product !== null || s.candidateProductId !== null) && s.application === null && d.eligibility.verdict !== 'ineligible',
    blockedReason: (s, d) => (
      // E1.6 (T11.D4): the block carries the DERIVED bounds so the agent can
      // speak the eligible range without a second rule read
      d.eligibility.verdict === 'ineligible' ? { reason: (d.eligibility.failedReasons[0] ?? 'not_exposed') as ReasonCode, params: { failedReasons: d.eligibility.failedReasons, ...(s.product?.eligibilityRules ? (({ minAge, maxAge }) => ({ minAge, maxAge }))(deriveEligibilityBounds(s.product.eligibilityRules)) : {}) } }
      : s.application !== null ? { reason: 'application_already_open', params: { applicationId: s.application.id } }
      : { reason: 'no_candidate_product' }) },
  // B4.2: lifecycle exposure comes from the pure application rules
  appRule('write_question_answer'),
  appRule('modify_answer'),
  appRule('select_coverage'),
  // resume works CROSS-conversation (T5.D4): a fresh conversation carries no
  // pointer, so the customer-scoped resumable fact drives exposure too.
  { action: 'resume_application', kind: 'commit',
    exposedWhen: (s) => appExposureFromSnapshot(s).available.includes('resume_application') || (s.resumableApplication !== null && s.resumableApplication.status !== 'REFERRED'),
    blockedReason: (s) => ((s.application?.status ?? s.resumableApplication?.status) === 'REFERRED' ? { reason: 'with_underwriter' } : null) },
  appRule('cancel_application'),
  // C3.4: the documented-warning commit — exposed exactly while a
  // warn_and_allow mismatch awaits the customer's acknowledgement.
  { action: 'acknowledge_suitability_warning', kind: 'commit',
    exposedWhen: (s, d) => s.application !== null && suitabilityAckNeeded(s, d),
    blockedReason: (s, d) => (s.application !== null && d.suitability !== null && !suitabilityAckNeeded(s, d) ? { reason: 'no_suitability_warning_pending' } : null) },
  { action: 'generate_quote', kind: 'commit',
    exposedWhen: (s, d) => d.phase === 'APPLICATION' && !s.application?.frozen && appExposureFromSnapshot(s).available.includes('generate_quote') && s.consents.gdprProcessing && !suitabilityAckNeeded(s, d) && !suitabilityHardBlocked(s, d),
    blockedReason: (s, d) => {
      // D1 (T7.D1): a Quote row in ANY state froze the application — the
      // one-app-one-quote invariant; recovery is cancel_quote + re-apply.
      if (s.application?.frozen) return { reason: 'application_frozen' }
      if (d.phase === 'QUOTE') return { reason: 'quote_already_issued' }
      // C3.4 (erratum 2): the suitability gate surfaces FIRST — the
      // documented-warning step is actionable the moment the DNT is signed,
      // before questionnaire/selection completeness; hard_block rejects with
      // the mismatch's own reason.
      if (suitabilityHardBlocked(s, d)) return { reason: (d.suitability!.mismatches[0]?.reason ?? 'not_exposed') as ReasonCode, params: { mismatches: d.suitability!.mismatches.map((m) => m.reason) } }
      if (suitabilityAckNeeded(s, d)) return { reason: 'suitability_warning_unacknowledged', params: { mismatches: d.suitability!.mismatches.map((m) => m.reason), ruleSetVersion: s.product!.suitabilityRules!.version } }
      const b = appExposureFromSnapshot(s).blocked.find((x) => x.action === 'generate_quote')
      if (b) return { reason: b.reason as ReasonCode, params: b.params }
      if (appExposureFromSnapshot(s).available.includes('generate_quote') && !s.consents.gdprProcessing) return { reason: 'requires_consent', params: { kind: 'gdpr_processing' } }
      return null
    } },
  // D2.5 (T7.D6): accept legality speaks through the ONE pure predicate —
  // expiry (shared isExpired) → transition → verified_channel identity
  // (T4-R6) → disclosure acks (T7.D2). Never re-decided in the handler
  // (erratum 1 / contradiction #6).
  { action: 'accept_quote', kind: 'commit',
    exposedWhen: (s, d) => d.phase === 'QUOTE' && s.quote !== null
      && acceptQuoteLegality({ quote: { status: s.quote.status, validUntil: new Date(s.quote.validUntil), disclosuresRequired: s.quote.disclosuresRequired ?? [] }, identity: { tier: s.identity.tier } }, new Date()).ok,
    blockedReason: (s, d) => {
      if (d.phase === 'PAYMENT' || d.phase === 'POLICY') return { reason: 'quote_already_accepted' }
      if (s.quote === null) return s.application !== null ? { reason: 'no_issued_quote' } : null
      const legality = acceptQuoteLegality({ quote: { status: s.quote.status, validUntil: new Date(s.quote.validUntil), disclosuresRequired: s.quote.disclosuresRequired ?? [] }, identity: { tier: s.identity.tier } }, new Date())
      if (legality.ok) return null
      if (legality.outcome === 'rejected') return { reason: legality.reason, params: { quoteId: s.quote.id } }
      // requires_identity / requires_disclosures — the reason IS the outcome
      // class (outcomeForBlocked); needs ride params for the envelope
      return { reason: legality.outcome, params: { needs: legality.needs } }
    } },
  // D2.3 (T7.D2): disclosure acknowledgement rides the live issued quote —
  // the accept_quote requires_disclosures gate consumes the same predicate
  // over the ack rows (D2.5).
  { action: 'acknowledge_disclosures', kind: 'commit', exposedWhen: (s) => s.quote !== null && !s.quote.expired,
    blockedReason: (s) => (
      s.quote !== null && s.quote.expired ? { reason: 'quote_expired', params: { quoteId: s.quote.id } }
      : { reason: 'no_issued_quote' }) },
  // D1.5: cancel_quote — the only quote transition the customer drives;
  // exposed exactly while a live (non-expired) ISSUED quote exists. The
  // transition table makes ACCEPTED terminal; recovery after cancel is a NEW
  // application prefilled via B4 (T13.D2).
  { action: 'cancel_quote', kind: 'commit', exposedWhen: (s) => s.quote !== null && !s.quote.expired,
    blockedReason: (s) => (
      s.quote !== null && s.quote.expired ? { reason: 'quote_expired', params: { quoteId: s.quote.id } }
      : s.acceptedQuote !== null ? { reason: 'quote_already_accepted' }
      : null) },
  // modify_quote died at D1.7 (T13.D2): post-quote mutation is engine-illegal
  // (application_frozen) — cancel_quote + a new application is the change path.
  // D3.2: the ONLY payment read — exposed once a schedule exists
  { action: 'get_payment_status', kind: 'read', exposedWhen: (s) => s.schedule.exists },
  // D4.4 (T9.D5/D6): the single @policy read — customer-scoped existence
  { action: 'get_policy_info', kind: 'read', exposedWhen: (s) => s.policy !== null },
  // D4.5 (T9.D2): free-look cancellation — the deterministic window rule IS
  // the legality (erratum-1 pattern); outside answers precisely with the
  // escalation floor (escalate_to_human is always exposed, M10).
  { action: 'request_cancellation', kind: 'commit',
    exposedWhen: (s) => s.policy !== null && freeLookDecision({ status: s.policy.status, freeLookEndsAt: s.policy.freeLookEndsAt ? new Date(s.policy.freeLookEndsAt) : null }, new Date()) === 'in_window',
    blockedReason: (s) => {
      if (s.policy === null) return null
      const d = freeLookDecision({ status: s.policy.status, freeLookEndsAt: s.policy.freeLookEndsAt ? new Date(s.policy.freeLookEndsAt) : null }, new Date())
      if (d === 'outside_window') return { reason: 'outside_free_look', params: { freeLookEndsAt: s.policy.freeLookEndsAt } }
      if (d === 'not_cancellable') return { reason: 'illegal_status_transition' }
      return null
    } },
  // D3.4 (T8.D5): pre-capture re-rating — exposed only while NOTHING has
  // been captured; the schedule supersedes, the accepted Quote never mutates.
  { action: 'change_payment_option', kind: 'commit',
    exposedWhen: (s) => s.schedule.exists && !s.schedule.settled && (s.schedule.capturedCount ?? 0) === 0,
    blockedReason: (s) => (s.schedule.exists && (s.schedule.capturedCount ?? 0) > 0 ? { reason: 'schedule_already_captured' } : null) },
  // D3.3 (T8.D4): ensure_payment_session replaces the initiate/resume/retry
  // trio — exposed while a due PENDING installment exists; a settled
  // schedule answers precisely; no Policy prerequisite (contradiction #5).
  { action: 'ensure_payment_session', kind: 'commit',
    exposedWhen: (s) => s.schedule.exists && !s.schedule.settled && s.schedule.nextDueAt !== null,
    blockedReason: (s) => (s.schedule.exists && (s.schedule.settled || s.schedule.nextDueAt === null) ? { reason: 'no_due_installment' } : null) },
]

const NEXT_BEST_PRIORITY = ['ensure_payment_session', 'accept_quote', 'generate_quote', 'select_coverage', 'write_question_answer', 'sign_dnt', 'write_dnt_answer', 'open_dnt_session', 'set_application', 'set_candidate_product', 'list_products']

export function deriveAndExpose(s: DomainSnapshot, config?: { identityRequirements?: IdentityRequirementsTable }): DeriveAndExposeResult {
  const d: Derived = { ...derivePhase(s), eligibility: deriveEligibility(s), suitability: deriveSuitability(s) }
  const identityTable = config?.identityRequirements ?? IDENTITY_REQUIREMENTS
  const available: string[] = []
  const blocked: BlockedAction[] = []
  for (const rule of ACTION_RULES) {
    if (rule.action !== 'escalate_to_human' && (s.circuit.openTools.includes(rule.action) || s.degraded.includes(`${rule.action}_backend`))) {
      blocked.push({ action: rule.action, reason: 'temporarily_unavailable' }); continue
    }
    if (rule.exposedWhen(s, d)) {
      if (rule.kind === 'commit') {
        // consent halt (B1): an explicit gdpr_processing withdrawal blocks
        // every writing commit outside the re-grant/withdraw/escalate floor.
        const consentCheck = consentBlocksCommit(s.consents, rule.action)
        if (consentCheck.blocked) {
          blocked.push({ action: rule.action, reason: consentCheck.reason! })
          continue
        }
        // identity gate (A3.6, contradiction #1): an otherwise-exposed commit
        // with an unmet identity requirement is blocked with a needs payload.
        const idCheck = checkIdentityRequirement(identityTable, rule.action, s.identity, s.documents.requirementsByTool[rule.action] ?? [], s.documents.validated)
        if (!idCheck.ok) {
          blocked.push({ action: rule.action, reason: 'requires_identity', params: { needs: idCheck.needs } })
          continue
        }
      }
      available.push(rule.action); continue
    }
    const why = rule.blockedReason?.(s, d)
    if (why) blocked.push({ action: rule.action, reason: why.reason, params: why.params })
  }
  const availableSet = new Set(available)
  const next = NEXT_BEST_PRIORITY.find((a) => availableSet.has(a))
  const flagsForReview: string[] = []
  if (s.dnt.valid && s.dnt.validUntil !== null && new Date(s.dnt.validUntil).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000) flagsForReview.push('dnt_expiring')
  for (const [field, meta] of Object.entries(s.identity.fields)) if (meta?.provenance === 'conflict') flagsForReview.push(`identity_conflict:${field}`)
  const state: DerivedStateV3 = {
    phase: d.phase, subphase: d.subphase, product: s.product,
    selection: { tier: s.application?.tier ?? null, level: s.application?.level ?? null, addon: s.application?.addon ?? null },
    identity: s.identity, consents: s.consents, dnt: s.dnt, application: s.application,
    quote: s.quote, acceptedQuote: s.acceptedQuote, schedule: s.schedule, policy: s.policy,
    eligibility: d.eligibility, suitability: d.suitability, openItems: s.openItems,
    flagsForReview,
    nextBestAction: next ? `call ${next}` : 'continue the conversation (no funnel commit is currently available)',
  }
  return { state, actions: { available, blocked } }
}
