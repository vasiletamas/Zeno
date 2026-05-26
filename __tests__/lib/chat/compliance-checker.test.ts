import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: vi.fn() },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
}))

import { gateway } from '@/lib/llm/gateway'
import { executeComplianceCheck, type ComplianceCheckResult } from '@/lib/chat/compliance-checker'

describe('executeComplianceCheck', () => {
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
      workflowStepCode: 'quote_presentation',
      customerProfile: { age: 35 },
      phase: 'application',
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
      workflowStepCode: null,
      customerProfile: null,
      phase: 'application',
    })

    expect(gateway.call).toHaveBeenCalledWith(
      'compliance-checker',
      expect.objectContaining({ messages: expect.any(Array) }),
    )
  })

  it('returns passing result on empty response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: '' } as never)
    const result = await executeComplianceCheck({
      messages: [], workflowStepCode: null, customerProfile: null, phase: 'application',
    })
    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })

  it('returns passing result on parse failure', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: 'not json' } as never)
    const result = await executeComplianceCheck({
      messages: [], workflowStepCode: null, customerProfile: null, phase: 'application',
    })
    expect(result.passed).toBe(true)
  })

  it('returns passing result on gateway error (fail-open)', async () => {
    vi.mocked(gateway.call).mockRejectedValue(new Error('timeout'))
    const result = await executeComplianceCheck({
      messages: [], workflowStepCode: null, customerProfile: null, phase: 'application',
    })
    expect(result.passed).toBe(true)
    expect(result.gaps).toEqual([])
  })
})
