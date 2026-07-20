/**
 * Spec 2026-07-20 §4 (conv cmrrhruba turns 6/8/10/12): emission hygiene for
 * collect_customer_field.
 *  (a) ONLY a ladder-member save (FIELD_ORDER: email, phone) may advance the
 *      contact ladder — declaredAge/residency saves return "<field> saved."
 *      with NO card and no Please-provide directive.
 *  (b) the next card must be DUE — phone is a servicing contact, due only
 *      once an ISSUED quote exists (Ruling 2).
 *  (c) when the email auto-chain fires, the OTP card owns the turn — never a
 *      simultaneous data-field card (turn 8: two competing input cards).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer, ensureTestProduct, issueTestQuote } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

// actor 'gui': the card submit IS first-party input (P0-1 guard stands down) —
// same idiom as collect-cnp-validation / collect-field-provenance.
const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function makeConversation() {
  const customer = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })
  return { customerId: customer.id, conversationId: conv.id }
}

/** A live pending challenge suppresses the T19 email auto-chain (mirrors the
 * collect-email-autochain NEGATIVE fixture). */
async function seedPendingChallenge(customerId: string, conversationId: string) {
  await prisma.verificationChallenge.create({
    data: {
      customerId, channel: 'email', target: 'a@b.ro',
      codeHash: 'h', linkToken: randomUUID(), conversationId,
      expiresAt: new Date(Date.now() + 600_000), attemptsRemaining: 5,
    },
  })
}

/** Application + ISSUED quote bound to THIS conversation: the quote row
 * comes from the shared issueTestQuote helper; only the conversation
 * binding (the snapshot's activeApplicationId pointer) is local. */
async function seedIssuedQuote(customerId: string, conversationId: string) {
  const product = await ensureTestProduct()
  const app = await prisma.application.create({
    data: { customerId, productId: product.id, status: 'OPEN' },
  })
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { productId: product.id, activeApplicationId: app.id },
  })
  await issueTestQuote({ customerId, applicationId: app.id })
}

describe.skipIf(!process.env.DATABASE_URL)('ladder gate (spec 2026-07-20 §4, conv cmrrhruba turns 6/10/12)', () => {
  it('a non-ladder save (declaredAge) emits NO card and no Please-provide directive', async () => {
    const { customerId, conversationId } = await makeConversation()
    const r = await collectCustomerField({ field: 'declaredAge', value: '40' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toBe('declaredAge saved.')
  })

  it('a non-ladder save (residency) emits NO card even when email/phone are missing', async () => {
    const { customerId, conversationId } = await makeConversation()
    const r = await collectCustomerField({ field: 'residency', value: 'Romania' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toBe('residency saved.')
  })

  it('email saved with NO quote → phone card NOT due yet', async () => {
    const { customerId, conversationId } = await makeConversation()
    // challenge pending → autoChain suppressed; phone missing but no quote
    await seedPendingChallenge(customerId, conversationId)
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toBe('email saved.')
  })

  it('email saved WITH an issued quote → phone card rides (ladder progression)', async () => {
    const { customerId, conversationId } = await makeConversation()
    await seedPendingChallenge(customerId, conversationId)
    await seedIssuedQuote(customerId, conversationId)
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    expect(r.uiAction).toMatchObject({ type: 'show_data_field', payload: { field: 'phone' } })
    expect(r.message).toContain('Please provide phone')
  })

  it('email save that declares the auto-chain → OTP owns the turn: NO data-field card, chain message', async () => {
    const { customerId, conversationId } = await makeConversation() // no verified email, no pending challenge → chain fires
    await seedIssuedQuote(customerId, conversationId) // even with phone due, the OTP card wins
    const r = await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(customerId, conversationId))
    expect(r.success).toBe(true)
    expect((r.data as Record<string, unknown>)._autoChain).toMatchObject({ tool: 'start_channel_verification' })
    expect(r.uiAction).toBeUndefined()
    expect(r.message).toContain('ALREADY sent')
  })
})
