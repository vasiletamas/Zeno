/**
 * Policy Operator Handlers (D4.2, M5 — T9.D3)
 *
 * mark_submitted / activate_policy / cancel_submission run through the
 * commit gateway with actor=operator (the OPERATOR_TOOLS actor gate rejects
 * everyone else). Every transition is legality-checked against the pure
 * policy machine — the free-form any→any admin edits died with these.
 * State rides context.db (the gateway transaction) so the policy update
 * lands atomically with the CommitLedger row.
 *
 * Operator commits are keyed to the policy's ORIGIN conversation, resolved
 * by the caller (deviation from D4 erratum 6 recorded: a nullable
 * conversationId would break the per-conversation advisory-lock key and the
 * pinned ledger shape; E2's resolve_referral established the
 * caller-resolves-conversation pattern instead).
 *
 * Activation writes the T9.D2 per-policy free-look snapshot: freeLookEndsAt
 * is FROZEN from Product.freeLookDays at activation — later product-config
 * changes never move a sold policy's window. cancel_submission gains the
 * refund system-effect at D4.5 (contradiction #5's second trigger).
 */
import { jsPDF } from 'jspdf'
import { canPolicyTransition, type PolicyStatusV3 } from '@/lib/engines/policy-machine'
import { executeFullRefund } from '@/lib/payments/refunds'
import { createDocument } from '@/lib/documents/registry'
import type { ToolHandler } from '@/lib/tools/types'

export const markSubmitted: ToolHandler = async (args, context) => {
  try {
    const policyId = args.policyId as string
    const policy = await context.db.policy.findUnique({ where: { id: policyId } })
    if (!policy) return { success: false, error: `not_exposed: policy ${policyId} not found` }
    if (!canPolicyTransition(policy.status as PolicyStatusV3, 'SUBMITTED', 'operator')) {
      return { success: false, error: `illegal_status_transition: ${policy.status} → SUBMITTED is not an operator transition.` }
    }
    await context.db.policy.update({ where: { id: policy.id }, data: { status: 'SUBMITTED' } })
    return { success: true, data: { policyId: policy.id, status: 'SUBMITTED' }, message: 'Policy marked as submitted to the insurer.' }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const activatePolicy: ToolHandler = async (args, context) => {
  try {
    const policyId = args.policyId as string
    const allianzPolicyNumber = args.allianzPolicyNumber as string
    const policy = await context.db.policy.findUnique({ where: { id: policyId }, include: { product: { select: { freeLookDays: true } } } })
    if (!policy) return { success: false, error: `not_exposed: policy ${policyId} not found` }
    if (!canPolicyTransition(policy.status as PolicyStatusV3, 'ACTIVE', 'operator')) {
      return { success: false, error: `illegal_status_transition: ${policy.status} → ACTIVE is not an operator transition.` }
    }
    const activatedAt = new Date()
    const effectiveUntil = new Date(activatedAt)
    effectiveUntil.setUTCFullYear(effectiveUntil.getUTCFullYear() + 1) // 1-year contractTerm
    const freeLookEndsAt = new Date(activatedAt.getTime() + policy.product.freeLookDays * 86_400_000) // frozen snapshot (T9.D2)
    await context.db.policy.update({
      where: { id: policy.id },
      // issuedAt untouched — single-meaning: first capture (D2.6)
      data: { status: 'ACTIVE', allianzPolicyNumber, activatedAt, effectiveFrom: activatedAt, effectiveUntil, freeLookEndsAt },
    })
    // D4.6: the POLICY_SCHEDULE document registers with the activation —
    // coverages, premium, Allianz number, effective dates
    try {
      const full = await context.db.policy.findUniqueOrThrow({ where: { id: policy.id }, include: { customer: { select: { language: true } } } })
      const lang = full.customer.language === 'en' ? 'en' : 'ro'
      const pdf = new jsPDF()
      pdf.setFontSize(16)
      pdf.text(lang === 'ro' ? 'Specificația poliței' : 'Policy schedule', 14, 20)
      pdf.setFontSize(11)
      const lines = [
        `${lang === 'ro' ? 'Număr poliță Allianz' : 'Allianz policy number'}: ${allianzPolicyNumber}`,
        `${lang === 'ro' ? 'Primă anuală' : 'Annual premium'}: ${full.premiumAnnual} ${full.currency}`,
        `${lang === 'ro' ? 'Valabilă de la' : 'Effective from'}: ${activatedAt.toISOString().split('T')[0]}`,
        `${lang === 'ro' ? 'Valabilă până la' : 'Effective until'}: ${effectiveUntil.toISOString().split('T')[0]}`,
        `${lang === 'ro' ? 'Drept de renunțare până la' : 'Free-look until'}: ${freeLookEndsAt.toISOString().split('T')[0]}`,
      ]
      lines.forEach((l, i) => pdf.text(l, 14, 32 + i * 7))
      pdf.text(JSON.stringify(full.coverageSummary).slice(0, 180), 14, 75, { maxWidth: 180 })
      await createDocument({
        kind: 'POLICY_SCHEDULE',
        language: lang,
        bytes: Buffer.from(pdf.output('arraybuffer')),
        source: 'GENERATED',
        customerId: full.customerId,
        policyId: full.id,
        quoteId: full.quoteId,
      }, context.db)
    } catch {
      // document failure never blocks activation — the registry can be
      // backfilled by an operator re-run
    }
    return {
      success: true,
      effects: ['terminal'],
      data: { policyId: policy.id, status: 'ACTIVE', allianzPolicyNumber, activatedAt: activatedAt.toISOString(), freeLookEndsAt: freeLookEndsAt.toISOString() },
      message: `Policy activated with Allianz number ${allianzPolicyNumber}; free-look until ${freeLookEndsAt.toISOString().split('T')[0]}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export const cancelSubmission: ToolHandler = async (args, context) => {
  try {
    const policyId = args.policyId as string
    const policy = await context.db.policy.findUnique({ where: { id: policyId } })
    if (!policy) return { success: false, error: `not_exposed: policy ${policyId} not found` }
    if (!canPolicyTransition(policy.status as PolicyStatusV3, 'CANCELLED', 'operator')) {
      return { success: false, error: `illegal_status_transition: ${policy.status} → CANCELLED is not an operator transition (post-activation cancellation is the engine's free-look).` }
    }
    await context.db.policy.update({ where: { id: policy.id }, data: { status: 'CANCELLED' } })
    // contradiction #5, second trigger: pre-activation cancellation /
    // Allianz rejection refunds every captured payment of the schedule.
    const schedule = await context.db.paymentSchedule.findFirst({
      where: { quoteId: policy.quoteId, status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const refunded = schedule ? await executeFullRefund(context.db, schedule.id) : { refundedCount: 0 }
    return {
      success: true,
      effects: ['terminal'],
      data: { policyId: policy.id, status: 'CANCELLED', refundedCount: refunded.refundedCount },
      message: `Policy submission cancelled; ${refunded.refundedCount} captured payment(s) refunded.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
