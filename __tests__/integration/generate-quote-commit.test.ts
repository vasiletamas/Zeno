import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildReadyApplication, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

const gq = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('generate_quote commit (D1.4)', () => {
  beforeEach(async () => { await resetDb() })

  it('issued: creates Quote(ISSUED) and freezes the application in one transaction; the suitability report registers', async () => {
    const fx = await buildReadyApplication()
    const res = await gq(fx)
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
    expect(quote.status).toBe('ISSUED')
    expect(quote.paymentFrequency).toBeNull() // elected at accept, not at issue
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.frozenAt).not.toBeNull()
    expect(app.status).toBe('COMPLETED')
    expect((app.quoteDecision as { outcome: string }).outcome).toBe('issued')
    // C3.6 flip: the suitability report is generated AT ISSUANCE
    const doc = await prisma.document.findFirst({ where: { quoteId: quote.id, kind: 'SUITABILITY_REPORT' } })
    expect(doc).not.toBeNull()
  })

  it('referred: NO Quote row, Application REFERRED, WorkItem(REFERRAL) created, decision persisted', async () => {
    const fx = await buildReadyApplication({ escalationFlag: 'HEALTH_DECLARATION_CONFIRM' })
    const res = await gq(fx)
    expect(res.outcome).toBe('referred')
    expect(res.reason).toBe('manual_underwriting')
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('REFERRED')
    expect((app.quoteDecision as { outcome: string }).outcome).toBe('referred')
    const wi = await prisma.workItem.findFirstOrThrow({ where: { kind: 'REFERRAL' } }) // E2 model
    expect(wi.refs).toMatchObject({ applicationId: fx.applicationId })
  })

  it('missing DOB and CNP: requires_identity with needs, no quote, no silent age-30 pricing', async () => {
    const fx = await buildReadyApplication({ withoutDob: true })
    const res = await gq(fx)
    expect(res.outcome).toBe('requires_identity')
    expect(res.needs).toContain('declared:cnp_or_dateOfBirth') // B3 needs vocabulary (pinned literal adapted)
    expect(await prisma.quote.findUnique({ where: { applicationId: fx.applicationId } })).toBeNull()
  })

  it('a quote row in ANY state makes generate_quote illegal (one-app-one-quote; no P2002 path)', async () => {
    const fx = await buildReadyApplication()
    await gq(fx)
    const second = await gq(fx)
    expect(second.outcome).toBe('rejected')
    expect(second.reason).toBe('application_frozen')
  })
})
