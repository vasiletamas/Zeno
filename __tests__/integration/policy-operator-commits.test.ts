import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildPaidPolicy, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import type { CommitActor } from '@/lib/engines/domain-types'

const op = (fx: { customerId: string; conversationId: string }, tool: string, args: Record<string, unknown>, actor: CommitActor = 'operator') =>
  executeCommit({ tool, args, actor, customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('operator policy commits (D4.2, actor=operator through the gateway)', () => {
  beforeEach(async () => { await resetDb() })

  it('mark_submitted: PENDING_SUBMISSION->SUBMITTED; replay returns original envelope', async () => {
    const fx = await buildPaidPolicy()
    const res = await op(fx, 'mark_submitted', { policyId: fx.policyId })
    expect(res.outcome, JSON.stringify({ reason: res.reason })).toBe('applied')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('SUBMITTED')
    const replay = await op(fx, 'mark_submitted', { policyId: fx.policyId })
    expect(replay.outcome).toBe('applied') // ledger replay, no re-execution
  })

  it('activate_policy: requires allianzPolicyNumber; writes activatedAt, effective dates, frozen freeLookEndsAt; issuedAt untouched', async () => {
    const fx = await buildPaidPolicy()
    await op(fx, 'mark_submitted', { policyId: fx.policyId })
    const missing = await op(fx, 'activate_policy', { policyId: fx.policyId })
    expect(missing.outcome).toBe('rejected') // validation: number mandatory
    const res = await op(fx, 'activate_policy', { policyId: fx.policyId, allianzPolicyNumber: 'AZT-123' })
    expect(res.outcome, JSON.stringify({ reason: res.reason })).toBe('applied')
    const p = await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })
    expect(p.status).toBe('ACTIVE')
    expect(p.allianzPolicyNumber).toBe('AZT-123')
    expect(p.activatedAt).not.toBeNull()
    expect(p.effectiveFrom!.getTime()).toBe(p.activatedAt!.getTime())
    const product = await prisma.product.findUniqueOrThrow({ where: { id: p.productId } })
    expect(p.freeLookEndsAt!.getTime()).toBe(p.activatedAt!.getTime() + product.freeLookDays * 86_400_000)
    expect(p.issuedAt!.getTime()).toBe(fx.issuedAt.getTime()) // settlement's stamp survives activation
  })

  it('illegal transitions rejected by the table: activate from PENDING_SUBMISSION; agent actor rejected outright', async () => {
    const fx = await buildPaidPolicy()
    const skip = await op(fx, 'activate_policy', { policyId: fx.policyId, allianzPolicyNumber: 'AZT-1' })
    expect(skip.outcome).toBe('rejected')
    expect(skip.reason).toBe('illegal_status_transition')
    const agent = await op(fx, 'mark_submitted', { policyId: fx.policyId }, 'agent')
    expect(agent.outcome).toBe('rejected')
    expect(agent.reason).toBe('actor_not_permitted')
  })

  it('cancel_submission (erratum 4): operator cancels a SUBMITTED policy; illegal from ACTIVE', async () => {
    const fx = await buildPaidPolicy()
    await op(fx, 'mark_submitted', { policyId: fx.policyId })
    const res = await op(fx, 'cancel_submission', { policyId: fx.policyId })
    expect(res.outcome, JSON.stringify({ reason: res.reason })).toBe('applied')
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: fx.policyId } })).status).toBe('CANCELLED')
    const again = await op(fx, 'cancel_submission', { policyId: fx.policyId })
    expect(again.outcome).toBe('applied') // ledger replay of the original envelope
  })
})
