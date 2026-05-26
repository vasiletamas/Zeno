import { describe, it, expect, vi, beforeEach } from 'vitest'

const gatewayCallSpy = vi.fn()
vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: (...args: unknown[]) => gatewayCallSpy(...args) },
}))
vi.mock('@/lib/errors/logger', () => ({ logWarn: vi.fn() }))

const { executeComplianceCheck } = await import('@/lib/chat/compliance-checker')

beforeEach(() => {
  gatewayCallSpy.mockReset()
  gatewayCallSpy.mockResolvedValue({ content: '{ "passed": true, "gaps": [], "suggestions": [] }' })
})

describe('executeComplianceCheck — phase awareness', () => {
  it('uses presentation-phase prompt when phase is "presentation"', async () => {
    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'hi' }],
      workflowStepCode: null,
      customerProfile: null,
      phase: 'presentation',
    })

    const call = gatewayCallSpy.mock.calls[0]
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages
    const userPrompt = messages[0].content

    // Presentation-phase rules: transparency-only
    expect(userPrompt).toMatch(/PRESENTATION/i)
    expect(userPrompt).toMatch(/AI nature|AI disclosure/i)
    expect(userPrompt).toMatch(/insurer disclosed/i)
    expect(userPrompt).toMatch(/GDPR/i)
    // Explicit guard: do not flag deferred checks
    expect(userPrompt).toMatch(/Do NOT flag/i)
    expect(userPrompt).toMatch(/needs assessment/i)
  })

  it('uses application-phase prompt when phase is "application"', async () => {
    await executeComplianceCheck({
      messages: [{ role: 'user', content: 'hi' }],
      workflowStepCode: 'application_fill',
      customerProfile: null,
      phase: 'application',
    })

    const call = gatewayCallSpy.mock.calls[0]
    const messages = (call[1] as { messages: Array<{ content: string }> }).messages
    const userPrompt = messages[0].content

    expect(userPrompt).toMatch(/APPLICATION/i)
    expect(userPrompt).toMatch(/needs identification/i)
    expect(userPrompt).toMatch(/suitability/i)
  })

  it('still returns parsed result regardless of phase', async () => {
    const r = await executeComplianceCheck({
      messages: [],
      workflowStepCode: null,
      customerProfile: null,
      phase: 'presentation',
    })
    expect(r.passed).toBe(true)
  })
})
