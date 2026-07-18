/**
 * T28 (P5.1) reconciliation: the quote rates on the DECLARED age; the ID
 * document arrives later (T27) carrying the real birth date. At extraction
 * the pipeline compares the rated age band (frozen in Quote.ratingInputs —
 * T14) against the document DOB: a different addon band → finding
 * 'age_band_mismatch' → the existing DOCUMENT_REVIEW WorkItem path (referral,
 * never a silent re-price). Without an addon band the integer ages compare
 * (conservative).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildReadyApplication, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { executeCommit } from '@/lib/tools/gateway'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { processDocument } from '@/lib/identity/document-pipeline'
import { setMockExtraction } from '@/lib/identity/extraction-provider'

beforeEach(async () => { await resetDb() })

/** An ISSUED quote rated on declaredAge only (no DOB/CNP on file — the T28 shape). */
async function issueQuoteOnDeclaredAge(opts: { addon: boolean; declaredAge: string }) {
  const fx = await buildReadyApplication({ addon: opts.addon, withoutDob: true })
  await setDeclaredField(fx.customerId, 'declaredAge', opts.declaredAge, 'fixture')
  // T28: without a CNP the residency eligibility fact must be declared by mouth
  await setDeclaredField(fx.customerId, 'residency', 'Romania', 'fixture')
  const res = await executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  if (res.outcome !== 'applied') throw new Error(`generate_quote ${res.outcome} (${res.reason})`)
  return fx
}

const uploadDoc = (customerId: string) =>
  prisma.customerDocument.create({ data: { customerId, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' } })

/** A DOB that derives exactly `age` today (Jan 1 birthday is always past). */
const dobForAge = (age: number) => `${new Date().getFullYear() - age}-01-01`

describe('T28: extracted-DOB age band reconciles against the rated band', () => {
  it('different addon band (rated 40 → 31-45, document 50 → 46-55) → age_band_mismatch + DOCUMENT_REVIEW WorkItem', async () => {
    const fx = await issueQuoteOnDeclaredAge({ addon: true, declaredAge: '40' })
    setMockExtraction({ dateOfBirth: dobForAge(50) })
    const doc = await uploadDoc(fx.customerId)
    const r = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(r.status).toBe('review')
    expect(r.findings).toContain('age_band_mismatch')
    const wi = await prisma.workItem.findFirst({ where: { kind: 'DOCUMENT_REVIEW', refs: { path: ['customerDocumentId'], equals: doc.id } } })
    expect(wi).not.toBeNull()
  })

  it('same addon band (rated 40, document 35 — both 31-45) → NO age finding, document validates', async () => {
    const fx = await issueQuoteOnDeclaredAge({ addon: true, declaredAge: '40' })
    setMockExtraction({ dateOfBirth: dobForAge(35) })
    const doc = await uploadDoc(fx.customerId)
    const r = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(r.findings).not.toContain('age_band_mismatch')
    expect(r.status).toBe('validated')
  })

  it('no addon (no band frozen): integer ages compare — a one-year difference is conservative review', async () => {
    const fx = await issueQuoteOnDeclaredAge({ addon: false, declaredAge: '40' })
    setMockExtraction({ dateOfBirth: dobForAge(39) })
    const doc = await uploadDoc(fx.customerId)
    const r = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(r.status).toBe('review')
    expect(r.findings).toContain('age_band_mismatch')
  })

  it('no addon, document age equals the rated age → validates', async () => {
    const fx = await issueQuoteOnDeclaredAge({ addon: false, declaredAge: '40' })
    setMockExtraction({ dateOfBirth: dobForAge(40) })
    const doc = await uploadDoc(fx.customerId)
    const r = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(r.findings).not.toContain('age_band_mismatch')
    expect(r.status).toBe('validated')
  })

  it('no ISSUED/ACCEPTED quote for the customer → the reconciliation stays silent', async () => {
    const c = await prisma.customer.create({ data: { language: 'ro' } })
    setMockExtraction({ dateOfBirth: dobForAge(50) })
    const doc = await uploadDoc(c.id)
    const r = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(r.findings).not.toContain('age_band_mismatch')
  })
})
