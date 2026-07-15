/**
 * B4.ADD-1 (T13 Table 1 #6): set_candidate_product drops the pseudo-metric
 * `confidence` and gains `addonIds` — the candidate is a soft product (+
 * addon interest) binding, not a scored guess.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { validateToolArgs } from '@/lib/tools/validation'
import { getToolDefinition } from '@/lib/tools/registry'
import { setCandidateProduct } from '@/lib/tools/handlers/candidate-handlers'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

it('schema accepts { productId, addonIds } and rejects confidence (strict zod)', () => {
  expect(validateToolArgs('set_candidate_product', { productId: 'p1' }).valid).toBe(true)
  expect(validateToolArgs('set_candidate_product', { productId: 'p1', addonIds: ['a1'] }).valid).toBe(true)
  expect(validateToolArgs('set_candidate_product', { productId: 'p1', confidence: 80 }).valid).toBe(false)
})

it('the registry parameters advertise addonIds, not confidence', () => {
  const def = getToolDefinition('set_candidate_product')
  expect(JSON.stringify(def?.parameters)).not.toContain('confidence')
  expect(JSON.stringify(def?.parameters)).toContain('addonIds')
})

it('the handler persists candidateAddonIds on the conversation', async () => {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  const r = await setCandidateProduct({ productId: product.id, addonIds: ['bd_treatment_abroad'] }, ctx)
  expect(r.success).toBe(true)
  const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })
  expect(updated.candidateProductId).toBe(product.id)
  expect(updated.candidateAddonIds).toEqual(['bd_treatment_abroad'])
})

it('a product CODE in the productId slot resolves too — the agent passes both live (runs cmr99s5cb, cmr9cq7e5)', async () => {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  const r = await setCandidateProduct({ productId: product.code }, ctx)
  expect(r.success).toBe(true)
  const updated = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })
  expect(updated.candidateProductId).toBe(product.id)
})

it('a foreign cuid (e.g. the APPLICATION id) still fails with the available-codes hint', async () => {
  await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  const r = await setCandidateProduct({ productId: 'cmr9crinx002jt40ep3fxwq26' }, ctx)
  expect(r.success).toBe(false)
  expect(r.error).toContain('Available codes')
})
