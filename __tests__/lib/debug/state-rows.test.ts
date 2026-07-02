import { describe, it, expect } from 'vitest'
import { deriveStateDebugRows } from '@/lib/debug/state-rows'
import type { DerivedState } from '@/lib/chat/derive-state'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

const QUESTIONNAIRE_STATE: DerivedState = {
  phase: 'QUESTIONNAIRE',
  product: { id: 'p-1', code: 'protect', name: 'Protect' },
  selection: { tier: 'standard', level: 'level_2', addon: true },
  consents: { gdpr: true, aiDisclosure: false },
  dnt: { signed: true, validUntil: '2025-01-01T00:00:00.000Z' },
  application: { exists: true, status: 'OPEN', answered: 3, required: 10, missing: ['AGE', 'OCCUPATION'] },
  quote: { exists: true, premiumAnnual: 500 },
  answers: { AGE: '35' },
  nextBestAction: 'ask the next missing question: AGE',
}

function rowMap(rows: Array<{ label: string; value: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.label, r.value]))
}

describe('deriveStateDebugRows', () => {
  it('renders a labeled row for each key piece of derived state', () => {
    const m = rowMap(deriveStateDebugRows(QUESTIONNAIRE_STATE))
    expect(m['phase']).toBe('QUESTIONNAIRE')
    expect(m['next action']).toBe('ask the next missing question: AGE')
    expect(m['product']).toBe('protect')
    expect(m['selection']).toBe('tier standard · level level_2 · addon yes')
    expect(m['consents']).toBe('GDPR ✓ · AI ✗')
    expect(m['DNT']).toBe('signed (until 2025-01-01T00:00:00.000Z)')
    expect(m['application']).toBe('OPEN · 3/10 answered')
    expect(m['missing']).toBe('AGE, OCCUPATION')
    expect(m['quote']).toBe('500')
  })

  it('handles a fresh DISCOVERY state: dashes for product/selection, no missing row, no application/quote', () => {
    const m = rowMap(
      deriveStateDebugRows({
        phase: 'DISCOVERY',
        product: null,
        selection: { tier: null, level: null, addon: null },
        consents: { gdpr: false, aiDisclosure: false },
        dnt: { signed: false, validUntil: null },
        application: { exists: false, status: null, answered: 0, required: 0, missing: [] },
        quote: null,
        answers: {},
        nextBestAction: 'call list_products, then set_candidate_product when the customer names a need',
      }),
    )
    expect(m['phase']).toBe('DISCOVERY')
    expect(m['product']).toBe('—')
    expect(m['selection']).toBe('tier — · level — · addon —')
    expect(m['consents']).toBe('GDPR ✗ · AI ✗')
    expect(m['DNT']).toBe('not signed')
    expect(m['application']).toBe('not started')
    expect(m['quote']).toBe('none')
    expect(m['missing']).toBeUndefined() // no missing row when no application exists
  })

  it('shows "none" for an application with no missing questions', () => {
    const m = rowMap(
      deriveStateDebugRows({
        phase: 'QUOTE',
        product: { id: 'p-1', code: 'protect', name: 'Protect' },
        selection: { tier: 'standard', level: 'level_1', addon: false },
        consents: { gdpr: true, aiDisclosure: true },
        dnt: { signed: true, validUntil: null },
        application: { exists: true, status: 'COMPLETED', answered: 10, required: 10, missing: [] },
        quote: null,
        answers: {},
        nextBestAction: 'call generate_quote',
      }),
    )
    expect(m['selection']).toBe('tier standard · level level_1 · addon no')
    expect(m['DNT']).toBe('signed')
    expect(m['application']).toBe('COMPLETED · 10/10 answered')
    expect(m['missing']).toBe('none')
    expect(m['quote']).toBe('none')
  })

  it('returns an "unavailable" marker when state is null/undefined', () => {
    expect(deriveStateDebugRows(null)).toEqual([{ label: 'state', value: 'unavailable' }])
    expect(deriveStateDebugRows(undefined)).toEqual([{ label: 'state', value: 'unavailable' }])
  })
})

describe('deriveStateDebugRows — DerivedStateV3 tolerance (A1.5 transitional; full migration in A1.7)', () => {
  it('renders a V3 APPLICATION/DNT state with phase/subphase and missingCodes, without throwing', () => {
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

  it('renders a V3 DISCOVERY state with a null application without throwing', () => {
    const { state } = deriveAndExpose(makeSnapshot({ product: null }))
    const m = rowMap(deriveStateDebugRows(state))
    expect(m['phase']).toBe('DISCOVERY')
    expect(m['product']).toBe('—')
    expect(m['application']).toBe('not started')
    expect(m['consents']).toBe('GDPR ✗ · AI ✗')
    expect(m['quote']).toBe('none')
  })
})
