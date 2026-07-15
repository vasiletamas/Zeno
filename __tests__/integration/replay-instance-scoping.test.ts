/**
 * P1-4 (2026-07-15 hardening): commits whose replay identity is constant per
 * conversation must be STATE-GUARDED (answered by legality / the handler's
 * idempotent path), never by replaying a stale applied envelope — the aggregate
 * they address can be replaced or superseded between two identical calls.
 *
 * - set_application: after cancel_application nulls the pointer, an identical
 *   re-open must create a NEW application, not replay the first one's envelope
 *   (which left the customer with only a CANCELLED app — the 40x set_application
 *   loop entry documented 2026-07-09).
 * - acknowledge_disclosures: a disclosure version published after the first ack
 *   must be acknowledgeable — the constant per-quote args must not replay the
 *   stale v1 envelope while accept_quote stays blocked on requires_disclosures.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildIssuedQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { seedDocuments } from '@/prisma/seeds/seed-documents'
import { createDocument } from '@/lib/documents/registry'
import type { ToolContext } from '@/lib/tools/types'

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

describe('set_application re-open after cancel (P1-4 state-guarded)', () => {
  beforeEach(async () => { await resetDb() })

  it('an identical set_application after cancel_application creates a NEW application, not a replay', async () => {
    const c = await createCustomer()
    const p = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
    const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })

    const first = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
    expect(first.outcome).toBe('applied')
    const app1 = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })

    // cancel_application is a two-step confirmation commit
    const cancelAsk = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed mind' }, actor: 'gui', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
    expect(cancelAsk.outcome).toBe('requires_confirmation')
    const cancel = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed mind', confirmToken: cancelAsk.confirmToken }, actor: 'gui', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
    expect(cancel.outcome).toBe('applied')

    const second = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
    expect(second.outcome).toBe('applied')

    // a DISTINCT, live application must now exist — not just the cancelled one
    const open = await prisma.application.findMany({ where: { customerId: c.id, status: 'OPEN' } })
    expect(open).toHaveLength(1)
    expect(open[0].id).not.toBe(app1.id)
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).activeApplicationId).toBe(open[0].id)
  })
})

describe('acknowledge_disclosures across a version bump (P1-4 state-guarded)', () => {
  beforeEach(async () => { await resetDb(); await seedDocuments(prisma) })

  const ack = (fx: { customerId: string; conversationId: string }) =>
    executeCommit({ tool: 'acknowledge_disclosures', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

  it('a newly published disclosure version is acknowledged instead of replaying the stale v1 envelope', async () => {
    const fx = await buildIssuedQuote()
    const first = await ack(fx)
    expect(first.outcome).toBe('applied')
    expect(await prisma.disclosureAck.count({ where: { customerId: fx.customerId } })).toBe(2) // IPID:1, TERMS:1

    // publish IPID v2 for the product
    const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
    await createDocument({ kind: 'IPID', language: 'ro', bytes: Buffer.from('ipid-v2'), source: 'STATIC_PER_PRODUCT_VERSION', productId: product.id, version: 2 }, prisma)

    const second = await ack(fx)
    expect(second.outcome).toBe('applied')
    // the new version must be acknowledged (a replay would leave only v1)
    const ipidVersions = (await prisma.disclosureAck.findMany({ where: { customerId: fx.customerId, kind: 'IPID' } })).map((r) => r.version).sort()
    expect(ipidVersions).toContain(2)
  })

  it('a second identical call is an idempotent no-op (state-guarded, not a stored replay)', async () => {
    const fx = await buildIssuedQuote()
    const first = await ack(fx)
    const second = await ack(fx)
    expect(first.outcome).toBe('applied')
    expect(second.outcome).toBe('applied')
    // no duplicate rows — the handler's missing-docs computation + unique belt
    expect(await prisma.disclosureAck.count({ where: { customerId: fx.customerId } })).toBe(2)
  })
})
