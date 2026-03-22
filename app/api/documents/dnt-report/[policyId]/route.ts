/**
 * GET /api/documents/dnt-report/[policyId]
 *
 * Serves the DNT suitability report PDF for download.
 * Auth: CUSTOMER (own policy only), ADMIN or OPERATOR (any policy).
 */

import fs from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> },
) {
  try {
    // Auth check
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { policyId } = await params

    // Load policy
    const policy = await prisma.policy.findUnique({
      where: { id: policyId },
      include: {
        customer: {
          include: { user: { select: { id: true } } },
        },
      },
    })

    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }

    // Authorization: CUSTOMER can only access own policy
    if (payload.role === 'CUSTOMER') {
      const customerUserId = policy.customer.user?.id
      if (customerUserId !== payload.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if report exists
    if (!policy.suitabilityReportPath) {
      return NextResponse.json(
        { error: 'Report not yet generated.' },
        { status: 404 },
      )
    }

    // Read file from filesystem
    if (!fs.existsSync(policy.suitabilityReportPath)) {
      return NextResponse.json(
        { error: 'Report file not found on disk.' },
        { status: 404 },
      )
    }

    const fileBuffer = fs.readFileSync(policy.suitabilityReportPath)

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="raport-dnt-${policyId}.pdf"`,
        'Content-Length': String(fileBuffer.length),
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
