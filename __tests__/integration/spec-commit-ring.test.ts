/**
 * Commit-ring spec translations (F1.7, T12.D3 — REAL test DB, no mocked
 * prisma). Placed in the integration ring per erratum 8: these files
 * truncate shared tables, and the integration project serializes them and
 * aliases DATABASE_URL <-> TEST_DATABASE_URL before '@/lib/db' loads.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { spec } from '@/lib/spec/registry'
import { executeCommit, REPLAY_NOTICE } from '@/lib/tools/gateway'
import { resetDb, seedMinimalProtectFixture, ensureTestProduct } from '../helpers/test-db'
import { buildAcceptReadyQuote, buildReadyApplication, fixtureCtx } from '../helpers/funnel-fixtures'
import { writeRevision } from '@/lib/engines/answer-store'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('Feature: agent is a client of the domain — commit ring', () => {
  beforeEach(async () => { await resetDb() })

  it(spec('contract/idempotent-on-double-submit') + ' accept_quote twice = one effect, replay envelope', async () => {
    const fx = await buildAcceptReadyQuote()
    const accept = (args: Record<string, unknown>) =>
      executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    const ask = await accept({ paymentOption: 'quarterly' })
    expect(ask.outcome).toBe('requires_confirmation')
    const first = await accept({ paymentOption: 'quarterly', confirmToken: ask.confirmToken })
    const second = await accept({ paymentOption: 'quarterly', confirmToken: ask.confirmToken })
    expect(first.outcome).toBe('applied')
    // ORIGINAL facts returned (gateway order #8 step 2), replay-stamped;
    // presentation is STRIPPED on replay (spec 2026-07-20 §3): _uiAction
    // dropped, card-directive _message swapped for the neutral notice.
    const { data: freshData, ...freshRest } = first
    const { data: replayData, ...replayRest } = second
    expect(replayRest).toEqual({ ...freshRest, disposition: 'replay' })
    const fd = freshData as Record<string, unknown>
    const rd = replayData as Record<string, unknown>
    expect(rd.acceptedAt).toBe(fd.acceptedAt)                 // facts untouched
    expect(rd.firstInstallment).toEqual(fd.firstInstallment)  // facts untouched
    expect(rd._uiAction).toBeUndefined()
    expect(rd._message).toBe(REPLAY_NOTICE)
    expect(await prisma.paymentSchedule.count({ where: { quoteId: fx.quoteId } })).toBe(1)
    const ledger = await prisma.commitLedger.findMany({ where: { tool: 'accept_quote', conversationId: fx.conversationId, outcome: 'applied' } })
    expect(ledger.map((r) => r.idempotencyDisposition).sort()).toEqual(['fresh', 'replay'])
    // same target, different material args -> conflict, not a second effect
    const conflict = await accept({ paymentOption: 'annual', confirmToken: ask.confirmToken })
    expect(conflict.outcome).toBe('rejected')
    expect(await prisma.paymentSchedule.count({ where: { quoteId: fx.quoteId } })).toBe(1)
  })

  it(spec('lifecycle/one-application-one-quote') + ' a quote row in ANY state makes further changes illegal', async () => {
    const fx = await buildReadyApplication()
    const gq = () => executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    const first = await gq()
    expect(first.outcome).toBe('applied')
    const second = await gq()
    expect(second.outcome).toBe('rejected')
    expect(second.reason).toBe('application_frozen')
    expect(await prisma.quote.count()).toBe(1)
    // "that application accepts no further answers": the frozen application
    // rejects answer mutations too
    const modify = await executeCommit({ tool: 'select_coverage', args: { tier: 'optim' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    expect(modify.outcome).toBe('rejected')
  })

  it(spec('questionnaire/modify-answer-consequence#ex4') + ' dependency change deletes dependent rows with causality (cascade_invalidate in envelope + ledger)', async () => {
    const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY, value: 'false', source: 'USER_ANSWER' })
    const ctx = { customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma } as unknown as ToolContext
    const res = await executeCommit({ tool: 'select_coverage', args: { tier: 'optim' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('cascade_invalidate')
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.levelId).toBeNull() // dependent selection actually cleared in Postgres
    const row = await prisma.commitLedger.findFirstOrThrow({ where: { conversationId: fx.conversationId, tool: 'select_coverage', outcome: 'applied' } })
    expect(row.effects).toContain('cascade_invalidate')
  })

  it(spec('contract/concurrent-gui-and-agent-consistent') + ' advisory lock: exactly one fresh apply, no double effect', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    const submit = (actor: 'gui' | 'agent') =>
      executeCommit({ tool: 'set_candidate_product', args: { productId: product.id }, actor, conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    const [a, b] = await Promise.all([submit('gui'), submit('agent')])
    expect([a.outcome, b.outcome]).toEqual(['applied', 'applied']) // loser gets the replayed original
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'set_candidate_product' } })
    expect(rows.map((r) => r.idempotencyDisposition).sort()).toEqual(['fresh', 'replay'])
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })
    expect(after.candidateProductId).toBe(product.id)
  })
})
