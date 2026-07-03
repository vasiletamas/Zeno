/**
 * Diagnostics catalog + runner (F4.1, T14.D6). The catalog only grows —
 * the /diagnose-conversation skill's ratchet rule adds a deterministic
 * check whenever an investigation surfaces a class the checker missed.
 */
import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DiagnosticCheck, Finding } from './types'
import * as basic from './checks-basic'

export const CHECK_CATALOG: DiagnosticCheck[] = Object.values(basic)

export function runDiagnostics(e: ConversationExport, catalog: DiagnosticCheck[] = CHECK_CATALOG): Finding[] {
  return catalog.flatMap((c) => c.run(e))
}

export type { Finding, DiagnosticCheck, FindingSeverity } from './types'
