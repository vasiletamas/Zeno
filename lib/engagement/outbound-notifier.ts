/**
 * Outbound customer notifier (E2.4 / E4.ADD-1 / M2 / M5): sends in the
 * customer's language (M6) and records the outbound as a system
 * CommitLedger event — the compliance trail covers messages the customer
 * never asked for. Transactional notices (referral outcomes) are exempt
 * from marketing consent; campaigns (the re-engagement job) run their own
 * consent gates in the pure selector.
 *
 * E4.ADD-1: a `{{magicLink}}` placeholder in the html is replaced with a
 * B3 challenge link that verifies AND returns to the conversation; a
 * `dedupeKey` makes the send once-only — a replayed resolution never
 * mails twice.
 */
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import type { EmailProvider } from '@/lib/email/types'
import { issueChallenge } from '@/lib/customer/verification-service'

export interface OutboundNotification {
  customerId: string
  conversationId: string
  kind: 'referral_rejected' | 'referral_approved' | 're_engagement'
  subject: { ro: string; en: string }
  html: { ro: string; en: string }
  /** Send-once key (ledger targetRef); a prior send with the same key skips. */
  dedupeKey?: string
}

const RETURN_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function sendCustomerNotification(
  input: OutboundNotification,
  provider: EmailProvider = getEmailProvider(),
): Promise<{ sent: boolean; reason?: 'no_email_channel' | 'already_sent' }> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } })
  if (!customer.email) return { sent: false, reason: 'no_email_channel' }
  const targetRef = input.dedupeKey ?? input.kind
  if (input.dedupeKey) {
    const prior = await prisma.commitLedger.findFirst({ where: { tool: 'notification_sent', targetRef } })
    if (prior) return { sent: false, reason: 'already_sent' }
  }
  const locale = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
  let html = input.html[locale]
  if (html.includes('{{magicLink}}')) {
    // B3 primitive: the challenge carries the conversation — the link
    // verifies AND returns; the standalone challenge email is suppressed.
    const { linkToken } = await issueChallenge(
      input.customerId, 'email', customer.email, input.conversationId,
      prisma,
      { send: async () => ({ messageId: 'embedded-in-notification' }) },
      RETURN_LINK_TTL_MS,
    )
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    html = html.replaceAll('{{magicLink}}', `${appUrl}/api/auth/verify?token=${linkToken}`)
  }
  await provider.send({ to: customer.email, subject: input.subject[locale], html })
  await prisma.commitLedger.create({
    data: {
      conversationId: input.conversationId,
      customerId: input.customerId,
      actor: 'system',
      tool: 'notification_sent',
      targetRef,
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
