import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

async function seedConversation(customerData: Record<string, unknown> = {}) {
  const customer = await prisma.customer.create({ data: customerData })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conversation.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { customer, conversation, ctx }
}

describe('GDPR erasure flow (agent requests, operator approves) — E3.3', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('request_erasure creates a GDPR_ERASURE WorkItem — data untouched until approval', async () => {
    const { customer, conversation, ctx } = await seedConversation({ name: 'Ion', email: 'ion@x.ro' })
    const r = await executeCommit({ tool: 'request_erasure', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args: { reason: 'customer asked in chat' }, toolContext: ctx })
    expect(r.outcome).toBe('applied')
    const items = await prisma.workItem.findMany({ where: { kind: 'GDPR_ERASURE', status: 'OPEN' } })
    expect(items).toHaveLength(1)
    expect((items[0].refs as { customerId?: string }).customerId).toBe(customer.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).name).toBe('Ion')
  })

  it('approve_erasure (operator) executes the retention-driven job and resolves the item, ledger-recorded', async () => {
    const { customer, conversation, ctx } = await seedConversation({ name: 'Ion', email: 'ion@x.ro' })
    await executeCommit({ tool: 'request_erasure', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args: {}, toolContext: ctx })
    const item = await prisma.workItem.findFirstOrThrow({ where: { kind: 'GDPR_ERASURE' } })
    const r = await executeCommit({ tool: 'approve_erasure', actor: 'operator', conversationId: conversation.id, customerId: customer.id, args: { workItemId: item.id }, toolContext: ctx })
    expect(r.outcome).toBe('applied')
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })
    expect(after.name).toBeNull()
    expect(after.erasedAt).not.toBeNull()
    const resolved = await prisma.workItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect((resolved.payload as { classResults?: unknown[] }).classResults).toBeDefined() // decision recorded
    expect(await prisma.commitLedger.count({ where: { tool: 'approve_erasure' } })).toBe(1)
  })

  it('approve_erasure rejects non-operator actors (negative)', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    const r = await executeCommit({ tool: 'approve_erasure', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args: { workItemId: 'whatever' }, toolContext: ctx })
    expect(r).toMatchObject({ outcome: 'rejected', reason: 'actor_not_permitted' })
  })

  it('approve_erasure on a non-open or wrong-kind item rejects cleanly (negative)', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    const r = await executeCommit({ tool: 'approve_erasure', actor: 'operator', conversationId: conversation.id, customerId: customer.id, args: { workItemId: 'missing' }, toolContext: ctx })
    expect(r.outcome).toBe('rejected')
  })
})
