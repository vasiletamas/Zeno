/**
 * Outbound customer notifier (E2.4 / M2 / M5): sends in the customer's
 * language (M6) and records the outbound as a system CommitLedger event —
 * the compliance trail covers messages the customer never asked for.
 */
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import type { EmailProvider } from '@/lib/email/types'

export interface OutboundNotification {
  customerId: string
  conversationId: string
  kind: 'referral_rejected' | 'referral_approved' | 're_engagement'
  subject: { ro: string; en: string }
  html: { ro: string; en: string }
}

export async function sendCustomerNotification(
  input: OutboundNotification,
  provider: EmailProvider = getEmailProvider(),
): Promise<{ sent: boolean; reason?: 'no_email_channel' }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } })
  if (!customer.email) return { sent: false, reason: 'no_email_channel' }
  const locale = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
  await provider.send({ to: customer.email, subject: input.subject[locale], html: input.html[locale] })
  await prisma.commitLedger.create({
    data: {
      conversationId: input.conversationId,
      customerId: input.customerId,
      actor: 'system',
      tool: 'notification_sent',
      targetRef: input.kind,
      argsHash: `${input.kind}:${input.customerId}:${Date.now()}`,
      outcome: 'applied',
      effects: [],
      phaseFrom: '-',
      phaseTo: '-',
      idempotencyDisposition: 'fresh',
      envelope: { outcome: 'applied', effects: [], data: { kind: input.kind, channel: 'email' } },
    },
  })
  return { sent: true }
}
