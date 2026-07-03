import { describe, it, expect } from 'vitest'
import { recomputeAndDiff } from '@/lib/debug/recompute-diff'

const entry = (over: Record<string, unknown> = {}) => ({
  point: 'turn_start', engineVersion: '1.33.0', contentVersions: [],
  snapshot: { marker: 'snap' },
  state: { phase: 'DISCOVERY', subphase: null },
  actions: { available: ['set_candidate_product'], blocked: [] }, ...over,
})
const turn = (legality: unknown[]) => ({ traceId: 't', conversationId: 'c', messageIndex: 0, userMessage: '', language: 'ro', startedAt: 0, toolCalls: [], legality }) as never

describe('recomputeAndDiff (F2.3, T14.D2)', () => {
  it('same engine version + identical recomputation -> no diffs', () => {
    const derive = () => ({ state: { phase: 'DISCOVERY', subphase: null }, actions: { available: ['set_candidate_product'], blocked: [] } })
    expect(recomputeAndDiff([turn([entry()])], { currentEngineVersion: '1.33.0', derive: derive as never })).toEqual([])
  })
  it('same engine version + different output -> same_version_drift (a bug)', () => {
    const derive = () => ({ state: { phase: 'APPLICATION', subphase: null }, actions: { available: [], blocked: [] } })
    const diffs = recomputeAndDiff([turn([entry()])], { currentEngineVersion: '1.33.0', derive: derive as never })
    expect(diffs).toHaveLength(1)
    expect(diffs[0].kind).toBe('same_version_drift')
    expect(diffs[0].stateDiff.join(' ')).toContain('phase')
    expect(diffs[0].actionsDiff.removedAvailable).toEqual(['set_candidate_product'])
  })
  it('different engine version -> cross_version_change (behavioral changelog, not a bug)', () => {
    const derive = () => ({ state: { phase: 'APPLICATION', subphase: null }, actions: { available: [], blocked: [] } })
    const diffs = recomputeAndDiff([turn([entry({ engineVersion: '1.20.0' })])], { currentEngineVersion: '1.33.0', derive: derive as never })
    expect(diffs[0].kind).toBe('cross_version_change')
  })
  it('turns without legality entries (pre-F2 history) are skipped silently', () => {
    const derive = () => { throw new Error('never called') }
    expect(recomputeAndDiff([turn([])], { currentEngineVersion: '1.33.0', derive: derive as never })).toEqual([])
  })
})
