/**
 * POST /api/chat
 *
 * Thin HTTP handler for the chat orchestrator.
 * Accepts message or UI action, returns SSE stream.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { adaptAction } from '@/lib/chat/action-adapter'

// ==============================================
// REQUEST VALIDATION
// ==============================================

const requestSchema = z
  .object({
    conversationId: z.string().optional(),
    customerId: z.string().optional(),
    message: z.string().min(1).optional(),
    language: z.enum(['en', 'ro']).optional(),
    action: z
      .object({
        type: z.string(),
        payload: z.record(z.string(), z.unknown()),
      })
      .optional(),
  })
  .refine((data) => data.message || data.action, {
    message: 'Either message or action is required',
  })

// ==============================================
// ROUTE HANDLER
// ==============================================

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const parsed = requestSchema.parse(body)

    let syntheticToolCall = undefined
    let message = parsed.message ?? ''

    if (parsed.action) {
      syntheticToolCall = adaptAction(parsed.action) ?? undefined
      if (!syntheticToolCall) {
        return NextResponse.json(
          { error: 'Unknown action type' },
          { status: 400 },
        )
      }
      message = message || `[Action: ${parsed.action.type}]`
    }

    const stream = handleChatTurn({
      conversationId: parsed.conversationId,
      customerId: parsed.customerId,
      message,
      language: parsed.language,
      syntheticToolCall,
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 },
      )
    }
    console.error('[POST /api/chat] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
