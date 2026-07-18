import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { maskVerificationTarget } from '@/lib/customer/verification-service'

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 2592000, // 30 days
  path: '/',
  secure: process.env.NODE_ENV === 'production',
}

/**
 * T26: an authenticated account's session is never handed silently to
 * whoever holds the cookie. A customer with a linked User AND a consumed
 * email challenge demands a fresh OTP (/api/session/reauth/*) — the response
 * withholds the customerId and does not extend the cookie. Anonymous
 * customers resume as before; {fresh:true} always starts a new anonymous
 * session (the explicit decline path).
 */
async function reauthGate(customerId: string): Promise<{ maskedEmail: string } | null> {
  const user = await prisma.user.findUnique({ where: { customerId }, select: { id: true } })
  if (!user) return null
  const proven = await prisma.verificationChallenge.findFirst({
    where: { customerId, channel: 'email', consumedAt: { not: null } },
    orderBy: { consumedAt: 'desc' },
    select: { target: true },
  })
  if (!proven) return null
  return { maskedEmail: maskVerificationTarget('email', proven.target) }
}

function mintAnonymous() {
  return prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
}

export async function POST(request: NextRequest) {
  const existingSession = request.cookies.get('zeno_session')
  const body = await request.json().catch(() => ({}))
  const fresh = (body as { fresh?: boolean })?.fresh === true

  if (!fresh && existingSession?.value) {
    const customer = await prisma.customer.findUnique({
      where: { id: existingSession.value },
    })
    // B3.5: a merged shell points at its canonical customer — follow the
    // pointer and rebind the cookie so the session continues on the account
    // the customer proved ownership of. (T4.D5's opaque-session transport is
    // still the raw id; consumed here, not implemented — see handoff.)
    if (customer?.mergedIntoId) {
      const canonical = await prisma.customer.findUnique({ where: { id: customer.mergedIntoId } })
      if (canonical) {
        const gate = await reauthGate(canonical.id)
        if (gate) return NextResponse.json({ status: 'reauth_required', maskedEmail: gate.maskedEmail })
        const response = NextResponse.json({ customerId: canonical.id, isNew: false })
        response.cookies.set('zeno_session', canonical.id, COOKIE_OPTS)
        return response
      }
    }
    if (customer) {
      const gate = await reauthGate(customer.id)
      if (gate) return NextResponse.json({ status: 'reauth_required', maskedEmail: gate.maskedEmail })
      return NextResponse.json({ customerId: customer.id, isNew: false })
    }
  }

  // Create anonymous customer (no cookie, unknown id, or an explicit fresh start)
  const customer = await mintAnonymous()

  const response = NextResponse.json({ customerId: customer.id, isNew: true })
  response.cookies.set('zeno_session', customer.id, COOKIE_OPTS)
  return response
}
