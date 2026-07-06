import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer, resetFunnelTables } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { openDntSession, writeDntAnswer, getDntNextQuestion } from '@/lib/tools/handlers/dnt-handlers'
import { setDeclaredField } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

// actor 'gui': these suites pin validation semantics, not the P0-1 grounding guard
const ctx = (id: string) => ({ customerId: id, conversationId: 'c', language: 'ro' as const, actor: 'gui' }) as never

it('rejects checksum-invalid CNP with a precise reason', async () => {
  const c = await createCustomer()
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089862' }, ctx(c.id))
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_checksum_invalid')
})

it('rejects CNP inconsistent with the declared DOB', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1990-01-01', 'collect_customer_field')
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id)) // encodes 1998-04-18
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_dob_mismatch')
})

it('accepts a consistent CNP', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1998-04-18', 'collect_customer_field')
  expect((await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id))).success).toBe(true)
})

// P0-4 (2026-07-06): the DNT path previously accepted checksum-invalid CNPs
// silently (and silently skipped the profile mirror), while the identity path
// rejected the SAME value — contradictory treatment of the same input, and an
// unusable identifier persisted into the regulatory record.
it('write_dnt_answer rejects a checksum-invalid DNT_CNP with the same precise reason as collect_customer_field', async () => {
  await resetDb() // needs the seeded question groups
  const c = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const tctx = { customerId: c.id, conversationId: conv.id, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext
  const opened = await openDntSession({}, tctx)
  expect(opened.success).toBe(true)
  // answer up to DNT_CNP
  for (let i = 0; i < 10; i++) {
    const n = await getDntNextQuestion({}, tctx)
    const q = (n.data as { question: { code: string; options: unknown } | null }).question
    if (!q) throw new Error('ran out of questions before DNT_CNP')
    if (q.code === 'DNT_CNP') break
    const opts = Array.isArray(q.options) ? (q.options as { value?: unknown }[]) : []
    await writeDntAnswer({ questionCode: q.code, value: String(opts[0]?.value ?? 'da') }, tctx)
  }
  const bad = await writeDntAnswer({ questionCode: 'DNT_CNP', value: '1960229410014' }, tctx)
  expect(bad.success).toBe(false)
  expect(bad.error).toContain('cnp_checksum_invalid')
  const good = await writeDntAnswer({ questionCode: 'DNT_CNP', value: '1960229410015' }, tctx)
  expect(good.success).toBe(true)
})
