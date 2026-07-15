import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'

// A2.1 — CommitLedger only. The plan's ConsentEvent model/case is VOID here:
// the whole consent-truth flip (model included) is owned by B1 (A2 erratum 0,
// ownership ruling 7).
describe.skipIf(!process.env.DATABASE_URL)('CommitLedger schema', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('persists a ledger row with the pinned columns and reads it back', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const row = await prisma.commitLedger.create({ data: { conversationId: conv.id, customerId: customer.id, actor: 'agent', tool: 'sign_dnt', targetRef: `conversation:${conv.id}`, argsHash: 'abc', outcome: 'applied', effects: ['advance_phase'], phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', envelope: { outcome: 'applied', effects: ['advance_phase'] } } })
    expect(row.idempotencyDisposition).toBe('fresh')
    const found = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'sign_dnt', argsHash: 'abc' } })
    expect(found?.outcome).toBe('applied')
  })
})
