import { describe, it, expect } from 'vitest'

describe('serializeToolResultForModel', () => {
  it('includes confirmation when present on success', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const toolResult = {
      success: true,
      data: { answerId: 'ans-123' },
      confirmation: { category: 'save' as const, label: 'Answer saved', value: 'apartment: 80 mp', timestamp: '2026-06-02T10:30:00Z' },
    }
    const parsed = JSON.parse(serializeToolResultForModel(toolResult))
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ answerId: 'ans-123' })
    expect(parsed.confirmation).toEqual({ category: 'save', label: 'Answer saved', value: 'apartment: 80 mp', timestamp: '2026-06-02T10:30:00Z' })
  })

  it('omits confirmation when not present', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({ success: true, data: { answerId: 'ans-123' }, message: 'Done' }))
    expect(parsed.confirmation).toBeUndefined()
    expect(parsed.message).toBe('Done')
  })

  it('includes error and omits data on failure', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({ success: false, error: 'Validation failed: missing required field' }))
    expect(parsed.success).toBe(false)
    expect(parsed.error).toBe('Validation failed: missing required field')
    expect(parsed.data).toBeUndefined()
  })

  it('keeps success, message, data, and confirmation together', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({
      success: true, data: { quoteId: 'q-456' }, message: 'Quote calculated',
      confirmation: { category: 'quote' as const, label: 'Premium calculated', value: '245 RON/month', timestamp: '2026-06-02T10:31:00Z' },
    }))
    expect(Object.keys(parsed).sort()).toEqual(['confirmation', 'data', 'message', 'success'].sort())
    expect(parsed.confirmation.category).toBe('quote')
  })

  it('passes the confirmation provenance through unchanged', async () => {
    const { serializeToolResultForModel } = await import('@/lib/chat/tool-result-serializer')
    const parsed = JSON.parse(serializeToolResultForModel({
      success: true,
      confirmation: { category: 'consent' as const, label: 'DNT signed', value: 'Yes', provenance: 'tool:sign_dnt', timestamp: '2026-06-02T10:32:00Z' },
    }))
    expect(parsed.confirmation.provenance).toBe('tool:sign_dnt')
    expect(parsed.confirmation.category).toBe('consent')
  })
})
