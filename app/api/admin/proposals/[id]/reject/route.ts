/**
 * POST /api/admin/proposals/:id/reject
 *
 * Reject a proposal with optional notes.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const proposal = await prisma.improvementProposal.findUnique({ where: { id } })
    if (!proposal) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (proposal.status !== 'PENDING') {
      return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const { notes } = body as { notes?: string }

    await prisma.improvementProposal.update({
      where: { id },
      data: {
        status: 'REJECTED',
        adminNotes: notes ?? null,
      },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
