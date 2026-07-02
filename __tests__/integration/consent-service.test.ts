import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { appendConsentEvents, loadDerivedConsents } from '@/lib/customer/consent-service'
beforeEach(async () => { await resetDb() })
it('appends events and derives current state; never mutates prior rows', async () => {
  const c = await createCustomer()
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'granted' }, { kind: 'ai_disclosure', action: 'granted' }], 'commit-1')
  await appendConsentEvents(c.id, [{ kind: 'gdpr_processing', action: 'withdrawn' }], 'commit-2')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id } })).toBe(3)
  expect(await loadDerivedConsents(c.id)).toEqual({ gdprProcessing: false, aiDisclosure: true, marketing: false, gdprWithdrawn: true })
})
