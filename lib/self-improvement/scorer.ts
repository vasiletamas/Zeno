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
      policy: {
        id: string
        payments: { status: string }[]
      } | null
    } | null
  } | null
  turnTraces: {
    cost: number | null
    latencyMs: number | null
    anomalies: unknown
  }[]
}

export async function scoreConversations(): Promise<number> {
  const conversations = (await prisma.conversation.findMany({
    where: {
      status: { in: ['COMPLETED', 'ABANDONED'] },
      score: null, // no ConversationScore yet
    },
    include: {
      application: {
        include: {
          quote: {
            include: {
              policy: {
                include: {
                  payments: { where: { status: 'COMPLETED' }, take: 1 },
                },
              },
            },
          },
        },
      },
      turnTraces: {
        select: { cost: true, latencyMs: true, anomalies: true },
      },
    },
  })) as ConversationWithRelations[]

  let scored = 0

  for (const conv of conversations) {
    const applicationSubmitted = conv.application !== null
    const quoteGenerated =
      applicationSubmitted && conv.application!.quote !== null
    const policyPurchased =
      quoteGenerated &&
      conv.application!.quote!.policy !== null &&
      (conv.application!.quote!.policy!.payments?.length ?? 0) > 0

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
      },
    })

    scored++
  }

  return scored
}
