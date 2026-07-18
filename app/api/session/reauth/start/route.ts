/**
 * POST /api/session/reauth/start (T26, P5.2)
 *
 * Issues an OTP challenge to the ACCOUNT's verified email for the customer
 * behind the zeno_session cookie (canonical after merge-pointer follow).
 * Anti-enumeration: always 200 {sent:true} — the response never reveals
 * whether the cookie maps to an account.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { issueChallenge } from '@/lib/customer/verification-service'

export async function POST(request: NextRequest) {
  try {
    const cookieId = request.cookies.get('zeno_session')?.value
    if (cookieId) {
      const customer = await prisma.customer.findUnique({ where: { id: cookieId } })
      const canonicalId = customer?.mergedIntoId ?? customer?.id ?? null
      if (canonicalId) {
        const user = await prisma.user.findUnique({ where: { customerId: canonicalId } })
        if (user) {
          await issueChallenge(canonicalId, 'email', user.email, null)
        }
      }
    }
  } catch {
    // anti-enumeration: failures answer exactly like successes
  }
  return NextResponse.json({ sent: true })
}
