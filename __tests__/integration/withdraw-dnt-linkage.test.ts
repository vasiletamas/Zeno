import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { ToolContext } from '@/lib/tools/types'
beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

// B2.ADD-1 (closes G16): a gdpr_processing withdrawal cannot leave the signed
// Dnt usable — it flips to WITHDRAWN in the same transaction, and only the
// re-grant floor stays exposed.
it('withdraw_consent(gdpr_processing) marks the signed Dnt WITHDRAWN and leaves only the re-grant floor exposed', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  await answerAllDntQuestions(c.id, conv.id)
  const consent = { gdpr: true, aiDisclosure: true }
  const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const signed = await executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(signed.outcome).toBe('applied')
  const dnt = await prisma.dnt.findFirstOrThrow({ where: { customerId: c.id, status: 'ACTIVE' } })

  const w = await executeCommit({ tool: 'withdraw_consent', args: { kind: 'gdpr_processing' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(w.outcome).toBe('applied')
  expect((await prisma.dnt.findUniqueOrThrow({ where: { id: dnt.id } })).status).toBe('WITHDRAWN')

  const { actions } = deriveAndExpose(await loadDomainSnapshot(conv.id))
  expect(actions.blocked.some(b => b.reason === 'gdpr_processing_withdrawn')).toBe(true)
  expect(actions.available).not.toContain('start_application')
  // the re-grant floor survives: a WITHDRAWN Dnt is not valid, so a new
  // session can open, be answered, and be signed
  expect(actions.available).toContain('open_dnt_session')
  expect(actions.available).toContain('escalate_to_human')
})

it('withdraw_consent(marketing) leaves the signed Dnt untouched', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  await answerAllDntQuestions(c.id, conv.id)
  const consent = { gdpr: true, aiDisclosure: true }
  const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  await executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  await executeCommit({ tool: 'withdraw_consent', args: { kind: 'marketing' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(await prisma.dnt.count({ where: { customerId: c.id, status: 'ACTIVE' } })).toBe(1)
})
