import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import type { ToolContext } from '@/lib/tools/types'

// Task 1.3/3 (D8): the loop-breaker — the same tool failing with the same
// argsHash 3× in one conversation is blocked with repeated_failure; the
// briefing tells the agent to explain and escalate instead of hammering.

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

/** Drive N identical REJECTED commits through the real gateway: writing a
 * DNT answer with no session open is rejected every time. */
async function failWriteDntAnswer(customerId: string, conversationId: string, times: number, value = 'employee') {
  for (let i = 0; i < times; i++) {
    const r = await executeCommit({
      tool: 'write_dnt_answer', actor: 'agent', customerId, conversationId,
      args: { questionCode: 'DNT_OCCUPATION', value }, toolContext: ctx(customerId, conversationId),
    })
    expect(r.outcome).toBe('rejected')
  }
}

it('third identical failure blocks the tool with repeated_failure', async () => {
  const fx = await seedMinimalProtectFixture()
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 3)
  const exposure = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(exposure.actions.blocked).toContainEqual(expect.objectContaining({ action: 'write_dnt_answer', reason: 'repeated_failure' }))
  // the escalation floor survives every loop-breaker
  expect(exposure.actions.available).toContain('escalate_to_human')
  // the briefing instructs explain-and-escalate
  const briefing = formatDerivedBriefing(exposure.state, exposure.actions)
  expect(briefing).toMatch(/repeated failures/i)
  expect(briefing).toContain('escalate_to_human')
}, 60000)

it('two identical failures do NOT block', async () => {
  const fx = await seedMinimalProtectFixture()
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 2)
  const exposure = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(exposure.actions.blocked).not.toContainEqual(expect.objectContaining({ reason: 'repeated_failure' }))
}, 60000)

it('failures with DIFFERENT args do not accumulate toward the block', async () => {
  const fx = await seedMinimalProtectFixture()
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 1, 'employee')
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 1, 'self-employed')
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 1, 'retired')
  const exposure = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(exposure.actions.blocked).not.toContainEqual(expect.objectContaining({ reason: 'repeated_failure' }))
}, 60000)

it('once blocked, the gateway rejects the tool with repeated_failure', async () => {
  const fx = await seedMinimalProtectFixture()
  await failWriteDntAnswer(fx.customerId, fx.conversationId, 3)
  const r = await executeCommit({
    tool: 'write_dnt_answer', actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId,
    args: { questionCode: 'DNT_OCCUPATION', value: 'employee' }, toolContext: ctx(fx.customerId, fx.conversationId),
  })
  expect(r.outcome).toBe('rejected')
  expect(r.reason).toBe('repeated_failure')
}, 60000)
