import { describe, it, expect } from 'vitest'
import { loadStateGrounding } from '@/lib/chat/context-loaders'

describe('loadStateGrounding rendering', () => {
  it('renders product when present and does NOT show GDPR granted when absent', () => {
    const out = loadStateGrounding({
      workflowSession: null,
      application: null,
      product: { code: 'LIFE', name: { ro: 'Asigurare viață', en: 'Life Insurance' } },
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('CURRENT SYSTEM STATE')
    expect(out).toContain('LIFE')
    expect(out).toContain('Asigurare viață')
    expect(out).not.toContain('GDPR consent: Granted')
  })

  it('renders ✗ when no application started', () => {
    const out = loadStateGrounding({
      workflowSession: null, application: null, product: null,
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('✗ No application has been started')
  })

  it('renders active application progress', () => {
    const out = loadStateGrounding({
      workflowSession: null,
      application: { id: 'app-1', status: 'OPEN', currentQuestionIndex: 3, totalQuestions: 10 },
      product: null,
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('✓ Active application')
    expect(out).toContain('question 3/10')
  })

  it('renders GDPR consent status', () => {
    const out = loadStateGrounding({
      workflowSession: null, application: null, product: null,
      customer: { gdprConsentAt: new Date(), gdprConsentScope: 'marketing', aiDisclosureAcknowledgedAt: null },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('✓ GDPR consent: Granted')
    expect(out).toContain('marketing')
  })

  it('renders AI disclosure status', () => {
    const out = loadStateGrounding({
      workflowSession: null, application: null, product: null,
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: new Date() },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('✓ AI disclosure: Acknowledged')
  })

  it('warns that state cannot be changed without tools', () => {
    const out = loadStateGrounding({
      workflowSession: null, application: null, product: null,
      customer: { gdprConsentAt: null, gdprConsentScope: null, aiDisclosureAcknowledgedAt: null },
    } as unknown as Parameters<typeof loadStateGrounding>[0])
    expect(out).toContain('cannot claim to have completed')
    expect(out).toContain('matching tool')
  })
})
