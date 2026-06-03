import { describe, it, expect, vi, beforeEach } from 'vitest'

const deriveStateSpy = vi.fn()

vi.mock('@/lib/chat/derive-state', () => ({
  deriveState: (...args: unknown[]) => deriveStateSpy(...args),
}))

const { getStateHandler } = await import('@/lib/tools/handlers/state-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof getStateHandler>[1]

describe('getStateHandler', () => {
  beforeEach(() => {
    deriveStateSpy.mockReset()
  })

  it('calls deriveState with conversationId and returns state on success', async () => {
    const mockState = {
      phase: 'DISCOVERY' as const,
      product: null,
      selection: { tier: null, level: null, addon: null },
      consents: { gdpr: false, aiDisclosure: false },
      dnt: { signed: false, validUntil: null },
      application: { exists: false, status: null, answered: 0, required: 0, missing: [] },
      quote: null,
      answers: {},
      nextBestAction: 'call list_products, then set_candidate_product when the customer names a need',
    }
    deriveStateSpy.mockResolvedValueOnce(mockState)

    const result = await getStateHandler({}, CONTEXT)

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ state: mockState })
    expect(deriveStateSpy).toHaveBeenCalledWith('conv-1')
    expect(result.message).toBeTruthy()
  })

  it('returns error when deriveState throws', async () => {
    deriveStateSpy.mockRejectedValueOnce(new Error('Database error'))

    const result = await getStateHandler({}, CONTEXT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/database error/i)
    expect(result.data).toBeUndefined()
  })
})
