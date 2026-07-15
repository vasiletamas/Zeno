/**
 * GDPR Handlers (E3.3/E3.5, M3)
 *
 * request_erasure / request_data_export are AGENT commits that persist a
 * WorkItem and change nothing else — deletion and disclosure are operator
 * decisions. approve_erasure / approve_export are OPERATOR_TOOLS commits
 * (the gateway actor gate rejects everyone else): approval executes the
 * retention-driven job / compiles the bundle INSIDE the gateway transaction
 * (context.db), so the domain change, the WorkItem resolution and the
 * ledger row land atomically (#8 step 6).
 *
 * The verified_channel gate on request_data_export is NOT re-implemented
 * here — it is an IDENTITY_REQUIREMENTS row consumed by the engine's
 * legality wall (contradiction #1): the gateway answers requires_identity
 * with needs ['verified_channel'] before this handler ever runs.
 */
import { createWorkItem } from '@/lib/work-items/service'
import { executeErasure } from '@/lib/gdpr/erasure'
import { compileCustomerExport } from '@/lib/gdpr/export'
import type { ToolHandler } from '@/lib/tools/types'

export const requestErasure: ToolHandler = async (args, context) => {
  try {
    const item = await createWorkItem({
      kind: 'GDPR_ERASURE', priority: 'HIGH',
      reason: (args.reason as string | undefined) ?? 'customer_requested_erasure',
      refs: { customerId: context.customerId, conversationId: context.conversationId },
      createdBy: 'agent',
    }, context.db)
    return { success: true, data: { workItemId: item.id }, message: 'Erasure request recorded for operator review. No data has been deleted yet.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const requestDataExport: ToolHandler = async (args, context) => {
  try {
    const item = await createWorkItem({
      kind: 'GDPR_EXPORT', priority: 'MEDIUM',
      reason: (args.reason as string | undefined) ?? 'customer_requested_data_export',
      refs: { customerId: context.customerId, conversationId: context.conversationId },
      createdBy: 'agent',
    }, context.db)
    return { success: true, data: { workItemId: item.id }, message: 'Data-access export request recorded for operator review.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const approveErasure: ToolHandler = async (args, context) => {
  try {
    const workItemId = args.workItemId as string
    const item = await context.db.workItem.findUnique({ where: { id: workItemId } })
    if (!item || item.kind !== 'GDPR_ERASURE') return { success: false, error: `work_item_not_found: ${workItemId}` }
    if (item.status !== 'OPEN') return { success: false, error: `work_item_not_open: ${item.status}` }
    const refs = item.refs as { customerId: string }
    const report = await executeErasure(refs.customerId, `operator:${String(context.actor ?? 'operator')}`, context.db)
    await context.db.workItem.update({
      where: { id: item.id },
      data: {
        status: 'RESOLVED', resolutionCode: 'completed', resolvedBy: 'operator', resolvedAt: new Date(),
        // per-class decisions recorded on the item; the ledger row comes from the gateway
        payload: JSON.parse(JSON.stringify(report)),
      },
    })
    return { success: true, effects: ['terminal'], data: { workItemId: item.id, classResults: report.classResults as unknown as Record<string, unknown>[] }, message: 'Erasure executed under the retention table; per-class report recorded on the work item.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const approveExport: ToolHandler = async (args, context) => {
  try {
    const workItemId = args.workItemId as string
    const item = await context.db.workItem.findUnique({ where: { id: workItemId } })
    if (!item || item.kind !== 'GDPR_EXPORT') return { success: false, error: `work_item_not_found: ${workItemId}` }
    if (item.status !== 'OPEN') return { success: false, error: `work_item_not_open: ${item.status}` }
    const refs = item.refs as { customerId: string }
    const bundle = await compileCustomerExport(refs.customerId, context.db)
    await context.db.workItem.update({
      where: { id: item.id },
      data: {
        status: 'RESOLVED', resolutionCode: 'completed', resolvedBy: 'operator', resolvedAt: new Date(),
        payload: JSON.parse(JSON.stringify(bundle)),
      },
    })
    return { success: true, data: { workItemId: item.id, schemaVersion: bundle.schemaVersion }, message: 'Export bundle compiled and stored on the work item for dashboard download.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
