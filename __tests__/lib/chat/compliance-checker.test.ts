import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: vi.fn() },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { gateway } from '@/lib/llm/gateway'
import { executeComplianceCheck, shouldRunComplianceCheck, type ComplianceCheckResult } from '@/lib/chat/compliance-checker'

describe('executeComplianceCheck', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // Task 5.2 (D10): the judge is GROUNDED — recorded facts ride the prompt,
  // and findings the ledger disproves are deterministically suppressed
  // (26/26 post-#38 turns were flagged "GDPR consent missing" DESPITE the
  // signed consent in the ledger).
  it('suppresses gaps the recorded facts disprove — the judge CANNOT emit "GDPR consent missing" over a signed consent', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        passed: false,
        gaps: [
          'No GDPR consent evidence for personal data collection',
          'No needs assessment before recommendation',
          'Premium invented without a quote',
        ],
        suggestions: ['Obtain GDPR consent'],
      }),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'x' }],
      customerProfile: null,
      phase: 'QUOTE',
      recordedFacts: { gdprProcessing: true, aiDisclosure: true, dntSigned: true, dntValidUntil: '2027-01-01' },
    })

    expect(result.gaps).toEqual(['Premium invented without a quote'])
    expect(result.suppressed).toEqual(expect.arrayContaining([
      expect.stringContaining('GDPR'),
      expect.stringContaining('needs assessment'),
    ]))
  })

  it('all gaps suppressed → passed flips to true', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ passed: false, gaps: ['GDPR consent missing'], suggestions: [] }),
    } as never)
    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'x' }], customerProfile: null, phase: 'QUOTE',
      recordedFacts: { gdprProcessing: true, aiDisclosure: false, dntSigned: false, dntValidUntil: null },
    })
    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('renders the recorded facts block and pins the output language', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ passed: true, gaps: [], suggestions: [] }),
    } as never)
    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'x' }], customerProfile: null, phase: 'APPLICATION',
      recordedFacts: { gdprProcessing: true, aiDisclosure: true, dntSigned: true, dntValidUntil: '2027-01-01' },
      language: 'ro',
    })
    const sent = vi.mocked(gateway.call).mock.calls[0][1].messages[0].content as string
    expect(sent).toContain('RECORDED SYSTEM FACTS')
    expect(sent).toMatch(/GDPR processing consent: GRANTED/i)
    expect(sent).toMatch(/needs analysis \(DNT\): SIGNED/i)
    expect(sent).toMatch(/Romanian/)
  })
})

describe('shouldRunComplianceCheck — phase-transition cadence (Task 5.2)', () => {
  it('runs on a phase or subphase transition and on the first observed turn', () => {
    expect(shouldRunComplianceCheck(null, { phase: 'APPLICATION', subphase: 'DNT' })).toBe(true)
    expect(shouldRunComplianceCheck({ phase: 'APPLICATION', subphase: 'DNT' }, { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' })).toBe(true)
    expect(shouldRunComplianceCheck({ phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' }, { phase: 'QUOTE', subphase: null })).toBe(true)
  })
  it('does NOT run per-turn inside a stable subphase — the QUESTIONNAIRE latency budget', () => {
    expect(shouldRunComplianceCheck({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' }, { phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' })).toBe(false)
    expect(shouldRunComplianceCheck({ phase: 'QUOTE', subphase: null }, { phase: 'QUOTE', subphase: null })).toBe(false)
  })
})

describe('executeComplianceCheck (base)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns parsed compliance result on valid response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        passed: false,
        gaps: ['Customer needs not formally identified'],
        suggestions: ['Ask customer to confirm protection needs'],
      }),
    } as never)

    const result = await executeComplianceCheck({
      messages: [{ role: 'user', content: 'I want the cheapest plan' }],
      customerProfile: { age: 35 },
      phase: 'APPLICATION',
    })

    expect(result.passed).toBe(false)
    expect(result.gaps).toHaveLength(1)
    expect(result.suggestions).toHaveLength(1)
  })

  it('calls gateway with compliance-checker slug', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ passed: true, gaps: [], suggestions: [] }),
    } as never)

    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'test' }],
      customerProfile: null,
      phase: 'APPLICATION',
    })

    expect(gateway.call).toHaveBeenCalledWith(
      'compliance-checker',
      expect.objectContaining({ messages: expect.any(Array) }),
    )
  })

  it('returns passing result on empty response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: '' } as never)
    const result = await executeComplianceCheck({
      messages: [], customerProfile: null, phase: 'APPLICATION' })
    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('returns passing result on parse failure', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: 'not json' } as never)
    const result = await executeComplianceCheck({
      messages: [], customerProfile: null, phase: 'APPLICATION' })
    expect(result.passed).toBe(true)
  })

  it('returns passing result on gateway error (fail-open)', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('timeout'))
    const result = await executeComplianceCheck({
      messages: [], customerProfile: null, phase: 'APPLICATION' })
    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })
})
