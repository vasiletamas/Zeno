/**
 * Conversation access control (spec 2026-07-21 §3.1 Fix A).
 *
 * Before this existed, /chat/[id] served ANY conversation to ANY caller who
 * knew its id — no ownership check, no reauth — and fell back to adopting the
 * conversation's own customer when no cookie was present. The reauth gate
 * lived only on POST /api/session, which a history link never touches.
 *
 * TWO controls, because there are two threats:
 *
 *  1. OWNERSHIP — the cookie must resolve (through the merge pointer) to the
 *     conversation's customer. Stops urls that escape the browser: links
 *     pasted into chats, referrer leaks, server logs.
 *
 *  2. FRESHNESS — an account holder must ALSO present a live `zeno_proof`.
 *     Stops the shared device. Ownership alone cannot: the second person at
 *     that browser carries the SAME `zeno_session` cookie and passes every
 *     ownership test there is. This control is the whole reason AC-3 works.
 *
 * Deliberately DB-only and framework-free — no next/headers, no Request — so
 * both the server component and the API route reach one decision, and so the
 * decision is testable without a webserver.
 */
import { prisma } from '@/lib/db'
import { accountChallengeTarget, canonicalCustomerId } from '@/lib/auth/reauth-gate'
import { verifySessionProof } from '@/lib/auth/session-proof'

export type ConversationAccess =
  /** Serve it. `customerId` is CANONICAL — callers must prefer it over the raw cookie. */
  | { kind: 'allow'; customerId: string }
  /** Owner, but this browser has not proven itself. Render the challenge and NOTHING else. */
  | { kind: 'reauth'; customerId: string; maskedEmail: string }
  /** Not this caller's conversation. Callers redirect to /chat; never 404 with detail. */
  | { kind: 'deny' }

export interface ConversationAccessInput {
  conversationId: string
  /** Raw `zeno_session` value — may be a merged shell id, or absent. */
  cookieCustomerId: string | undefined
  /** Raw `zeno_proof` value, if the browser carries one. */
  proofToken: string | undefined
}

export async function decideConversationAccess(
  { conversationId, cookieCustomerId, proofToken }: ConversationAccessInput,
): Promise<ConversationAccess> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerId: true },
  })
  if (!conversation) return { kind: 'deny' }

  // Both sides resolved through the merge pointer before comparison: either
  // the cookie or the conversation may sit on the shell (AC-6).
  const [ownerId, callerId] = await Promise.all([
    canonicalCustomerId(conversation.customerId),
    canonicalCustomerId(cookieCustomerId),
  ])

  // No cookie, unknown cookie, or someone else's conversation. One answer for
  // all three: a distinct "exists but not yours" would confirm the id.
  if (!ownerId || !callerId || ownerId !== callerId) return { kind: 'deny' }

  const gate = await accountChallengeTarget(ownerId)
  if (!gate) return { kind: 'allow', customerId: ownerId } // anonymous — AC-4

  const proven = await verifySessionProof(proofToken, ownerId)
  return proven
    ? { kind: 'allow', customerId: ownerId }
    : { kind: 'reauth', customerId: ownerId, maskedEmail: gate.maskedEmail }
}
