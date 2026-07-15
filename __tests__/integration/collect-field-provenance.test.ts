import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeTool } from '@/lib/tools/executor'
import { getProfile } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'

// B0.ADD-1 (closes G13): identity tier is DERIVED (T4-R2), never stored —
// collecting fields must not flip Customer.isAnonymous, even when the full
// FIELD_ORDER set has been collected.
beforeEach(async () => { await resetDb() })

it('collect_customer_field writes declared provenance via the profile service and never flips isAnonymous', async () => {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext

  const fields: Array<[string, string]> = [
    ['name', 'Ion Popescu'],
    ['cnp', '1980418089861'],
    ['dateOfBirth', '1990-05-01'],
    ['email', 'ion.addone@example.ro'],
    ['phone', '0722123456'],
  ]
  for (const [field, value] of fields) {
    const r = await executeTool('collect_customer_field', { field, value }, ctx, 'CUSTOMER')
    expect(r.success, field).toBe(true)
  }

  const after = await prisma.customer.findUnique({ where: { id: customer.id } })
  expect(after!.isAnonymous).toBe(true) // tier is DERIVED (T4-R2), never stored

  const prov = (await getProfile(customer.id)).fields.name
  expect(prov).toMatchObject({ value: 'Ion Popescu', provenance: 'declared' })
})
