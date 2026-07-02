import { describe, it, expect, vi, beforeEach } from 'vitest'

const questionFindFirstSpy = vi.fn()
const answerFindUniqueSpy = vi.fn()
const convFindUniqueSpy = vi.fn()
// B2.6: both the consent-answer source and the validity gate read the Dnt
// aggregate; one spy serves verifyConsents' include-query and hasValidDnt.
const dntFindFirstSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findFirst: (...a: unknown[]) => questionFindFirstSpy(...a) },
    answer: { findUnique: (...a: unknown[]) => answerFindUniqueSpy(...a) },
    conversation: { findUnique: (...a: unknown[]) => convFindUniqueSpy(...a) },
    dnt: { findFirst: (...a: unknown[]) => dntFindFirstSpy(...a) },
  },
}))

const { verifyConsents } = await import('@/lib/compliance/consent-check')

const VALID_DNT = (validUntil: Date) => ({
  id: 'dnt-1',
  status: 'ACTIVE',
  signedAt: new Date(Date.now() - 1e7),
  validUntil,
  productTypesCovered: ['LIFE'],
  sourceSession: {
    answers: [
      { question: { code: 'DNT_CONSULTATION_CONSENT' } },
      { question: { code: 'DNT_ELECTRONIC_COMMUNICATION' } },
      { question: { code: 'DNT_MARKETING_CONSENT' } },
    ],
  },
})

describe('verifyConsents — DNT signature gate (customer-scoped Dnt aggregate, B2.6)', () => {
  beforeEach(() => {
    questionFindFirstSpy.mockReset(); answerFindUniqueSpy.mockReset(); convFindUniqueSpy.mockReset()
    dntFindFirstSpy.mockReset()
    convFindUniqueSpy.mockResolvedValue({ customerId: 'cust-1' })
  })

  it('valid when consents answered in the signed session and the Dnt is still valid', async () => {
    dntFindFirstSpy.mockResolvedValue(VALID_DNT(new Date(Date.now() + 1e7)))
    const r = await verifyConsents('conv-1')
    expect(r.valid).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('flags DNT_SIGNATURE + consent codes missing when the customer has no Dnt', async () => {
    dntFindFirstSpy.mockResolvedValue(null)
    const r = await verifyConsents('conv-1')
    expect(r.valid).toBe(false)
    expect(r.missing).toContain('DNT_SIGNATURE')
    expect(r.missing).toContain('DNT_CONSULTATION_CONSENT')
  })

  it('flags DNT_SIGNATURE missing when the Dnt expired', async () => {
    dntFindFirstSpy.mockResolvedValue(VALID_DNT(new Date(Date.now() - 1e7)))
    const r = await verifyConsents('conv-1')
    expect(r.missing).toContain('DNT_SIGNATURE')
  })
})
