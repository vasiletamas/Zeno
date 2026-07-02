import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

describe('M10 degraded-mode exposure', () => {
  it('an action whose backend circuit is open is blocked with temporarily_unavailable', () => {
    const snap = makeSnapshot({ degraded: ['initiate_payment_backend'] })
    const { actions } = deriveAndExpose(snap)
    const blocked = actions.blocked.find((b) => b.reason === 'temporarily_unavailable')
    expect(blocked).toBeDefined()
    expect(blocked?.action).toBe('initiate_payment')
  })
  it('escalate_to_human is exposed in every snapshot (the floor)', () => {
    const { actions } = deriveAndExpose(makeSnapshot({ degraded: ['everything'] }))
    expect(actions.available).toContain('escalate_to_human')
  })
})
