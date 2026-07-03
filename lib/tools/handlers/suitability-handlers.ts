/**
 * acknowledge_suitability_warning (C3.4, M7.2b) — the documented-warning
 * commit: the customer explicitly acknowledges a demands-and-needs mismatch
 * and chooses to proceed. The ack row is created from the CURRENT engine
 * verdict (never from agent-provided args — args are empty by design) and
 * names the ledger row that carried it (sourceCommitId), bound to the
 * ruleset version so a rule change re-arms the warning.
 */
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveSuitability } from '@/lib/engines/derive-and-expose'
import { loadActiveApplication } from './application-handlers'
import type { ToolHandler } from '@/lib/tools/types'

export const acknowledgeSuitabilityWarning: ToolHandler = async (_args, context) => {
  try {
    const application = await loadActiveApplication(context)
    if (!application || application.status === 'CANCELLED') {
      return { success: false, error: 'no_open_application: the warning is acknowledged on an open application.' }
    }
    const snapshot = await loadDomainSnapshot(context.conversationId, context.db)
    const suitability = deriveSuitability(snapshot)
    const rules = snapshot.product?.suitabilityRules
    if (!rules || !suitability || suitability.verdict === 'suitable') {
      return { success: false, error: 'no_suitability_warning_pending: the current verdict carries no mismatch to acknowledge.' }
    }
    const existing = await context.db.suitabilityWarningAck.findFirst({
      where: { customerId: context.customerId, applicationId: application.id, ruleSetVersion: rules.version },
    })
    if (existing) {
      return { success: false, error: 'no_suitability_warning_pending: this warning was already acknowledged.' }
    }
    const row = await context.db.suitabilityWarningAck.create({
      data: {
        customerId: context.customerId,
        applicationId: application.id,
        productCode: snapshot.product!.code,
        ruleSetVersion: rules.version,
        mismatches: JSON.parse(JSON.stringify(suitability.mismatches.map((m) => ({ ruleId: m.rule.id, reason: m.reason })))),
        sourceCommitId: context.commitId ?? crypto.randomUUID(),
      },
    })
    return {
      success: true,
      data: {
        acknowledged: true,
        verdict: suitability.verdict,
        mismatches: suitability.mismatches.map((m) => m.reason),
        ruleSetVersion: rules.version,
        ackId: row.id,
      },
      message: 'Suitability warning acknowledged — the customer chose to proceed with the documented mismatch. The quote is now available.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
