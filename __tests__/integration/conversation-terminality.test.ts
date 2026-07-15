import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { reactivateIfArchived } from '@/lib/chat/turn-context'
import { archiveInactiveConversations } from '@/scripts/archive-inactive-conversations'

describe('conversations are channels (D2.9, contradiction #11)', () => {
  beforeEach(async () => { await resetDb() })

  it('a turn on an ARCHIVED conversation reactivates it instead of throwing', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, status: 'ARCHIVED', archivedAt: new Date() } })
    await reactivateIfArchived(conv.id)
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })
    expect(after.status).toBe('ACTIVE')
    expect(after.archivedAt).toBeNull()
  })

  it('sweep archives conversations idle beyond the window and leaves recent ones alone', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const stale = await prisma.conversation.create({ data: { customerId: customer.id, lastActivityAt: new Date(Date.now() - 40 * 86_400_000) } })
    const fresh = await prisma.conversation.create({ data: { customerId: customer.id } })
    const n = await archiveInactiveConversations({ idleDays: 30 })
    expect(n).toBe(1)
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('ARCHIVED')
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('ACTIVE')
  })
})
