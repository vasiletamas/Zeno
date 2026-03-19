/**
 * BD Handlers — Medical Questionnaire Eligibility
 *
 * check_bd_eligibility
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

const BD_GROUP_CODES = ['bd_medical']

// ─────────────────────────────────────────────
// check_bd_eligibility
// ─────────────────────────────────────────────

export const checkBdEligibility: ToolHandler = async (_args, context) => {
  try {
    // Load all BD medical questions
    const groups = await prisma.questionGroup.findMany({
      where: { code: { in: BD_GROUP_CODES } },
    })
    if (groups.length === 0) {
      return { success: false, error: 'BD medical question group not found.' }
    }

    const groupIds = groups.map(g => g.id)

    const questions = await prisma.question.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: { orderIndex: 'asc' },
    })

    // Load answers for this conversation
    const questionIds = questions.map(q => q.id)
    const answers = await prisma.answer.findMany({
      where: {
        conversationId: context.conversationId,
        questionId: { in: questionIds },
      },
    })

    // Verify all 6 BD questions are answered
    if (answers.length < questions.length) {
      return {
        success: false,
        error: `Not all BD medical questions have been answered (${answers.length}/${questions.length}).`,
      }
    }

    // Check if any answer is "true" (yes to a medical condition)
    const hasPositiveAnswer = answers.some(a => a.value === 'true')

    // Load application for this conversation
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (hasPositiveAnswer) {
      // Reject BD addon
      if (application) {
        await prisma.application.update({
          where: { id: application.id },
          data: { includesAddon: false },
        })
      }

      return {
        success: true,
        data: {
          eligible: false,
          reason: 'medical_condition_declared',
        },
        message:
          'Based on the medical questionnaire responses, the Treatment Abroad coverage cannot be included at this time. This does not affect the base life insurance protection, which remains fully available.',
      }
    }

    // All answers are "false" — eligible
    return {
      success: true,
      data: {
        eligible: true,
      },
      message:
        'Medical questionnaire complete. The customer is eligible for Treatment Abroad coverage.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
