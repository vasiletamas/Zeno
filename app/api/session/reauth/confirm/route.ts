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
    return response
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 401 })
  }
}
