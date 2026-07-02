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
  candidateConfidence: number | null
  candidateSetAt: Date | null
  workflowSession: {
    id: string
    workflowId: string
    currentStepId: string
    currentStep: {
      id: string
      code: string
      name: string
      agentInstructions: string | null
      allowedTools: string[]
      autoTool: string | null
    }
    data: unknown
  } | null
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
  extractedProfile: Record<string, unknown>
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
  const [rawConversation, rawCustomer, rawMessages] = await Promise.all([
    // Query 1 — conversation with product, workflowSession (+ currentStep), application (+ quote + policy)
    prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        product: { select: { id: true, code: true, name: true } },
        workflowSession: {
          include: {
            currentStep: {
              select: {
                id: true,
                code: true,
                name: true,
                agentInstructions: true,
                allowedTools: true,
                autoTool: true,
              },
            },
          },
        },
        application: {
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
        },
      },
    }),

    // Query 2 — customer profile fields
    prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        name: true,
        dateOfBirth: true,
        extractedProfile: true,
        language: true,
        isAnonymous: true,
        gdprConsentAt: true,
        gdprConsentScope: true,
        aiDisclosureAcknowledgedAt: true,
      },
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
    candidateConfidence: rawConversation.candidateConfidence,
    candidateSetAt: rawConversation.candidateSetAt,
    workflowSession: rawConversation.workflowSession ?? null,
    application: (rawConversation as { application?: TurnContextConversation['application'] }).application ?? null,
  }

  // -------------------------------------------------------------------------
  // Shape customer — handle null (anonymous) gracefully
  // -------------------------------------------------------------------------
  const customer: TurnContextCustomer = rawCustomer
    ? {
        name: rawCustomer.name ?? null,
        dateOfBirth: rawCustomer.dateOfBirth ?? null,
        extractedProfile: (rawCustomer.extractedProfile as Record<string, unknown>) ?? {},
        language: rawCustomer.language,
        isAnonymous: rawCustomer.isAnonymous,
        gdprConsentAt: rawCustomer.gdprConsentAt ?? null,
        gdprConsentScope: rawCustomer.gdprConsentScope ?? null,
        aiDisclosureAcknowledgedAt: rawCustomer.aiDisclosureAcknowledgedAt ?? null,
      }
    : {
        name: null,
        dateOfBirth: null,
        extractedProfile: {},
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
