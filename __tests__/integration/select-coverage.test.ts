import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getToolDefinition } from '@/lib/tools/registry'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

async function openApp() {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  return { c, p, conv }
}

it('writes Application columns only — no Answer rows (single writer, T5.D2); one facet per commit (C1.6)', async () => {
  const { c, conv } = await openApp()
  const r = await executeCommit({ tool: 'select_coverage', args: { tier: 'standard' }, actor: 'gui', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('applied')
  const r2 = await executeCommit({ tool: 'select_coverage', args: { level: 'level_1' }, actor: 'gui', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r2.outcome).toBe('applied')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app.tierId).not.toBeNull(); expect(app.levelId).not.toBeNull()
  expect(await prisma.answer.count({ where: { applicationId: app.id } })).toBe(0)
})

it('invalid level for tier → rejected(invalid_level_for_tier); re-invocation with a DRAFT quote → re_rating + quote expired', async () => {
  const { c, conv } = await openApp()
  await executeCommit({ tool: 'select_coverage', args: { tier: 'standard' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const bad = await executeCommit({ tool: 'select_coverage', args: { level: 'no_such' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(bad).toMatchObject({ outcome: 'rejected', reason: 'invalid_level_for_tier' })
  await executeCommit({ tool: 'select_coverage', args: { level: 'level_1' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  await prisma.quote.create({ data: { applicationId: app.id, productId: app.productId, customerId: c.id, premiumAnnual: 100, premiumMonthly: 9, coverages: {}, status: 'DRAFT', validUntil: new Date(Date.now() + 86400e3) } })
  const r2 = await executeCommit({ tool: 'select_coverage', args: { level: 'level_2' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r2.effects).toContain('re_rating')
  expect((await prisma.quote.findFirstOrThrow({ where: { applicationId: app.id } })).status).toBe('EXPIRED')
})

it('addon toggle carries cascade_expand / questions_removed (#4); legacy mutators are gone', async () => {
  const { c, conv } = await openApp()
  const on = await executeCommit({ tool: 'select_coverage', args: { addon: true }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(on.effects).toContain('cascade_expand')
  const off = await executeCommit({ tool: 'select_coverage', args: { addon: false }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(off.effects).toContain('questions_removed')
  for (const t of ['change_selection', 'switch_product', 'set_answer', 'start_application']) expect(getToolDefinition(t)).toBeUndefined()
})
