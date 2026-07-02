import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COMPLIANCE_RELEVANT_BY_PHASE, rulesForPhase, executeComplianceCheck } from '@/lib/chat/compliance-checker'
import { PHASES } from '@/lib/engines/domain-types'

const gatewayCallSpy = vi.fn()
vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: (...args: unknown[]) => gatewayCallSpy(...args) },
}))
vi.mock('@/lib/errors/logger', () => ({ logWarn: vi.fn() }))

describe('compliance keyed on the pinned Phase (kills the dual vocabulary at orchestrator.ts:651)', () => {
  it('is exhaustively defined for every Phase (rename can never silently disable it again)', () => {
    for (const p of PHASES) expect(typeof COMPLIANCE_RELEVANT_BY_PHASE[p]).toBe('boolean')
  })
  it('DISCOVERY is not compliance-relevant and maps to the NARROW rule set (over-flagging pathology stays fixed)', () => {
    expect(COMPLIANCE_RELEVANT_BY_PHASE.DISCOVERY).toBe(false)
    expect(rulesForPhase('DISCOVERY')).toBe(rulesForPhase('DISCOVERY')) // stable
    expect(rulesForPhase('DISCOVERY')).not.toEqual(rulesForPhase('APPLICATION'))
  })
  it('APPLICATION/QUOTE/PAYMENT/POLICY are compliance-relevant', () => {
    for (const p of ['APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const) expect(COMPLIANCE_RELEVANT_BY_PHASE[p]).toBe(true)
  })
})

describe('executeComplianceCheck selects the rule set from the pinned Phase', () => {
  beforeEach(() => {
    gatewayCallSpy.mockReset()
    gatewayCallSpy.mockResolvedValue({ content: '{ "passed": true, "gaps": [], "suggestions": [] }' })
  })

  it('DISCOVERY uses the narrow presentation rule set', async () => {
    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'hi' }],
      customerProfile: null,
      phase: 'DISCOVERY',
    })

    const call = gatewayCallSpy.mock.calls[0]
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages
    const userPrompt = messages[0].content

    expect(userPrompt).toMatch(/Do NOT flag/i)
    expect(userPrompt).not.toMatch(/needs identification/i)
  })

  it('every non-DISCOVERY Phase uses the full rule set', async () => {
    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'hi' }],
      customerProfile: null,
      phase: 'APPLICATION',
    })

    const call = gatewayCallSpy.mock.calls[0]
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages
    const userPrompt = messages[0].content

    expect(userPrompt).toMatch(/needs identification/i)
    expect(userPrompt).toMatch(/suitability/i)
  })
})
