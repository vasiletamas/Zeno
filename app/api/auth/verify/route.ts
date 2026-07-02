/**
 * GET /api/auth/verify?token=...
 *
 * Magic-link leg of the B3.4 challenge primitive: consuming the linkToken
 * runs the SAME consumption + verified-claim path as the in-chat OTP
 * (verification-service), binds the chat session (zeno_session) to the
 * canonical customer, keeps the JWT for dashboard access, and returns the
 * customer to their conversation when the challenge was chat-initiated
 * (erratum 2: /chat/[id]), else to the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signToken, setAuthCookie } from '@/lib/auth/jwt'
import { confirmByLinkToken, applyVerifiedClaim } from '@/lib/customer/verification-service'

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.redirect(new URL('/dashboard/login?error=missing-token', request.url))
    }

    const r = await confirmByLinkToken(token)
    if (!r.ok) {
      return NextResponse.redirect(new URL('/dashboard/login?error=invalid-token', request.url))
    }

    // shared verified-claim path (T4.D4): merged shells continue on the owner
    const claim = await applyVerifiedClaim(r)
    const customerId = claim.customerId
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })

    // Find or create User linked to this Customer (dashboard access)
    let user = await prisma.user.findUnique({ where: { customerId } })
    if (!user) {
      user = await prisma.user.create({
        data: { email: customer.email ?? r.target, role: 'CUSTOMER', customerId },
      })
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })

    const jwtToken = await signToken({ userId: user.id, role: user.role, email: user.email }, '7d')

    // return-to-conversation (T4-R5): chat-initiated challenges carry the
    // conversation; /chat/[id] loads it for the rebound session.
    const dest = r.conversationId ? `/chat/${r.conversationId}` : '/dashboard'
    const response = NextResponse.redirect(new URL(dest, request.url))
    setAuthCookie(response, jwtToken)
    response.cookies.set('zeno_session', customerId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 2592000,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    })
    return response
  } catch {
    return NextResponse.redirect(new URL('/dashboard/login?error=server-error', request.url))
  }
}
