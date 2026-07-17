/**
 * Diagnostics catalog + runner (F4.1, T14.D6). The catalog only grows —
 * the /diagnose-conversation skill's ratchet rule adds a deterministic
 * check whenever an investigation surfaces a class the checker missed.
 */
import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DiagnosticCheck, Finding } from './types'
import * as basic from './checks-basic'
import * as behavioral from './checks-behavioral'
import * as verification from './checks-verification'
import * as ui from './checks-ui'
import * as paymentFunnel from './checks-payment-funnel'
import { questionnaireAnswerFabricated, stateClaimWithoutCommit } from './checks-fabrication'
import { hallucinatedUiReference } from './checks-cards'
import { staleGateClaim } from './checks-supersession'
import { blockedActionAttempted, missingConsequences, recomputeDriftFindings, type RecomputeOptions } from './checks-envelope'

const isCheck = (v: unknown): v is DiagnosticCheck =>
  typeof v === 'object' && v !== null && 'id' in v && 'run' in v

export const CHECK_CATALOG: DiagnosticCheck[] = [
  ...Object.values(basic),
  ...Object.values(behavioral).filter(isCheck), // skips the exported trigramSimilarity helper
  ...Object.values(verification),
  // T29 ratchet (2026-07-15): emitted-but-unrendered uiAction types
  ...Object.values(ui),
  // T30 ratchet (2026-07-15): funnel recorded as ending at the payment card
  ...Object.values(paymentFunnel),
  blockedActionAttempted,
  missingConsequences,
  // P0-1 ratchet (2026-07-06): fabrication + false-claim nets
  questionnaireAnswerFabricated,
  stateClaimWithoutCommit,
  // T11 ratchet (2026-07-15): card references with no emitted card that turn
  hallucinatedUiReference,
  // T13 ratchet (2026-07-17): stale-gate refusal — an enabling result this
  // turn, zero calls to the enabled action, impossibility prose about it
  staleGateClaim,
]

export function runDiagnostics(
  e: ConversationExport,
  catalog: DiagnosticCheck[] = CHECK_CATALOG,
  opts?: RecomputeOptions,
): Finding[] {
  const findings = catalog.flatMap((c) => c.run(e))
  // recompute_drift is opt-in (erratum 2): synthetic fixtures must never
  // hit the real deriveAndExpose
  if (opts?.currentEngineVersion) findings.push(...recomputeDriftFindings(e, opts))
  return findings
}

export type { Finding, DiagnosticCheck, FindingSeverity } from './types'
