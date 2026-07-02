/**
 * POST /api/admin/work-items/[id]/resolve
 *
 * Resolve a work item with a kind-appropriate decision. The state change
 * runs through the commit gateway as an operator commit (resolve_referral /
 * resolve_work_item), so the ledger records who moved what and why.
 * Protected: ADMIN or OPERATOR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { resolveWorkItemDecision } from '@/lib/work-items/resolution'

/** Decisions each kind accepts. GDPR kinds are wired by E3's resolution flow. */
const DECISIONS_BY_KIND: Record<string, string[]> = {
  REFERRAL: ['approve', 'reject'],
  ESCALATION: ['resolve', 'dismiss'],
  DOCUMENT_REVIEW: ['resolve', 'dismiss'],
  ALERT_FLAG: ['resolve', 'dismiss'],
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = (await request.json()) as { decision?: string; note?: string }
    const decision = body.decision

    const item = await prisma.workItem.findUnique({ where: { id } })
    if (!item) {
      return NextResponse.json({ error: 'Work item not found' }, { status: 404 })
    }
    if (item.kind === 'GDPR_ERASURE' || item.kind === 'GDPR_EXPORT') {
      return NextResponse.json({ error: 'use_gdpr_resolution' }, { status: 400 })
    }
    if (!decision || !DECISIONS_BY_KIND[item.kind]?.includes(decision)) {
      return NextResponse.json({ error: 'invalid_decision_for_kind' }, { status: 400 })
    }

    const result = await resolveWorkItemDecision({
      workItemId: id,
      decision: decision as 'approve' | 'reject' | 'resolve' | 'dismiss',
      note: body.note,
      resolvedBy: payload.email,
    })
    if (result.outcome !== 'applied') {
      // domain rejection (e.g. work_item_not_open) — not a client-shape error
      return NextResponse.json({ error: result.reason ?? 'rejected', result }, { status: 409 })
    }
    return NextResponse.json({ result })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
