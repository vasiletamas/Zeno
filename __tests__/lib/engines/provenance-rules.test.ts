import { describe, it, expect } from 'vitest'
import { resolveDeclaredWrite, resolveVerifiedWrite, mergeFieldRecords } from '@/lib/engines/provenance-rules'
const at = (s: string) => new Date(s)
const dec = (value: string, recordedAt = at('2026-01-01')) => ({ value, provenance: 'declared' as const, source: 't', recordedAt })
const ver = (value: string, recordedAt = at('2026-01-02')) => ({ value, provenance: 'verified' as const, source: 'doc', evidenceRef: 'ev1', recordedAt })

describe('provenance rules (pure, T12.D3)', () => {
  it('fresh declared write applies; newer declared overwrites older', () => {
    expect(resolveDeclaredWrite(null, { value: 'Ana', source: 's', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'declared' } })
    expect(resolveDeclaredWrite(dec('Ana'), { value: 'Ana-Maria', source: 's', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { value: 'Ana-Maria' } })
  })
  it('declared can never displace verified (T4-R3)', () => {
    expect(resolveDeclaredWrite(ver('1980418089861'), { value: '2950715123458', source: 's', at: at('2026-06-01') })).toEqual({ action: 'reject', reason: 'field_verified_immutable' })
    expect(resolveDeclaredWrite(ver('Ana'), { value: 'Ana', source: 's', at: at('2026-06-01') })).toEqual({ action: 'noop' })
  })
  it('verified write: diacritics-insensitive match flips to verified, mismatch flags conflict keeping both', () => {
    expect(resolveVerifiedWrite(dec('Stefan Popa'), { value: 'Ștefan Popa', source: 'doc', evidenceRef: 'e', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'verified' } })
    expect(resolveVerifiedWrite(dec('Ion Popa'), { value: 'Ion Popescu', source: 'doc', evidenceRef: 'e', at: at('2026-06-01') })).toMatchObject({ action: 'write', next: { provenance: 'conflict', conflictValue: 'Ion Popa' } })
  })
  it('merge: verified beats declared; newer declared beats older; differing verified → conflict', () => {
    expect(mergeFieldRecords(dec('a@x.ro'), ver('b@x.ro'))).toMatchObject({ provenance: 'verified', value: 'b@x.ro' })
    expect(mergeFieldRecords(dec('old', at('2026-01-01')), dec('new', at('2026-02-01')))).toMatchObject({ value: 'new' })
    expect(mergeFieldRecords(ver('111'), ver('222'))).toMatchObject({ provenance: 'conflict' })
  })
})
