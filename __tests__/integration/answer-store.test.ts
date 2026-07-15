import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeRevision, invalidateActive, getActiveAnswers } from '@/lib/engines/answer-store'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>

beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture()
})

describe('answer-store (append-only revisions, application-scoped per B4)', () => {
  it('writeRevision supersedes the previous ACTIVE row instead of overwriting', async () => {
    const qId = fx.questionIdByCode.HEALTH_DECLARATION_CONFIRM
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: qId, value: 'true', source: 'USER_ANSWER', commitId: 'c1' })
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c2' })
    const rows = await prisma.answer.findMany({ where: { applicationId: fx.applicationId, questionId: qId }, orderBy: { answeredAt: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0].status).toBe('SUPERSEDED')
    expect(rows[1].status).toBe('ACTIVE')
    expect(rows[1].value).toBe('false')
  })
  it('the DB rejects two ACTIVE revisions for one (questionId, applicationId) — partial unique index', async () => {
    const qId = fx.questionIdByCode.HEALTH_DECLARATION_CONFIRM
    await prisma.answer.create({ data: { questionId: qId, applicationId: fx.applicationId, value: 'a', status: 'ACTIVE', source: 'USER_ANSWER' } })
    await expect(
      prisma.answer.create({ data: { questionId: qId, applicationId: fx.applicationId, value: 'b', status: 'ACTIVE', source: 'USER_ANSWER' } }),
    ).rejects.toThrow() // unique_violation from answer_active_unique
  })
  it('invalidateActive marks the row INVALIDATED with causality; getActiveAnswers no longer returns it', async () => {
    const qId = fx.questionIdByCode.BD_CANCER_HISTORY
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c1' })
    await invalidateActive(prisma, { applicationId: fx.applicationId, questionId: qId, causedByKey: 'selection:addon', reason: 'removed_by_branch', commitId: 'c2' })
    const active = await getActiveAnswers(prisma, fx.applicationId)
    expect(active.BD_CANCER_HISTORY).toBeUndefined()
    const row = await prisma.answer.findFirst({ where: { questionId: qId, applicationId: fx.applicationId } })
    expect(row?.status).toBe('INVALIDATED')
    expect(row?.causedByKey).toBe('selection:addon')
    expect(row?.invalidatedReason).toBe('removed_by_branch')
  })
  it('re-answering after invalidation creates a fresh ACTIVE revision (reactivation)', async () => {
    const qId = fx.questionIdByCode.BD_CANCER_HISTORY
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: qId, value: 'false', source: 'USER_ANSWER', commitId: 'c1' })
    await invalidateActive(prisma, { applicationId: fx.applicationId, questionId: qId, causedByKey: 'selection:addon', reason: 'removed_by_branch', commitId: 'c2' })
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: qId, value: 'true', source: 'USER_ANSWER', commitId: 'c3' })
    const active = await getActiveAnswers(prisma, fx.applicationId)
    expect(active.BD_CANCER_HISTORY).toBe('true')
  })
})
