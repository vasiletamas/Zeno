/**
 * Provenance rules — PURE, no prisma (T12.D3 decision core).
 *
 * The write/merge decision logic for the B0 CustomerProfileField store:
 * declared facts may be freely restated, verified facts are immutable to
 * declarations (T4-R3), and verified-vs-declared mismatches surface as
 * conflicts keeping both values.
 */

export type ProvenanceState = 'declared' | 'verified' | 'conflict'

export interface FieldRecord {
  value: string
  provenance: ProvenanceState
  source: string
  evidenceRef?: string | null
  conflictValue?: string | null
  conflictSource?: string | null
  recordedAt: Date
}

export type WriteDecision =
  | { action: 'write'; next: FieldRecord }
  | { action: 'noop' }
  | { action: 'reject'; reason: 'field_verified_immutable' }

/** Diacritics-insensitive, whitespace-normalized comparison key. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function resolveDeclaredWrite(
  existing: FieldRecord | null,
  inc: { value: string; source: string; at: Date },
): WriteDecision {
  if (!existing || existing.provenance === 'declared') {
    if (existing && existing.value === inc.value) return { action: 'noop' }
    return { action: 'write', next: { value: inc.value, provenance: 'declared', source: inc.source, recordedAt: inc.at } }
  }
  return normalizeForMatch(existing.value) === normalizeForMatch(inc.value)
    ? { action: 'noop' }
    : { action: 'reject', reason: 'field_verified_immutable' }
}

export function resolveVerifiedWrite(
  existing: FieldRecord | null,
  inc: { value: string; source: string; evidenceRef: string; at: Date },
): WriteDecision {
  const next: FieldRecord = { value: inc.value, provenance: 'verified', source: inc.source, evidenceRef: inc.evidenceRef, recordedAt: inc.at }
  if (existing?.provenance === 'declared' && normalizeForMatch(existing.value) !== normalizeForMatch(inc.value)) {
    return { action: 'write', next: { ...next, provenance: 'conflict', conflictValue: existing.value, conflictSource: existing.source } }
  }
  return { action: 'write', next }
}

export function mergeFieldRecords(a: FieldRecord | null, b: FieldRecord | null): FieldRecord | null {
  if (!a) return b
  if (!b) return a
  const rank = (r: FieldRecord) => (r.provenance === 'declared' ? 0 : 1)
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b
  if (a.provenance === 'declared') return a.recordedAt >= b.recordedAt ? a : b
  if (normalizeForMatch(a.value) === normalizeForMatch(b.value)) return a.recordedAt >= b.recordedAt ? a : b
  const w = a.recordedAt >= b.recordedAt ? a : b
  const l = w === a ? b : a
  return { ...w, provenance: 'conflict', conflictValue: l.value, conflictSource: l.source }
}
