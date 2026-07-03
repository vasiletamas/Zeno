import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { applyConsequencePlan, buildPlannerSnapshot } from '@/lib/engines/consequence-applier'
import { computeConsequences } from '@/lib/engines/consequence-planner'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import { writeRevision } from '@/lib/engines/answer-store'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
})

describe('applyConsequencePlan (application-scoped per B4)', () => {
  it('bd yes: one transaction writes the answer, flips includesAddon=false, invalidates remaining bd answers', async () => {
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CARDIOVASCULAR, value: 'false', source: 'USER_ANSWER' })
    const snap = await buildPlannerSnapshot(prisma, fx.conversationId)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap, { node: 'answer:BD_CANCER_HISTORY', newValue: 'true' })
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'test-commit' }, plan))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.includesAddon).toBe(false)
    const cardio = await prisma.answer.findFirst({ where: { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CARDIOVASCULAR } })
    expect(cardio?.status).toBe('INVALIDATED')
    expect(cardio?.causedByKey).toBe('answer:BD_CANCER_HISTORY')
    const written = await prisma.answer.findFirst({ where: { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY, status: 'ACTIVE' } })
    expect(written?.value).toBe('true')
    expect(written?.commitId).toBe('test-commit')
  })

  it('statusTransition reverts COMPLETED→OPEN pre-quote and the VALIDITY cascade clears the tier-scoped level', async () => {
    await prisma.application.update({ where: { id: fx.applicationId }, data: { status: 'COMPLETED' } })
    const snap = await buildPlannerSnapshot(prisma, fx.conversationId)
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap, { node: 'selection:tier', newValue: 'optim' })
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'c2' }, plan))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('OPEN')
    expect(app.levelId).toBeNull() // VALIDITY cascade cleared the tier-scoped level
  })

  // erratum 10: flags are DERIVED from active revisions — recomputed inside
  // the applier tx, so a corrected answer can never leave a zombie flag.
  it('derived flags: HEALTH_DECLARATION_CONFIRM false → flag + PAUSED; modify to true → flag cleared, status recomputed', async () => {
    const snap1 = await buildPlannerSnapshot(prisma, fx.conversationId)
    const plan1 = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap1, { node: 'answer:HEALTH_DECLARATION_CONFIRM', newValue: 'false' })
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'c1' }, plan1))
    let app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('PAUSED')
    expect(app.flagsForReview).toContainEqual(expect.objectContaining({ questionCode: 'HEALTH_DECLARATION_CONFIRM', action: 'escalate' }))

    const snap2 = await buildPlannerSnapshot(prisma, fx.conversationId)
    const plan2 = computeConsequences(PROTECT_DEPENDENCY_EDGES, snap2, { node: 'answer:HEALTH_DECLARATION_CONFIRM', newValue: 'true' })
    expect(plan2.requiresConfirmation).toBe(true) // CONFIRM_ON_MODIFY with a prior value
    await prisma.$transaction(tx => applyConsequencePlan(tx, { conversationId: fx.conversationId, applicationId: fx.applicationId, commitId: 'c2' }, plan2))
    app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.status).toBe('OPEN')
    expect(app.flagsForReview).toEqual([])
  })
})
