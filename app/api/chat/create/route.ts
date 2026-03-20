/**
 * POST /api/chat/create
 *
 * Creates a new conversation for a given customer.
 * Used by the /chat entry page after session resolution.
 *
 * Body: { customerId: string }
 * Response: { conversationId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const requestSchema = z.object({
  customerId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const { customerId } = requestSchema.parse(body)

    // Verify customer exists
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 },
      )
    }

    // Create conversation
    const conversation = await prisma.conversation.create({
      data: {
        customerId,
        language: customer.language ?? 'ro',
        channel: 'web',
      },
    })

    return NextResponse.json({ conversationId: conversation.id })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 },
      )
    }
    console.error('[POST /api/chat/create] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
