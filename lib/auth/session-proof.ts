/**
 * Session proof (spec 2026-07-21 §3.1 A-proof).
 *
 * `zeno_session` says "this browser has met customer X". It is a bare id with
 * a 30-day life, and on a shared device the second person carries it too — so
 * it can never be evidence of WHO is at the keyboard.
 *
 * `zeno_proof` is that evidence: a short-lived, signed, HttpOnly cookie minted
 * only after a verification challenge for that customer was CONSUMED. It is
 * earned, never asserted — the client cannot forge a consumed challenge.
 *
 * Deliberately separate from lib/auth/jwt.ts (`zeno_auth`, dashboard/operator
 * sessions): different subject, different lifetime, different blast radius.
 * The distinct `aud` claim means neither token can ever be replayed as the
 * other.
 */
import { SignJWT, jwtVerify } from 'jose'

export const PROOF_COOKIE = 'zeno_proof'

/** Audience claim — the anti-confusion guard against `zeno_auth` tokens. */
const AUDIENCE = 'zeno:session-proof'

/** Default life of a proof. Long enough not to nag a legitimate customer
 * mid-funnel, short enough that a borrowed device does not stay open. */
export const DEFAULT_PROOF_TTL = '12h'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  return new TextEncoder().encode(secret)
}

/** Mint a proof that THIS browser holds the inbox of `customerId`. */
export async function signSessionProof(customerId: string, ttl: string = DEFAULT_PROOF_TTL): Promise<string> {
  return new SignJWT({ customerId })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getSecret())
}

/**
 * True only when `token` is a live proof minted for exactly `customerId`.
 * Every failure mode — absent, malformed, expired, wrong audience, wrong
 * customer — answers false. Callers get a boolean, never a reason: there is
 * nothing a caller should do differently for a forged token than for an
 * expired one.
 */
export async function verifySessionProof(token: string | undefined | null, customerId: string): Promise<boolean> {
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, getSecret(), { audience: AUDIENCE })
    return payload.customerId === customerId
  } catch {
    return false
  }
}
