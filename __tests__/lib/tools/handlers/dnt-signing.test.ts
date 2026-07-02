// __tests__/lib/tools/handlers/dnt-signing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const convUpdateSpy = vi.fn()
const calcProgressSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: { conversation: { update: (...a: unknown[]) => convUpdateSpy(...a) } },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...a: unknown[]) => calcProgressSpy(...a),
  getNextQuestion: vi.fn(),
  validateAnswer: vi.fn(),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))
vi.mock('@/lib/analytics/events', () => ({ trackDntCompleted: vi.fn() }))

const { signDnt } = await import('@/lib/tools/handlers/dnt-handlers')

const CONTEXT = {
  db: (await import('@/lib/db')).prisma,
  conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const,
} as unknown as Parameters<typeof signDnt>[1]

describe('signDnt', () => {
  beforeEach(() => {
    convUpdateSpy.mockReset(); calcProgressSpy.mockReset()
    resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['dnt_consent'])
  })

  it('persists dntSignedAt/dntValidUntil to Conversation without a workflow session', async () => {
    calcProgressSpy.mockResolvedValueOnce({ answered: 3, total: 3, percentage: 100 })
    convUpdateSpy.mockResolvedValueOnce({ id: 'conv-1' })

    const result = await signDnt({ confirmSignature: true, gdprConsent: true }, CONTEXT)

    expect(result.success).toBe(true)
    expect(convUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        dntSignedAt: expect.any(Date),
        dntValidUntil: expect.any(Date),
      }),
    })
  })

  it('refuses to sign when DNT is incomplete', async () => {
    calcProgressSpy.mockResolvedValueOnce({ answered: 1, total: 3, percentage: 33 })
    const result = await signDnt({ confirmSignature: true, gdprConsent: true }, CONTEXT)
    expect(result.success).toBe(false)
    expect(convUpdateSpy).not.toHaveBeenCalled()
  })

  it('requires GDPR consent', async () => {
    const result = await signDnt({ confirmSignature: true, gdprConsent: false }, CONTEXT)
    expect(result.success).toBe(false)
  })
})
