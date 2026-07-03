/**
 * Policy notifications (D4.3) — best-effort side effects AFTER an applied
 * operator commit; a mail failure never rolls back an activation.
 */
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import { policyActivatedEmail } from '@/lib/email/templates/policy-activated'
import { logError } from '@/lib/errors/logger'

export async function sendPolicyActivatedEmail(policyId: string): Promise<void> {
  try {
    const policy = await prisma.policy.findUniqueOrThrow({
      where: { id: policyId },
      include: { customer: { select: { email: true, name: true, language: true } } },
    })
    if (!policy.customer.email || !policy.allianzPolicyNumber || !policy.activatedAt) return
    const { subject, html } = policyActivatedEmail({
      customerName: policy.customer.name ?? 'Client',
      allianzPolicyNumber: policy.allianzPolicyNumber,
      effectiveFrom: policy.effectiveFrom ?? policy.activatedAt,
      effectiveUntil: policy.effectiveUntil,
      freeLookEndsAt: policy.freeLookEndsAt,
      language: policy.customer.language === 'en' ? 'en' : 'ro',
    })
    await getEmailProvider().send({ to: policy.customer.email, subject, html })
  } catch (error) {
    logError({
      layer: 'tool', category: 'policy_notifications',
      message: `policy-activated email failed for ${policyId} (activation stands)`,
      context: { policyId }, error,
    })
  }
}
