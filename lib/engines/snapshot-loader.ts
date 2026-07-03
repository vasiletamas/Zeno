import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { shouldShowQuestion } from '@/lib/engines/questionnaire-engine'
import { computeVisibleSet } from '@/lib/engines/dependency-graph'
import { loadDependencyGraph } from '@/lib/engines/dependency-graph-loader'
import { getActiveAnswers } from '@/lib/engines/answer-store'
import { getOpenCircuitTools } from '@/lib/tools/circuit-state'
import { deriveConsents, type ConsentEventLike } from '@/lib/customer/consent'
import { getIdentityFacts } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'
import type { DomainSnapshot } from './domain-types'

// Widened for the A2 gateway: the interactive-transaction handle lacks
// $transaction/$executeRawUnsafe, so `typeof prisma` alone would reject it.
type Db = typeof prisma | Prisma.TransactionClient

export async function loadDomainSnapshot(conversationId: string, db: Db = prisma): Promise<DomainSnapshot> {
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })
  const customer = await db.customer.findUniqueOrThrow({ where: { id: conversation.customerId } })
  // consent truth is the append-only ConsentEvent ledger (B1), reduced by
  // the pure deriveConsents (latest event per kind wins).
  const consentEvents = await db.consentEvent.findMany({ where: { customerId: conversation.customerId }, orderBy: { createdAt: 'asc' } })
  const consents = deriveConsents(consentEvents as unknown as ConsentEventLike[])
  const identityFacts = await getIdentityFacts(conversation.customerId, db)
  const pendingChallenge = await db.verificationChallenge.findFirst({
    where: { customerId: conversation.customerId, consumedAt: null, expiresAt: { gt: new Date() } },
    select: { channel: true },
    orderBy: { createdAt: 'desc' },
  })
  const validatedDocs = await db.customerDocument.findMany({
    where: { customerId: conversation.customerId, status: 'validated' },
    select: { kind: true },
  })
  const activeProductId = conversation.productId ?? conversation.candidateProductId ?? null
  const prod = activeProductId ? await db.product.findUnique({ where: { id: activeProductId } }) : null
  // B4.1: the conversation POINTS at a customer-scoped application (T5.D4);
  // a CANCELLED pointer target is treated as no application (terminal).
  const application = conversation.activeApplicationId
    ? await db.application.findUnique({ where: { id: conversation.activeApplicationId } })
    : null
  // B4.6: the customer's live application anywhere — feeds cross-
  // conversation resume exposure even before this conversation points at it.
  const resumable = await db.application.findFirst({
    where: { customerId: conversation.customerId, status: { in: ['OPEN', 'PAUSED', 'REFERRED'] } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, status: true },
  })
  let appState: DomainSnapshot['application'] = null
  if (application && application.status !== 'CANCELLED') {
    // C1.7: ONE canonical visible set — the FULL application phase
    // (bd_medical included) filtered by computeVisibleSet over the typed
    // graph. The addon toggle hides/reveals BD questions via VISIBILITY
    // edges (answers retained), replacing the B4 group-exclusion special
    // case; progress, missingCodes and branching_metadata share this source.
    const groupCodes = (await resolveGroupCodes(application.productId, 'application', db)) ?? []
    const questions = groupCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: groupCodes } } }, select: { id: true, code: true } }) : []
    const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId } }) : null
    const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
    const activeAnswers = await getActiveAnswers(db, application.id)
    const graph = await loadDependencyGraph(db, application.productId)
    const visible = computeVisibleSet(
      graph,
      questions.map((q) => q.code).filter((c): c is string => c !== null),
      { answers: activeAnswers, selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon } },
    )
    const visibleCodes = questions.map((q) => q.code).filter((c): c is string => c !== null && visible.has(c))
    const answeredCodes = visibleCodes.filter((c) => activeAnswers[c] !== undefined)
    appState = {
      id: application.id, status: application.status,
      tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon,
      answeredCount: answeredCodes.length, requiredCount: visibleCodes.length,
      missingCodes: visibleCodes.filter((c) => activeAnswers[c] === undefined),
    }
  }
  // DNT facts. Legacy conversation-stamp semantics survive until B2.6; the
  // customer-scoped aggregate facts (latest Dnt + ACTIVE session) feed the
  // B2 dntExposure predicates. Counting is VISIBILITY-AWARE (B1.6 fix):
  // conditional questions hidden by answers must not block sign at n-1/n.
  const countVisible = (
    questions: { id: string; parentQuestionId: string | null; showWhenValue: string | null }[],
    answers: Map<string, string>,
  ) => {
    let total = 0
    let answered = 0
    for (const q of questions) {
      if (!shouldShowQuestion({ parentQuestionId: q.parentQuestionId, showWhenValue: q.showWhenValue }, answers)) continue
      total++
      if (answers.has(q.id)) answered++
    }
    return { total, answered }
  }
  // aggregate facts (B2.6 — the Dnt aggregate is the ONLY validity source)
  const latestDnt = await db.dnt.findFirst({ where: { customerId: conversation.customerId }, orderBy: { signedAt: 'desc' } })
  const dntValid = latestDnt !== null && latestDnt.status === 'ACTIVE' && latestDnt.validUntil.getTime() > Date.now() && (!prod || latestDnt.productTypesCovered.includes(prod.insuranceType))
  const activeDntSession = await db.dntSession.findFirst({ where: { customerId: conversation.customerId, status: 'ACTIVE' } })
  let sessionCounts = { total: 0, answered: 0 }
  if (activeDntSession) {
    const sessionCodes = (await resolveGroupCodes(activeDntSession.productId, 'dnt', db)) ?? []
    const sessionQuestions = sessionCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: sessionCodes } } }, select: { id: true, parentQuestionId: true, showWhenValue: true } }) : []
    const sessionAnswerRows = sessionQuestions.length > 0 ? await db.dntAnswer.findMany({ where: { sessionId: activeDntSession.id }, select: { questionId: true, value: true } }) : []
    sessionCounts = countVisible(sessionQuestions, new Map(sessionAnswerRows.map((a) => [a.questionId, a.value])))
  }
  // quotes: issued (today: DRAFT, non-expired) and accepted — only for a
  // live (non-CANCELLED) application slice
  const issued = appState && application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'DRAFT' }, orderBy: { createdAt: 'desc' } }) : null
  const accepted = appState && application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'ACCEPTED' } }) : null
  const policy = accepted ? await db.policy.findUnique({ where: { quoteId: accepted.id } }) : null
  return {
    conversationId, customerId: conversation.customerId,
    product: prod ? { id: prod.id, code: prod.code, insuranceType: prod.insuranceType } : null,
    candidateProductId: conversation.candidateProductId,
    identity: {
      // B3.2: tier DERIVED from the provenance store (+ verified channels),
      // never stored; the snapshot carries presence/provenance only — raw
      // values (decrypted cnp) stay inside getIdentityFacts.
      tier: deriveIdentityTier(identityFacts),
      fields: Object.fromEntries(Object.entries(identityFacts.fields).map(([k, v]) => [k, { provenance: v.provenance }])),
      verifiedChannels: identityFacts.verifiedChannels,
      pendingChallenge: pendingChallenge ? { channel: pendingChallenge.channel } : null,
    },
    consents,
    dnt: {
      signed: latestDnt !== null && latestDnt.status !== 'WITHDRAWN', valid: dntValid, validUntil: latestDnt?.validUntil.toISOString() ?? null, coversProductTypes: dntValid ? latestDnt!.productTypesCovered : [], answeredCount: sessionCounts.answered, totalCount: sessionCounts.total, sessionActive: activeDntSession !== null,
      latest: latestDnt ? { status: latestDnt.status, signedAt: latestDnt.signedAt.toISOString(), validUntil: latestDnt.validUntil.toISOString(), productTypesCovered: latestDnt.productTypesCovered } : null,
      activeSessionId: activeDntSession?.id ?? null,
      sessionType: activeDntSession?.type ?? null,
      sessionAnswered: sessionCounts.answered,
      sessionTotal: sessionCounts.total,
    },
    application: appState,
    resumableApplication: resumable ? { id: resumable.id, status: resumable.status as 'OPEN' | 'PAUSED' | 'REFERRED' } : null,
    quote: issued ? { id: issued.id, status: issued.status, premiumAnnual: issued.premiumAnnual, validUntil: issued.validUntil.toISOString(), expired: issued.validUntil.getTime() <= Date.now() } : null,
    acceptedQuote: accepted ? { id: accepted.id, acceptedAt: accepted.updatedAt.toISOString() } : null,
    schedule: { exists: false, settled: false, nextDueAt: null, lastPaymentStatus: null }, // Block D (PaymentSchedule) re-points
    policy: policy ? { id: policy.id, status: policy.status } : null,
    eligibility: { verdict: 'unknown' }, suitability: { verdict: 'unknown' },
    documents: {
      requirementsByTool: (prod?.verificationRequirements as Record<string, string[]> | null) ?? {},
      validated: [...new Set(validatedDocs.map((d) => d.kind as string))],
    },
    openItems: [], // M2 (Block B) wires openItems
    circuit: { openTools: getOpenCircuitTools() }, // M10 degraded-mode input (A2.7)
    degraded: [], // backend circuits land with their blocks (payment provider in D3)
    answers: {},
  }
}
