import { it, expect, beforeEach } from 'vitest'
import { resetFunnelTables, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { prisma } from '@/lib/db'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

// 2026-07-06 user-found defect: the post-write next-question walk read through
// the GLOBAL client, which cannot see the answer row written inside the
// gateway transaction — the just-answered question was re-served as
// nextQuestion (and in the show_question card) with stale progress. Same trap
// dnt-handlers' sessionNextQuestion already documents and avoids.
it('write_question_answer (via gateway tx) advances nextQuestion past the just-answered question', async () => {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection' })

  const res = await executeCommit({
    tool: 'write_question_answer',
    args: { answer: 'da', questionCode: 'HEALTH_DECLARATION_CONFIRM' },
    actor: 'agent',
    customerId: fx.customerId,
    conversationId: fx.conversationId,
    toolContext: ctx(fx.customerId, fx.conversationId),
  })
  expect(res.outcome).toBe('applied')
  const data = res.data as { answerSaved: boolean; nextQuestion: { code: string } | null; progress: { answered: number; total: number }; isComplete?: boolean }
  expect(data.answerSaved).toBe(true)
  if (!data.isComplete) {
    expect(data.nextQuestion?.code).not.toBe('HEALTH_DECLARATION_CONFIRM')
    expect(data.progress.answered).toBe(1)
  }
})
