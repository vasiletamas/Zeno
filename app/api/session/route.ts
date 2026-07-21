import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { accountChallengeTarget } from '@/lib/auth/reauth-gate'

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
 *
 * 2026-07-21: the gate itself moved to lib/auth/reauth-gate.ts — /chat/[id]
 * now enforces the same rule (spec §3.1), and two copies of it would leave
 * one door locked and the other open.
 */
const reauthGate = accountChallengeTarget

function mintAnonymous() {
  return prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
}

/**
 * T21: resume-by-default — a resumed session points the entry page at the
 * customer's latest ACTIVE conversation (null when none). Only the resume
 * paths carry this; reauth_required and fresh mints never do.
 */
async function latestActiveConversationId(customerId: string): Promise<string | null> {
  const conv = await prisma.conversation.findFirst({
    where: { customerId, status: 'ACTIVE' },
    orderBy: { lastActivityAt: 'desc' },
    select: { id: true },
  })
  return conv?.id ?? null
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
        const response = NextResponse.json({
          customerId: canonical.id,
          isNew: false,
          activeConversationId: await latestActiveConversationId(canonical.id),
        })
        response.cookies.set('zeno_session', canonical.id, COOKIE_OPTS)
        return response
      }
    }
    if (customer) {
      const gate = await reauthGate(customer.id)
      if (gate) return NextResponse.json({ status: 'reauth_required', maskedEmail: gate.maskedEmail })
      return NextResponse.json({
        customerId: customer.id,
        isNew: false,
        activeConversationId: await latestActiveConversationId(customer.id),
      })
    }
  }

  // Create anonymous customer (no cookie, unknown id, or an explicit fresh start)
  const customer = await mintAnonymous()

  const response = NextResponse.json({ customerId: customer.id, isNew: true })
  response.cookies.set('zeno_session', customer.id, COOKIE_OPTS)
  return response
}
