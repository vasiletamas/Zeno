/**
 * GET /api/gdpr/export/[workItemId] (E3.5, M3)
 *
 * Dashboard download of an approved GDPR_EXPORT bundle. A CUSTOMER may
 * download only their OWN resolved bundle (user.customerId must match the
 * item's refs.customerId); ADMIN/OPERATOR always. Streams the stored
 * payload as an application/json attachment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workItemId: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { workItemId } = await params
    const item = await prisma.workItem.findUnique({ where: { id: workItemId } })
    if (!item || item.kind !== 'GDPR_EXPORT') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (payload.role === 'CUSTOMER') {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { customerId: true } })
      const refs = item.refs as { customerId?: string }
      if (!user?.customerId || user.customerId !== refs.customerId || item.status !== 'RESOLVED') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (item.status !== 'RESOLVED' || !item.payload) {
      return NextResponse.json({ error: 'Export not ready' }, { status: 409 })
    }

    return new NextResponse(JSON.stringify(item.payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="gdpr-export-${workItemId}.json"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
