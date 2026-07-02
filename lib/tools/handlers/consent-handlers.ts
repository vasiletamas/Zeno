/**
 * Consent Handlers
 *
 * withdraw_consent — appends a withdrawal event to the append-only ledger.
 * Kind validation lives in the zod schema (gateway step 5); the halt rule
 * lives in the engine (consentBlocksCommit). sourceCommitId linkage to the
 * CommitLedger row is not wired yet — the row is written after the handler
 * runs inside the same transaction.
 */

import { appendConsentEvents } from '@/lib/customer/consent-service'
import type { ToolHandler } from '@/lib/tools/types'

export const withdrawConsent: ToolHandler = async (args, context) => {
  const kind = args.kind as 'gdpr_processing' | 'ai_disclosure' | 'marketing'
  const scope = typeof args.scope === 'string' ? args.scope : undefined
  try {
    await appendConsentEvents(context.customerId, [{ kind, action: 'withdrawn', scope }], undefined, context.db)
    return {
      success: true,
      data: { kind, action: 'withdrawn' },
      message: context.language === 'en'
        ? `Consent withdrawn (${kind}). Your data is preserved; processing stops.`
        : `Consimțământ retras (${kind}). Datele tale rămân păstrate; prelucrarea se oprește.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
