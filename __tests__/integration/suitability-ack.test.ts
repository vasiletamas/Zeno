import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)
const ack = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'acknowledge_suitability_warning', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx(fx.customerId, fx.conversationId) })

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'financial_and_investment' }) // unsuitable facts
})

describe('acknowledge_suitability_warning', () => {
  it('persists the ack with the mismatches + ruleset version and ledger linkage', async () => {
    const res = await ack(fx)
    expect(res.outcome).toBe('applied')
    const row = await prisma.suitabilityWarningAck.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(row.ruleSetVersion).toBe(1)
    expect(row.mismatches).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'product_has_no_investment_component' })]))
    expect(row.sourceCommitId).toBeTruthy() // ledger row id — documented-warning audit trail
    const ledger = await prisma.commitLedger.findUnique({ where: { id: row.sourceCommitId } })
    expect(ledger?.tool).toBe('acknowledge_suitability_warning')
  })

  it('is idempotent: replay returns the original outcome, no second row (gateway #8 order)', async () => {
    await ack(fx)
    const replay = await ack(fx)
    expect(replay.outcome).toBe('applied')
    expect(await prisma.suitabilityWarningAck.count({ where: { customerId: fx.customerId } })).toBe(1)
  })

  it('unlocks generate_quote: the suitability block clears once the warning is acknowledged (C3 erratum 2)', async () => {
    const { deriveAndExpose } = await import('@/lib/engines/derive-and-expose')
    const { loadDomainSnapshot } = await import('@/lib/engines/snapshot-loader')
    const before = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(before.actions.blocked.find((b) => b.action === 'generate_quote')?.reason).toBe('suitability_warning_unacknowledged')
    expect(before.actions.available).toContain('acknowledge_suitability_warning')
    await ack(fx)
    const after = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(after.actions.blocked.find((b) => b.action === 'generate_quote')?.reason).not.toBe('suitability_warning_unacknowledged')
    expect(after.actions.available).not.toContain('acknowledge_suitability_warning')
  })

  it('rejected when there is nothing to acknowledge (suitable verdict)', async () => {
    await resetDb()
    const clean = await seedMinimalProtectFixture()
    await signDntWithFacts(clean, { DNT_LIFE_SUBTYPE: 'simple_protection' })
    const res = await ack(clean)
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('no_suitability_warning_pending')
  })
})
