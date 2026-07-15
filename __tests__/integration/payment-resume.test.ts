/**
 * P1-5 (2026-07-15 hardening): resuming an open payment attempt must hand the
 * frontend a USABLE credential. The old resume branch returned
 * clientSecret:null / redirectUrl:null, so a returning customer could not
 * complete a real Stripe/PayU session. Credentials are persisted at create
 * time and re-supplied on resume; an unusable intent is superseded for a fresh
 * one.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

beforeEach(async () => { await resetDb() })

const ensure = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'ensure_payment_session', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

const cardPayload = (r: Awaited<ReturnType<typeof ensure>>) =>
  ((r.data as { _uiAction?: { payload?: { clientSecret?: string | null; redirectUrl?: string | null; mode?: string } } })?._uiAction?.payload) ?? {}

it('a started session carries a usable client secret', async () => {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  const first = await ensure(fx)
  expect(first.outcome).toBe('applied')
  expect(cardPayload(first).mode).toBe('started')
  expect(cardPayload(first).clientSecret).toBe('mock_secret') // mock provider secret
})

it('RESUMING the open attempt re-supplies the credential, not null', async () => {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  await ensure(fx)
  const resumed = await ensure(fx)
  expect(resumed.outcome).toBe('applied')
  expect(cardPayload(resumed).mode).toBe('resumed')
  // the regression: this used to be null and the card could not mount
  expect(cardPayload(resumed).clientSecret).toBe('mock_secret')
  // still exactly one open attempt
  const firstInstallment = await prisma.installment.findFirstOrThrow({ where: { scheduleId: fx.scheduleId }, orderBy: { sequence: 'asc' } })
  expect(await prisma.payment.count({ where: { installmentId: firstInstallment.id, status: 'PENDING' } })).toBe(1)
})

it('the created Payment persists its provider credential for resume', async () => {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  await ensure(fx)
  const payment = await prisma.payment.findFirstOrThrow({ where: { customerId: fx.customerId, status: 'PENDING' } })
  const meta = (payment.metadata ?? {}) as { clientSecret?: string | null }
  expect(meta.clientSecret).toBe('mock_secret')
})
