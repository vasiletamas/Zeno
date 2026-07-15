import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { resolveWorkItemDecision } from '@/lib/work-items/resolution'
import { seedReferredApplication } from '@/__tests__/helpers/seed-fixtures'

describe('referral resolution notifications (E4.ADD-1 — G11b)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('reject records exactly ONE outbound with the customer-language template and a challenge link back to the conversation', async () => {
    const { item, customerId } = await seedReferredApplication()
    await prisma.customer.update({ where: { id: customerId }, data: { email: 'notify@example.ro', language: 'ro' } })
    const r = await resolveWorkItemDecision({ workItemId: item.id, decision: 'reject', note: 'risk', resolvedBy: 'op' })
    expect(r.outcome).toBe('applied')
    const outbound = await prisma.commitLedger.findMany({ where: { tool: 'notification_sent', actor: 'system' } })
    expect(outbound).toHaveLength(1)
    // the challenge row carries the conversation — the link verifies AND returns (B3)
    const challenge = await prisma.verificationChallenge.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' } })
    expect(challenge?.linkToken).toBeTruthy()
    expect(challenge?.conversationId).not.toBeNull()

    // a second identical resolution attempt REPLAYS (the gateway returns
    // the original applied envelope) — and the dedupeKey means no second send
    const again = await resolveWorkItemDecision({ workItemId: item.id, decision: 'reject', note: 'risk', resolvedBy: 'op' })
    expect(again.outcome).toBe('applied')
    expect(await prisma.commitLedger.count({ where: { tool: 'notification_sent' } })).toBe(1)
  })

  it('approve ALSO notifies (transactional notice, regardless of marketing consent) — exactly once', async () => {
    const { item, customerId } = await seedReferredApplication()
    await prisma.customer.update({ where: { id: customerId }, data: { email: 'approve@example.ro' } })
    // NO marketing consent granted — transactional notices are exempt
    const r = await resolveWorkItemDecision({ workItemId: item.id, decision: 'approve', note: 'ok', resolvedBy: 'op' })
    expect(r.outcome).toBe('applied')
    const outbound = await prisma.commitLedger.findMany({ where: { tool: 'notification_sent', actor: 'system' } })
    expect(outbound).toHaveLength(1)
    expect(outbound[0].targetRef).toContain(item.id) // dedupe key names the work item
  })
})
