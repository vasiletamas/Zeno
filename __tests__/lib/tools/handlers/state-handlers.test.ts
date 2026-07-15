import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'
import { makeSnapshot } from '../../engines/snapshot-fixtures'

const loadSnapshotSpy = vi.fn()

vi.mock('@/lib/engines/snapshot-loader', () => ({
  loadDomainSnapshot: (...args: unknown[]) => loadSnapshotSpy(...args),
}))

const { getStateHandler } = await import('@/lib/tools/handlers/state-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof getStateHandler>[1]

describe('getStateHandler', () => {
  beforeEach(() => {
    loadSnapshotSpy.mockReset()
  })

  it('loads the snapshot for the conversation and returns { state, actions }', async () => {
    loadSnapshotSpy.mockResolvedValueOnce(makeSnapshot({ product: null }))

    const result = await getStateHandler({}, CONTEXT)

    expect(loadSnapshotSpy).toHaveBeenCalledWith('conv-1')
    expect(result.success).toBe(true)
    const data = result.data as { state: DerivedStateV3; actions: ExposedActions }
    expect(data.state.phase).toBe('DISCOVERY')
    expect(data.state.subphase).toBeNull()
    expect(data.actions.available).toContain('get_current_state')
    expect(result.message).toBe(`Phase DISCOVERY. ${data.state.nextBestAction}`)
  })

  it('renders phase/subphase in the message when a subphase is active', async () => {
    loadSnapshotSpy.mockResolvedValueOnce(
      makeSnapshot({
        application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['AGE'], frozen: false },
      }),
    )

    const result = await getStateHandler({}, CONTEXT)

    expect(result.success).toBe(true)
    expect(result.message).toMatch(/^Phase APPLICATION\/DNT\. /)
  })

  it('propagates loader errors (the executor catch converts them to error results)', async () => {
    loadSnapshotSpy.mockRejectedValueOnce(new Error('Database error'))

    await expect(getStateHandler({}, CONTEXT)).rejects.toThrow('Database error')
  })
})
