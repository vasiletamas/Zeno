import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { writeRevision } from '@/lib/engines/answer-store'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
})

const ctx = () => ({ customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma } as unknown as ToolContext)
const commit = (args: Record<string, unknown>) =>
  executeCommit({ tool: 'select_coverage', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx() })

describe('select_coverage through the consequence planner (contradiction #4)', () => {
  it('tier change → re_rating + cascade_invalidate of the now-invalid level (no stale levelId)', async () => {
    const res = await commit({ tier: 'optim' })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toEqual(expect.arrayContaining(['re_rating', 'cascade_invalidate']))
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.levelId).toBeNull() // the change-selection stale-level hole is closed
  })

  it('addon=false → questions_removed for bd_medical, answered bd rows invalidated', async () => {
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY, value: 'false', source: 'USER_ANSWER' })
    const res = await commit({ addon: false })
    expect(res.outcome).toBe('applied')
    expect(res.effects).toContain('questions_removed')
    const bd = await prisma.answer.findFirst({ where: { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_CANCER_HISTORY } })
    expect(bd?.status).toBe('INVALIDATED')
    expect(bd?.causedByKey).toBe('selection:addon')
  })

  it('addon=true → cascade_expand listing the 6 bd questions in the envelope data', async () => {
    await commit({ addon: false })
    const res = await commit({ addon: true })
    expect(res.effects).toContain('cascade_expand')
    expect((res.data as { questionsAdded: string[] }).questionsAdded).toHaveLength(6)
  })

  it('multi-facet args are rejected: one facet per commit', async () => {
    const res = await commit({ tier: 'optim', level: 'level_2' })
    expect(res).toMatchObject({ outcome: 'rejected', reason: 'one_facet_per_commit' })
    const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
    expect(app.levelId).not.toBeNull() // nothing was written
  })
})
