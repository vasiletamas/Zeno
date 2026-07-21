/**
 * Proof issuance + the conversation-minting hole (spec 2026-07-21 §3.1).
 *
 * Two halves of one security boundary:
 *
 *  1. ISSUANCE — a `zeno_proof` is minted ONLY where a challenge was actually
 *     consumed. Without an issuer the gate in lib/chat/conversation-access.ts
 *     locks out every account holder permanently; with a forgeable one it
 *     protects nothing.
 *
 *  2. /api/chat/create — took `customerId` from the request BODY and bound a
 *     new Conversation to it with no cookie check. Since the identity slice is
 *     derived from `conversation.customerId` (lib/engines/snapshot-loader.ts),
 *     that let any caller mint a conversation that RUNS AS a chosen customer —
 *     defeating not just this spec's new rows but the `verified_channel` gates
 *     already on accept_quote / ensure_payment_session.
 */
import { it, expect, beforeEach, describe } from 'vitest'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { lastMockEmailTo } from '@/lib/email/providers/mock'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import { POST as reauthStart } from '@/app/api/session/reauth/start/route'
import { POST as reauthConfirm } from '@/app/api/session/reauth/confirm/route'
import { POST as chatCreate } from '@/app/api/chat/create/route'
import { verifySessionProof, PROOF_COOKIE } from '@/lib/auth/session-proof'

beforeEach(async () => { await resetFunnelTables() })

const req = (url: string, opts: { cookie?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    headers: new Headers({ 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}) }),
  })

async function makeAccountHolder(email = 'holder@example.ro') {
  const c = await createCustomer({ isAnonymous: false, email })
  await prisma.user.create({ data: { email, role: 'CUSTOMER', customerId: c.id } })
  await prisma.verificationChallenge.create({
    data: {
      customerId: c.id, channel: 'email', target: email,
      codeHash: 'h', linkToken: randomUUID(), expiresAt: new Date(Date.now() + 600_000),
      attemptsRemaining: 5, consumedAt: new Date(),
    },
  })
  return c
}

/** Pull a Set-Cookie value by name out of a Response. */
function cookieValue(res: Response, name: string): string | null {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  const m = new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`).exec(raw)
  return m ? m[1] : null
}

describe.skipIf(!process.env.DATABASE_URL)('zeno_proof issuance', () => {
  // AC-2 step 3→4: Ion enters the code and gets in. Without this the gate is a
  // permanent lockout rather than a challenge.
  it('reauth confirm with the RIGHT code issues a proof for that customer', async () => {
    const c = await makeAccountHolder()
    await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${c.id}`, body: {} }))
    const code = lastMockEmailTo('holder@example.ro')?.code
    if (!code) throw new Error('no reauth code in the mock mailbox')

    const res = await reauthConfirm(req('/api/session/reauth/confirm', { cookie: `zeno_session=${c.id}`, body: { code } }))

    expect(res.status).toBe(200)
    const proof = cookieValue(res, PROOF_COOKIE)
    expect(proof).toBeTruthy()
    expect(await verifySessionProof(proof!, c.id)).toBe(true)
  })

  // AC-3: the roommate guesses codes and fails. A wrong code must leave them
  // with nothing — a proof issued on failure would hand over the conversation.
  it('reauth confirm with the WRONG code issues NO proof', async () => {
    const c = await makeAccountHolder()
    await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${c.id}`, body: {} }))
    const code = lastMockEmailTo('holder@example.ro')?.code
    if (!code) throw new Error('no reauth code in the mock mailbox')
    const wrong = code === '000000' ? '000001' : '000000'

    const res = await reauthConfirm(req('/api/session/reauth/confirm', { cookie: `zeno_session=${c.id}`, body: { code: wrong } }))

    expect(res.status).toBe(401)
    expect(cookieValue(res, PROOF_COOKIE)).toBeNull()
  })

  it('the proof is HttpOnly — script on the page can never read or replay it', async () => {
    const c = await makeAccountHolder()
    await reauthStart(req('/api/session/reauth/start', { cookie: `zeno_session=${c.id}`, body: {} }))
    const code = lastMockEmailTo('holder@example.ro')!.code

    const res = await reauthConfirm(req('/api/session/reauth/confirm', { cookie: `zeno_session=${c.id}`, body: { code } }))

    const raw = res.headers.get('set-cookie') ?? ''
    const proofChunk = raw.split(/,\s*(?=[a-z_]+=)/).find((c2) => c2.startsWith(`${PROOF_COOKIE}=`)) ?? ''
    expect(proofChunk.toLowerCase()).toContain('httponly')
  })
})

describe.skipIf(!process.env.DATABASE_URL)('/api/chat/create — conversations are minted for the COOKIE, never the body', () => {
  it('mints a conversation when the body customer matches the cookie', async () => {
    const c = await createCustomer({ isAnonymous: true })

    const res = await chatCreate(req('/api/chat/create', { cookie: `zeno_session=${c.id}`, body: { customerId: c.id } }))

    expect(res.status).toBe(200)
    const { conversationId } = await res.json()
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conv.customerId).toBe(c.id)
  })

  /**
   * THE HOLE. `customerId` came from the body and was never compared to the
   * cookie. Because lib/engines/snapshot-loader.ts derives the identity slice
   * from `conversation.customerId`, a conversation minted this way RUNS AS the
   * victim — inheriting their verified tier, their application, their quote.
   */
  it('refuses to mint a conversation on someone else\'s customer id', async () => {
    const victim = await makeAccountHolder('victim@example.ro')
    const attacker = await createCustomer({ isAnonymous: true })

    const res = await chatCreate(req('/api/chat/create', { cookie: `zeno_session=${attacker.id}`, body: { customerId: victim.id } }))

    expect(res.status).toBe(403)
    expect(await prisma.conversation.count({ where: { customerId: victim.id } })).toBe(0)
  })

  it('refuses when there is no cookie at all', async () => {
    const victim = await createCustomer({ isAnonymous: true })

    const res = await chatCreate(req('/api/chat/create', { body: { customerId: victim.id } }))

    expect(res.status).toBe(403)
    expect(await prisma.conversation.count({ where: { customerId: victim.id } })).toBe(0)
  })

  // AC-6: the cookie may sit on a merged shell while the account lives on the
  // canonical record. That customer must still be able to open a conversation.
  it('follows the merge pointer instead of locking the customer out', async () => {
    const canonical = await createCustomer({ isAnonymous: true })
    const shell = await createCustomer({ isAnonymous: true, mergedIntoId: canonical.id })

    const res = await chatCreate(req('/api/chat/create', { cookie: `zeno_session=${shell.id}`, body: { customerId: canonical.id } }))

    expect(res.status).toBe(200)
    const { conversationId } = await res.json()
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conv.customerId).toBe(canonical.id)
  })

  /**
   * The 404-vs-200 split was an id-validity oracle on an unauthenticated
   * route: it told an unauthenticated caller whether a customer id was real.
   * Both cases must now answer identically.
   */
  it('does not distinguish a real foreign customer from a made-up one', async () => {
    const attacker = await createCustomer({ isAnonymous: true })
    const victim = await createCustomer({ isAnonymous: true })

    const real = await chatCreate(req('/api/chat/create', { cookie: `zeno_session=${attacker.id}`, body: { customerId: victim.id } }))
    const fake = await chatCreate(req('/api/chat/create', { cookie: `zeno_session=${attacker.id}`, body: { customerId: 'cust_does_not_exist' } }))

    expect(real.status).toBe(fake.status)
  })
})
