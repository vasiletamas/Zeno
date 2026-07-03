import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { getPolicyInfo } from '@/lib/tools/handlers/policy-handlers'
import { buildActivatedPolicy, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

describe('get_policy_info (D4.4 — T9.D5 single read, T9.D6 customer-scoped)', () => {
  beforeEach(async () => { await resetDb() })

  it('returns one consistent snapshot from a FRESH conversation (customer-scoped, survives the sale conversation)', async () => {
    const fx = await buildActivatedPolicy()
    const newConv = await prisma.conversation.create({ data: { customerId: fx.customerId } })
    const res = await getPolicyInfo({}, fixtureCtx(fx.customerId, newConv.id))
    expect(res.success).toBe(true)
    const d = res.data as { statusCode: string; allianzPolicyNumber: string; freeLookEndsAt: string; schedule: { capturedCount: number }; documents: { kind: string }[] }
    expect(d.statusCode).toBe('policy_active') // stable code, never localized prose (M6)
    expect(d.allianzPolicyNumber).toBe('AZT-123')
    expect(d.freeLookEndsAt).toBeTruthy()
    expect(d.schedule.capturedCount).toBeGreaterThanOrEqual(1)
  })

  it('pre-activation statuses map to honest codes — never an in-force claim before ACTIVE', async () => {
    const fx = await buildActivatedPolicy({ stopAt: 'PENDING_SUBMISSION' })
    const res = await getPolicyInfo({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect((res.data as { statusCode: string }).statusCode).toBe('paid_processing') // #5: 'paid, being processed'
  })
})
