/**
 * GET /api/admin/work-items
 *
 * List the operator work-item queue (M5), filterable by ?status and ?kind.
 * Protected: ADMIN or OPERATOR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { listWorkItems } from '@/lib/work-items/service'
import type { WorkItemKind, WorkItemStatus } from '@/lib/generated/prisma/client'

const STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'])
const KINDS = new Set(['REFERRAL', 'ESCALATION', 'DOCUMENT_REVIEW', 'GDPR_ERASURE', 'GDPR_EXPORT', 'ALERT_FLAG'])

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const status = request.nextUrl.searchParams.get('status') ?? undefined
    const kind = request.nextUrl.searchParams.get('kind') ?? undefined
    if ((status && !STATUSES.has(status)) || (kind && !KINDS.has(kind))) {
      return NextResponse.json({ error: 'Invalid filter' }, { status: 400 })
    }

    const items = await listWorkItems({
      status: status as WorkItemStatus | undefined,
      kind: kind as WorkItemKind | undefined,
    })
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
