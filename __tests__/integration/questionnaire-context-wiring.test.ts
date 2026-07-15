import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadQuestionnaireContextForState } from '@/lib/chat/context-loaders'

// Task 1.2 (D2): the woken questionnaire surface against the REAL catalog —
// derived (phase, subphase) → step code → canonical getNextQuestion walk.

beforeEach(async () => { await resetDb() }, 60000)

it('APPLICATION/QUESTIONNAIRE turn includes questionnaireContext with the current question', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, {})
  const exposure = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(exposure.state.phase).toBe('APPLICATION')
  expect(exposure.state.subphase).toBe('QUESTIONNAIRE')

  const section = await loadQuestionnaireContextForState(exposure.state, fx.conversationId, fx.customerId, 'ro')
  expect(section).toMatch(/current question/i)
  expect(section).toContain('HEALTH_DECLARATION_CONFIRM')
}, 60000)

it('a stored insight matching the current question renders the CONTEXT HIT block', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, {})
  // arrange: the current question carries an insight key and the customer
  // already stated the fact in THIS conversation
  await prisma.question.updateMany({ where: { code: 'HEALTH_DECLARATION_CONFIRM' }, data: { insightKey: 'healthDeclarationOk' } })
  await prisma.customerInsight.create({
    data: {
      customerId: fx.customerId, key: 'healthDeclarationOk', value: 'true',
      category: 'PREFERENCE', confidence: 0.95, source: fx.conversationId,
      lastConfirmedAt: new Date(),
    },
  })

  const exposure = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  const section = await loadQuestionnaireContextForState(exposure.state, fx.conversationId, fx.customerId, 'ro')
  expect(section).toContain('[CONTEXT HIT for current question]')
  expect(section).toContain('INSTRUCTIONS — DO NOT RE-ASK')
}, 60000)
