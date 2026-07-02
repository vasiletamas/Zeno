import { describe, it, expect } from 'vitest'
import { deriveStateDebugRows } from '@/lib/debug/state-rows'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

function rowMap(rows: Array<{ label: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.label, r.value]))
}

describe('deriveStateDebugRows (DerivedStateV3)', () => {
  it('renders an APPLICATION/DNT state with phase/subphase and missingCodes', () => {
    const { state } = deriveAndExpose(makeSnapshot({
      application: { id: 'a', status: 'OPEN', tier: 'standard', level: 'l1', addon: false, answeredCount: 2, requiredCount: 6, missingCodes: ['AGE', 'OCCUPATION'] },
    }))
    const m = rowMap(deriveStateDebugRows(state))
    expect(m['phase']).toBe('APPLICATION/DNT')
    expect(m['next action']).toBe(state.nextBestAction)
    expect(m['product']).toBe('protect')
    expect(m['application']).toBe('OPEN · 2/6 answered')
    expect(m['missing']).toBe('AGE, OCCUPATION')
  })

  it('renders a DISCOVERY state with a null application without throwing', () => {
    const { state } = deriveAndExpose(makeSnapshot({ product: null }))
    const m = rowMap(deriveStateDebugRows(state))
    expect(m['phase']).toBe('DISCOVERY')
    expect(m['product']).toBe('—')
    expect(m['application']).toBe('not started')
    expect(m['consents']).toBe('GDPR ✗ · AI ✗')
    expect(m['quote']).toBe('none')
  })

  it('returns an "unavailable" marker when state is null/undefined', () => {
    expect(deriveStateDebugRows(null)).toEqual([{ label: 'state', value: 'unavailable' }])
    expect(deriveStateDebugRows(undefined)).toEqual([{ label: 'state', value: 'unavailable' }])
  })
})
