/**
 * Tool Context Builder
 *
 * Builds a ToolContext from database state for a given conversation.
 * Queries conversation with all relevant includes and maps Prisma
 * results to the typed ToolContext interface.
 */

import { prisma } from '@/lib/db'
import type { ToolContext } from '@/lib/tools/types'

/**
 * Build a ToolContext from the current database state.
 * Fetches conversation with product, application (+ quote), and workflow session.
 */
export async function buildToolContext(
  customerId: string,
  conversationId: string,
  language: 'en' | 'ro',
): Promise<ToolContext> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          insuranceType: true,
        },
      },
    },
  })
  // B4: the application hangs off the conversation via the pointer
  const applicationRow = conversation?.activeApplicationId
    ? await prisma.application.findUnique({
        where: { id: conversation.activeApplicationId },
        select: {
          id: true,
          status: true,
          currentQuestionIndex: true,
          quote: {
            select: {
              id: true,
              status: true,
              premiumAnnual: true,
              premiumMonthly: true,
              policy: {
                select: {
                  id: true,
                  status: true,
                  premiumMonthly: true,
                  premiumAnnual: true,
                  paymentFrequency: true,
                },
              },
            },
          },
        },
      })
    : null

  const ctx: ToolContext = {
    customerId,
    conversationId,
    language,
    db: prisma,
  }

  // Map product if present
  if (conversation?.product) {
    const p = conversation.product
    const nameJson = p.name as Record<string, string> | null
    ctx.product = {
      id: p.id,
      code: p.code,
      name: {
        en: nameJson?.en ?? p.code,
        ro: nameJson?.ro ?? p.code,
      },
      insuranceType: p.insuranceType,
    }
  }

  // Map application if present
  if (applicationRow) {
    const a = applicationRow
    ctx.application = {
      id: a.id,
      status: a.status,
      currentQuestionIndex: a.currentQuestionIndex,
    }

    // Map quote if present on the application
    if (a.quote) {
      const q = a.quote
      ctx.quote = {
        id: q.id,
        status: q.status,
        premiumAnnual: q.premiumAnnual,
        premiumMonthly: q.premiumMonthly,
      }

      // Map policy if present on the quote
      if (q.policy) {
        const pol = q.policy
        ctx.policy = {
          id: pol.id,
          status: pol.status,
          premiumMonthly: pol.premiumMonthly,
          premiumAnnual: pol.premiumAnnual,
          paymentFrequency: pol.paymentFrequency,
        }
      }
    }
  }

  return ctx
}
