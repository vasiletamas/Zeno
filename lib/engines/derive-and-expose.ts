import type { DomainSnapshot, Phase, AppSubphase } from './domain-types'
import type { BlockedAction, DeriveAndExposeResult, DerivedStateV3, ReasonCode } from './domain-types'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS, type IdentityRequirementsTable } from './identity-requirements'
import { consentBlocksCommit } from './consent-rules'

/**
 * Engine version stamp carried in every per-turn legality snapshot
 * (debug:gate payload) so recompute-and-diff replay can tell which rule set
 * produced a historical exposure (T14.D2). Bump on ANY change to derivePhase,
 * ACTION_RULES, or NEXT_BEST_PRIORITY.
 */
export const engineVersion = '1.5.0' // 1.3.0: update_customer_profile retired (B0.1); 1.4.0: standalone consent tools retired — capture folds into sign_dnt (B1.1); 1.5.0: gdpr-withdrawn halt rule in exposure (B1.3)

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

type Derived = { phase: Phase; subphase: AppSubphase | null }
export interface ActionRule {
  action: string
  kind: 'read' | 'commit'
  exposedWhen: (s: DomainSnapshot, d: Derived) => boolean
  blockedReason?: (s: DomainSnapshot, d: Derived) => { reason: ReasonCode; params?: Record<string, unknown> } | null
}
const always = () => true

export const ACTION_RULES: ActionRule[] = [
  { action: 'list_products', kind: 'read', exposedWhen: always },
  { action: 'get_product_info', kind: 'read', exposedWhen: always },
  { action: 'compare_products', kind: 'read', exposedWhen: always },
  { action: 'preview_product_requirements', kind: 'read', exposedWhen: always },
  { action: 'get_current_state', kind: 'read', exposedWhen: always },
  { action: 'get_objection_strategy', kind: 'read', exposedWhen: always },
  { action: 'get_customer_profile', kind: 'read', exposedWhen: always },
  { action: 'check_dnt_status', kind: 'read', exposedWhen: (s) => s.product !== null || s.dnt.signed },
  { action: 'get_quote_details', kind: 'read', exposedWhen: (s) => s.quote !== null || s.acceptedQuote !== null },
  { action: 'escalate_to_human', kind: 'commit', exposedWhen: always },
  { action: 'set_candidate_product', kind: 'commit', exposedWhen: always },
  { action: 'switch_product', kind: 'commit', exposedWhen: (s) => s.product !== null },
  { action: 'collect_customer_field', kind: 'commit', exposedWhen: always },
  { action: 'start_dnt_questionnaire', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.valid && s.dnt.answeredCount < s.dnt.totalCount,
    blockedReason: (s) => (s.product === null ? { reason: 'no_product_in_focus' } : null) },
  { action: 'save_dnt_answer', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.signed && s.dnt.totalCount > 0 && s.dnt.answeredCount < s.dnt.totalCount },
  { action: 'sign_dnt', kind: 'commit', exposedWhen: (s) => s.product !== null && !s.dnt.signed && s.dnt.totalCount > 0 && s.dnt.answeredCount >= s.dnt.totalCount,
    blockedReason: (s) => (s.product !== null && !s.dnt.signed && s.dnt.answeredCount < s.dnt.totalCount ? { reason: 'dnt_incomplete', params: { answered: s.dnt.answeredCount, total: s.dnt.totalCount } } : null) },
  { action: 'start_application', kind: 'commit', exposedWhen: (s) => s.product !== null && s.dnt.valid && s.application === null,
    blockedReason: (s) => (s.application !== null ? { reason: 'application_already_open' } : s.product !== null && !s.dnt.valid ? { reason: s.dnt.signed ? 'dnt_expired' : 'dnt_not_signed' } : null) },
  { action: 'save_application_answer', kind: 'commit', exposedWhen: (s) => s.application?.status === 'OPEN' && s.application.missingCodes.length > 0 },
  { action: 'set_answer', kind: 'commit', exposedWhen: (s) => s.application !== null },
  { action: 'change_selection', kind: 'commit', exposedWhen: (s) => s.application !== null },
  { action: 'resume_application', kind: 'commit', exposedWhen: (s) => s.application?.status === 'PAUSED' },
  { action: 'cancel_application', kind: 'commit', exposedWhen: (s) => s.application !== null && s.application.status !== 'COMPLETED' },
  { action: 'check_bd_eligibility', kind: 'commit', exposedWhen: (s) => s.application !== null && s.application.addon === true },
  { action: 'generate_quote', kind: 'commit', exposedWhen: (s, d) => d.phase === 'APPLICATION' && d.subphase === 'QUOTE_GENERATION' && s.consents.gdprProcessing,
    blockedReason: (s, d) => (d.subphase === 'QUOTE_GENERATION' && !s.consents.gdprProcessing ? { reason: 'requires_consent', params: { kind: 'gdpr_processing' } } : d.subphase === 'QUESTIONNAIRE' ? { reason: 'questionnaire_incomplete', params: { missing: s.application?.missingCodes.slice(0, 5) } } : d.phase === 'QUOTE' ? { reason: 'quote_already_issued' } : null) },
  { action: 'accept_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE',
    blockedReason: (s, d) => (d.phase === 'PAYMENT' || d.phase === 'POLICY' ? { reason: 'quote_already_accepted' } : s.application !== null && d.phase !== 'QUOTE' ? { reason: 'no_issued_quote' } : null) },
  { action: 'modify_quote', kind: 'commit', exposedWhen: (_s, d) => d.phase === 'QUOTE' },
  { action: 'initiate_payment', kind: 'commit', exposedWhen: (s) => s.policy !== null && s.policy.status === 'PENDING_SUBMISSION' },
]

const NEXT_BEST_PRIORITY = ['initiate_payment', 'accept_quote', 'generate_quote', 'save_application_answer', 'sign_dnt', 'save_dnt_answer', 'start_dnt_questionnaire', 'start_application', 'set_candidate_product', 'list_products']

export function deriveAndExpose(s: DomainSnapshot, config?: { identityRequirements?: IdentityRequirementsTable }): DeriveAndExposeResult {
  const d = derivePhase(s)
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
        const idCheck = checkIdentityRequirement(identityTable, rule.action, s.identity)
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
    eligibility: s.eligibility, suitability: s.suitability, openItems: s.openItems,
    flagsForReview,
    nextBestAction: next ? `call ${next}` : 'continue the conversation (no funnel commit is currently available)',
  }
  return { state, actions: { available, blocked } }
}
