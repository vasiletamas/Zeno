import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { getCustomerProfile } from '@/lib/tools/handlers/profile-handlers'
import { setDeclaredField } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'

function ctxFor(customerId: string, conversationId: string) {
  return { customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext
}

describe('get_customer_profile (E4.1 — B0-backed with derived age + history summary)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('returns profile facts with per-field provenance, the derived identity tier and the derived age', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await setDeclaredField(customer.id, 'name', 'Ion Pop', 'conversation')
    await setDeclaredField(customer.id, 'declaredAge', '35', 'conversation')
    const r = await getCustomerProfile({}, ctxFor(customer.id, conv.id))
    expect(r.success).toBe(true)
    const data = r.data as { profile: { fields: Record<string, { value: unknown; provenance: string }>; age: number | null }; identity: { tier: string } }
    expect(data.profile.fields.name).toEqual(expect.objectContaining({ provenance: 'declared' }))
    expect(data.identity.tier).toBe('anonymous') // partial KYC, no verified channel
    expect(data.profile.age).toBe(35) // derived from declaredAge — never a stored snapshot
  })

  it('includes a history summary with store counts', async () => {
    const customer = await prisma.customer.create({ data: {} })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    const r = await getCustomerProfile({}, ctxFor(customer.id, conv.id))
    const data = r.data as { historySummary: { applications: number; quotes: number; policies: number; conversations: number } }
    expect(data.historySummary).toEqual({ applications: 0, quotes: 0, policies: 0, conversations: 1 })
    expect(JSON.stringify(r.data)).not.toContain('extractedProfile')
  })
})
