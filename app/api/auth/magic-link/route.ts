/**
 * POST /api/auth/magic-link
 *
 * Customer magic link authentication.
 * Sends a one-time login link to the customer's email.
 * Token expires after 30 minutes.
 *
 * Always returns { sent: true } to avoid revealing whether an email exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { issueChallenge } from '@/lib/customer/verification-service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email } = body as { email?: string }

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 },
      )
    }

    // Find customer by email
    const customer = await prisma.customer.findUnique({
      where: { email },
    })

    // If not found, return success anyway (don't reveal if email exists)
    if (!customer) {
      return NextResponse.json({ sent: true })
    }

    // Find or create User linked to this customer
    await prisma.user.upsert({
      where: { customerId: customer.id },
      update: {},
      create: {
        email: customer.email!,
        role: 'CUSTOMER',
        customerId: customer.id,
      },
    })

    // B3.6: the link is the B3.4 challenge primitive (code + link in one
    // email, 30-minute expiry). Dashboard-initiated → no conversation
    // binding; /api/auth/verify redirects to /dashboard.
    await issueChallenge(customer.id, 'email', customer.email!, null, prisma, undefined, 30 * 60 * 1000)

    return NextResponse.json({ sent: true })
  } catch {
    // Still return success to avoid leaking info
    return NextResponse.json({ sent: true })
  }
}
