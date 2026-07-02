/**
 * Consent legality predicate — PURE, consumed by deriveAndExpose (A1).
 *
 * An explicit gdpr_processing withdrawal halts every writing commit except
 * the floor that keeps the customer able to escalate, withdraw further, or
 * RE-GRANT: re-granting happens through the DNT signing path, so the DNT
 * commits themselves must stay reachable (B1 erratum 2 — otherwise sign_dnt
 * is exempt but unreachable and re-granting deadlocks).
 */
import type { DerivedConsents } from '@/lib/customer/consent'

const HALT_EXEMPT = new Set([
  'withdraw_consent',
  'escalate_to_human',
  // the re-grant path: reach + complete + sign a DNT questionnaire
  'start_dnt_questionnaire',
  'save_dnt_answer',
  'sign_dnt',
])

export function consentBlocksCommit(
  c: DerivedConsents,
  commitTool: string,
): { blocked: boolean; reason?: 'gdpr_processing_withdrawn' } {
  if (c.gdprWithdrawn && !HALT_EXEMPT.has(commitTool)) return { blocked: true, reason: 'gdpr_processing_withdrawn' }
  return { blocked: false }
}
