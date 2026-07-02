import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { createReferralWorkItem } from '@/lib/work-items/referral'

describe('createReferralWorkItem', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('opens exactly one OPEN referral per application (re-running generate_quote must not duplicate)', async () => {
    const input = {
      applicationId: 'app-1', customerId: 'cust-1', conversationId: 'conv-1',
      reason: 'pending_external_check: cumulative sum at risk',
    }
    const first = await createReferralWorkItem(input)
    const second = await createReferralWorkItem(input)
    expect(second.id).toBe(first.id)
    expect(await prisma.workItem.count({ where: { kind: 'REFERRAL', status: 'OPEN' } })).toBe(1)
    expect((first.refs as { applicationId?: string }).applicationId).toBe('app-1')
  })
})
