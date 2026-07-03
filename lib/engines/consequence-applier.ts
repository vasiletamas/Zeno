/**
 * Transactional consequence applier (C1.5): executes a ConsequencePlan
 * inside the gateway's commit transaction — the triggering answer write,
 * invalidations with causality, the deterministic selection patch, the
 * derived status transition (T6.D2), and the erratum-10 flag recompute
 * (flags are DERIVED from active revisions, so a corrected answer can
 * never leave a zombie flag or a stale PAUSED behind).
 *
 * Also home to the impure graph/snapshot loaders the planner's callers
 * share: loadDependencyGraph reads QuestionDependency (the ONE dependency
 * store) and buildPlannerSnapshot assembles the planner's narrow input
 * from the domain rows.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { writeRevision, invalidateActive, getActiveAnswers } from './answer-store'
import { deriveFlags } from './questionnaire-engine'
import { resolveGroupCodes } from './question-groups'
import { parseEligibilityRuleSet, type EligibilityRuleSet } from './eligibility'
import { getIdentityFacts } from '@/lib/customer/profile-service'
import { loadDependencyGraph } from './dependency-graph-loader'
import type { ConsequencePlan, PlannerSnapshot, QuestionSensitivityStr } from './consequence-planner'
import type { AppStatus } from './application-rules'

// callers historically import the graph loader from here (C1.5); its home
// is dependency-graph-loader.ts so the questionnaire engine can share it
export { loadDependencyGraph }

type Db = typeof prisma | Prisma.TransactionClient

export interface ApplyContext {
  conversationId: string
  applicationId: string
  commitId: string
}

/**
 * Assemble the planner's input slice from the conversation's active
 * application. Question codes cover the FULL application phase including
 * bd_medical — visibility is the graph's decision, not the loader's.
 */
export async function buildPlannerSnapshot(db: Db, conversationId: string): Promise<PlannerSnapshot> {
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { activeApplicationId: true, customerId: true },
  })
  const application = conversation.activeApplicationId
    ? await db.application.findUnique({ where: { id: conversation.activeApplicationId } })
    : null

  const empty: PlannerSnapshot = {
    application: { exists: false, status: 'OPEN', quoteIssued: false },
    selection: { tier: null, level: null, addon: null },
    answers: { active: {}, sensitivity: {} },
    questionCodes: [],
    product: { eligibilityRules: null },
  }
  if (!application || application.status === 'CANCELLED') return empty

  // sequential on purpose: db may be the gateway's tx client, which cannot
  // run concurrent queries on its single connection
  const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId } }) : null
  const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
  const liveQuote = await db.quote.findFirst({
    where: { applicationId: application.id, OR: [{ status: 'ACCEPTED' }, { status: 'DRAFT', validUntil: { gt: new Date() } }] },
  })

  const groupCodes = (await resolveGroupCodes(application.productId, 'application', db)) ?? []
  const questions = groupCodes.length > 0
    ? await db.question.findMany({ where: { group: { code: { in: groupCodes } } }, select: { code: true, sensitivity: true } })
    : []
  const sensitivity: Record<string, QuestionSensitivityStr> = {}
  const questionCodes: string[] = []
  for (const q of questions) {
    if (!q.code) continue
    questionCodes.push(q.code)
    sensitivity[q.code] = q.sensitivity as QuestionSensitivityStr
  }

  const product = await db.product.findUnique({ where: { id: application.productId }, select: { eligibility: true } })
  let eligibilityRules: EligibilityRuleSet | null = null
  try {
    eligibilityRules = parseEligibilityRuleSet(product?.eligibility)
  } catch {
    eligibilityRules = null // informal legacy Json — no engine-evaluable rules
  }

  const identityFacts: Record<string, string | number | boolean> = {}
  const identity = await getIdentityFacts(conversation.customerId, db)
  const dob = identity.fields.dateOfBirth?.value
  if (dob) {
    const d = new Date(dob)
    const now = new Date()
    let age = now.getFullYear() - d.getFullYear()
    const m = now.getMonth() - d.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
    if (Number.isFinite(age)) identityFacts.age = age
  }

  return {
    application: { exists: true, status: application.status as AppStatus, quoteIssued: liveQuote !== null },
    selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon },
    answers: { active: await getActiveAnswers(db, application.id), sensitivity },
    questionCodes,
    product: { eligibilityRules },
    identityFacts,
  }
}

export async function applyConsequencePlan(
  tx: Db,
  ctx: ApplyContext,
  plan: ConsequencePlan,
): Promise<void> {
  // 1. the triggering write (answer mutations only; selection mutations are
  // written by select_coverage — B4's single selection writer)
  if (plan.mutation.node.startsWith('answer:') && plan.mutation.newValue !== null) {
    const code = plan.mutation.node.slice('answer:'.length)
    const q = await tx.question.findFirstOrThrow({ where: { code } })
    await writeRevision(tx, { applicationId: ctx.applicationId, questionId: q.id, value: plan.mutation.newValue, source: 'USER_ANSWER', commitId: ctx.commitId })
  }

  // 2. invalidations with causality
  for (const inv of plan.invalidations) {
    if (!inv.node.startsWith('answer:')) continue
    const q = await tx.question.findFirstOrThrow({ where: { code: inv.node.slice('answer:'.length) } })
    await invalidateActive(tx, { applicationId: ctx.applicationId, questionId: q.id, causedByKey: inv.cause, reason: inv.reason, commitId: ctx.commitId })
  }

  // 3. deterministic selection patch (eligibility-driven addon removal,
  // validity-cleared level/tier)
  if (Object.keys(plan.selectionPatch).length > 0) {
    await tx.application.update({
      where: { id: ctx.applicationId },
      data: {
        ...(plan.selectionPatch.addon !== undefined ? { includesAddon: plan.selectionPatch.addon } : {}),
        ...(plan.selectionPatch.level !== undefined ? { levelId: null } : {}),
        ...(plan.selectionPatch.tier !== undefined ? { tierId: null } : {}),
      },
    })
  }

  // 4. derived status transition (T6.D2: the revision model makes COMPLETED
  // non-terminal pre-quote — this planner edge is written directly, never
  // through the tool-facing status machine)
  if (plan.statusTransition) {
    await tx.application.update({ where: { id: ctx.applicationId }, data: { status: plan.statusTransition.to, completedAt: null } })
  }

  // 5. erratum 10: flags derived from active revisions, recomputed in the
  // same transaction. Non-answer flags (e.g. E2's underwriterReason) are
  // preserved; the OPEN↔PAUSED flip follows the derived escalate flags.
  const activeAnswers = await getActiveAnswers(tx, ctx.applicationId)
  const codes = Object.keys(activeAnswers)
  const questionRules = codes.length > 0
    ? await tx.question.findMany({ where: { code: { in: codes } }, select: { code: true, validationRules: true } })
    : []
  const derived = deriveFlags(activeAnswers, questionRules.map((q) => ({ code: q.code ?? '', validationRules: q.validationRules })))
  const app = await tx.application.findUniqueOrThrow({ where: { id: ctx.applicationId } })
  const existing = Array.isArray(app.flagsForReview) ? (app.flagsForReview as Array<Record<string, unknown>>) : []
  const preserved = existing.filter((f) => f && typeof f === 'object' && !('questionCode' in f))
  const hasEscalate = derived.some((f) => f.action === 'escalate')
  let status = app.status
  if (status === 'OPEN' && hasEscalate) status = 'PAUSED'
  else if (status === 'PAUSED' && !hasEscalate) status = 'OPEN'
  await tx.application.update({
    where: { id: ctx.applicationId },
    data: { flagsForReview: JSON.parse(JSON.stringify([...preserved, ...derived])), status },
  })
}
