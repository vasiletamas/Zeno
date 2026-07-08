/**
 * Tool-failure classification (Task 1.3, D8) — ONE typed vocabulary for what
 * a failure means and whether re-calling can help, attached to every failing
 * ToolResult and serialized to the model. The model never has to derive a
 * retry policy from a raw error string again.
 *
 * - transient:    infrastructure hiccup — retrying (later) can succeed
 * - validation:   the ARGS are wrong — retry with corrected args
 * - precondition: the STATE refuses it — retrying unchanged cannot help;
 *                 explain, satisfy the precondition, or escalate
 * - permanent:    the call itself is impossible (unknown tool, permission)
 */
import type { CommitResult } from '@/lib/engines/domain-types'

export type ToolErrorCode = 'transient' | 'precondition' | 'validation' | 'permanent'
export interface FailureClass { errorCode: ToolErrorCode; retryable: boolean }

export const TRANSIENT: FailureClass = { errorCode: 'transient', retryable: true }
export const VALIDATION: FailureClass = { errorCode: 'validation', retryable: true }
export const PRECONDITION: FailureClass = { errorCode: 'precondition', retryable: false }
export const PERMANENT: FailureClass = { errorCode: 'permanent', retryable: false }

/**
 * Classify a commit envelope. Null for non-failures (applied / referred /
 * pending are real state changes, not errors).
 */
export function classifyEnvelopeFailure(envelope: CommitResult): FailureClass | null {
  switch (envelope.outcome) {
    case 'applied':
    case 'referred':
    case 'pending':
      return null
    case 'unavailable':
      return TRANSIENT
    case 'requires_confirmation':
    case 'requires_identity':
    case 'requires_consent':
    case 'requires_disclosures':
      // the follow-up is a customer action (card tap, verification,
      // consent), never an identical re-call
      return PRECONDITION
    case 'rejected':
      if (envelope.reason === 'invalid_args') return VALIDATION
      if (envelope.reason === 'temporarily_unavailable') return TRANSIENT
      return PRECONDITION
  }
}
