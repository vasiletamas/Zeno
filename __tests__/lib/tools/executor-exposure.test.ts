import { describe, it, expect } from 'vitest'
import { executeTool } from '@/lib/tools/executor'
import { DEGRADED_FLOOR } from '@/lib/chat/turn-tools'
import type { ToolContext } from '@/lib/tools/types'

const ctx = { customerId: 'c1', conversationId: 'cv1', language: 'ro', exposedTools: ['list_products', 'escalate_to_human'] } as unknown as ToolContext

describe('executor defense-in-depth', () => {
  it('hard-rejects a registered but non-exposed tool with a not_exposed envelope', async () => {
    const r = await executeTool('accept_quote', {}, ctx, 'CUSTOMER')
    expect(r.success).toBe(false)
    expect(r.envelope?.outcome).toBe('rejected')
    expect(r.envelope?.reason).toBe('not_exposed')
  })
  it('escalate_to_human is never rejected by the exposure check', async () => {
    const r = await executeTool('escalate_to_human', { reason: 'test' }, { ...ctx, exposedTools: [] } as unknown as ToolContext, 'CUSTOMER')
    expect(r.envelope?.reason).not.toBe('not_exposed')
  })
  it('the degraded floor is ONE constant shared by the LLM list and the executor wall (erratum 4)', () => {
    expect([...DEGRADED_FLOOR]).toEqual(['get_current_state', 'list_products', 'get_product_info', 'escalate_to_human'])
  })
})
