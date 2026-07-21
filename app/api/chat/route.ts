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
import { ACTION_MESSAGE_PREFIX, actionLabel } from '@/lib/chat/action-labels'
import { logError, logFatal } from '@/lib/errors/logger'
import { decideConversationAccess } from '@/lib/chat/conversation-access'
import { PROOF_COOKIE } from '@/lib/auth/session-proof'
import { canonicalCustomerId } from '@/lib/auth/reauth-gate'

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

    /**
     * ACCESS BEFORE ANYTHING ELSE (spec 2026-07-21 §3.1) — deliberately ahead
     * of the concurrency guard, so a refused caller never takes a slot. Three
     * refused posts would otherwise 429 the owner out of their own
     * conversation.
     *
     * The route previously trusted BOTH ids from the body. Because the
     * identity slice is derived from `conversation.customerId`
     * (lib/engines/snapshot-loader.ts), that let any caller drive a turn in
     * someone else's conversation — reading their state and writing commits
     * under their identity.
     *
     * `customerId` is now derived from the cookie and the body copy is only
     * ever checked against it, so reads and writes share one principal.
     */
    const callerId = await canonicalCustomerId(request.cookies.get('zeno_session')?.value)
    if (!callerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (parsed.customerId && (await canonicalCustomerId(parsed.customerId)) !== callerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (conversationId) {
      const access = await decideConversationAccess({
        conversationId,
        cookieCustomerId: request.cookies.get('zeno_session')?.value,
        proofToken: request.cookies.get(PROOF_COOKIE)?.value,
      })
      // `reauth` refuses here too: the page renders the challenge, and a turn
      // posted from a stale tab must not slip past it.
      if (access.kind !== 'allow') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

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
      // T22: the persisted user row is what the customer sees after reload —
      // a localized, PII-safe summary, never the raw "[Action: type]" marker.
      message = message || ACTION_MESSAGE_PREFIX + actionLabel(parsed.action, parsed.language ?? 'ro')
    }

    const debugEnabled = request.headers.get('x-zeno-debug') === '1'

    let stream: ReadableStream<Uint8Array>
    try {
      stream = handleChatTurn({
        conversationId: parsed.conversationId,
        // the COOKIE's customer, canonicalised — never the body's (see the
        // access block above): reads and writes must share one principal.
        customerId: callerId,
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
