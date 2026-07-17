/**
 * T8 (design 2026-07-15 §1/§4/§5): durable purchase intent is a LEDGERED
 * commit — after the DNT signature the agent asked "Ești gata să continuăm?"
 * although the customer committed 30 messages earlier; intent lived only in
 * prose. These tests drive the real gateway against the test DB:
 * commit+ledger row, supersession (stale), renounce, accept_quote → fulfilled,
 * and the snapshot `intent` slice (sameSession both ways).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildAcceptReadyQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'

const setIntent = (fx: { customerId: string; conversationId: string }, args: Record<string, unknown>) =>
  executeCommit({ tool: 'set_purchase_intent', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

async function makeDiscoveryFixture() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web', productId: product.id } })
  return { customerId: customer.id, conversationId: conversation.id }
}

describe('set_purchase_intent commit (T8)', () => {
  beforeEach(async () => { await resetDb() })

  it('applies, persists an ACTIVE PurchaseIntent and a ledger row with targetRef intent:<customerId>', async () => {
    const fx = await makeDiscoveryFixture()
    const res = await setIntent(fx, { goal: 'purchase', productCode: 'protect', config: { tier: 'standard', level: 'level_1', addon: true } })
    expect(res.outcome, JSON.stringify(res)).toBe('applied')

    const intent = await prisma.purchaseIntent.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(intent.status).toBe('active')
    expect(intent.goal).toBe('purchase')
    expect(intent.productCode).toBe('protect')
    expect(intent.conversationId).toBe(fx.conversationId)
    expect(intent.config).toEqual({ tier: 'standard', level: 'level_1', addon: true })

    const ledger = await prisma.commitLedger.findFirstOrThrow({ where: { conversationId: fx.conversationId, tool: 'set_purchase_intent' } })
    expect(ledger.outcome).toBe('applied')
    expect(ledger.targetRef).toBe(`intent:${fx.customerId}`)
  })

  it('a newer intent supersedes: the prior ACTIVE row becomes stale', async () => {
    const fx = await makeDiscoveryFixture()
    await setIntent(fx, { goal: 'quote', productCode: 'protect' })
    const second = await setIntent(fx, { goal: 'purchase', productCode: 'protect', config: { tier: 'optim' } })
    expect(second.outcome).toBe('applied')

    const rows = await prisma.purchaseIntent.findMany({ where: { customerId: fx.customerId }, orderBy: { capturedAt: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('stale')
    expect(rows[1].status).toBe('active')
    expect(rows[1].goal).toBe('purchase')
  })

  it('an identical re-commit is answered by the handler unchanged path — no duplicate active row', async () => {
    const fx = await makeDiscoveryFixture()
    await setIntent(fx, { goal: 'purchase', productCode: 'protect' })
    const dup = await setIntent(fx, { goal: 'purchase', productCode: 'protect' })
    expect(dup.outcome).toBe('applied')
    expect((dup.data as { unchanged?: boolean }).unchanged).toBe(true)
    expect(await prisma.purchaseIntent.count({ where: { customerId: fx.customerId } })).toBe(1)
  })

  it('renounce marks the active intent renounced; renounce-then-recommit with identical args creates a FRESH active intent (replay-exempt)', async () => {
    const fx = await makeDiscoveryFixture()
    await setIntent(fx, { goal: 'purchase', productCode: 'protect' })
    const ren = await setIntent(fx, { renounce: true })
    expect(ren.outcome).toBe('applied')
    expect((await prisma.purchaseIntent.findFirstOrThrow({ where: { customerId: fx.customerId } })).status).toBe('renounced')

    // The customer changes their mind back: the SAME material args must
    // create a new ACTIVE row, never replay the original applied envelope
    // against a renounced intent (state-guarded, select_coverage precedent).
    const again = await setIntent(fx, { goal: 'purchase', productCode: 'protect' })
    expect(again.outcome).toBe('applied')
    const active = await prisma.purchaseIntent.findMany({ where: { customerId: fx.customerId, status: 'active' } })
    expect(active).toHaveLength(1)
  })

  it('renounce with no active intent is a harmless no-op apply', async () => {
    const fx = await makeDiscoveryFixture()
    const ren = await setIntent(fx, { renounce: true })
    expect(ren.outcome).toBe('applied')
    expect((ren.data as { renounced?: boolean }).renounced).toBe(false)
  })

  it('NEGATIVE: goal without productCode (and vice versa) is rejected invalid_args — the DTO is the boundary', async () => {
    const fx = await makeDiscoveryFixture()
    const noProduct = await setIntent(fx, { goal: 'purchase' })
    expect(noProduct.outcome).toBe('rejected')
    expect(noProduct.reason).toBe('invalid_args')
    const noGoal = await setIntent(fx, { productCode: 'protect' })
    expect(noGoal.outcome).toBe('rejected')
    expect(noGoal.reason).toBe('invalid_args')
    const badGoal = await setIntent(fx, { goal: 'window_shopping', productCode: 'protect' })
    expect(badGoal.outcome).toBe('rejected')
    expect(badGoal.reason).toBe('invalid_args')
    expect(await prisma.purchaseIntent.count()).toBe(0)
  })

  it('an unknown productCode is rejected with the available codes', async () => {
    const fx = await makeDiscoveryFixture()
    const res = await setIntent(fx, { goal: 'quote', productCode: 'no-such-product' })
    expect(res.outcome).toBe('rejected')
    expect(String((res.data as { error?: string })?.error ?? '')).toContain('protect')
    expect(await prisma.purchaseIntent.count()).toBe(0)
  })

  it('accept_quote applied → the active intent is fulfilled (inside the accept tx)', async () => {
    const fx = await buildAcceptReadyQuote()
    const set = await setIntent(fx, { goal: 'purchase', productCode: 'protect' })
    expect(set.outcome, JSON.stringify(set)).toBe('applied')

    const accept = (args: Record<string, unknown>) =>
      executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    const ask = await accept({ paymentOption: 'annual' })
    expect(ask.outcome).toBe('requires_confirmation')
    const res = await accept({ paymentOption: 'annual', confirmToken: ask.confirmToken })
    expect(res.outcome, JSON.stringify({ reason: res.reason, data: res.data })).toBe('applied')

    const intent = await prisma.purchaseIntent.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(intent.status).toBe('fulfilled')
  })

  it('snapshot intent slice: shape + sameSession true in the capturing conversation, false in a sibling conversation', async () => {
    const fx = await makeDiscoveryFixture()
    await setIntent(fx, { goal: 'quote', productCode: 'protect', config: { tier: 'standard' } })

    const same = await loadDomainSnapshot(fx.conversationId)
    expect(same.intent).toEqual({
      goal: 'quote',
      productCode: 'protect',
      config: { tier: 'standard' },
      capturedAt: expect.any(String),
      sameSession: true,
      status: 'active',
    })

    const sibling = await prisma.conversation.create({ data: { customerId: fx.customerId, language: 'ro', channel: 'web' } })
    const cross = await loadDomainSnapshot(sibling.id)
    expect(cross.intent?.sameSession).toBe(false)
    expect(cross.intent?.goal).toBe('quote')
  })

  it('snapshot intent slice is null when no ACTIVE intent exists (renounced/fulfilled rows do not surface)', async () => {
    const fx = await makeDiscoveryFixture()
    expect((await loadDomainSnapshot(fx.conversationId)).intent).toBeNull()
    await setIntent(fx, { goal: 'quote', productCode: 'protect' })
    await setIntent(fx, { renounce: true })
    expect((await loadDomainSnapshot(fx.conversationId)).intent).toBeNull()
  })
})
