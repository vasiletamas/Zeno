/**
 * P0-7: the APPLICATION/QUESTIONNAIRE stage gets a current-question prompt
 * surface — previously loadAllSections passed workflowStepCode=null ("dead
 * input") and questionnaireContext was permanently null, so the agent had no
 * engine-rendered current question at this stage (the same bug the DNT stage
 * had before dntContext). The section now derives everything from the active
 * application: canonical group codes (bd_medical only while the addon is
 * selected), the engine's next visible unanswered question, and progress.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { writeRevision } from '@/lib/engines/answer-store'
import { loadQuestionnaireContext } from '@/lib/chat/context-loaders'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>

describe('loadQuestionnaireContext (P0-7)', () => {
  beforeEach(async () => { await resetDb() })

  it('renders the current question + progress for the base application (bd_medical excluded while addon off)', async () => {
    fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
    const s = await loadQuestionnaireContext(fx.conversationId, fx.customerId, 'ro')
    expect(s).toContain('ACTIVE QUESTIONNAIRE')
    expect(s).toContain('HEALTH_DECLARATION_CONFIRM')
    expect(s).toContain('Progress: 0/1')
    expect(s).not.toContain('BD_CANCER_HISTORY')
  })

  it('includes the BD medical set while the addon is selected (7 questions)', async () => {
    fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
    const s = await loadQuestionnaireContext(fx.conversationId, fx.customerId, 'ro')
    expect(s).toContain('Progress: 0/7')
  })

  it('reports completion once every visible question is answered', async () => {
    fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode.HEALTH_DECLARATION_CONFIRM, value: 'true', source: 'USER_ANSWER' })
    const s = await loadQuestionnaireContext(fx.conversationId, fx.customerId, 'ro')
    expect(s).toContain('Progress: 1/1')
    expect(s).toContain('complete')
  })

  it('returns null with no active application, and null once the application froze (post-quote)', async () => {
    fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
    const other = await prisma.conversation.create({ data: { customerId: fx.customerId } })
    expect(await loadQuestionnaireContext(other.id, fx.customerId, 'ro')).toBeNull()
    await prisma.application.update({ where: { id: fx.applicationId }, data: { frozenAt: new Date() } })
    expect(await loadQuestionnaireContext(fx.conversationId, fx.customerId, 'ro')).toBeNull()
  })
})
