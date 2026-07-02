/**
 * B3.ADD-3 — soft verification offer at application open (T4-R6, G6): a
 * FLAG for the copy layer, never a wall — the funnel is not blocked.
 * (B4 renamed the surface to set_application; the offer rides data.softOffer.)
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables } from '@/__tests__/helpers/test-db'
import { seedDntFullyAnswered } from '@/__tests__/helpers/dnt-fixtures'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { setApplication } from '@/lib/tools/handlers/application-handlers'
import { issueChallenge, confirmByCode } from '@/lib/customer/verification-service'
import { setDeclaredField } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetFunnelTables() })

it('offers verification when the tier is below verified_channel, and stays silent once verified', async () => {
  const { customerId, conversationId, ctx } = await seedDntFullyAnswered()
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`fixture sign failed: ${signed.error}`)

  const first = await setApplication({}, ctx)
  expect(first.success).toBe(true)
  expect(first.data?.softOffer).toBe('channel_verification')

  // reach verified_channel: full consistent declared KYC + a consumed challenge
  await setDeclaredField(customerId, 'name', 'Ana Pop', 'test')
  await setDeclaredField(customerId, 'cnp', '1980418089861', 'test')
  await setDeclaredField(customerId, 'dateOfBirth', '1998-04-18', 'test')
  await setDeclaredField(customerId, 'phone', '0712345678', 'test')
  const { code } = await issueChallenge(customerId, 'email', 'offer@example.ro', conversationId)
  const confirmed = await confirmByCode(customerId, code)
  if (!confirmed.ok) throw new Error('fixture verification failed')

  await prisma.conversation.update({ where: { id: conversationId }, data: { activeApplicationId: null } })
  await prisma.answer.deleteMany({ where: { application: { customerId } } })
  await prisma.application.deleteMany({ where: { customerId } })
  const second = await setApplication({}, ctx)
  expect(second.success).toBe(true)
  expect(second.data?.softOffer).toBeUndefined()
})
