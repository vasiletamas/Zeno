/**
 * Policy Handlers (D4.4/D4.5)
 *
 * get_policy_info is the SINGLE @policy read (T9.D5), customer-scoped
 * (T9.D6 — it survives the sale conversation): status language is
 * ENGINE-GATED via stable snake_case codes; the agent never narrates
 * in-force before ACTIVE (contradiction #5: PENDING_SUBMISSION is
 * 'paid_processing', codes only — A4's POLICY section localizes).
 */
import { deriveSchedulePosition } from '@/lib/engines/payment-position'
import type { ToolHandler } from '@/lib/tools/types'

/** M6: statusCode contract consumed by A4's POLICY prompt section. */
const POLICY_STATUS_CODES: Record<string, string> = {
  PENDING_SUBMISSION: 'paid_processing',
  SUBMITTED: 'submitted_to_insurer',
  ACTIVE: 'policy_active',
  CANCELLED: 'policy_cancelled',
  LAPSED: 'policy_lapsed',
  EXPIRED: 'policy_expired',
}

export const getPolicyInfo: ToolHandler = async (_args, context) => {
  try {
    // customer-scoped: the newest non-terminal policy; terminal ones only
    // when nothing live exists (an honest cancelled/expired answer)
    const policy =
      (await context.db.policy.findFirst({
        where: { customerId: context.customerId, status: { in: ['PENDING_SUBMISSION', 'SUBMITTED', 'ACTIVE', 'LAPSED'] } },
        orderBy: { createdAt: 'desc' },
      })) ??
      (await context.db.policy.findFirst({
        where: { customerId: context.customerId },
        orderBy: { createdAt: 'desc' },
      }))
    if (!policy) {
      return { success: false, error: 'no_policy: no policy exists for this customer.' }
    }

    const schedule = await context.db.paymentSchedule.findFirst({
      where: { quoteId: policy.quoteId, status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE', 'COMPLETED'] } },
      include: { installments: { orderBy: { sequence: 'asc' }, include: { payments: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const pos = schedule
      ? deriveSchedulePosition({ installments: schedule.installments, payments: schedule.installments.flatMap((i) => i.payments), now: new Date() })
      : null

    const documents = await context.db.document.findMany({
      where: { OR: [{ policyId: policy.id }, { quoteId: policy.quoteId }] },
      orderBy: { generatedAt: 'desc' },
    })

    const statusCode = POLICY_STATUS_CODES[policy.status] ?? 'paid_processing'
    return {
      success: true,
      data: {
        policyId: policy.id,
        statusCode,
        allianzPolicyNumber: policy.allianzPolicyNumber,
        activatedAt: policy.activatedAt?.toISOString() ?? null,
        effectiveFrom: policy.effectiveFrom?.toISOString() ?? null,
        effectiveUntil: policy.effectiveUntil?.toISOString() ?? null,
        freeLookEndsAt: policy.freeLookEndsAt?.toISOString() ?? null,
        premiumAnnual: policy.premiumAnnual,
        currency: policy.currency,
        schedule: schedule && pos
          ? { frequency: schedule.frequency, capturedCount: pos.capturedCount, totalInstallments: schedule.totalInstallments, nextDue: pos.nextDue ? { sequence: pos.nextDue.sequence, amountMinor: pos.nextDue.amountMinor, dueAt: pos.nextDue.dueAt.toISOString() } : null, settled: pos.settled }
          : null,
        documents: documents.map((d) => ({ kind: d.kind, version: d.version, language: d.language, url: `/api/documents/${d.id}` })),
      },
      message: `Policy status code: ${statusCode}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
