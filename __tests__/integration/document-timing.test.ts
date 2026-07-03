import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote, buildActivatedPolicy } from '@/__tests__/helpers/funnel-fixtures'

describe('document generation timing (D4.6, M7c: report at issuance, not post-policy)', () => {
  beforeEach(async () => { await resetDb() })

  it('quote issuance creates the SUITABILITY_REPORT document bound to the quote', async () => {
    const fx = await buildIssuedQuote()
    const doc = await prisma.document.findFirst({ where: { kind: 'SUITABILITY_REPORT', quoteId: fx.quoteId } })
    expect(doc).not.toBeNull()
    expect(doc!.contentHash.length).toBeGreaterThan(0)
  })

  it('first capture creates a PAYMENT_RECEIPT; activation creates the POLICY_SCHEDULE', async () => {
    const fx = await buildActivatedPolicy()
    expect(await prisma.document.count({ where: { kind: 'PAYMENT_RECEIPT', customerId: fx.customerId } })).toBeGreaterThanOrEqual(1)
    expect(await prisma.document.count({ where: { kind: 'POLICY_SCHEDULE', policyId: fx.policyId } })).toBe(1)
  })
})
