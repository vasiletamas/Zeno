import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { createWorkItem, listWorkItems } from '@/lib/work-items/service'

describe('WorkItem service', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('persists a work item with kind, refs, priority and creator', async () => {
    const item = await createWorkItem({
      kind: 'ESCALATION', reason: 'customer asked for a human',
      refs: { conversationId: 'conv-1', customerId: 'cust-1' },
      createdBy: 'agent', priority: 'HIGH',
    })
    expect(item.status).toBe('OPEN')
    const found = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(found.kind).toBe('ESCALATION')
    expect((found.refs as { conversationId?: string }).conversationId).toBe('conv-1')
  })

  it('lists open items filtered by kind, newest first', async () => {
    await createWorkItem({ kind: 'REFERRAL', reason: 'underwriter review', refs: { applicationId: 'app-1' }, createdBy: 'system' })
    await createWorkItem({ kind: 'ESCALATION', reason: 'x', refs: {}, createdBy: 'agent' })
    const referrals = await listWorkItems({ status: 'OPEN', kind: 'REFERRAL' })
    expect(referrals).toHaveLength(1)
    expect(referrals[0].reason).toBe('underwriter review')
  })
})
