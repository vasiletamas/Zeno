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
import { getEmailProvider } from '@/lib/email'
import { magicLinkEmail } from '@/lib/email/templates/magic-link'

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

    // Generate token and set expiry (30 minutes)
    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

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

    // Update customer with magic link token
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        magicLinkToken: token,
        magicLinkExpiresAt: expiresAt,
      },
    })

    // Send magic link email
    const appUrl = process.env.APP_URL || 'http://localhost:3001'
    const magicLink = `${appUrl}/api/auth/verify?token=${token}`

    const emailContent = magicLinkEmail({
      customerName: customer.name || 'Client',
      magicLink,
      language: (customer.language as 'ro' | 'en') || 'ro',
    })

    const emailProvider = getEmailProvider()
    await emailProvider.send({
      to: customer.email!,
      subject: emailContent.subject,
      html: emailContent.html,
    })

    return NextResponse.json({ sent: true })
  } catch {
    // Still return success to avoid leaking info
    return NextResponse.json({ sent: true })
  }
}
