import { describe, it, expect } from 'vitest'
import { signSessionProof, verifySessionProof, PROOF_COOKIE } from '@/lib/auth/session-proof'

/**
 * Session proof (spec 2026-07-21 §3.1 A-proof). The cookie that says "THIS
 * BROWSER proved it holds the customer's inbox", as distinct from
 * `zeno_session`, which only says "this browser once met that customer".
 *
 * The distinction is the whole point of AC-3: the roommate carries the same
 * `zeno_session` cookie, so only a per-browser proof can tell them apart.
 */
describe('session proof', () => {
  it('verifies for the customer it was signed for', async () => {
    const token = await signSessionProof('cust_alpha')
    expect(await verifySessionProof(token, 'cust_alpha')).toBe(true)
  })

  // AC-3: the roommate's browser holds Ion's session cookie. A proof minted
  // for anyone else must never satisfy Ion's conversation.
  it('does NOT verify for a different customer', async () => {
    const token = await signSessionProof('cust_alpha')
    expect(await verifySessionProof(token, 'cust_beta')).toBe(false)
  })

  it('rejects an absent token', async () => {
    expect(await verifySessionProof(undefined, 'cust_alpha')).toBe(false)
  })

  it('rejects a forged token', async () => {
    expect(await verifySessionProof('not.a.jwt', 'cust_alpha')).toBe(false)
  })

  // A proof is short-lived by design: leaving the device logged in forever
  // reopens the shared-device hole this control exists to close.
  it('rejects an expired proof', async () => {
    const token = await signSessionProof('cust_alpha', '1s')
    // jose treats `exp` as a second-resolution claim; backdate past it.
    await new Promise((r) => setTimeout(r, 1100))
    expect(await verifySessionProof(token, 'cust_alpha')).toBe(false)
  })

  it('exposes the cookie name it is carried in', () => {
    expect(PROOF_COOKIE).toBe('zeno_proof')
  })

  /**
   * Token confusion. Every token this app mints is signed with the SAME
   * JWT_SECRET, so the signature alone proves nothing about a token's PURPOSE.
   * The threat is any other token that happens to carry a `customerId` claim —
   * a future feature, a magic-link token, an export token — being replayed as
   * a conversation-access proof.
   *
   * This must be attacked with a token that WOULD otherwise pass: right
   * secret, right customerId, wrong purpose. (A first attempt used
   * signToken({userId}), which was vacuous — it failed on the customerId
   * check and never reached the audience guard at all.)
   */
  it('does NOT accept a same-secret token minted for another purpose', async () => {
    const { SignJWT } = await import('jose')
    const foreign = await new SignJWT({ customerId: 'cust_alpha' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('zeno:some-other-feature')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!))

    expect(await verifySessionProof(foreign, 'cust_alpha')).toBe(false)
  })

  it('does NOT accept a same-secret token with no audience at all', async () => {
    const { SignJWT } = await import('jose')
    const audienceless = await new SignJWT({ customerId: 'cust_alpha' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!))

    expect(await verifySessionProof(audienceless, 'cust_alpha')).toBe(false)
  })
})
