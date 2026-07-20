import { describe, it, expect } from 'vitest'
import { sanitizeReplayEnvelope, REPLAY_NOTICE } from '@/lib/tools/gateway'
import type { CommitResult } from '@/lib/engines/domain-types'

describe('sanitizeReplayEnvelope (2026-07-20, conv cmrrhruba turn 12)', () => {
  it('drops _uiAction and swaps the card-directive _message for the neutral notice', () => {
    const envelope: CommitResult = {
      outcome: 'applied', effects: [], ledgerId: 'orig', disposition: 'fresh',
      data: {
        fieldSaved: 'residency', nextField: 'phone',
        _message: 'residency saved. Please provide phone.',
        _uiAction: { type: 'show_data_field', payload: { field: 'phone' } },
        _confirmation: { label: 'x', value: 'y', category: 'save', timestamp: 't' },
      },
    }
    const out = sanitizeReplayEnvelope(envelope)
    const d = out.data as Record<string, unknown>
    expect(d._uiAction).toBeUndefined()
    expect(d._message).toBe(REPLAY_NOTICE)
    expect(d.fieldSaved).toBe('residency')          // facts untouched
    expect(d._confirmation).toBeDefined()            // idempotent ✓ line may re-render
    expect(out.ledgerId).toBe('orig')                // join key untouched
    expect(envelope.data).toHaveProperty('_uiAction') // input not mutated
  })

  it('is a no-op for envelopes without a data bag or without presentation fields', () => {
    const bare: CommitResult = { outcome: 'applied', effects: [] }
    expect(sanitizeReplayEnvelope(bare)).toEqual(bare)
    const factsOnly: CommitResult = { outcome: 'applied', effects: [], data: { fieldSaved: 'phone' } }
    expect((sanitizeReplayEnvelope(factsOnly).data as Record<string, unknown>)._message).toBeUndefined()
  })
})
