import type { EligibilityRuleSet } from './eligibility'
import type { SuitabilityRuleSet, SuitabilityResult } from './suitability'

export const PHASES = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const
export type Phase = (typeof PHASES)[number]
export const APP_SUBPHASES = ['DNT', 'QUESTIONNAIRE', 'QUOTE_GENERATION'] as const
export type AppSubphase = (typeof APP_SUBPHASES)[number]
export const IDENTITY_TIERS = ['anonymous', 'declared', 'verified_channel'] as const
export type IdentityTier = (typeof IDENTITY_TIERS)[number]
export const COMMIT_OUTCOMES = ['applied', 'rejected', 'referred', 'pending', 'unavailable', 'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures'] as const
export type CommitOutcome = (typeof COMMIT_OUTCOMES)[number]
export const COMMIT_EFFECTS = ['advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand', 'questions_removed', 'eligibility_recheck', 'terminal'] as const
export type CommitEffect = (typeof COMMIT_EFFECTS)[number]
export const REASON_CODES = ['no_product_in_focus', 'no_open_application', 'application_already_open', 'application_paused', 'no_candidate_product', 'invalid_level_for_tier', 'illegal_status_transition', 'with_underwriter', 'requires_consent', 'gdpr_processing_withdrawn', 'dnt_not_signed', 'dnt_incomplete', 'dnt_expired', 'dnt_session_already_active', 'dnt_session_incomplete', 'no_active_dnt_session', 'questionnaire_incomplete', 'selection_incomplete', 'quote_already_issued', 'no_issued_quote', 'quote_expired', 'quote_already_accepted', 'requires_confirmation', 'requires_identity', 'requires_disclosures', 'already_applied', 'stale_confirm_token', 'invalid_args', 'handler_rejected', 'temporarily_unavailable', 'degraded_mode', 'no_policy', 'payment_not_pending', 'actor_not_permitted', 'work_item_not_found', 'work_item_not_open', 'permission_denied', 'not_exposed', 'validity_dependency_changed', 'removed_by_branch', 'addon_ineligible_medical_history', 'ineligible_age_minimum', 'ineligible_age_maximum', 'ineligible_residency', 'addon_age_band_unavailable', 'one_facet_per_commit', 'eligibility_facts_missing', 'suitability_warning_unacknowledged', 'no_suitability_warning_pending', 'product_has_no_investment_component', 'severe_conditions_demand_needs_addon', 'compliance_block', 'application_frozen', 'manual_underwriting', 'no_due_installment', 'schedule_already_captured', 'outside_free_look'] as const
export type ReasonCode = (typeof REASON_CODES)[number]

export type CommitActor = 'agent' | 'gui' | 'system' | 'operator'
export type Provenance = 'declared' | 'verified' | 'conflict'

export interface DomainSnapshot {
  conversationId: string
  customerId: string
  product: { id: string; code: string; insuranceType: string; eligibilityRules?: EligibilityRuleSet | null; suitabilityRules?: SuitabilityRuleSet | null } | null // committed > candidate; eligibilityRules = the PARSED typed ruleset (C2.6), null/absent when the row carries no engine-evaluable rules
  candidateProductId: string | null
  identity: { tier: IdentityTier; fields: Record<string, { provenance: Provenance } | undefined>; verifiedChannels: ('email' | 'sms')[]; pendingChallenge: { channel: 'email' | 'sms' } | null } // tier DERIVED by the loader via identity-rules (B3.2), never stored; pendingChallenge = live unconsumed VerificationChallenge (B3.5 exposure fact)
  consents: { gdprProcessing: boolean; aiDisclosure: boolean; marketing: boolean; gdprWithdrawn: boolean; hasAnyEvents: boolean } // derived from the ConsentEvent ledger (B1); gdprWithdrawn = latest gdpr event is an explicit withdrawal
  dnt: {
    // legacy conversation-stamp semantics — retired at B2.6 with the columns
    signed: boolean; valid: boolean; validUntil: string | null; coversProductTypes: string[]; answeredCount: number; totalCount: number; sessionActive: boolean
    // B2 aggregate facts (customer-scoped)
    latest: { id?: string; status: string; signedAt: string; validUntil: string; productTypesCovered: string[] } | null // id (E4.2) = open-item refId
    activeSessionId: string | null
    sessionType: string | null
    sessionAnswered: number
    sessionTotal: number
    /** First visible unanswered question code of the ACTIVE session, in the handler's walk order (group orderIndex, question orderIndex). Null when no session or complete. Optional — undefined ≡ null — keeps pre-existing test literals compiling. */
    pendingCode?: string | null
    /** C3.3: the SIGNED Dnt's answers (questionCode → value) — the suitability facts. Empty until a Dnt exists. */
    facts: Record<string, string>
  }
  application: { id: string; status: 'OPEN' | 'PAUSED' | 'REFERRED' | 'COMPLETED' | 'CANCELLED'; tier: string | null; level: string | null; addon: boolean | null; answeredCount: number; requiredCount: number; missingCodes: string[]; frozen: boolean; createdAt?: string } | null // frozen (D1, T7.D1): frozenAt set OR a Quote row exists in ANY state — post-quote mutation is engine-illegal // full T5.D6 set (B4); the loader nulls CANCELLED pointers; createdAt (E4.2) feeds open-item age
  /**
   * B4.6 cross-conversation resume (T5.D4): the customer's live application
   * ANYWHERE — present even when this conversation carries no pointer yet,
   * so resume_application can be exposed in a fresh conversation.
   */
  resumableApplication: { id: string; status: 'OPEN' | 'PAUSED' | 'REFERRED' } | null
  /**
   * Tools whose LATEST ledger row in this conversation is requires_confirmation
   * (a confirm card is displayed, awaiting the customer's tap). The briefing
   * uses it to countermand re-calling the tool (2026-07-06 sign_dnt loop).
   * Optional — undefined ≡ [] — keeps pre-existing test literals compiling.
   */
  pendingConfirmationTools?: string[]
  quote: { id: string; status: string; premiumAnnual: number; validUntil: string; expired: boolean; disclosuresRequired?: { kind: string; version: number; language: string }[]; createdAt?: string } | null // issued, unaccepted; disclosuresRequired (D2.5, T7.D2) = current disclosure docs lacking an exact-identity ack — the loader always sets it; undefined ≡ [] keeps pre-D2 test literals compiling; createdAt (E4.2) feeds open-item age
  acceptedQuote: { id: string; acceptedAt: string | null } | null
  schedule: { exists: boolean; settled: boolean; nextDueAt: string | null; lastPaymentStatus: string | null; capturedCount?: number; id?: string | null } // D2.5 live; capturedCount (D3.4) = PAID installments — gates change_payment_option pre-capture only; id (E4.2) = open-item refId
  policy: { id: string; status: string; freeLookEndsAt?: string | null; createdAt?: string } | null // freeLookEndsAt (D4.5): the FROZEN per-policy window feeding the free-look exposure rule; createdAt (E4.2) feeds open-item age
  /**
   * C2.6: identity-class eligibility facts (age from the B0 derivation —
   * DOB or declaredAge, NEVER a stored snapshot or a 30-fallback; residency
   * derived from a declared/verified CNP). Answer facts ride `answers`.
   */
  eligibilityFacts: Record<string, string | number | boolean>
  /** C3.4: the customer's suitability acks for the ACTIVE application — a stale ruleset version never satisfies the gate. */
  suitabilityAcks: { ruleSetVersion: number }[]
  /**
   * B3.7 (#1 productDocuments): per-commit document requirements from
   * Product.verificationRequirements plus the customer's VALIDATED document
   * kinds — consumed by the identity gate and request_document_upload
   * exposure.
   */
  documents: { requirementsByTool: Record<string, string[]>; validated: string[] }
  openItems: Array<{ kind: string; refId: string }>
  circuit: { openTools: string[] } // M10 input to exposure (per-tool circuits)
  /**
   * Degraded BACKENDS (A3.ADD-2, M10.3): '<tool>_backend' entries block the
   * matching tool with temporarily_unavailable. Backend circuits land with
   * their blocks (e.g. the payment provider in D3); the loader stubs [].
   */
  degraded: string[]
  answers: Record<string, string>
}

export interface DerivedStateV3 {
  phase: Phase
  subphase: AppSubphase | null
  product: DomainSnapshot['product']
  selection: { tier: string | null; level: string | null; addon: boolean | null }
  identity: DomainSnapshot['identity']
  consents: DomainSnapshot['consents']
  dnt: DomainSnapshot['dnt']
  application: DomainSnapshot['application']
  quote: DomainSnapshot['quote']
  acceptedQuote: DomainSnapshot['acceptedQuote'] // D2.5: stable quote ref across ISSUED→ACCEPTED (gateway targetRef + phase)
  schedule: DomainSnapshot['schedule']
  policy: DomainSnapshot['policy']
  /** C2.6: the discovery verdict — DERIVED per turn from the product rules (subject 'product'), never stored. */
  eligibility: { verdict: 'eligible' | 'ineligible' | 'unknown'; missingFacts: string[]; failedReasons: string[] }
  /** C3.3 (M7): derived post-sign_dnt from the product's suitability rules; null before — no fit claims possible. */
  suitability: SuitabilityResult | null
  openItems: DomainSnapshot['openItems']
  /**
   * Alert-worthy facts the agent should not miss (A3.ADD-1/T13.D8): identity
   * fields in conflict state, an expiring DNT, and — once B4 lands the
   * status — a REFERRED application. Snake_case codes, never prose.
   */
  flagsForReview: string[]
  nextBestAction: string // MUST only name actions present in ExposedActions.available
  /** Mirrors DomainSnapshot.pendingConfirmationTools — see that doc comment. */
  pendingConfirmationTools?: string[]
}

export interface BlockedAction { action: string; reason: ReasonCode; params?: Record<string, unknown> }
export interface ExposedActions { available: string[]; blocked: BlockedAction[] }
export interface DeriveAndExposeResult { state: DerivedStateV3; actions: ExposedActions }

export interface CommitResult {
  outcome: CommitOutcome
  reason?: ReasonCode
  effects: CommitEffect[]
  phaseDelta?: { from: Phase; to: Phase }
  data?: unknown
  confirmToken?: string
  needs?: string[]
  /**
   * F2.2 (erratum 2): the CommitLedger row id, stamped at write time so the
   * stored and returned envelopes agree — the deterministic turn↔ledger join
   * key. On a replay this stays the ORIGINAL applied row's id.
   */
  ledgerId?: string
  /** 'replay' when the ledger answered instead of the handler (F2.4 counter). */
  disposition?: 'fresh' | 'replay'
}
