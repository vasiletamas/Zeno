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
      application: {
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
            },
          },
        },
      },
      workflowSession: {
        include: {
          currentStep: {
            select: {
              id: true,
              code: true,
            },
          },
        },
      },
    },
  })

  const ctx: ToolContext = {
    customerId,
    conversationId,
    language,
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
  if (conversation?.application) {
    const a = conversation.application
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
    }
  }

  // Map workflow session if present
  if (conversation?.workflowSession) {
    const ws = conversation.workflowSession
    ctx.workflowSession = {
      id: ws.id,
      workflowId: ws.workflowId,
      currentStepId: ws.currentStepId,
      currentStepCode: ws.currentStep.code,
      data: ws.data,
    }
  }

  return ctx
}
