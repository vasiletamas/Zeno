import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { getOpenCircuitTools } from '@/lib/tools/circuit-state'
import type { DomainSnapshot } from './domain-types'

// Widened for the A2 gateway: the interactive-transaction handle lacks
// $transaction/$executeRawUnsafe, so `typeof prisma` alone would reject it.
type Db = typeof prisma | Prisma.TransactionClient

export async function loadDomainSnapshot(conversationId: string, db: Db = prisma): Promise<DomainSnapshot> {
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })
  const customer = await db.customer.findUniqueOrThrow({ where: { id: conversation.customerId } })
  const activeProductId = conversation.productId ?? conversation.candidateProductId ?? null
  const prod = activeProductId ? await db.product.findUnique({ where: { id: activeProductId } }) : null
  const application = await db.application.findUnique({ where: { conversationId } })
  // questionnaire completeness (reuses the question-group engine exactly like the old deriveState)
  let appState: DomainSnapshot['application'] = null
  if (application) {
    const groupCodes = (await resolveGroupCodes(application.productId, 'application', db)) ?? []
    const questions = groupCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: groupCodes } } }, select: { id: true, code: true } }) : []
    const answered = await db.answer.findMany({ where: { conversationId, questionId: { in: questions.map((q) => q.id) } }, select: { questionId: true } })
    const answeredIds = new Set(answered.map((a) => a.questionId))
    const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId } }) : null
    const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
    appState = {
      id: application.id, status: application.status as 'OPEN' | 'PAUSED' | 'COMPLETED',
      tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon,
      answeredCount: answeredIds.size, requiredCount: questions.length,
      missingCodes: questions.filter((q) => !answeredIds.has(q.id)).map((q) => q.code ?? q.id),
    }
  }
  // DNT facts (interim source: Conversation.dntSignedAt/dntValidUntil; Block B re-points to the Dnt aggregate behind this seam)
  const dntGroupCodes = prod ? ((await resolveGroupCodes(prod.id, 'dnt', db)) ?? []) : []
  const dntQuestions = dntGroupCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: dntGroupCodes } } }, select: { id: true } }) : []
  const dntAnswered = dntQuestions.length > 0 ? await db.answer.findMany({ where: { conversationId, questionId: { in: dntQuestions.map((q) => q.id) } }, select: { questionId: true } }) : []
  const dntValid = conversation.dntSignedAt != null && conversation.dntValidUntil != null && conversation.dntValidUntil.getTime() > Date.now()
  // quotes: issued (today: DRAFT, non-expired) and accepted
  const issued = application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'DRAFT' }, orderBy: { createdAt: 'desc' } }) : null
  const accepted = application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'ACCEPTED' } }) : null
  const policy = accepted ? await db.policy.findUnique({ where: { quoteId: accepted.id } }) : null
  return {
    conversationId, customerId: conversation.customerId,
    product: prod ? { id: prod.id, code: prod.code, insuranceType: prod.insuranceType } : null,
    candidateProductId: conversation.candidateProductId,
    identity: { tier: customer.isAnonymous ? 'anonymous' : 'declared', fields: {} }, // B0 provenance store replaces fields
    consents: { gdprProcessing: customer.gdprConsentAt != null, aiDisclosure: customer.aiDisclosureAcknowledgedAt != null, marketing: false }, // A2.8 flips source to ConsentEvent
    dnt: { signed: conversation.dntSignedAt != null, valid: dntValid, validUntil: conversation.dntValidUntil?.toISOString() ?? null, coversProductTypes: dntValid && prod ? [prod.insuranceType] : [], answeredCount: dntAnswered.length, totalCount: dntQuestions.length, sessionActive: conversation.dntSignedAt == null && dntAnswered.length > 0 && dntAnswered.length < dntQuestions.length },
    application: appState,
    quote: issued ? { id: issued.id, status: issued.status, premiumAnnual: issued.premiumAnnual, validUntil: issued.validUntil.toISOString(), expired: issued.validUntil.getTime() <= Date.now() } : null,
    acceptedQuote: accepted ? { id: accepted.id, acceptedAt: accepted.updatedAt.toISOString() } : null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null }, // Block D (PaymentSchedule) re-points
    policy: policy ? { id: policy.id, status: policy.status } : null,
    eligibility: { verdict: 'unknown' }, suitability: { verdict: 'unknown' },
    openItems: [], // M2 (Block B) wires openItems
    circuit: { openTools: getOpenCircuitTools() }, // M10 degraded-mode input (A2.7)
    answers: {},
  }
}
