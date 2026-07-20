/**
 * Spec 2026-07-20 §1 (Ruling 6): a customer's "not now" on a contact ask is a
 * recorded FACT, not a card operation. defer_customer_field persists the
 * deferral; the card derivation (Task 8) reads it as status 'deferred'; a
 * later provided value simply supersedes (field presence wins).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { executeTool } from '@/lib/tools/executor'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { getFieldDeferrals } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

// actor 'gui': first-party input (P0-1 guard stands down) — the collect in
// the supersede test writes without prose seeding, as the collect tests do.
const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function makeConversation() {
  const customer = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })
  return { customerId: customer.id, conversationId: conv.id }
}

describe.skipIf(!process.env.DATABASE_URL)('defer_customer_field (spec 2026-07-20 §1)', () => {
  it('records a deferral fact for a ladder field', async () => {
    const { customerId, conversationId } = await makeConversation()
    const r = await executeTool('defer_customer_field', { field: 'phone', reason: 'nu doresc acum' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    const rows = await prisma.profileFieldDeferral.findMany({ where: { customerId, field: 'phone' } })
    expect(rows).toHaveLength(1)
  })

  it('rejects non-ladder fields (only contact asks are deferrable)', async () => {
    const { customerId, conversationId } = await makeConversation()
    const r = await executeTool('defer_customer_field', { field: 'name' }, ctx(customerId, conversationId))
    expect(r.success).toBe(false)
    expect(await prisma.profileFieldDeferral.count({ where: { customerId } })).toBe(0)
  })

  it('getFieldDeferrals returns the deferred set; a provided value supersedes', async () => {
    const { customerId, conversationId } = await makeConversation()
    await executeTool('defer_customer_field', { field: 'phone' }, ctx(customerId, conversationId))
    expect(await getFieldDeferrals(customerId)).toEqual(['phone'])
    // provide the value afterwards (gui actor — first-party input):
    const w = await collectCustomerField({ field: 'phone', value: '0735226607' }, ctx(customerId, conversationId))
    expect(w.success).toBe(true)
    expect(await getFieldDeferrals(customerId)).toEqual([]) // presence wins over deferral
  })
})
