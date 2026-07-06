import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { computeVisibleSet } from '@/lib/engines/dependency-graph'
import { loadDependencyGraph } from '@/lib/engines/dependency-graph-loader'
import { getActiveAnswers } from '@/lib/engines/answer-store'
import { parseEligibilityRuleSet, type EligibilityRuleSet } from '@/lib/engines/eligibility'
import { parseSuitabilityRuleSet, type SuitabilityRuleSet } from '@/lib/engines/suitability'
import { isExpired, type QuoteStatusV3 } from '@/lib/engines/quote-lifecycle'
import { disclosuresRequired, type DisclosureRef } from '@/lib/engines/disclosures'
import { getProductDisclosureDocuments } from '@/lib/documents/registry'
import { getOpenCircuitTools } from '@/lib/tools/circuit-state'
import { deriveConsents, type ConsentEventLike } from '@/lib/customer/consent'
import { getIdentityFacts, getAge } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'
import { maskCnp, decryptEnvelopeTolerant } from '@/lib/security/encryption'
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
    select: { channel: true, target: true, attemptsRemaining: true },
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
  let appAnswers: Record<string, string> = {}
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
    appAnswers = activeAnswers
    const graph = await loadDependencyGraph(db, application.productId)
    const visible = computeVisibleSet(
      graph,
      questions.map((q) => q.code).filter((c): c is string => c !== null),
      { answers: activeAnswers, selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon } },
    )
    const visibleCodes = questions.map((q) => q.code).filter((c): c is string => c !== null && visible.has(c))
    const answeredCodes = visibleCodes.filter((c) => activeAnswers[c] !== undefined)
    // D1 (T7.D1): a Quote row in ANY state freezes its application — the
    // recovery path is always cancel_quote + a new application.
    const quoteCount = await db.quote.count({ where: { applicationId: application.id } })
    appState = {
      id: application.id, status: application.status,
      tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon,
      answeredCount: answeredCodes.length, requiredCount: visibleCodes.length,
      missingCodes: visibleCodes.filter((c) => activeAnswers[c] === undefined),
      frozen: application.frozenAt !== null || quoteCount > 0,
      createdAt: application.createdAt.toISOString(), // E4.2: open-item age
    }
  }
  // DNT facts. Legacy conversation-stamp semantics survive until B2.6; the
  // customer-scoped aggregate facts (latest Dnt + ACTIVE session) feed the
  // B2 dntExposure predicates. Counting is VISIBILITY-AWARE (B1.6 fix):
  // conditional questions hidden by answers must not block sign at n-1/n —
  // visibility from the typed graph (C1.8), sessions carry no selection.
  // aggregate facts (B2.6 — the Dnt aggregate is the ONLY validity source)
  const latestDnt = await db.dnt.findFirst({ where: { customerId: conversation.customerId }, orderBy: { signedAt: 'desc' } })
  const dntValid = latestDnt !== null && latestDnt.status === 'ACTIVE' && latestDnt.validUntil.getTime() > Date.now() && (!prod || latestDnt.productTypesCovered.includes(prod.insuranceType))
  const activeDntSession = await db.dntSession.findFirst({ where: { customerId: conversation.customerId, status: 'ACTIVE' } })
  let sessionCounts = { total: 0, answered: 0 }
  let sessionPendingCode: string | null = null
  if (activeDntSession) {
    const sessionCodes = (await resolveGroupCodes(activeDntSession.productId, 'dnt', db)) ?? []
    // Walk order mirrors the handler's sessionNextQuestion (group orderIndex,
    // then question orderIndex) so pendingCode = the code write_dnt_answer expects.
    const sessionQuestions = sessionCodes.length > 0 ? await db.question.findMany({ where: { group: { code: { in: sessionCodes } } }, select: { id: true, code: true }, orderBy: [{ group: { orderIndex: 'asc' } }, { orderIndex: 'asc' }] }) : []
    const sessionAnswerRows = sessionQuestions.length > 0 ? await db.dntAnswer.findMany({ where: { sessionId: activeDntSession.id }, select: { questionId: true, value: true } }) : []
    const answersById = new Map(sessionAnswerRows.map((a) => [a.questionId, a.value]))
    const sessionAnswers: Record<string, string> = {}
    for (const q of sessionQuestions) {
      const v = q.code ? answersById.get(q.id) : undefined
      if (q.code && v !== undefined) sessionAnswers[q.code] = v
    }
    const dntGraph = await loadDependencyGraph(db)
    const dntVisible = computeVisibleSet(
      dntGraph,
      sessionQuestions.map((q) => q.code).filter((c): c is string => c !== null),
      { answers: sessionAnswers, selection: { tier: null, level: null, addon: null } },
    )
    let total = 0
    let answered = 0
    let pendingAssigned = false
    for (const q of sessionQuestions) {
      if (q.code && !dntVisible.has(q.code)) continue
      total++
      if (answersById.has(q.id)) answered++
      else if (!pendingAssigned) { sessionPendingCode = q.code; pendingAssigned = true }
    }
    sessionCounts = { total, answered }
  }
  // quotes: issued (today: DRAFT, non-expired) and accepted — only for a
  // live (non-CANCELLED) application slice
  const issued = appState && application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'ISSUED' }, orderBy: { createdAt: 'desc' } }) : null
  const accepted = appState && application ? await db.quote.findFirst({ where: { applicationId: application.id, status: 'ACCEPTED' } }) : null
  // D4.4 (T9.D6): the policy is CUSTOMER-scoped — it survives the sale
  // conversation, so a returning customer's fresh conversation derives the
  // POLICY phase and its post-sale surface.
  const policy = await db.policy.findFirst({
    where: { customerId: conversation.customerId, status: { in: ['PENDING_SUBMISSION', 'SUBMITTED', 'ACTIVE', 'LAPSED'] } },
    orderBy: { createdAt: 'desc' },
  })
  // D2.5 (T7.D2): which current disclosure docs still lack an exact-identity
  // ack — feeds the accept_quote legality predicate via the quote slice
  let quoteDisclosuresRequired: DisclosureRef[] = []
  if (issued && prod) {
    const disclosureDocs = await getProductDisclosureDocuments(prod.id, conversation.language ?? 'ro', db)
    const ackRows = await db.disclosureAck.findMany({ where: { quoteId: issued.id }, select: { kind: true, version: true, language: true } })
    quoteDisclosuresRequired = disclosuresRequired(
      disclosureDocs.map((d) => ({ kind: d.kind as DisclosureRef['kind'], version: d.version, language: d.language })),
      ackRows.map((a) => ({ kind: a.kind as DisclosureRef['kind'], version: a.version, language: a.language })),
    )
  }
  // D2.5 (contradiction #3): the schedule slice goes live — existence flips
  // the phase to PAYMENT, settled/nextDueAt feed D2.6/D3
  const scheduleRow = accepted
    ? await db.paymentSchedule.findFirst({
        where: { quoteId: accepted.id, status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE', 'COMPLETED'] } },
        include: { installments: { orderBy: { sequence: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      })
    : null
  // PENDING or FAILED — a failed installment is still DUE (retry, D3.1)
  const nextPending = scheduleRow?.installments.find((i) => i.status === 'PENDING' || i.status === 'FAILED') ?? null
  const scheduleSlice = {
    exists: scheduleRow !== null,
    settled: scheduleRow !== null && scheduleRow.installments.every((i) => i.status === 'PAID' || i.status === 'WAIVED'),
    nextDueAt: nextPending?.dueAt.toISOString() ?? null,
    lastPaymentStatus: null as string | null, // D2.6 settlement wires this
    capturedCount: scheduleRow?.installments.filter((i) => i.status === 'PAID').length ?? 0,
    id: scheduleRow?.id ?? null, // E4.2: open-item refId
  }
  // C2.6: identity-class eligibility facts — age via the B0 derivation
  // (DOB or declaredAge, NEVER a 30-fallback), residency from a
  // declared/verified CNP (a Romanian personal code implies RO residence).
  const eligibilityFacts: Record<string, string | number | boolean> = {}
  const age = await getAge(conversation.customerId, new Date(), db)
  if (age !== null) eligibilityFacts.age = age
  const declaredResidency = await db.customerProfileField.findUnique({ where: { customerId_field: { customerId: conversation.customerId, field: 'residency' } } })
  if (declaredResidency) eligibilityFacts.residency = declaredResidency.value
  else if (identityFacts.fields.cnp && identityFacts.fields.cnp.provenance !== 'conflict') eligibilityFacts.residency = 'Romania'
  // the product's typed ruleset, parsed once per snapshot (informal legacy
  // Json → null: no engine-evaluable rules)
  let eligibilityRules: EligibilityRuleSet | null = null
  let suitabilityRules: SuitabilityRuleSet | null = null
  if (prod) {
    try { eligibilityRules = parseEligibilityRuleSet(prod.eligibility) } catch { eligibilityRules = null }
    try { suitabilityRules = prod.suitabilityRules ? parseSuitabilityRuleSet(prod.suitabilityRules) : null } catch { suitabilityRules = null }
  }
  // C3.3: the SIGNED Dnt's answers are the suitability facts (questionCode →
  // value, via the aggregate's source session)
  let dntFacts: Record<string, string> = {}
  if (latestDnt && latestDnt.status === 'ACTIVE') {
    const signedAnswers = await db.dntAnswer.findMany({
      where: { sessionId: latestDnt.sourceSessionId },
      include: { question: { select: { code: true } } },
    })
    // Task 5.4 (D11): the CNP fact is MASKED at the source — no suitability
    // rule reads it, and the facts flow into legality snapshots/TurnDebug;
    // age/residency derive from the (encrypted) profile mirror instead.
    dntFacts = Object.fromEntries(signedAnswers.filter((a) => a.question.code).map((a) => [
      a.question.code as string,
      a.question.code === 'DNT_CNP' ? maskCnp(decryptEnvelopeTolerant(a.value)) : a.value,
    ]))
  }
  // C3.4: acks for the active application (documented-warning state)
  const suitabilityAcks = application && application.status !== 'CANCELLED'
    ? await db.suitabilityWarningAck.findMany({ where: { customerId: conversation.customerId, applicationId: application.id }, select: { ruleSetVersion: true } })
    : []
  // P0-5 (2026-07-06): a tool whose LATEST ledger row is requires_confirmation
  // has a confirm card awaiting the customer's tap — the briefing must
  // countermand re-calling it (the token itself never enters the prompt).
  const recentCommits = await db.commitLedger.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { tool: true, outcome: true },
    take: 50,
  })
  const latestOutcomeSeen = new Set<string>()
  const pendingConfirmationTools: string[] = []
  for (const row of recentCommits) {
    if (latestOutcomeSeen.has(row.tool)) continue
    latestOutcomeSeen.add(row.tool)
    if (row.outcome === 'requires_confirmation') pendingConfirmationTools.push(row.tool)
  }
  // Task 1.3 (D8) loop-breaker: the SAME (tool, argsHash) failing >= 3 times
  // in this conversation blocks the tool with repeated_failure — the model
  // must explain-and-escalate, never hammer. requires_confirmation is NOT a
  // failure (the customer's card tap resolves it, confirmation_stalled
  // diagnoses that class).
  const repeatedFailureRows = await db.commitLedger.groupBy({
    by: ['tool', 'argsHash'],
    where: { conversationId, outcome: { in: ['rejected', 'unavailable'] } },
    _count: { _all: true },
    having: { argsHash: { _count: { gte: 3 } } },
  })
  const repeatedFailureTools = [...new Set(repeatedFailureRows.map((r) => r.tool))]
  return {
    conversationId, customerId: conversation.customerId,
    product: prod ? { id: prod.id, code: prod.code, insuranceType: prod.insuranceType, eligibilityRules, suitabilityRules } : null,
    candidateProductId: conversation.candidateProductId,
    identity: {
      // B3.2: tier DERIVED from the provenance store (+ verified channels),
      // never stored; the snapshot carries presence/provenance only — raw
      // values (decrypted cnp) stay inside getIdentityFacts.
      tier: deriveIdentityTier(identityFacts),
      fields: Object.fromEntries(Object.entries(identityFacts.fields).map(([k, v]) => [k, { provenance: v.provenance }])),
      verifiedChannels: identityFacts.verifiedChannels,
      pendingChallenge: pendingChallenge ? { channel: pendingChallenge.channel, target: pendingChallenge.target, attemptsRemaining: pendingChallenge.attemptsRemaining } : null,
    },
    consents,
    dnt: {
      signed: latestDnt !== null && latestDnt.status !== 'WITHDRAWN', valid: dntValid, validUntil: latestDnt?.validUntil.toISOString() ?? null, coversProductTypes: dntValid ? latestDnt!.productTypesCovered : [], answeredCount: sessionCounts.answered, totalCount: sessionCounts.total, sessionActive: activeDntSession !== null,
      latest: latestDnt ? { id: latestDnt.id, status: latestDnt.status, signedAt: latestDnt.signedAt.toISOString(), validUntil: latestDnt.validUntil.toISOString(), productTypesCovered: latestDnt.productTypesCovered } : null,
      activeSessionId: activeDntSession?.id ?? null,
      sessionType: activeDntSession?.type ?? null,
      sessionAnswered: sessionCounts.answered,
      sessionTotal: sessionCounts.total,
      pendingCode: sessionPendingCode,
      facts: dntFacts,
    },
    application: appState,
    resumableApplication: resumable ? { id: resumable.id, status: resumable.status as 'OPEN' | 'PAUSED' | 'REFERRED' } : null,
    pendingConfirmationTools,
    // T7.D5: expiry via the ONE pure predicate — never an inline comparison
    quote: issued ? { id: issued.id, status: issued.status, premiumAnnual: issued.premiumAnnual, validUntil: issued.validUntil.toISOString(), expired: isExpired({ status: issued.status as QuoteStatusV3, validUntil: issued.validUntil }, new Date()), disclosuresRequired: quoteDisclosuresRequired, createdAt: issued.createdAt.toISOString() } : null,
    acceptedQuote: accepted ? { id: accepted.id, acceptedAt: accepted.updatedAt.toISOString() } : null,
    schedule: scheduleSlice,
    policy: policy ? { id: policy.id, status: policy.status, freeLookEndsAt: policy.freeLookEndsAt?.toISOString() ?? null, createdAt: policy.createdAt.toISOString() } : null,
    eligibilityFacts, suitabilityAcks,
    documents: {
      requirementsByTool: (prod?.verificationRequirements as Record<string, string[]> | null) ?? {},
      validated: [...new Set(validatedDocs.map((d) => d.kind as string))],
    },
    openItems: [], // M2 (Block B) wires openItems
    circuit: { openTools: getOpenCircuitTools() }, // M10 degraded-mode input (A2.7)
    degraded: [], // backend circuits land with their blocks (payment provider in D3)
    repeatedFailureTools,
    answers: appAnswers, // C2.6: ACTIVE application answers (code → value) feed the eligibility answer-facts
  }
}
