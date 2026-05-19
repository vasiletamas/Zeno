import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

const { prisma } = await import('@/lib/db')
const { logWarn } = await import('@/lib/errors/logger')
const { findContextHit } = await import('@/lib/insights/context-hits')

function makeInsight(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    customerId: 'cust-1',
    productId: null,
    category: 'PREFERENCE',
    key: 'selectedTier',
    value: 'Standard',
    confidence: 0.9,
    source: 'conv-1',
    lastConfirmedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }
}

const baseQuestion = {
  id: 'q1',
  insightKey: 'selectedTier',
  options: [
    { value: 'Standard', label: { en: 'Standard', ro: 'Standard' } },
    { value: 'Optim', label: { en: 'Optim', ro: 'Optim' } },
  ],
  group: { code: 'application' },
}

describe('findContextHit', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns hit on happy path (PREFERENCE, same conv, confidence above threshold)', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(makeInsight() as never)
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1')
    expect(hit).not.toBeNull()
    expect(hit?.value).toBe('Standard')
    expect(hit?.confidence).toBe(0.9)
  })

  it('returns null when question.insightKey is null (no DB call)', async () => {
    const hit = await findContextHit('cust-1', { ...baseQuestion, insightKey: null }, 'conv-1')
    expect(hit).toBeNull()
    expect(prisma.customerInsight.findUnique).not.toHaveBeenCalled()
  })

  it('returns null when confidence below threshold', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({ confidence: 0.7 }) as never,
    )
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1')
    expect(hit).toBeNull()
  })

  it('returns null when no insight exists', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(null)
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1')
    expect(hit).toBeNull()
  })

  it('returns null and warns when value not in options', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({ value: 'Premium' }) as never,
    )
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1')
    expect(hit).toBeNull()
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'extractor_value_mismatch' }),
    )
  })

  it('rejects PREFERENCE insight from a different conversation', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({ source: 'conv-other' }) as never,
    )
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1')
    expect(hit).toBeNull()
  })

  it('allows DEMOGRAPHIC insight from a different conversation', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({
        category: 'DEMOGRAPHIC',
        key: 'age',
        value: '40',
        source: 'conv-other',
      }) as never,
    )
    const hit = await findContextHit(
      'cust-1',
      { id: 'q2', insightKey: 'age', options: null, group: { code: 'application' } },
      'conv-1',
    )
    expect(hit).not.toBeNull()
  })

  it('rejects RISK_FACTOR insight from a different conversation when group is bd_medical', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({
        category: 'RISK_FACTOR',
        key: 'smokingStatus',
        value: 'smoker',
        source: 'conv-other',
      }) as never,
    )
    const hit = await findContextHit(
      'cust-1',
      { id: 'q3', insightKey: 'smokingStatus', options: null, group: { code: 'bd_medical' } },
      'conv-1',
    )
    expect(hit).toBeNull()
  })

  it('allows RISK_FACTOR insight from a different conversation when group is NOT bd_medical', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({
        category: 'RISK_FACTOR',
        key: 'smokingStatus',
        value: 'smoker',
        source: 'conv-other',
      }) as never,
    )
    const hit = await findContextHit(
      'cust-1',
      { id: 'q3', insightKey: 'smokingStatus', options: null, group: { code: 'application' } },
      'conv-1',
    )
    expect(hit).not.toBeNull()
  })

  it('uses a custom threshold when provided', async () => {
    vi.mocked(prisma.customerInsight.findUnique).mockResolvedValue(
      makeInsight({ confidence: 0.75 }) as never,
    )
    const hit = await findContextHit('cust-1', baseQuestion, 'conv-1', 0.7)
    expect(hit).not.toBeNull()
  })
})
