import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

async function seedConversation() {
  const customer = await prisma.customer.create({ data: {} })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conversation.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { customer, conversation, ctx }
}

describe('escalate_to_human (gateway commit)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('persists an ESCALATION WorkItem + ledger row; conversation status untouched', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    const result = await executeCommit({
      tool: 'escalate_to_human', actor: 'agent',
      conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'customer requested a human', priority: 'high' },
      toolContext: ctx,
    })
    expect(result.outcome).toBe('applied')
    const items = await prisma.workItem.findMany({ where: { kind: 'ESCALATION' } })
    expect(items).toHaveLength(1)
    expect((items[0].refs as { conversationId?: string }).conversationId).toBe(conversation.id)
    expect(items[0].priority).toBe('HIGH')
    const ledger = await prisma.commitLedger.findMany({ where: { tool: 'escalate_to_human' } })
    expect(ledger).toHaveLength(1)
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } })
    expect(conv.status).toBe('ACTIVE') // no funnel semantics on conversation status (#11)
  })

  it('replays idempotently — same args return original outcome, no second WorkItem (#8 order)', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    const args = { reason: 'same reason', priority: 'medium' }
    const first = await executeCommit({ tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args, toolContext: ctx })
    const replay = await executeCommit({ tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id, args, toolContext: ctx })
    expect(replay.outcome).toBe(first.outcome)
    expect(await prisma.workItem.count()).toBe(1)
    const ledger = await prisma.commitLedger.findMany({ where: { tool: 'escalate_to_human' }, orderBy: { createdAt: 'asc' } })
    expect(ledger[1].idempotencyDisposition).toBe('replay')
  })
})
