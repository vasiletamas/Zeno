import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customer: { update: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { getToolDefinition, getToolHandler } from '@/lib/tools/registry'
import type { ToolContext } from '@/lib/tools/types'

const baseContext: ToolContext = {
  customerId: 'cust-1',
  conversationId: 'conv-1',
  language: 'ro',
}

describe('record_gdpr_consent tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is registered with sideEffect: consent', () => {
    const def = getToolDefinition('record_gdpr_consent')
    expect(def).toBeDefined()
    expect(def?.sideEffect).toBe('consent')
  })

  it('handler writes Customer.gdprConsentAt and gdprConsentScope, returns confirmation', async () => {
    const recordedAt = new Date('2026-05-20T13:00:00Z')
    vi.mocked(prisma.customer.update).mockResolvedValue({
      gdprConsentAt: recordedAt,
      gdprConsentScope: 'data_processing_for_quote',
    } as never)

    const handler = getToolHandler('record_gdpr_consent')!
    const result = await handler({ scope: 'data_processing_for_quote' }, baseContext)

    expect(result.success).toBe(true)
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-1' },
      data: expect.objectContaining({
        gdprConsentAt: expect.any(Date),
        gdprConsentScope: 'data_processing_for_quote',
      }),
    }))
    expect(result.confirmation).toBeDefined()
    expect(result.confirmation?.category).toBe('consent')
    expect(result.confirmation?.label).toBe('Consimțământ GDPR')
    expect(result.confirmation?.value).toContain('data_processing_for_quote')
  })

  it('returns success: false on DB error (no confirmation field)', async () => {
    vi.mocked(prisma.customer.update).mockRejectedValue(new Error('db down'))

    const handler = getToolHandler('record_gdpr_consent')!
    const result = await handler({ scope: 'data_processing_for_quote' }, baseContext)

    expect(result.success).toBe(false)
    expect(result.error).toContain('db down')
    expect(result.confirmation).toBeUndefined()
  })
})

describe('acknowledge_ai_disclosure tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is registered with sideEffect: consent', () => {
    const def = getToolDefinition('acknowledge_ai_disclosure')
    expect(def).toBeDefined()
    expect(def?.sideEffect).toBe('consent')
  })

  it('handler writes Customer.aiDisclosureAcknowledgedAt and returns confirmation', async () => {
    const acknowledgedAt = new Date('2026-05-20T13:00:00Z')
    vi.mocked(prisma.customer.update).mockResolvedValue({
      aiDisclosureAcknowledgedAt: acknowledgedAt,
    } as never)

    const handler = getToolHandler('acknowledge_ai_disclosure')!
    const result = await handler({}, baseContext)

    expect(result.success).toBe(true)
    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-1' },
      data: expect.objectContaining({
        aiDisclosureAcknowledgedAt: expect.any(Date),
      }),
    }))
    expect(result.confirmation?.category).toBe('consent')
    expect(result.confirmation?.label).toBe('Asistență AI')
  })

  it('localizes the confirmation when language is en', async () => {
    vi.mocked(prisma.customer.update).mockResolvedValue({
      aiDisclosureAcknowledgedAt: new Date(),
    } as never)

    const handler = getToolHandler('acknowledge_ai_disclosure')!
    const result = await handler({}, { ...baseContext, language: 'en' })

    expect(result.confirmation?.label).toBe('AI assistance disclosure')
    expect(result.confirmation?.value).toBe('Acknowledged')
  })
})
