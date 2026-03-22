/**
 * PATCH /api/admin/policies/[id]/status
 *
 * Update policy status and optional allianzPolicyNumber.
 * If status=ACTIVE, triggers customer email notification.
 * Protected: ADMIN or OPERATOR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth check
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { status, allianzPolicyNumber } = body as {
      status: string
      allianzPolicyNumber?: string
    }

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 },
      )
    }

    // Validate status
    const validStatuses = ['PENDING_SUBMISSION', 'SUBMITTED', 'ACTIVE', 'CANCELLED', 'EXPIRED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 },
      )
    }

    // Update policy
    const updateData: Record<string, unknown> = { status }
    if (allianzPolicyNumber) {
      updateData.allianzPolicyNumber = allianzPolicyNumber
    }
    if (status === 'ACTIVE') {
      updateData.issuedAt = new Date()
    }

    const policy = await prisma.policy.update({
      where: { id },
      data: updateData,
      include: {
        customer: { select: { email: true, name: true } },
      },
    })

    // If activating, log that we would send email notification
    // (Email service integration is Phase C — for now just log)
    if (status === 'ACTIVE' && policy.customer.email) {
      console.log(
        `[Policy Activation] Would send email to ${policy.customer.email}: "Polita ta a fost activata"`,
      )
    }

    return NextResponse.json({ policy: { id: policy.id, status: policy.status } })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
