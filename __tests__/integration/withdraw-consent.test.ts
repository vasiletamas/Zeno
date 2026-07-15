import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { appendConsentEvents } from '@/lib/customer/consent-service'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })
const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('withdraw(gdpr_processing) applies, halts subsequent writing commits, preserves data', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }], 'seed')
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'withdraw_consent', args: { kind: 'gdpr_processing' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('applied')
  const product = await ensureTestProduct()
  const blocked = await executeCommit({ tool: 'set_candidate_product', args: { productId: product.id }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(blocked.outcome).toBe('rejected')
  expect(blocked.reason).toBe('gdpr_processing_withdrawn')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id } })).toBe(2) // nothing deleted — withdrawal blocks processing, never erases
})

it('withdraw(marketing) does not halt funnel commits (scope-aware, M3)', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }, { kind: 'marketing', action: 'granted' }], 'seed')
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  await executeCommit({ tool: 'withdraw_consent', args: { kind: 'marketing' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const product = await ensureTestProduct()
  const ok = await executeCommit({ tool: 'set_candidate_product', args: { productId: product.id }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(ok.reason).not.toBe('gdpr_processing_withdrawn')
})

it('an invalid consent kind is rejected at validation (invalid_args)', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }], 'seed')
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'withdraw_consent', args: { kind: 'bogus' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('rejected')
  expect(r.reason).toBe('invalid_args')
})
