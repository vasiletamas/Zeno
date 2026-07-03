/**
 * Re-engagement job v1 (E4.5, M2): proactive outbound over two triggers —
 * abandoned payment (accepted quote, nothing captured, N days) and quote
 * nearing expiry. HARD rules live in the pure selector: verified-channel
 * customers only, marketing consent checked against the B1 ledger before
 * EVERY send (a withdrawal kills the job for that customer),
 * gdpr_processing withdrawal likewise, frequency caps from prior outbound
 * ledger events. Every outbound is a system CommitLedger event; the email
 * carries a B3 magic link that verifies AND returns to the conversation.
 * Dunning for later installments is explicitly NOT here (M16).
 */
import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import type { EmailProvider } from '@/lib/email/types'
import { RE_ENGAGEMENT_CONFIG } from '@/lib/engagement/config'
import { selectReEngagementCandidates, type ReEngagementCandidateInput, type ReEngagementTrigger } from '@/lib/engagement/select-candidates'
import { getIdentityFacts } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'
import { deriveConsents } from '@/lib/customer/consent'
import { issueChallenge } from '@/lib/customer/verification-service'
import { reEngagementEmail } from '@/lib/email/templates/re-engagement'

export interface ReEngagementReport {
  considered: number
  sent: { customerId: string; trigger: ReEngagementTrigger }[]
  skipped: number
}

const DAY = 24 * 60 * 60 * 1000
const RETURN_LINK_TTL_MS = 7 * DAY

/**
 * Raw trigger rows, one per customer: abandoned payments from D2 schedules
 * awaiting their first capture, expiring quotes from ISSUED rows inside the
 * window — enriched with the B0 tier, B1 consents and the outbound history.
 */
export async function gatherCandidateRows(now: Date): Promise<ReEngagementCandidateInput[]> {
  const byCustomer = new Map<string, { conversationId: string | null; abandonedPaymentSince: Date | null; quoteExpiresAt: Date | null }>()

  // (a) accepted quote, schedule awaiting FIRST capture — abandoned payment
  const schedules = await prisma.paymentSchedule.findMany({
    where: { status: 'PENDING_FIRST_CAPTURE' },
    include: { quote: { include: { application: { select: { originConversationId: true } } } } },
  })
  for (const s of schedules) {
    const acceptedAt = s.quote.acceptedAt ?? s.createdAt
    const entry = byCustomer.get(s.customerId) ?? { conversationId: null, abandonedPaymentSince: null, quoteExpiresAt: null }
    entry.abandonedPaymentSince = acceptedAt
    entry.conversationId = s.quote.application?.originConversationId ?? entry.conversationId
    byCustomer.set(s.customerId, entry)
  }

  // (b) ISSUED (unaccepted) quotes expiring inside the window
  const expiring = await prisma.quote.findMany({
    where: {
      status: 'ISSUED',
      validUntil: { gt: now, lte: new Date(now.getTime() + RE_ENGAGEMENT_CONFIG.quoteExpiryWindowDays * DAY) },
    },
    include: { application: { select: { originConversationId: true } } },
  })
  for (const q of expiring) {
    const entry = byCustomer.get(q.customerId) ?? { conversationId: null, abandonedPaymentSince: null, quoteExpiresAt: null }
    entry.quoteExpiresAt = q.validUntil
    entry.conversationId = entry.conversationId ?? q.application?.originConversationId ?? null
    byCustomer.set(q.customerId, entry)
  }

  const rows: ReEngagementCandidateInput[] = []
  for (const [customerId, entry] of byCustomer) {
    const facts = await getIdentityFacts(customerId)
    const consentEvents = await prisma.consentEvent.findMany({ where: { customerId } })
    const consents = deriveConsents(consentEvents)
    const lastOutbound = await prisma.commitLedger.findFirst({
      where: { customerId, tool: 're_engagement_outbound' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    rows.push({
      customerId,
      conversationId: entry.conversationId,
      identityTier: deriveIdentityTier(facts),
      marketingConsent: consents.marketing,
      gdprProcessingActive: !consents.gdprWithdrawn,
      lastOutboundAt: lastOutbound?.createdAt ?? null,
      abandonedPaymentSince: entry.abandonedPaymentSince,
      quoteExpiresAt: entry.quoteExpiresAt,
    })
  }
  return rows
}

export async function runReEngagementJob(opts: { provider?: EmailProvider; now?: Date } = {}): Promise<ReEngagementReport> {
  const now = opts.now ?? new Date()
  const provider = opts.provider ?? getEmailProvider()

  const rows = await gatherCandidateRows(now)
  const candidates = selectReEngagementCandidates(rows, RE_ENGAGEMENT_CONFIG, now)
  const sent: ReEngagementReport['sent'] = []
  for (const c of candidates) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.customerId } })
    if (!customer.email) continue
    // B3 primitive: the challenge carries the conversation, so the link
    // verifies AND returns — the standalone challenge email is suppressed.
    const { linkToken } = await issueChallenge(
      c.customerId, 'email', customer.email, c.conversationId,
      prisma,
      { send: async () => ({ messageId: 'embedded-in-re-engagement-email' }) },
      RETURN_LINK_TTL_MS,
    )
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const magicLinkUrl = `${appUrl}/api/auth/verify?token=${linkToken}`
    const locale = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
    const mail = reEngagementEmail({ trigger: c.trigger, magicLinkUrl, locale })
    await provider.send({ to: customer.email, subject: mail.subject, html: mail.html })
    await prisma.commitLedger.create({
      data: {
        conversationId: c.conversationId ?? '-',
        customerId: c.customerId,
        actor: 'system',
        tool: 're_engagement_outbound',
        targetRef: c.trigger,
        argsHash: `${c.trigger}:${c.customerId}:${now.toISOString().slice(0, 10)}`,
        outcome: 'applied',
        effects: [],
        phaseFrom: '-',
        phaseTo: '-',
        idempotencyDisposition: 'fresh',
        envelope: { outcome: 'applied', effects: [], data: { trigger: c.trigger, channel: 'email' } },
      },
    })
    sent.push({ customerId: c.customerId, trigger: c.trigger })
  }
  return { considered: rows.length, sent, skipped: rows.length - sent.length }
}
