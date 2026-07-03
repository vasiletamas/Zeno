import { describe, it, expect } from 'vitest'
import { buildLegalityPayload } from '@/lib/chat/debug'
import { engineVersion } from '@/lib/engines/derive-and-expose'

describe('buildLegalityPayload (F2.2)', () => {
  it('stamps the engine version, redacts the snapshot, carries state+actions verbatim', () => {
    const p = buildLegalityPayload({
      traceId: 't1', point: 'turn_start', contentVersions: ['pc_v4'],
      snapshot: { customerId: 'c', identity: { fields: { cnp: { provenance: 'declared', value: '1900101123456' } } } },
      state: { phase: 'DISCOVERY', subphase: null } as never,
      actions: { available: ['set_candidate_product'], blocked: [] },
    })
    expect(p.engineVersion).toBe(engineVersion)
    expect(JSON.stringify(p.snapshot)).not.toContain('1900101123456')
    expect(p.actions.available).toContain('set_candidate_product')
    expect(p.point).toBe('turn_start')
  })
  it('carries the commit ledger row id on post_commit entries (erratum 2 join key)', () => {
    const p = buildLegalityPayload({
      traceId: 't1', point: 'post_commit', commitLedgerId: 'led_9', contentVersions: [],
      snapshot: {}, state: { phase: 'QUOTE', subphase: null } as never, actions: { available: [], blocked: [] },
    })
    expect(p.commitLedgerId).toBe('led_9')
  })
})
