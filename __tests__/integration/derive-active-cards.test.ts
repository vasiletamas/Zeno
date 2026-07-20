/**
 * Card-state SSOT (spec 2026-07-20 §1): deriveActiveCards is the server's
 * answer to "what inputs is the customer currently being asked for, and what
 * is each one's status?". v1 key scope: data_field:*, otp:*, question:*,
 * confirm:*. Statuses active|expired|deferred; resolved/superseded
 * materialize as ABSENCE from the set.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer, ensureTestProduct, issueTestQuote, seedMinimalProtectFixture } from '@/__tests__/helpers/test-db'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { openDntSession } from '@/lib/tools/handlers/dnt-handlers'
import { deriveActiveCards } from '@/lib/chat/derive-active-cards'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() }, 60000)

/**
 * Customer + conversation; openApplication binds a fresh OPEN application to
 * the conversation (Ruling 2: the identity anchor becomes due); issuedQuote
 * adds the ISSUED quote AND a declared email — by the time a quote exists
 * the ladder has collected email (phone is due only after email, both in
 * FIELD_ORDER and in the derivation).
 */
async function makeConversationFixture(opts: { openApplication?: boolean; issuedQuote?: boolean } = {}) {
  const customer = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })
  if (opts.openApplication) {
    const product = await ensureTestProduct()
    const app = await prisma.application.create({ data: { customerId: customer.id, productId: product.id, status: 'OPEN' } })
    await prisma.conversation.update({ where: { id: conv.id }, data: { productId: product.id, activeApplicationId: app.id } })
    if (opts.issuedQuote) {
      await issueTestQuote({ customerId: customer.id, applicationId: app.id })
      await setDeclaredField(customer.id, 'email', 'a@b.ro', 'test')
    }
  }
  return { conversationId: conv.id, customerId: customer.id }
}

/** ACTIVE DNT session with a pending question — same idiom as
 * derive-pending-card.test.ts (protect fixture + open_dnt_session). */
async function makeDntSessionFixture() {
  const fx = await seedMinimalProtectFixture()
  const ctx = { customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext
  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`makeDntSessionFixture: open_dnt_session failed: ${opened.error}`)
  return fx
}

describe.skipIf(!process.env.DATABASE_URL)('deriveActiveCards (spec 2026-07-20 §1)', () => {
  it('empty conversation → empty set (DISCOVERY is contact-free)', async () => {
    const { conversationId } = await makeConversationFixture()
    expect(await deriveActiveCards(conversationId)).toEqual([])
  })

  it('open application → data_field:email active (identity anchor before DNT)', async () => {
    const { conversationId } = await makeConversationFixture({ openApplication: true })
    const cards = await deriveActiveCards(conversationId)
    expect(cards).toContainEqual(expect.objectContaining({ key: 'data_field:email', status: 'active' }))
    expect(cards.find((c) => c.key === 'data_field:phone')).toBeUndefined() // phone waits for a quote
  })

  it('email in profile → data_field:email absent (resolved = absence)', async () => {
    const { conversationId, customerId } = await makeConversationFixture({ openApplication: true })
    await setDeclaredField(customerId, 'email', 'a@b.ro', 'test')
    const cards = await deriveActiveCards(conversationId)
    expect(cards.find((c) => c.key === 'data_field:email')).toBeUndefined()
  })

  it('issued quote → data_field:phone active; deferral row → status deferred', async () => {
    const { conversationId, customerId } = await makeConversationFixture({ openApplication: true, issuedQuote: true })
    const before = await deriveActiveCards(conversationId)
    expect(before).toContainEqual(expect.objectContaining({ key: 'data_field:phone', status: 'active' }))
    await prisma.profileFieldDeferral.create({ data: { customerId, field: 'phone' } })
    const after = await deriveActiveCards(conversationId)
    expect(after).toContainEqual(expect.objectContaining({ key: 'data_field:phone', status: 'deferred' }))
  })

  it('unconsumed challenge → otp active while unexpired, expired after — never silently absent', async () => {
    const { conversationId, customerId } = await makeConversationFixture()
    const ch = await prisma.verificationChallenge.create({ data: { customerId, channel: 'email', target: 'a@b.ro', codeHash: 'h', expiresAt: new Date(Date.now() + 60_000) } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'otp:email', status: 'active' }))
    await prisma.verificationChallenge.update({ where: { id: ch.id }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'otp:email', status: 'expired' }))
  })

  it('active DNT session with a pending question → question:<code> active with a renderable uiAction', async () => {
    const { conversationId } = await makeDntSessionFixture()
    const cards = await deriveActiveCards(conversationId)
    const q = cards.find((c) => c.key.startsWith('question:'))
    expect(q?.status).toBe('active')
    expect(q?.uiAction?.type).toMatch(/^show_(question|medical_batch)$/)
  })

  it('latest ledger row requires_confirmation → confirm:<tool> active', async () => {
    const { conversationId, customerId } = await makeConversationFixture()
    await prisma.commitLedger.create({ data: { conversationId, customerId, actor: 'agent', tool: 'sign_dnt', targetRef: 'x', argsHash: 'h', outcome: 'requires_confirmation', effects: [], idempotencyDisposition: 'fresh', envelope: {} } })
    expect(await deriveActiveCards(conversationId)).toContainEqual(expect.objectContaining({ key: 'confirm:sign_dnt', status: 'active' }))
  })
})
