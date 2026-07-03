import type { DomainSnapshot, Phase, AppSubphase } from './domain-types'
import type { BlockedAction, DeriveAndExposeResult, DerivedStateV3, ReasonCode } from './domain-types'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS, type IdentityRequirementsTable } from './identity-requirements'
import { consentBlocksCommit } from './consent-rules'
import { dntExposure, type DntFact, type ProductTypeStr } from './dnt-rules'
import { applicationExposure, canTransition, type AppStatus } from './application-rules'
import { evaluateEligibility } from './eligibility'

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

const appRule = (action: string): ActionRule => ({
  action,
  kind: 'commit',
  exposedWhen: (s) => appExposureFromSnapshot(s).available.includes(action),
  blockedReason: (s) => {
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
export const engineVersion = '1.17.0' // 1.15.0: modify_answer exposed on OPEN/PAUSED apps with answers behind the DNT gate (C1.5, erratum 10); 1.16.0: pinned questionnaire surface (C1.ADD-1/2) — write_question_answer renames the save commit, get_next_question read with branching provenance, check_bd_eligibility retired; 1.17.0: discovery eligibility verdict DERIVED per turn (C2.6) — DerivedStateV3.eligibility from the typed rules, INELIGIBLE blocks set_application with the failed-rule reason (erratum 3), unknown never a wall

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

type Derived = { phase: Phase; subphase: AppSubphase | null; eligibility: DerivedStateV3['eligibility'] }
export interface ActionRule {
  action: string
  kind: 'read' | 'commit'
  exposedWhen: (s: DomainSnapshot, d: Derived) => boolean
  blockedReason?: (s: DomainSnapshot, d: Derived) => { reason: ReasonCode; params?: Record<string, unknown> } | null
}
const always = () => true

/**
 * The discovery eligibility verdict (C2.6, #9): ONE evaluator over the
 * product's typed rules — subject 'product' (addon rules are the consequence
 * planner's and the D1 gate's business). Facts = identity-class facts from
 * the B0 derivation plus prefixed active-answer facts. No rules → unknown.
 */
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
  { action: 'get_quote_details', kind: 'read', exposedWhen: (s) => s.quote !== null || s.acceptedQuote !== null },
  { action: 'get_last_application_info', kind: 'read', exposedWhen: always }, // B4.6 prefill-as-proposals read
  // C1.ADD-1: the pinned questionnaire read — next question + progress +
  // structured branching provenance (T13.D1)
  { action: 'get_next_question', kind: 'read', exposedWhen: (s) => s.application !== null },
  { action: 'escalate_to_human', kind: 'commit', exposedWhen: always },
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
      d.eligibility.verdict === 'ineligible' ? { reason: (d.eligibility.failedReasons[0] ?? 'not_exposed') as ReasonCode, params: { failedReasons: d.eligibility.failedReasons } }
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
  { action: 'generate_quote', kind: 'commit',
    exposedWhen: (s, d) => d.phase === 'APPLICATION' && appExposureFromSnapshot(s).available.includes('generate_quote') && s.consents.gdprProcessing,
    blockedReason: (s, d) => {
      if (d.phase === 'QUOTE') return { reason: 'quote_already_issued' }
      const b = appExposureFromSnapshot(s).blocked.find((x) => x.action === 'generate_quote')
      if (b) return { reason: b.reason as ReasonCode, params: b.params }
      if (appExposureFromSnapshot(s).available.includes('generate_quote') && !s.consents.gdprProcessing) return { reason: 'requires_consent', params: { kind: 'gdpr_processing' } }
      return null
    } },
  { action: 'accept_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE',
    blockedReason: (s, d) => (d.phase === 'PAYMENT' || d.phase === 'POLICY' ? { reason: 'quote_already_accepted' } : s.application !== null && d.phase !== 'QUOTE' ? { reason: 'no_issued_quote' } : null) },
  { action: 'modify_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE' },
  { action: 'initiate_payment', kind: 'commit', exposedWhen: (s) => s.policy !== null && s.policy.status === 'PENDING_SUBMISSION' },
]

const NEXT_BEST_PRIORITY = ['initiate_payment', 'accept_quote', 'generate_quote', 'select_coverage', 'write_question_answer', 'sign_dnt', 'write_dnt_answer', 'open_dnt_session', 'set_application', 'set_candidate_product', 'list_products']

export function deriveAndExpose(s: DomainSnapshot, config?: { identityRequirements?: IdentityRequirementsTable }): DeriveAndExposeResult {
  const d: Derived = { ...derivePhase(s), eligibility: deriveEligibility(s) }
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
    quote: s.quote, schedule: s.schedule, policy: s.policy,
    eligibility: d.eligibility, suitability: s.suitability, openItems: s.openItems,
    flagsForReview,
    nextBestAction: next ? `call ${next}` : 'continue the conversation (no funnel commit is currently available)',
  }
  return { state, actions: { available, blocked } }
}
