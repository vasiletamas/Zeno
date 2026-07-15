import { describe, it, expect } from 'vitest'
import { partitionToolCalls } from '@/lib/chat/orchestrator'
import { registerTool } from '@/lib/tools/registry'

// No production tool is executionMode='background' anymore (the stubs died in
// A5.ADD-1; update_customer_profile retired in B0.1) — pin the partition
// behavior with a test-only registration.
registerTool('__test_background_tool', {
  description: 'test-only background tool',
  parameters: { type: 'object', properties: {} },
  executionMode: 'background',
  customerVisible: false,
  statusMessage: null,
  allowedRoles: ['CUSTOMER', 'OPERATOR', 'ADMIN'],
  kind: 'read',
}, async () => ({ success: true }))

describe('partitionToolCalls', () => {
  it('separates read-only and writing tool calls', () => {
    const toolCalls = [
      { id: '1', name: 'get_product_info', arguments: { productCode: 'protect' } },
      { id: '2', name: 'save_dnt_answer', arguments: { answer: 'Da' } },
      { id: '3', name: 'list_products', arguments: {} },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(readOnly).toHaveLength(2)
    expect(readOnly.map(tc => tc.name)).toEqual(['get_product_info', 'list_products'])
    expect(writing).toHaveLength(1)
    expect(writing[0].name).toBe('save_dnt_answer')
    expect(background).toHaveLength(0)
  })

  it('separates background tools', () => {
    const toolCalls = [
      { id: '1', name: 'get_product_info', arguments: { productCode: 'protect' } },
      { id: '2', name: '__test_background_tool', arguments: {} },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(readOnly).toHaveLength(1)
    expect(background).toHaveLength(1)
    expect(background[0].name).toBe('__test_background_tool')
    expect(writing).toHaveLength(0)
  })

  it('puts unknown tools in writing group for safety', () => {
    const toolCalls = [
      { id: '1', name: 'unknown_tool', arguments: {} },
    ]

    const { readOnly, writing, background } = partitionToolCalls(toolCalls)

    expect(writing).toHaveLength(1)
    expect(readOnly).toHaveLength(0)
  })

  it('handles empty array', () => {
    const { readOnly, writing, background } = partitionToolCalls([])

    expect(readOnly).toHaveLength(0)
    expect(writing).toHaveLength(0)
    expect(background).toHaveLength(0)
  })
})
