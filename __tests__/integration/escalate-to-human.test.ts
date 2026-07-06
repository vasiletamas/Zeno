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

  it('a repeat escalation with a DIFFERENT reason is absorbed while one is OPEN (run cmr9ayiad: 45 fresh escalations, 2026-07-06)', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    const first = await executeCommit({
      tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'customer wants the addon variant', priority: 'medium' }, toolContext: ctx,
    })
    expect(first.outcome).toBe('applied')
    // different args -> ledger idempotency cannot catch it; the handler must
    const second = await executeCommit({
      tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'still stuck, escalating again', priority: 'high' }, toolContext: ctx,
    })
    expect(second.outcome).toBe('rejected')
    expect(second.reason).toBe('already_escalated')
    expect(await prisma.workItem.count({ where: { kind: 'ESCALATION' } })).toBe(1)
  })

  it('a RESOLVED escalation does not absorb a new one (re-escalation after resolution is legitimate)', async () => {
    const { customer, conversation, ctx } = await seedConversation()
    await executeCommit({
      tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'first issue', priority: 'medium' }, toolContext: ctx,
    })
    await prisma.workItem.updateMany({ where: { kind: 'ESCALATION' }, data: { status: 'RESOLVED' } })
    const second = await executeCommit({
      tool: 'escalate_to_human', actor: 'agent', conversationId: conversation.id, customerId: customer.id,
      args: { reason: 'a brand new issue', priority: 'medium' }, toolContext: ctx,
    })
    expect(second.outcome).toBe('applied')
    expect(await prisma.workItem.count({ where: { kind: 'ESCALATION' } })).toBe(2)
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
