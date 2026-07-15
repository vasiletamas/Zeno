/**
 * GET /api/dev/last-verification-email?customerId=…
 *
 * Dev-only seam (Task 4.1, D6): the last verification code + link the mock
 * email provider sent to the given customer's challenge target — so a human
 * on the laptop (or an HTTP-driven sim harness) reads the OTP without
 * grepping server logs. 404s unconditionally in production; codes are
 * hashed at rest, so the mock provider's in-process log is the ONLY source.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { lastMockEmailTo } from '@/lib/email/providers/mock'

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const customerId = request.nextUrl.searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  }
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    select: { channel: true, target: true, expiresAt: true, consumedAt: true },
  })
  const recorded = challenge ? lastMockEmailTo(challenge.target) : null
  if (!challenge || !recorded) {
    return NextResponse.json({ error: 'no recorded verification email for this customer' }, { status: 404 })
  }
  return NextResponse.json({
    customerId,
    channel: challenge.channel,
    target: challenge.target,
    code: recorded.code,
    link: recorded.link,
    sentAt: recorded.sentAt,
    consumed: challenge.consumedAt !== null,
    expiresAt: challenge.expiresAt.toISOString(),
  })
}
