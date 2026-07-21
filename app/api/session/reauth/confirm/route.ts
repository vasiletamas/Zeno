/**
 * POST /api/session/reauth/confirm (T26, P5.2) — body {code}
 *
 * Consumes the reauth OTP for the cookie's (canonical) customer via the ONE
 * challenge primitive (confirmByCode). Success re-sets the zeno_session
 * cookie and returns {customerId}; failure answers 401 with the live
 * attemptsRemaining (P0-2: the decrement survives — confirmByCode writes it).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { confirmByCode } from '@/lib/customer/verification-service'
import { signSessionProof, PROOF_COOKIE } from '@/lib/auth/session-proof'

export async function POST(request: NextRequest) {
  try {
    const cookieId = request.cookies.get('zeno_session')?.value
    if (!cookieId) {
      return NextResponse.json({ error: 'no_active_challenge' }, { status: 401 })
    }
    const customer = await prisma.customer.findUnique({ where: { id: cookieId } })
    const canonicalId = customer?.mergedIntoId ?? customer?.id
    if (!canonicalId) {
      return NextResponse.json({ error: 'no_active_challenge' }, { status: 401 })
    }
    const body = (await request.json().catch(() => ({}))) as { code?: unknown }
    const r = await confirmByCode(canonicalId, String(body.code ?? '').trim())
    if (!r.ok) {
      return NextResponse.json(
        { error: r.reason, ...(r.attemptsRemaining !== undefined ? { attemptsRemaining: r.attemptsRemaining } : {}) },
        { status: 401 },
      )
    }
    const response = NextResponse.json({ customerId: canonicalId })
    response.cookies.set('zeno_session', canonicalId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 2592000,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    // 2026-07-21 (spec §3.1): the consumed challenge is what makes THIS browser
    // provable, so this is the one place a proof may be minted. Issued only on
    // the success path — a wrong code must leave the holder with nothing, or
    // the roommate guesses their way in (AC-3). Short-lived by design; the
    // session cookie outlives it by 30 days on purpose.
    response.cookies.set(PROOF_COOKIE, await signSessionProof(canonicalId), {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    return response
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 401 })
  }
}
