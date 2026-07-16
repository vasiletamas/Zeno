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
import { logError, logFatal } from '@/lib/errors/logger'

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
// CONCURRENCY GUARD
// ==============================================

const inFlightRequests = new Map<string, number>()
const MAX_CONCURRENT_PER_CONVERSATION = 3

// T30: EVERY exit after the increment must release its slot — the unknown-
// action 400 used to leak one per post, permanently 429ing the conversation.
function releaseInFlight(conversationId: string) {
  const current = inFlightRequests.get(conversationId) ?? 1
  if (current <= 1) inFlightRequests.delete(conversationId)
  else inFlightRequests.set(conversationId, current - 1)
}

// ==============================================
// ROUTE HANDLER
// ==============================================

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const parsed = requestSchema.parse(body)

    const conversationId = parsed.conversationId
    if (conversationId) {
      const current = inFlightRequests.get(conversationId) ?? 0
      if (current >= MAX_CONCURRENT_PER_CONVERSATION) {
        return Response.json(
          { error: 'Too many concurrent requests for this conversation' },
          { status: 429 },
        )
      }
      inFlightRequests.set(conversationId, current + 1)
    }

    let syntheticToolCall = undefined
    let message = parsed.message ?? ''

    if (parsed.action) {
      syntheticToolCall = adaptAction(parsed.action) ?? undefined
      if (!syntheticToolCall) {
        if (conversationId) releaseInFlight(conversationId)
        return NextResponse.json(
          { error: 'Unknown action type' },
          { status: 400 },
        )
      }
      message = message || `[Action: ${parsed.action.type}]`
    }

    const debugEnabled = request.headers.get('x-zeno-debug') === '1'

    let stream: ReadableStream<Uint8Array>
    try {
      stream = handleChatTurn({
        conversationId: parsed.conversationId,
        customerId: parsed.customerId,
        message,
        language: parsed.language,
        syntheticToolCall,
        debugEnabled,
      })
    } catch (err) {
      const errorId = logFatal({
        layer: 'api',
        category: 'internal',
        message: 'handleChatTurn threw synchronously',
        context: { conversationId },
        error: err,
      })
      if (conversationId) releaseInFlight(conversationId)
      return Response.json(
        { error: 'Internal server error', errorId },
        { status: 500 },
      )
    }

    if (conversationId) {
      const cleanup = new TransformStream({
        flush() {
          releaseInFlight(conversationId)
        },
      })
      stream = stream.pipeThrough(cleanup)
    }

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
    const errorId = logError({
      layer: 'api',
      category: 'internal',
      message: 'Unexpected error in POST /api/chat',
      error,
    })
    return NextResponse.json(
      { error: 'Internal server error', errorId },
      { status: 500 },
    )
  }
}
