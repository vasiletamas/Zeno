import { describe, it, expect, vi, beforeEach } from 'vitest'

const questionFindFirstSpy = vi.fn()
const answerFindUniqueSpy = vi.fn()
const convFindUniqueSpy = vi.fn()
// B2.1: negative stamp cases fall through to the Dnt aggregate — none here.
const dntFindFirstSpy = vi.fn().mockResolvedValue(null)

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findFirst: (...a: unknown[]) => questionFindFirstSpy(...a) },
    answer: { findUnique: (...a: unknown[]) => answerFindUniqueSpy(...a) },
    conversation: { findUnique: (...a: unknown[]) => convFindUniqueSpy(...a) },
    dnt: { findFirst: (...a: unknown[]) => dntFindFirstSpy(...a) },
  },
}))

const { verifyConsents } = await import('@/lib/compliance/consent-check')

describe('verifyConsents — DNT signature gate (from Conversation)', () => {
  beforeEach(() => {
    questionFindFirstSpy.mockReset(); answerFindUniqueSpy.mockReset(); convFindUniqueSpy.mockReset()
    // all required consent answers present
    questionFindFirstSpy.mockResolvedValue({ id: 'q' })
    answerFindUniqueSpy.mockResolvedValue({ id: 'a' })
  })

  it('valid when consents answered and DNT signed + still valid', async () => {
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: new Date(), dntValidUntil: new Date(Date.now() + 1e7) })
    const r = await verifyConsents('conv-1')
    expect(r.valid).toBe(true)
    expect(r.missing).toEqual([])
  })

  it('flags DNT_SIGNATURE missing when not signed', async () => {
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: null, dntValidUntil: null })
    const r = await verifyConsents('conv-1')
    expect(r.valid).toBe(false)
    expect(r.missing).toContain('DNT_SIGNATURE')
  })

  it('flags DNT_SIGNATURE missing when signature expired', async () => {
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: new Date(Date.now() - 1e9), dntValidUntil: new Date(Date.now() - 1e7) })
    const r = await verifyConsents('conv-1')
    expect(r.missing).toContain('DNT_SIGNATURE')
  })
})
