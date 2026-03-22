/**
 * DELETE /api/gdpr/delete-data
 *
 * GDPR Right to Erasure — anonymize customer PII, retain business records.
 * Auth: CUSTOMER (own data only) or ADMIN (any customer).
 *
 * Retained (legal/financial requirement): Policies, Payments, TurnTraces,
 * Conversation records (anonymized), assistant Messages.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { Prisma } from '@/lib/generated/prisma/client'

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

    // For CUSTOMER role, verify they can only delete own data
    if (payload.role === 'CUSTOMER') {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { customerId: true },
      })
      if (user?.customerId !== customerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        conversations: { select: { id: true } },
        user: { select: { id: true } },
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 },
      )
    }

    const conversationIds = customer.conversations.map((c) => c.id)
    const deletedFields: string[] = []
    const retainedRecords: string[] = []

    // 1. Anonymize Customer — set all PII fields to null
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        name: null,
        email: null,
        phone: null,
        cnpEncrypted: null,
        cnpIv: null,
        cnpTag: null,
        address: Prisma.DbNull,
        extractedProfile: Prisma.DbNull,
        dateOfBirth: null,
        isAnonymous: true,
        magicLinkToken: null,
        magicLinkExpiresAt: null,
      },
    })
    deletedFields.push(
      'name',
      'email',
      'phone',
      'cnp (encrypted)',
      'address',
      'extractedProfile',
      'dateOfBirth',
      'magicLinkToken',
    )

    // 2. Delete Answers for customer's conversations
    if (conversationIds.length > 0) {
      const deleteResult = await prisma.answer.deleteMany({
        where: { conversationId: { in: conversationIds } },
      })
      deletedFields.push(`answers (${deleteResult.count} records)`)
    }

    // 3. Anonymize user Messages — replace content
    if (conversationIds.length > 0) {
      const msgResult = await prisma.message.updateMany({
        where: {
          conversationId: { in: conversationIds },
          role: 'user',
        },
        data: { content: '[Deleted per GDPR request]' },
      })
      deletedFields.push(`user messages anonymized (${msgResult.count} records)`)
    }

    // 4. Deactivate User account
    if (customer.user) {
      await prisma.user.update({
        where: { id: customer.user.id },
        data: { isActive: false },
      })
      deletedFields.push('user account deactivated')
    }

    // Record retained items
    retainedRecords.push(
      'conversations (audit trail, anonymized)',
      'policies (legal obligation)',
      'payments (financial records)',
      'turnTraces (operational, no PII)',
      'assistant messages (agent responses)',
    )

    // Log the deletion
    console.log(
      `[GDPR Deletion] Completed for customer=${customerId}, ` +
        `requestedBy=${payload.userId} (${payload.role}), ` +
        `deletedFields=[${deletedFields.join(', ')}], ` +
        `timestamp=${new Date().toISOString()}`,
    )

    return NextResponse.json({
      success: true,
      deletedFields,
      retainedRecords,
    })
  } catch (error) {
    console.error('[GDPR Deletion] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
