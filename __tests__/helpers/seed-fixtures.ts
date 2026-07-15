/**
 * Concrete cross-package seeding helpers (E2 erratum 5) — real-DB chains
 * built on the same handlers the product uses, never mocked choreography.
 */
import { prisma } from '@/lib/db'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { createReferralWorkItem } from '@/lib/work-items/referral'
import { seedDntFullyAnswered } from './dnt-fixtures'

/**
 * Customer with a signed Dnt (consents granted at signing) holding a
 * REFERRED application with tier/level selected — the underwriter-queue
 * entry state, plus its OPEN REFERRAL WorkItem.
 */
export async function seedReferredApplication() {
  const { customerId, conversationId, ctx } = await seedDntFullyAnswered()
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`fixture sign failed: ${signed.error}`)
  // #1 identity row (B3.2): generate_quote needs a declared cnp-or-dob — a
  // real pre-referral applicant declared these on the way to the quote.
  await setDeclaredField(customerId, 'dateOfBirth', '1990-01-01', 'fixture')

  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })
  const productId = conversation.productId
  if (!productId) throw new Error('fixture conversation has no product')
  const tier = await prisma.pricingTier.findFirstOrThrow({ where: { productId, isActive: true }, orderBy: { orderIndex: 'asc' } })
  const level = await prisma.pricingLevel.findFirstOrThrow({ where: { tierId: tier.id, isActive: true }, orderBy: { orderIndex: 'asc' } })

  // B4: the application is customer-scoped and the conversation points at
  // it; answers key on the application.
  const app = await prisma.application.create({
    data: {
      originConversationId: conversationId,
      customerId,
      productId,
      tierId: tier.id,
      levelId: level.id,
      includesAddon: false,
      status: 'REFERRED',
    },
  })
  await prisma.conversation.update({ where: { id: conversationId }, data: { activeApplicationId: app.id } })

  // A real pre-referral application went through the full questionnaire —
  // answer every application-phase question (resolved exactly like the
  // snapshot loader) so an approved app derives straight back to
  // QUOTE_GENERATION (missingCodes must be empty).
  const groupCodes = (await resolveGroupCodes(productId, 'application')) ?? []
  const appQuestions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: groupCodes } } } })
    : []
  // D1.8: PAYMENT_FREQUENCY left the questionnaire — every remaining
  // application question is boolean (HEALTH_DECLARATION_CONFIRM and future).
  await prisma.answer.createMany({
    data: appQuestions.map((q) => ({ questionId: q.id, applicationId: app.id, value: 'true' })),
  })
  await prisma.application.update({
    where: { id: app.id },
    data: { currentQuestionIndex: appQuestions.length, totalQuestions: appQuestions.length },
  })
  const item = await createReferralWorkItem({
    applicationId: app.id,
    customerId,
    conversationId,
    reason: 'pending_external_check: cumulative sum at risk',
  })
  return { app, item, customerId, conversationId, ctx }
}
