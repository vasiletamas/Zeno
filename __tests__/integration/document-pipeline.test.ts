import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { processDocument } from '@/lib/identity/document-pipeline'
import { setMockExtraction } from '@/lib/identity/extraction-provider'
import { setDeclaredField, getProfile } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetFunnelTables() })

async function uploadedDoc(customerId: string) {
  return prisma.customerDocument.create({
    data: { customerId, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' },
  })
}

it('matching extraction flips declared fields to verified and emits mutation events (T4-R4)', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'name', 'Stefan Popa', 'collect_customer_field')
  await setDeclaredField(c.id, 'cnp', '1980418089861', 'collect_customer_field')
  setMockExtraction({ name: 'Ștefan Popa', cnp: '1980418089861', expiryDate: '2030-01-01' })
  const doc = await uploadedDoc(c.id)
  const events: unknown[] = []
  const r = await processDocument(doc.id, { onFieldVerified: e => { events.push(e) } })
  expect(r.status).toBe('validated')
  const p = await getProfile(c.id)
  expect(p.fields.name).toMatchObject({ provenance: 'verified' })
  expect(p.fields.cnp).toMatchObject({ provenance: 'verified' })
  expect(events).toContainEqual(expect.objectContaining({ field: 'cnp' })) // feeds the C1 planner (eligibility_recheck/re_rating)
  const stored = await prisma.customerDocument.findUniqueOrThrow({ where: { id: doc.id } })
  expect(stored.status).toBe('validated')
  expect(stored.verifiedFields).toEqual(expect.arrayContaining(['name', 'cnp']))
})

it('mismatch → conflict surfaced; checksum-invalid extraction or expired document → review + WorkItem(DOCUMENT_REVIEW)', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'name', 'Ion Popa', 'collect_customer_field')
  setMockExtraction({ name: 'Ion Popescu', cnp: '1980418089862', expiryDate: '2020-01-01' })
  const doc = await uploadedDoc(c.id)
  const r = await processDocument(doc.id, { onFieldVerified: () => {} })
  expect(r.status).toBe('review')
  expect(r.findings).toEqual(expect.arrayContaining(['cnp_checksum_invalid', 'document_expired', 'field_mismatch:name']))
  expect(await prisma.workItem.count({ where: { kind: 'DOCUMENT_REVIEW' } })).toBe(1) // E2 model
  expect((await getProfile(c.id)).fields.name).toMatchObject({ provenance: 'conflict' })
})
