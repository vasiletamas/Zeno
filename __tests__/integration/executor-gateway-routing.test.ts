import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { executeTool } from '@/lib/tools/executor'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('executor routes commits through the gateway', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('a commit executed via executeTool produces a CommitLedger row and an envelope on the ToolResult', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    const r = await executeTool('set_candidate_product', { productId: product.id, confidence: 80 }, ctx, 'CUSTOMER')
    expect(r.success).toBe(true)
    expect(r.envelope?.outcome).toBe('applied')
    expect(await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'set_candidate_product' } })).toBe(1)
  })
  it('reads do NOT write ledger rows', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
    await executeTool('get_current_state', {}, ctx, 'CUSTOMER')
    expect(await prisma.commitLedger.count({ where: { conversationId: conv.id } })).toBe(0)
  })
})
