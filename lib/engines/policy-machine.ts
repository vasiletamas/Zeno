/**
 * Pure policy state machine (D4.1, T9.D3) — no DB.
 *
 * An explicit transition table with EXCLUSIVE per-transition owners: the
 * payment module creates PENDING_SUBMISSION (D2.6, contradiction #5),
 * operators own the submission pipeline and pre-activation cancellation
 * (Allianz rejection), the ENGINE owns the free-look ACTIVE→CANCELLED, and
 * system jobs own LAPSED/EXPIRED (M16: the lapse detection job is
 * explicitly deferred — the row exists so LAPSED is never a dead orphan).
 * The agent owns NOTHING.
 */
export type PolicyStatusV3 = 'PENDING_SUBMISSION' | 'SUBMITTED' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'LAPSED'
export type TransitionOwner = 'payment_module' | 'operator' | 'engine' | 'system'
export interface PolicyTransition { from: PolicyStatusV3; to: PolicyStatusV3; owner: TransitionOwner }

export const POLICY_TRANSITIONS: PolicyTransition[] = [
  { from: 'PENDING_SUBMISSION', to: 'SUBMITTED', owner: 'operator' },
  { from: 'SUBMITTED', to: 'ACTIVE', owner: 'operator' },
  { from: 'PENDING_SUBMISSION', to: 'CANCELLED', owner: 'operator' }, // Allianz rejection pre-submission review
  { from: 'SUBMITTED', to: 'CANCELLED', owner: 'operator' },          // Allianz rejection
  { from: 'ACTIVE', to: 'CANCELLED', owner: 'engine' },               // free-look request_cancellation
  { from: 'ACTIVE', to: 'LAPSED', owner: 'system' },                  // M16: detection job deferred; row defined now
  { from: 'LAPSED', to: 'ACTIVE', owner: 'system' },                  // reinstatement
  { from: 'ACTIVE', to: 'EXPIRED', owner: 'system' },                 // term end
]

export function canPolicyTransition(from: PolicyStatusV3, to: PolicyStatusV3, owner: TransitionOwner): boolean {
  return POLICY_TRANSITIONS.some((t) => t.from === from && t.to === to && t.owner === owner)
}
