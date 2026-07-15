import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getQuoteInfo } from '@/lib/tools/handlers/quote-handlers'
import { buildIssuedQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { seedDocuments } from '@/prisma/seeds/seed-documents'

const ack = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'acknowledge_disclosures', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('acknowledge_disclosures commit (D2.3, T7.D2)', () => {
  beforeEach(async () => { await resetDb(); await seedDocuments(prisma) })

  it('ack writes one row per current disclosure doc bound to version+language, with ledger linkage', async () => {
    const fx = await buildIssuedQuote()
    const res = await ack(fx)
    expect(res.outcome).toBe('applied')
    const rows = await prisma.disclosureAck.findMany({ where: { customerId: fx.customerId } })
    expect(rows.map((r) => `${r.kind}:${r.version}:${r.language}`).sort()).toEqual(['IPID:1:ro', 'TERMS:1:ro'])
    expect(rows.every((r) => r.sourceCommitId !== null)).toBe(true)
  })

  it('a second identical call is an idempotent no-op (state-guarded, not a stored replay — P1-4)', async () => {
    const fx = await buildIssuedQuote()
    const first = await ack(fx)
    const second = await ack(fx)
    expect(first.outcome).toBe('applied')
    expect(second.outcome).toBe('applied')
    // REPLAY_EXEMPT: duplicates are answered by re-running the idempotent
    // handler (missing-docs computation + @@unique belt), so no duplicate rows
    // — a version bump between calls would now be acknowledged, not replayed.
    expect(await prisma.disclosureAck.count()).toBe(2)
  })

  it('get_quote_info lists disclosures_required before the ack and [] after', async () => {
    const fx = await buildIssuedQuote()
    const before = await getQuoteInfo({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect((before.data as { disclosures_required: { kind: string }[] }).disclosures_required.map((d) => d.kind).sort()).toEqual(['IPID', 'TERMS'])
    await ack(fx)
    const after = await getQuoteInfo({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect((after.data as { disclosures_required: unknown[] }).disclosures_required).toEqual([])
  })
})
