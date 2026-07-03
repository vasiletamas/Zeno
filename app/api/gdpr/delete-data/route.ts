/**
 * DELETE /api/gdpr/delete-data (E3.4 — aligned under the retention table)
 *
 * GDPR Right to Erasure. This route MUTATES NOTHING inline — the erasure
 * executor owns every mutation under the retention policy (M3):
 *  - CUSTOMER (own data only): creates a GDPR_ERASURE WorkItem → 202
 *    { workItemId, status: 'pending_operator_approval' }.
 *  - ADMIN: creates the WorkItem and approves it immediately through the
 *    commit gateway (approve_erasure, actor=operator) → 200 with the
 *    per-class report; the decision is ledger-recorded like any operator's.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { createWorkItem } from '@/lib/work-items/service'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

export async function DELETE(request: NextRequest) {
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

    // Only CUSTOMER or ADMIN can use this endpoint
    if (payload.role !== 'CUSTOMER' && payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { customerId, confirmDeletion } = body as {
      customerId: string
      confirmDeletion: boolean
    }

    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId is required' },
        { status: 400 },
      )
    }

    if (confirmDeletion !== true) {
      return NextResponse.json(
        { error: 'confirmDeletion must be true to proceed' },
        { status: 400 },
      )
    }

    // For CUSTOMER role, verify they can only request erasure of own data
    if (payload.role === 'CUSTOMER') {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { customerId: true },
      })
      if (user?.customerId !== customerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 },
      )
    }

    const item = await createWorkItem({
      kind: 'GDPR_ERASURE',
      priority: 'HIGH',
      reason: 'erasure_requested_via_dashboard',
      refs: { customerId },
      createdBy: `${payload.role}:${payload.userId}`,
    })

    if (payload.role !== 'ADMIN') {
      return NextResponse.json({ workItemId: item.id, status: 'pending_operator_approval' }, { status: 202 })
    }

    // ADMIN approves immediately — through the SAME gateway commit an
    // operator would use from the queue; the commit needs a conversation
    // for its lock/snapshot, so use the customer's latest (or a service one).
    const conversation =
      (await prisma.conversation.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' }, select: { id: true } })) ??
      (await prisma.conversation.create({ data: { customerId, channel: 'system' }, select: { id: true } }))
    const ctx = { customerId, conversationId: conversation.id, language: 'ro', db: prisma } as unknown as ToolContext
    const result = await executeCommit({
      tool: 'approve_erasure',
      actor: 'operator',
      conversationId: conversation.id,
      customerId,
      args: { workItemId: item.id },
      toolContext: ctx,
    })
    if (result.outcome !== 'applied') {
      return NextResponse.json({ error: result.reason ?? 'rejected', workItemId: item.id }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      workItemId: item.id,
      classResults: (result.data as { classResults?: unknown[] })?.classResults ?? [],
    })
  } catch (error) {
    console.error('[GDPR Deletion] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
