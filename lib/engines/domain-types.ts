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
export const REASON_CODES = ['no_product_in_focus', 'no_open_application', 'application_already_open', 'application_paused', 'no_candidate_product', 'invalid_level_for_tier', 'illegal_status_transition', 'with_underwriter', 'requires_consent', 'gdpr_processing_withdrawn', 'dnt_not_signed', 'dnt_incomplete', 'dnt_expired', 'dnt_session_already_active', 'dnt_session_incomplete', 'no_active_dnt_session', 'questionnaire_incomplete', 'selection_incomplete', 'quote_already_issued', 'no_issued_quote', 'quote_expired', 'quote_already_accepted', 'requires_confirmation', 'requires_identity', 'requires_disclosures', 'already_applied', 'stale_confirm_token', 'invalid_args', 'handler_rejected', 'temporarily_unavailable', 'degraded_mode', 'no_policy', 'payment_not_pending', 'actor_not_permitted', 'work_item_not_found', 'work_item_not_open', 'permission_denied', 'not_exposed'] as const
export type ReasonCode = (typeof REASON_CODES)[number]

export type CommitActor = 'agent' | 'gui' | 'system' | 'operator'
export type Provenance = 'declared' | 'verified' | 'conflict'

export interface DomainSnapshot {
  conversationId: string
  customerId: string
  product: { id: string; code: string; insuranceType: string } | null // committed > candidate
  candidateProductId: string | null
  identity: { tier: IdentityTier; fields: Record<string, { provenance: Provenance } | undefined>; verifiedChannels: ('email' | 'sms')[]; pendingChallenge: { channel: 'email' | 'sms' } | null } // tier DERIVED by the loader via identity-rules (B3.2), never stored; pendingChallenge = live unconsumed VerificationChallenge (B3.5 exposure fact)
  consents: { gdprProcessing: boolean; aiDisclosure: boolean; marketing: boolean; gdprWithdrawn: boolean; hasAnyEvents: boolean } // derived from the ConsentEvent ledger (B1); gdprWithdrawn = latest gdpr event is an explicit withdrawal
  dnt: {
    // legacy conversation-stamp semantics — retired at B2.6 with the columns
    signed: boolean; valid: boolean; validUntil: string | null; coversProductTypes: string[]; answeredCount: number; totalCount: number; sessionActive: boolean
    // B2 aggregate facts (customer-scoped)
    latest: { status: string; signedAt: string; validUntil: string; productTypesCovered: string[] } | null
    activeSessionId: string | null
    sessionType: string | null
    sessionAnswered: number
    sessionTotal: number
  }
  application: { id: string; status: 'OPEN' | 'PAUSED' | 'REFERRED' | 'COMPLETED' | 'CANCELLED'; tier: string | null; level: string | null; addon: boolean | null; answeredCount: number; requiredCount: number; missingCodes: string[] } | null // full T5.D6 set (B4); the loader nulls CANCELLED pointers
  /**
   * B4.6 cross-conversation resume (T5.D4): the customer's live application
   * ANYWHERE — present even when this conversation carries no pointer yet,
   * so resume_application can be exposed in a fresh conversation.
   */
  resumableApplication: { id: string; status: 'OPEN' | 'PAUSED' | 'REFERRED' } | null
  quote: { id: string; status: string; premiumAnnual: number; validUntil: string; expired: boolean } | null // issued, unaccepted
  acceptedQuote: { id: string; acceptedAt: string | null } | null
  schedule: { exists: boolean; settled: boolean; nextDueAt: string | null; lastPaymentStatus: string | null } // Block D re-points; loader stubs exists:false
  policy: { id: string; status: string } | null
  eligibility: { verdict: 'eligible' | 'ineligible' | 'unknown' } // engine lands per contradiction #9 (other block)
  suitability: { verdict: 'suitable' | 'conditionally_suitable' | 'unsuitable' | 'unknown' } // M7 (other block)
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
  schedule: DomainSnapshot['schedule']
  policy: DomainSnapshot['policy']
  eligibility: DomainSnapshot['eligibility']
  suitability: DomainSnapshot['suitability']
  openItems: DomainSnapshot['openItems']
  /**
   * Alert-worthy facts the agent should not miss (A3.ADD-1/T13.D8): identity
   * fields in conflict state, an expiring DNT, and — once B4 lands the
   * status — a REFERRED application. Snake_case codes, never prose.
   */
  flagsForReview: string[]
  nextBestAction: string // MUST only name actions present in ExposedActions.available
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
}
