/**
 * POST /api/chat/create
 *
 * Creates a new conversation for the customer behind the `zeno_session`
 * cookie. Used by the /chat entry page after session resolution.
 *
 * Body: { customerId: string } — must match the cookie (see below)
 * Response: { conversationId: string }
 *
 * SECURITY (2026-07-21, spec §3.1). This route previously took `customerId`
 * from the BODY and bound a new Conversation to it after checking only that
 * the row existed. No cookie was read. Because the identity slice for every
 * turn is derived from `conversation.customerId`
 * (lib/engines/snapshot-loader.ts), a conversation minted that way RUNS AS the
 * named customer — inheriting their verified tier, application and quote. That
 * defeated the `verified_channel` gates already guarding accept_quote and
 * ensure_payment_session, and would have silently defeated every new gate too.
 *
 * The cookie is now the sole source of identity. The body field is retained
 * for compatibility with the existing client but is only ever CHECKED against
 * the cookie, never trusted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { canonicalCustomerId } from '@/lib/auth/reauth-gate'

const requestSchema = z.object({
  customerId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    const { customerId } = requestSchema.parse(body)

    // Both sides through the merge pointer: after a merge the cookie may name
    // the shell while the client still holds the canonical id, or vice versa.
    // Comparing raw ids locks merged customers out of their own chat (AC-6).
    const [callerId, requestedId] = await Promise.all([
      canonicalCustomerId(request.cookies.get('zeno_session')?.value),
      canonicalCustomerId(customerId),
    ])

    // ONE answer for: no cookie, unknown cookie, someone else's id, and an id
    // that does not exist. The old 404-vs-200 split was an id-validity oracle
    // on an unauthenticated route — it confirmed whether a customer id was
    // real to anyone who asked.
    if (!callerId || !requestedId || callerId !== requestedId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: callerId } })

    const conversation = await prisma.conversation.create({
      data: {
        customerId: callerId,
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
