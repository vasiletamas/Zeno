/**
 * set_answer Handler
 *
 * Generic "answer any question by code" tool. Resolves the question by code
 * within the active DNT + application group codes, validates, upserts the
 * Answer, applies tier/level/addon side-effects for the three selection
 * questions, bumps insight when the question has an insightKey, and returns
 * fresh deriveAndExpose output ({ state, actions }) plus a `save` confirmation.
 */

import type { ToolHandler } from '@/lib/tools/types'
import { validateAnswer } from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { bumpInsightOnAnswer } from './insight-bump'

export const setAnswer: ToolHandler = async (args, context) => {
  try {
    const questionCode = args.questionCode as string
    const value = args.value as string

    const productId = await resolveActiveProductId(context.conversationId, context.product?.id)

    const dntCodes = await resolveGroupCodes(productId, 'dnt')
    const appCodes = await resolveGroupCodes(productId, 'application')
    const allCodes = [...new Set([...dntCodes, ...appCodes])]

    const question = await context.db.question.findFirst({
      where: { code: questionCode, group: { code: { in: allCodes } } },
      include: { group: true },
    })
    if (!question) {
      return { success: false, error: `Question code "${questionCode}" not found` }
    }

    const validation = validateAnswer(
      { type: question.type, options: question.options, validationRules: question.validationRules },
      value,
    )
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid answer' }
    }

    await context.db.answer.upsert({
      where: { questionId_conversationId: { questionId: question.id, conversationId: context.conversationId } },
      create: { questionId: question.id, conversationId: context.conversationId, value: validation.normalizedValue },
      update: { value: validation.normalizedValue, answeredAt: new Date() },
    })

    // Special tier/level/addon handling — key on the QUESTION CODE, not group membership.
    if (
      questionCode === 'PACKAGE_CHOICE' ||
      questionCode === 'PREMIUM_LEVEL' ||
      questionCode === 'BD_ADDON_INTEREST'
    ) {
      const application = await context.db.application.findUnique({
        where: { conversationId: context.conversationId },
      })
      if (application) {
        const updateData: Record<string, unknown> = {}
        if (questionCode === 'PACKAGE_CHOICE') {
          const tier = await context.db.pricingTier.findFirst({
            where: { productId: application.productId, code: validation.normalizedValue },
          })
          if (tier) updateData.tierId = tier.id
        }
        if (questionCode === 'PREMIUM_LEVEL' && application.tierId) {
          const level = await context.db.pricingLevel.findFirst({
            where: { tierId: application.tierId, code: validation.normalizedValue },
          })
          if (level) updateData.levelId = level.id
        }
        if (questionCode === 'BD_ADDON_INTEREST') {
          updateData.includesAddon = validation.normalizedValue === 'true'
        }
        if (Object.keys(updateData).length > 0) {
          await context.db.application.update({ where: { id: application.id }, data: updateData })
        }
      }
    }

    // Insight bump (only when the question carries an insightKey).
    if (question.insightKey) {
      const priorInsight = await context.db.customerInsight.findUnique({
        where: { customerId_key: { customerId: context.customerId, key: question.insightKey } },
      })
      await bumpInsightOnAnswer({
        customerId: context.customerId,
        conversationId: context.conversationId,
        question: {
          id: question.id,
          code: question.code,
          insightKey: question.insightKey,
          group: { code: question.group.code },
        },
        answerValue: validation.normalizedValue,
        previousInsightValue: priorInsight?.value,
        previousInsightCategory: priorInsight?.category,
      })
    }

    const { state, actions } = deriveAndExpose(await loadDomainSnapshot(context.conversationId))

    return {
      success: true,
      data: { state, actions },
      message: `Answer saved for question "${questionCode}".`,
      confirmation: {
        category: 'save',
        label: context.language === 'en' ? 'Question answered' : 'Întrebare răspunsă',
        value: validation.normalizedValue,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
