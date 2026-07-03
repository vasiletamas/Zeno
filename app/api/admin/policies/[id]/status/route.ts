/**
 * PATCH /api/admin/policies/[id]/status (D4.3 — gateway-owned)
 *
 * Body: { action: 'mark_submitted' | 'activate' | 'cancel_submission',
 * allianzPolicyNumber? }. Each action maps to the matching operator commit
 * through executeCommit — the free-form any→any status writes and the
 * issuedAt overwrite are DEAD (T9.D3: the transition table is the law).
 * 200 on applied, 409 + { reason } on rejected. The activation email sends
 * best-effort after an applied activate.
 * Protected: ADMIN or OPERATOR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { sendPolicyActivatedEmail } from '@/lib/policies/notifications'
import { trackPolicyIssued } from '@/lib/analytics/events'
import type { ToolContext } from '@/lib/tools/types'

const ACTION_TO_TOOL: Record<string, string> = {
  mark_submitted: 'mark_submitted',
  activate: 'activate_policy',
  cancel_submission: 'cancel_submission',
}

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
    const { action, allianzPolicyNumber } = body as { action?: string; allianzPolicyNumber?: string }
    const tool = action ? ACTION_TO_TOOL[action] : undefined
    if (!tool) {
      return NextResponse.json(
        { error: 'action must be one of mark_submitted | activate | cancel_submission' },
        { status: 400 },
      )
    }

    // operator commits are keyed to the policy's ORIGIN conversation (D4.2)
    const policy = await prisma.policy.findUnique({
      where: { id },
      include: { quote: { include: { application: { select: { originConversationId: true } } } } },
    })
    if (!policy) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 })
    }
    const conversationId = policy.quote.application?.originConversationId
      ?? (await prisma.conversation.findFirstOrThrow({ where: { customerId: policy.customerId }, orderBy: { createdAt: 'asc' }, select: { id: true } })).id

    const result = await executeCommit({
      tool,
      args: { policyId: id, ...(allianzPolicyNumber ? { allianzPolicyNumber } : {}) },
      actor: 'operator',
      customerId: policy.customerId,
      conversationId,
      toolContext: { customerId: policy.customerId, conversationId, language: 'ro', db: prisma, actor: 'operator' } as unknown as ToolContext,
    })

    if (result.outcome !== 'applied') {
      return NextResponse.json({ reason: result.reason ?? 'rejected' }, { status: 409 })
    }

    if (tool === 'activate_policy') {
      trackPolicyIssued(policy.customerId, policy.id)
      await sendPolicyActivatedEmail(policy.id) // best-effort inside
    }

    const updated = await prisma.policy.findUniqueOrThrow({ where: { id }, select: { id: true, status: true } })
    return NextResponse.json({ policy: updated })
  } catch (error) {
    console.error('[AdminPolicyStatus] PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
