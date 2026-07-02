import { describe, it, expect } from 'vitest'
import { loadStateGrounding } from '@/lib/chat/context-loaders'

const emptyState = {
  application: null,
  product: null,
  customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
} as const

describe('loadStateGrounding', () => {
  it('returns the all-negative form when no state is present', () => {
    const result = loadStateGrounding(emptyState)
    expect(result).toContain('=== CURRENT SYSTEM STATE (ground truth — do not contradict) ===')
    expect(result).toContain('✗ No application has been started')
    expect(result).toContain('✗ No product is selected')
    expect(result).toContain('✗ GDPR consent has NOT been granted by this customer')
    expect(result).toContain('✗ AI disclosure has NOT been acknowledged by this customer')
    expect(result).toContain('You cannot claim to have completed any of these')
  })

  it('returns positive lines for fields that are populated', () => {
    const result = loadStateGrounding({
      application: {
        id: 'APP-12345',
        status: 'IN_PROGRESS',
        currentQuestionIndex: 5,
        totalQuestions: 14,
      },
      product: { code: 'LIFE-PRO', name: 'Asigurare Viață Premium' },
      customer: {
        gdprConsentAt: new Date('2026-05-20T12:48:00.000Z'),
        gdprConsentScope: 'data_processing_for_quote',
        aiDisclosureAcknowledgedAt: new Date('2026-05-20T12:45:00.000Z'),
      },
    })

    expect(result).toContain('✓ Active application: APP-12345 (question 5/14)')
    expect(result).toContain('✓ Selected product: LIFE-PRO — Asigurare Viață Premium')
    expect(result).toContain('✓ GDPR consent: Granted at 2026-05-20')
    expect(result).toContain('for data_processing_for_quote')
    expect(result).toContain('✓ AI disclosure: Acknowledged at 2026-05-20')
  })

  it('renders mixed states per-line correctly', () => {
    const result = loadStateGrounding({
      application: null,
      product: { code: 'LIFE-PRO', name: 'Asigurare Viață Premium' },
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    })

    expect(result).toContain('✗ No application has been started')
    expect(result).toContain('✓ Selected product: LIFE-PRO — Asigurare Viață Premium')
    expect(result).toContain('✗ GDPR consent has NOT been granted by this customer')
  })

  it('handles non-string product name shapes by stringifying defensively', () => {
    const result = loadStateGrounding({
      application: null,
      product: { code: 'LIFE-PRO', name: { ro: 'Asigurare Viață Premium', en: 'Premium Life' } as unknown },
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    })

    expect(result).toMatch(/✓ Selected product: LIFE-PRO — /)
  })
})
