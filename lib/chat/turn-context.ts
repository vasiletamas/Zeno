/**
 * Turn Context Loader
 *
 * Consolidates ~10 sequential DB queries across orchestrator Steps 1, 3, and 4
 * into 3 parallel queries executed via Promise.all.
 */

import { prisma } from '@/lib/db'

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export interface TurnContextConversation {
  id: string
  status: string
  messageCount: number
  mode: string
  productId: string | null
  product: { id: string; code: string; name: unknown } | null
  candidateProductId: string | null
  candidateSetAt: Date | null
  application: {
    status: string
    currentQuestionIndex: number
    totalQuestions: number
    quote: {
      status: string
      premiumAnnual: number
      policy: { id: string } | null
    } | null
  } | null
}

export interface TurnContextCustomer {
  name: string | null
  dateOfBirth: Date | null
  language: string
  isAnonymous: boolean
  gdprConsentAt: Date | null
  gdprConsentScope: string | null
  aiDisclosureAcknowledgedAt: Date | null
}

export interface TurnContextMessage {
  role: string
  content: string
  createdAt: Date
}

export interface TurnContext {
  conversation: TurnContextConversation
  customer: TurnContextCustomer
  recentMessages: TurnContextMessage[]
}

// =============================================================================
// LOADER
// =============================================================================

/**
 * Load all data needed for a single chat turn in 4 parallel queries.
 *
 * Replaces the ~10 sequential DB queries previously spread across
 * orchestrator Steps 1, 3, and 4.
 */
export async function loadTurnContext(
  conversationId: string,
  customerId: string,
): Promise<TurnContext> {
  const [rawConversation, rawCustomer, rawConsentEvents, rawMessages] = await Promise.all([
    // Query 1 — conversation with product (the application hangs off the
    // activeApplicationId pointer since B4 and is loaded below)
    prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        product: { select: { id: true, code: true, name: true } },
      },
    }),

    // Query 2 — customer profile fields
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true,
        dateOfBirth: true,
        language: true,
        isAnonymous: true,
      },
    }),

    // Query 2b — consent ledger (B1): consent facts are DERIVED from the
    // append-only ConsentEvent rows, latest event per kind wins
    prisma.consentEvent.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, action: true, scope: true, createdAt: true },
    }),

    // Query 3 — last 10 messages, newest-first, to be reversed to chronological
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        role: true,
        content: true,
        createdAt: true,
      },
    }),
  ])

  // -------------------------------------------------------------------------
  // Shape conversation — apply casts and defaults
  // -------------------------------------------------------------------------
  const conversation: TurnContextConversation = {
    id: rawConversation.id,
    status: rawConversation.status,
    messageCount: rawConversation.messageCount,
    mode: (rawConversation.mode as string) ?? 'SALES',
    productId: rawConversation.productId,
    product: rawConversation.product,
    candidateProductId: rawConversation.candidateProductId,
    candidateSetAt: rawConversation.candidateSetAt,
    application: rawConversation.activeApplicationId
      ? ((await prisma.application.findUnique({
          where: { id: rawConversation.activeApplicationId },
          select: {
            status: true,
            currentQuestionIndex: true,
            totalQuestions: true,
            quote: {
              select: {
                status: true,
                premiumAnnual: true,
                policy: { select: { id: true } },
              },
            },
          },
        })) as TurnContextConversation['application'])
      : null,
  }

  // -------------------------------------------------------------------------
  // Shape customer — handle null (anonymous) gracefully. Consent facts are
  // derived from the ledger: latest event per kind, granted → its timestamp.
  // -------------------------------------------------------------------------
  const latestConsent = new Map<string, { action: string; scope: string | null; createdAt: Date }>()
  for (const e of rawConsentEvents) latestConsent.set(e.kind, e)
  const granted = (kind: string) => {
    const e = latestConsent.get(kind)
    return e?.action === 'granted' ? e : null
  }
  const gdprGrant = granted('gdpr_processing')
  const aiGrant = granted('ai_disclosure')

  const customer: TurnContextCustomer = rawCustomer
    ? {
        name: rawCustomer.name ?? null,
        dateOfBirth: rawCustomer.dateOfBirth ?? null,
        language: rawCustomer.language,
        isAnonymous: rawCustomer.isAnonymous,
        gdprConsentAt: gdprGrant?.createdAt ?? null,
        gdprConsentScope: gdprGrant?.scope ?? null,
        aiDisclosureAcknowledgedAt: aiGrant?.createdAt ?? null,
      }
    : {
        name: null,
        dateOfBirth: null,
        language: 'ro',
        isAnonymous: true,
        gdprConsentAt: null,
        gdprConsentScope: null,
        aiDisclosureAcknowledgedAt: null,
      }

  // -------------------------------------------------------------------------
  // Messages — reverse from desc to chronological order
  // -------------------------------------------------------------------------
  const recentMessages: TurnContextMessage[] = [...rawMessages].reverse()

  return {
    conversation,
    customer,
    recentMessages,
  }
}

/**
 * D2.9 (contradiction #11): a conversation is a CHANNEL — ACTIVE or
 * ARCHIVED (inactivity sweep), never a funnel stage. A turn on an archived
 * conversation REACTIVATES it (the old terminal guard threw). This is the
 * ONLY status-writing call site in lib/; the sweep script is the other, in
 * scripts/.
 */
export async function reactivateIfArchived(conversationId: string): Promise<boolean> {
  const res = await prisma.conversation.updateMany({
    where: { id: conversationId, status: 'ARCHIVED' },
    data: { status: 'ACTIVE', archivedAt: null },
  })
  return res.count > 0
}
