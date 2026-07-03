import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { runReEngagementJob } from '@/lib/engagement/re-engagement-job'
import type { EmailProvider } from '@/lib/email/types'

function recordingProvider(): EmailProvider & { sent: { to: string; subject: string; html: string }[] } {
  const sent: { to: string; subject: string; html: string }[] = []
  return {
    sent,
    async send(input: { to: string; subject: string; html: string }) {
      sent.push(input)
      return { success: true, messageId: `m${sent.length}` }
    },
  } as unknown as EmailProvider & { sent: { to: string; subject: string; html: string }[] }
}

/** buildIssuedQuote + full KYC + consumed challenge (verified_channel) + B1 marketing grant + quote expiring in 2 days. */
async function seedVerifiedConsentingCustomerWithExpiringQuote() {
  const fx = await buildIssuedQuote()
  await setDeclaredField(fx.customerId, 'name', 'Ion Fixture', 'fixture')
  const email = `fx-${fx.customerId}@example.com`
  await setDeclaredField(fx.customerId, 'email', email, 'fixture')
  await setDeclaredField(fx.customerId, 'phone', '+40712345678', 'fixture')
  await prisma.verificationChallenge.create({
    data: { customerId: fx.customerId, channel: 'email', target: email, codeHash: 'fixture', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  await prisma.consentEvent.create({ data: { customerId: fx.customerId, kind: 'marketing', action: 'granted' } })
  await prisma.quote.update({ where: { id: fx.quoteId }, data: { validUntil: new Date(Date.now() + 2 * 86400e3) } })
  await prisma.customer.update({ where: { id: fx.customerId }, data: { email } })
  return { ...fx, email }
}

describe('re-engagement job v1 (E4.5, M2)', () => {
  beforeEach(async () => { await resetDb() })

  it('emails a verified, consenting customer whose quote nears expiry — magic link returns to the conversation', async () => {
    const fx = await seedVerifiedConsentingCustomerWithExpiringQuote()
    const provider = recordingProvider()
    const report = await runReEngagementJob({ provider, now: new Date() })
    expect(report.sent).toHaveLength(1)
    expect(report.sent[0]).toMatchObject({ customerId: fx.customerId, trigger: 'quote_expiring' })
    expect(provider.sent[0].to).toBe(fx.email)
    expect(provider.sent[0].html).toMatch(/\/api\/auth\/verify\?token=/) // B3 challenge URL — verifies AND returns
    const ledger = await prisma.commitLedger.findMany({ where: { tool: 're_engagement_outbound', actor: 'system' } })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].customerId).toBe(fx.customerId)
  })

  it('second run within the frequency cap sends nothing', async () => {
    await seedVerifiedConsentingCustomerWithExpiringQuote()
    const provider = recordingProvider()
    await runReEngagementJob({ provider, now: new Date() })
    const second = await runReEngagementJob({ provider, now: new Date() })
    expect(second.sent).toHaveLength(0)
    expect(provider.sent).toHaveLength(1)
  })

  it('marketing withdrawal in the B1 ledger silences the customer', async () => {
    const fx = await seedVerifiedConsentingCustomerWithExpiringQuote()
    await prisma.consentEvent.create({ data: { customerId: fx.customerId, kind: 'marketing', action: 'withdrawn' } })
    const provider = recordingProvider()
    const report = await runReEngagementJob({ provider, now: new Date() })
    expect(report.sent).toHaveLength(0)
    expect(provider.sent).toHaveLength(0)
  })

  it('a non-verified customer with an expiring quote is never emailed (hard rule)', async () => {
    const fx = await buildIssuedQuote()
    await prisma.consentEvent.create({ data: { customerId: fx.customerId, kind: 'marketing', action: 'granted' } })
    await prisma.quote.update({ where: { id: fx.quoteId }, data: { validUntil: new Date(Date.now() + 2 * 86400e3) } })
    const provider = recordingProvider()
    const report = await runReEngagementJob({ provider, now: new Date() })
    expect(report.sent).toHaveLength(0)
  })
})
