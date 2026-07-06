/**
 * Scorer Agent — scores unscored completed/abandoned conversations.
 *
 * Weighted signals:
 *   quote generated       = 0.3
 *   application submitted = 0.6
 *   policy purchased      = 1.0
 * Normalized to 0–1 by dividing by 1.9.
 */

import { prisma } from '@/lib/db'

const MAX_SCORE = 0.3 + 0.6 + 1.0 // 1.9

interface ConversationWithRelations {
  id: string
  messageCount: number
  mode: string
  application: {
    id: string
    quote: {
      id: string
      paymentSchedules: { installments: { id: string }[] }[]
    } | null
  } | null
  turnTraces: {
    cost: number | null
    latencyMs: number | null
    anomalies: unknown
    inputTokens?: number | null
    cacheReadTokens?: number | null
    cacheWriteTokens?: number | null
  }[]
}

export async function scoreConversations(): Promise<number> {
  // D2.1 (contradiction #11): Conversation.status is ACTIVE|ARCHIVED and no
  // funnel outcome — sim outcomes live on SimulationConversation, so score
  // conversations whose simulation reached a terminal customer outcome.
  const rawConversations = await prisma.conversation.findMany({
    where: {
      simulationConversation: { status: { in: ['COMPLETED', 'ABANDONED'] } },
      score: null, // no ConversationScore yet
    },
    include: {
      turnTraces: {
        select: { cost: true, latencyMs: true, anomalies: true, inputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      },
    },
  })
  // B4: the application hangs off the activeApplicationId pointer
  const conversations = (await Promise.all(
    rawConversations.map(async (conv) => ({
      ...conv,
      application: conv.activeApplicationId
        ? await prisma.application.findUnique({
            where: { id: conv.activeApplicationId },
            include: {
              quote: {
                include: {
                  // D2.1 (contradiction #3): purchase truth = a PAID
                  // installment on the quote's schedule, never Payment→Policy
                  paymentSchedules: {
                    include: { installments: { where: { status: 'PAID' }, take: 1, select: { id: true } } },
                  },
                },
              },
            },
          })
        : null,
    })),
  )) as unknown as ConversationWithRelations[]

  let scored = 0

  for (const conv of conversations) {
    const applicationSubmitted = conv.application !== null
    const quoteGenerated =
      applicationSubmitted && conv.application!.quote !== null
    const policyPurchased =
      quoteGenerated &&
      conv.application!.quote!.paymentSchedules.some((s) => s.installments.length > 0)

    const rawScore =
      (quoteGenerated ? 0.3 : 0) +
      (applicationSubmitted ? 0.6 : 0) +
      (policyPurchased ? 1.0 : 0)
    const normalizedScore = rawScore / MAX_SCORE

    const totalCost = conv.turnTraces.reduce(
      (sum, t) => sum + (t.cost ?? 0),
      0
    )
    const totalLatencyMs = conv.turnTraces.reduce(
      (sum, t) => sum + (t.latencyMs ?? 0),
      0
    )
    const anomalyCount = conv.turnTraces.reduce((sum, t) => {
      const anomalies = t.anomalies as unknown[] | null
      return sum + (Array.isArray(anomalies) ? anomalies.length : 0)
    }, 0)

    // A1c cache aggregates: hit rate is per LLM-carrying trace; null when the
    // conversation predates the token telemetry entirely.
    const llmTraces = conv.turnTraces.filter((t) => (t.inputTokens ?? 0) > 0)
    const totalPromptTokens = llmTraces.reduce((sum, t) => sum + (t.inputTokens ?? 0), 0)
    const totalCachedTokens = llmTraces.reduce((sum, t) => sum + (t.cacheReadTokens ?? 0), 0)
    const avgCacheHitRate =
      llmTraces.length > 0
        ? llmTraces.filter((t) => (t.cacheReadTokens ?? 0) > 0).length / llmTraces.length
        : null

    await prisma.conversationScore.create({
      data: {
        conversationId: conv.id,
        quoteGenerated,
        applicationSubmitted,
        policyPurchased,
        score: normalizedScore,
        messageCount: conv.messageCount,
        totalCost,
        totalLatencyMs,
        anomalyCount,
        mode: conv.mode,
        skillPackSlugs: [], // pack subsystem deleted (A5.2); column kept for history
        totalPromptTokens,
        totalCachedTokens,
        avgCacheHitRate,
      },
    })

    scored++
  }

  return scored
}
