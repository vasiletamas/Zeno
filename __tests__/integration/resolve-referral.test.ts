import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { resolveWorkItemDecision } from '@/lib/work-items/resolution'
import { seedReferredApplication } from '@/__tests__/helpers/seed-fixtures'
import type { ToolContext } from '@/lib/tools/types'

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

describe('resolve_referral (actor=operator)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('rejects non-operator actors with actor_not_permitted', async () => {
    const { app, item, conversationId } = await seedReferredApplication()
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'agent',
      conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'approve' },
      toolContext: ctx(app.customerId, conversationId),
    })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'actor_not_permitted' })
  })

  it('approve resumes quote generation: application leaves REFERRED, quote issued as a system commit, work item resolved', async () => {
    const { app, item } = await seedReferredApplication()
    const r = await resolveWorkItemDecision({ workItemId: item.id, decision: 'approve', note: 'underwriter ok', resolvedBy: 'operator' })
    expect(r.outcome).toBe('applied')
    const resolved = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolutionCode: 'approved', resolvedBy: 'operator' })
    const quote = await prisma.quote.findFirst({ where: { applicationId: app.id } })
    expect(quote).not.toBeNull() // generate_quote re-ran as a system commit and issued
    const systemQuoteLedger = await prisma.commitLedger.findFirst({ where: { tool: 'generate_quote', actor: 'system', outcome: 'applied' } })
    expect(systemQuoteLedger).not.toBeNull()
    const updated = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
    expect(updated.status).not.toBe('REFERRED')
  })

  it('reject terminates the application (CANCELLED + underwriter reason) and records an outbound notification ledger event', async () => {
    const { app, item, customerId } = await seedReferredApplication()
    await prisma.customer.update({ where: { id: customerId }, data: { email: 'referral-reject@example.ro' } })
    const r = await resolveWorkItemDecision({ workItemId: item.id, decision: 'reject', note: 'sum at risk exceeded', resolvedBy: 'operator' })
    expect(r.outcome).toBe('applied')
    expect(r.effects).toContain('terminal')
    const updated = await prisma.application.findUniqueOrThrow({ where: { id: app.id } })
    expect(updated.status).toBe('CANCELLED') // T5.D6 terminal (erratum 2: no DECLINED in the pinned set)
    expect((updated.flagsForReview as { underwriterReason?: string }).underwriterReason).toBe('sum at risk exceeded')
    const outbound = await prisma.commitLedger.findMany({ where: { tool: 'notification_sent', actor: 'system' } })
    expect(outbound).toHaveLength(1)
  })

  it('rejects resolution of a non-OPEN work item with work_item_not_open', async () => {
    const { app, item, conversationId } = await seedReferredApplication()
    await prisma.workItem.update({ where: { id: item.id }, data: { status: 'RESOLVED' } })
    const r = await executeCommit({
      tool: 'resolve_referral', actor: 'operator',
      conversationId, customerId: app.customerId,
      args: { workItemId: item.id, decision: 'approve' },
      toolContext: ctx(app.customerId, conversationId),
    })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'work_item_not_open' })
  })
})
