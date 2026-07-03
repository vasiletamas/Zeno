/**
 * BD Handlers — Medical Questionnaire Eligibility
 *
 * check_bd_eligibility
 */

import type { ToolHandler } from '@/lib/tools/types'
import { loadActiveApplication } from './application-handlers'

const BD_GROUP_CODES = ['bd_medical']

// ─────────────────────────────────────────────
// check_bd_eligibility
// ─────────────────────────────────────────────

export const checkBdEligibility: ToolHandler = async (_args, context) => {
  try {
    // Load all BD medical questions
    const groups = await context.db.questionGroup.findMany({
      where: { code: { in: BD_GROUP_CODES } },
    })
    if (groups.length === 0) {
      return { success: false, error: 'BD medical question group not found.' }
    }

    const groupIds = groups.map(g => g.id)

    const questions = await context.db.question.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: { orderIndex: 'asc' },
    })

    // B4: answers key on the conversation's active application
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'No active application for the BD questionnaire.' }
    }
    const questionIds = questions.map(q => q.id)
    const answers = await context.db.answer.findMany({
      where: {
        applicationId: application.id,
        questionId: { in: questionIds },
        status: 'ACTIVE',
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

    if (hasPositiveAnswer) {
      // Reject BD addon
      await context.db.application.update({
        where: { id: application.id },
        data: { includesAddon: false },
      })

      return {
        success: true,
        data: {
          eligible: false,
          reason: 'medical_condition_declared',
        },
        message:
          'Based on the medical questionnaire responses, the Treatment Abroad coverage cannot be included at this time. This does not affect the base life insurance protection, which remains fully available.',
        uiAction: {
          type: 'show_bd_rejected',
          payload: {
            eligible: false,
            message: {
              en: 'Based on the medical questionnaire responses, the Treatment Abroad coverage cannot be included. Your base life insurance protection remains fully available.',
              ro: 'Din cauza raspunsurilor, componenta de tratament medical in strainatate nu poate fi activata. Protectia de viata ramane disponibila si iti ofera acoperire pentru familie. Vrei sa continuam cu ea?',
            },
          } as unknown as Record<string, unknown>,
        },
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
      uiAction: {
        type: 'show_bd_result',
        payload: {
          eligible: true,
          message: {
            en: 'You are eligible for international medical treatment coverage.',
            ro: 'Esti eligibil pentru acoperirea de tratament medical international.',
          },
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
