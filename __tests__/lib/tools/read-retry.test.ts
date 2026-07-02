import { describe, it, expect } from 'vitest'
import { executeTool } from '@/lib/tools/executor'
import { registerTool } from '@/lib/tools/registry'
import { TimeoutError } from '@/lib/errors/types'
import type { ToolContext } from '@/lib/tools/types'

// M10 retry policy (A3.ADD-2): reads retry ONCE on transient infra failure.
// Commits never auto-retry — that path is gateway-owned and pinned by the
// gateway/idempotency suites.

let calls = 0
registerTool('__test_flaky_read', {
  description: 'test-only flaky read',
  parameters: { type: 'object', properties: {} },
  executionMode: 'blocking',
  customerVisible: false,
  statusMessage: null,
  alwaysAllowed: false,
  allowedRoles: ['CUSTOMER', 'OPERATOR', 'ADMIN'],
  kind: 'read',
}, async () => {
  calls++
  if (calls === 1) throw new TimeoutError('tool:__test_flaky_read', 1)
  return { success: true, data: { ok: true } }
})

const ctx = { customerId: 'c', conversationId: 'cv', language: 'ro' } as unknown as ToolContext

describe('M10 read retry policy (A3.ADD-2)', () => {
  it('a read that times out transiently is retried exactly once and succeeds', async () => {
    const r = await executeTool('__test_flaky_read', {}, ctx, 'CUSTOMER')
    expect(r.success).toBe(true)
    expect(calls).toBe(2)
  })
})
