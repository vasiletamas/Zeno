import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
beforeEach(async () => { await resetDb() })
it('ConsentEvent rows append with pinned kinds/actions; Customer columns are gone', async () => {
  const c = await createCustomer()
  const e = await prisma.consentEvent.create({ data: { customerId: c.id, kind: 'gdpr_processing', action: 'granted', sourceCommitId: 'commit-1' } })
  expect(e.kind).toBe('gdpr_processing')
  const row = await prisma.customer.findUnique({ where: { id: c.id } })
  expect('gdprConsentAt' in row!).toBe(false)
  expect('aiDisclosureAcknowledgedAt' in row!).toBe(false)
})
