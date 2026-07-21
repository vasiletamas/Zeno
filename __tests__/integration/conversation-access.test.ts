/**
 * Conversation access control (spec 2026-07-21 §3.1). The decision that guards
 * /chat/[id] and /api/chat.
 *
 * Two independent controls, because they answer two different threats:
 *  - OWNERSHIP  — the cookie must resolve to the conversation's customer.
 *                 Covers urls that escape the browser (shared links, logs).
 *  - FRESHNESS  — an account holder must additionally present a live
 *                 `zeno_proof`. Covers the shared DEVICE, where the cookie is
 *                 not evidence: the second person carries the same one.
 *
 * Acceptance criteria: §4 AC-2 (Ion), AC-3 (the roommate), AC-6 (no lockout
 * after a merge).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { signSessionProof } from '@/lib/auth/session-proof'
import { decideConversationAccess } from '@/lib/chat/conversation-access'

beforeEach(async () => { await resetDb() }, 60000)

async function conversationFor(customerId: string) {
  const conv = await prisma.conversation.create({ data: { customerId, language: 'ro' } })
  return conv.id
}

/** The T26 "account holder" shape: a linked User AND a consumed email
 * challenge — exactly what app/api/session/route.ts reauthGate() tests. */
async function makeAccountHolder(email = 'ion@gmail.com') {
  const customer = await createCustomer()
  await prisma.user.create({ data: { email, role: 'CUSTOMER', customerId: customer.id } })
  await prisma.verificationChallenge.create({
    data: {
      customerId: customer.id, channel: 'email', target: email, codeHash: 'h',
      expiresAt: new Date(Date.now() - 60_000), consumedAt: new Date(),
    },
  })
  return customer.id
}

describe.skipIf(!process.env.DATABASE_URL)('decideConversationAccess (spec 2026-07-21 §3.1)', () => {
  it('allows an anonymous customer into their own conversation', async () => {
    const customer = await createCustomer()
    const conversationId = await conversationFor(customer.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: customer.id, proofToken: undefined })

    expect(d).toEqual({ kind: 'allow', customerId: customer.id })
  })

  // The line-63 fallback: `customerId ?? conversation.customerId` adopted the
  // conversation's own customer when no cookie existed.
  it('denies when there is no cookie at all', async () => {
    const customer = await createCustomer()
    const conversationId = await conversationFor(customer.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: undefined, proofToken: undefined })

    expect(d.kind).toBe('deny')
  })

  it('denies a cookie belonging to a different customer', async () => {
    const owner = await createCustomer()
    const stranger = await createCustomer()
    const conversationId = await conversationFor(owner.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: stranger.id, proofToken: undefined })

    expect(d.kind).toBe('deny')
  })

  it('denies an unknown conversation id', async () => {
    const customer = await createCustomer()

    const d = await decideConversationAccess({ conversationId: 'does-not-exist', cookieCustomerId: customer.id, proofToken: undefined })

    expect(d.kind).toBe('deny')
  })

  // AC-3: the roommate holds Ion's cookie, so ownership PASSES. Only the
  // freshness control stops them.
  it('AC-3: account holder with no proof is challenged, not admitted', async () => {
    const customerId = await makeAccountHolder('ion@gmail.com')
    const conversationId = await conversationFor(customerId)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: customerId, proofToken: undefined })

    expect(d.kind).toBe('reauth')
    if (d.kind !== 'reauth') throw new Error('unreachable')
    expect(d.customerId).toBe(customerId)
    expect(d.maskedEmail).toContain('@gmail.com')
    expect(d.maskedEmail).not.toBe('ion@gmail.com') // masked, never the raw address
  })

  // AC-2 step 4: after Ion enters the code he holds a proof and gets in.
  it('AC-2: account holder WITH a live proof is admitted', async () => {
    const customerId = await makeAccountHolder()
    const conversationId = await conversationFor(customerId)
    const proofToken = await signSessionProof(customerId)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: customerId, proofToken })

    expect(d).toEqual({ kind: 'allow', customerId })
  })

  // The roommate cannot borrow a proof minted for anyone else.
  it('AC-3: a proof for a DIFFERENT customer does not admit', async () => {
    const customerId = await makeAccountHolder()
    const conversationId = await conversationFor(customerId)
    const someoneElse = await createCustomer()
    const proofToken = await signSessionProof(someoneElse.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: customerId, proofToken })

    expect(d.kind).toBe('reauth')
  })

  // An anonymous customer has no account, so there is nothing to prove and
  // nothing sensitive behind it (AC-4, the accepted residual).
  it('AC-4: an anonymous customer is never challenged', async () => {
    const customer = await createCustomer()
    const conversationId = await conversationFor(customer.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: customer.id, proofToken: undefined })

    expect(d.kind).toBe('allow')
  })

  /**
   * AC-6. Verifying an email that already belongs to another record merges the
   * two: the shell customer gets `mergedIntoId` and the conversation may hang
   * off EITHER record. A naive `conversation.customerId === cookie` check locks
   * the customer out of their own data. app/api/session/route.ts:64 already
   * follows this pointer; so must we.
   */
  it('AC-6: a cookie on a merged shell reaches the canonical customer\'s conversation', async () => {
    const canonical = await createCustomer()
    const shell = await createCustomer()
    await prisma.customer.update({ where: { id: shell.id }, data: { mergedIntoId: canonical.id } })
    const conversationId = await conversationFor(canonical.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: shell.id, proofToken: undefined })

    expect(d).toEqual({ kind: 'allow', customerId: canonical.id })
  })

  it('AC-6: a canonical cookie reaches a conversation left on the merged shell', async () => {
    const canonical = await createCustomer()
    const shell = await createCustomer()
    await prisma.customer.update({ where: { id: shell.id }, data: { mergedIntoId: canonical.id } })
    const conversationId = await conversationFor(shell.id)

    const d = await decideConversationAccess({ conversationId, cookieCustomerId: canonical.id, proofToken: undefined })

    expect(d).toEqual({ kind: 'allow', customerId: canonical.id })
  })
})
