/**
 * GET /api/auth/verify?token=...
 *
 * Verifies a magic link token and creates a JWT session.
 * Token is one-time use and expires after 30 minutes.
 * JWT session lasts 7 days for customers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signToken, setAuthCookie } from '@/lib/auth/jwt'

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.redirect(
        new URL('/dashboard/login?error=missing-token', request.url),
      )
    }

    // Find customer by magic link token (uses @unique index)
    const customer = await prisma.customer.findUnique({
      where: { magicLinkToken: token },
    })

    if (!customer) {
      return NextResponse.redirect(
        new URL('/dashboard/login?error=invalid-token', request.url),
      )
    }

    // Check token expiry (30 minutes)
    if (
      !customer.magicLinkExpiresAt ||
      customer.magicLinkExpiresAt < new Date()
    ) {
      // Clear expired token
      await prisma.customer.update({
        where: { id: customer.id },
        data: { magicLinkToken: null, magicLinkExpiresAt: null },
      })
      return NextResponse.redirect(
        new URL('/dashboard/login?error=expired-token', request.url),
      )
    }

    // Find or create User linked to this Customer
    let user = await prisma.user.findUnique({
      where: { customerId: customer.id },
    })

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: customer.email!,
          role: 'CUSTOMER',
          customerId: customer.id,
        },
      })
    }

    // Update lastLoginAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Sign JWT (7-day expiry for customers)
    const jwtToken = await signToken(
      { userId: user.id, role: user.role, email: user.email },
      '7d',
    )

    // Clear magic link token (one-time use)
    await prisma.customer.update({
      where: { id: customer.id },
      data: { magicLinkToken: null, magicLinkExpiresAt: null },
    })

    // Set cookie and redirect to dashboard
    const response = NextResponse.redirect(
      new URL('/dashboard', request.url),
    )
    setAuthCookie(response, jwtToken)

    return response
  } catch {
    return NextResponse.redirect(
      new URL('/dashboard/login?error=server-error', request.url),
    )
  }
}
