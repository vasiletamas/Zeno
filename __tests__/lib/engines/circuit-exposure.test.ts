import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

describe('M10 degraded-mode exposure', () => {
  it('a circuit-open tool is blocked temporarily_unavailable; escalate_to_human stays as the floor', () => {
    const r = deriveAndExpose(makeSnapshot({ circuit: { openTools: ['generate_quote', 'escalate_to_human'] } }))
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'temporarily_unavailable' }))
    expect(r.actions.available).toContain('escalate_to_human')
  })
})
