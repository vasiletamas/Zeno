/**
 * preview_product_requirements — read-only analysis of which questions would
 * carry over (already answered) vs be newly missing for a candidate product.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { loadActiveApplication } from './application-handlers'

export const previewProductRequirements: ToolHandler = async (args, context) => {
  const productId = args.productId as string | undefined

  if (!productId || typeof productId !== 'string') {
    return { success: false, error: 'productId is required.' }
  }

  try {
    const ref = await resolveProductRef({ productId })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Product not found: "${productId}". ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    const productGroupCodes = await resolveGroupCodes(ref.id, 'application')
    const dntGroupCodes = await resolveGroupCodes(null, 'dnt')
    const allGroupCodes = [...new Set([...dntGroupCodes, ...productGroupCodes])]

    if (allGroupCodes.length === 0) {
      return { success: true, data: { wouldCarryOver: [], stillMissing: [] }, message: 'No question groups found for this product.' }
    }

    const groups = await prisma.questionGroup.findMany({ where: { code: { in: allGroupCodes } } })
    if (groups.length === 0) {
      return { success: true, data: { wouldCarryOver: [], stillMissing: [] }, message: 'No question groups resolved.' }
    }

    const groupIds = groups.map((g) => g.id)
    const questions = await prisma.question.findMany({
      where: { groupId: { in: groupIds } },
      select: { id: true, code: true },
    })
    if (questions.length === 0) {
      return { success: true, data: { wouldCarryOver: [], stillMissing: [] }, message: 'No questions found for the specified groups.' }
    }

    // B4: answers are application-scoped — carry-over compares against the
    // conversation's active application (none → everything is missing).
    const questionIds = questions.map((q) => q.id)
    const activeApp = await loadActiveApplication(context)
    const answers = activeApp
      ? await prisma.answer.findMany({
          where: { applicationId: activeApp.id, questionId: { in: questionIds }, status: 'ACTIVE' },
          select: { questionId: true },
        })
      : []
    const answeredQuestionIds = new Set(answers.map((a) => a.questionId))

    const wouldCarryOver: string[] = []
    const stillMissing: string[] = []
    for (const q of questions) {
      if (!q.code) continue
      if (answeredQuestionIds.has(q.id)) wouldCarryOver.push(q.code)
      else stillMissing.push(q.code)
    }

    const uniqueCarryOver = [...new Set(wouldCarryOver)].sort()
    const uniqueMissing = [...new Set(stillMissing)].sort()

    return {
      success: true,
      data: { wouldCarryOver: uniqueCarryOver, stillMissing: uniqueMissing },
      message: `Preview for product ${ref.code}: ${uniqueCarryOver.length} answers carry over, ${uniqueMissing.length} new questions required.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: `Failed to preview product requirements: ${message}` }
  }
}
