import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote } from '@/__tests__/helpers/funnel-fixtures'
import { getOpenItems } from '@/lib/tools/handlers/open-items-handlers'
import type { ToolContext } from '@/lib/tools/types'

function ctxFor(customerId: string, conversationId: string) {
  return { customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext
}

describe('get_open_items (E4.3, integration)', () => {
  beforeEach(async () => { await resetDb() })

  it('returns the issued-quote open item for a returning customer, nextAction exposed', async () => {
    const fx = await buildIssuedQuote()
    const r = await getOpenItems({}, ctxFor(fx.customerId, fx.conversationId))
    expect(r.success).toBe(true)
    const items = (r.data as { items: { kind: string; refId: string; age: number; nextAction: string }[] }).items
    expect(items.some((i) => i.kind === 'quote')).toBe(true)
    const exposed = (r.data as { availableActions: string[] }).availableActions
    for (const item of items) expect(exposed).toContain(item.nextAction) // briefing-integrity invariant, end to end
  })

  it('returns an empty list for a fresh customer', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
    const r = await getOpenItems({}, ctxFor(customer.id, conversation.id))
    expect((r.data as { items: unknown[] }).items).toEqual([])
  })
})
