/**
 * Operator Handlers (E2.4/E2.5 — M5)
 *
 * resolve_referral / resolve_work_item run through the commit gateway with
 * actor=operator|system (the gateway's OPERATOR_TOOLS actor gate rejects
 * everyone else with actor_not_permitted). State changes ride context.db —
 * the gateway transaction — so item/application updates are atomic with the
 * ledger row.
 *
 * Follow-up commits (the approve→generate_quote re-run, the reject→outbound
 * notification) CANNOT run inside the same gateway transaction: a nested
 * executeCommit would try to take the same per-conversation advisory lock
 * from a second connection and deadlock. lib/work-items/resolution.ts is the
 * route-facing orchestrator: each step is its own top-level ledgered commit.
 * (It lives there, not here, so the registry→handlers import stays acyclic.)
 */
import type { ToolHandler } from '@/lib/tools/types'

type ReferralRefs = { applicationId: string; customerId: string; conversationId: string }

// ─────────────────────────────────────────────
// resolve_referral (gateway commit; in-tx state changes only)
// ─────────────────────────────────────────────

export const resolveReferral: ToolHandler = async (args, context) => {
  const workItemId = args.workItemId as string
  const decision = args.decision as 'approve' | 'reject'
  const note = typeof args.note === 'string' ? args.note : undefined
  const resolvedBy = typeof args.resolvedBy === 'string' ? args.resolvedBy : String(context.actor ?? 'operator')
  try {
    const item = await context.db.workItem.findUnique({ where: { id: workItemId } })
    if (!item || item.kind !== 'REFERRAL') return { success: false, error: `work_item_not_found: ${workItemId}` }
    if (item.status !== 'OPEN') return { success: false, error: `work_item_not_open: ${item.status}` }
    const refs = item.refs as ReferralRefs

    if (decision === 'approve') {
      // B4 status machine: REFERRED → OPEN is the underwriter-approval
      // re-entry (canTransition); the follow-up system generate_quote runs
      // on the OPEN, answers-complete application. D1: approval CONSUMES the
      // escalate flags — the underwriter reviewed exactly them; the audit
      // trail lives on the WorkItem. Leaving them would re-refer forever.
      const app = await context.db.application.findUnique({ where: { id: refs.applicationId }, select: { flagsForReview: true } })
      const remaining = (Array.isArray(app?.flagsForReview) ? (app!.flagsForReview as Array<Record<string, unknown>>) : [])
        .filter((f) => f?.action !== 'escalate')
      await context.db.application.update({ where: { id: refs.applicationId }, data: { status: 'OPEN', flagsForReview: JSON.parse(JSON.stringify(remaining)) } })
      await context.db.workItem.update({
        where: { id: item.id },
        data: { status: 'RESOLVED', resolutionCode: 'approved', resolution: note ?? null, resolvedBy, resolvedAt: new Date() },
      })
      return { success: true, data: { workItemId: item.id, decision, refs }, message: 'Referral approved; quote generation resumes as a system commit.' }
    }

    await context.db.application.update({
      where: { id: refs.applicationId },
      data: { status: 'CANCELLED', flagsForReview: { underwriterReason: note ?? 'declined' } },
    })
    await context.db.workItem.update({
      where: { id: item.id },
      data: { status: 'RESOLVED', resolutionCode: 'rejected', resolution: note ?? null, resolvedBy, resolvedAt: new Date() },
    })
    return { success: true, data: { workItemId: item.id, decision, refs, terminal: true }, message: 'Referral rejected; application terminated with the underwriter reason.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// resolve_work_item (generic: ESCALATION / ALERT_FLAG resolve|dismiss)
// ─────────────────────────────────────────────

export const resolveWorkItem: ToolHandler = async (args, context) => {
  const workItemId = args.workItemId as string
  const decision = args.decision as 'resolve' | 'dismiss'
  const note = typeof args.note === 'string' ? args.note : undefined
  const resolvedBy = typeof args.resolvedBy === 'string' ? args.resolvedBy : String(context.actor ?? 'operator')
  try {
    const item = await context.db.workItem.findUnique({ where: { id: workItemId } })
    if (!item) return { success: false, error: `work_item_not_found: ${workItemId}` }
    if (item.status !== 'OPEN' && item.status !== 'IN_PROGRESS') return { success: false, error: `work_item_not_open: ${item.status}` }
    const status = decision === 'dismiss' ? 'DISMISSED' : 'RESOLVED'
    await context.db.workItem.update({
      where: { id: item.id },
      data: { status, resolutionCode: decision === 'dismiss' ? 'dismissed' : 'resolved', resolution: note ?? null, resolvedBy, resolvedAt: new Date() },
    })
    return { success: true, data: { workItemId: item.id, status }, message: `Work item ${status.toLowerCase()}.` }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
