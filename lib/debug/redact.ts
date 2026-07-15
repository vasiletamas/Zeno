/**
 * Snapshot redaction (F2.1, T14.D5) — defense-in-depth. The DomainSnapshot
 * is DESIGNED to carry derived facts, not raw PII (the loader's identity
 * slice is provenance-only; age is derived), so this pass normally changes
 * nothing. It exists to strip any raw identity string that slips in through
 * a future loader change, preserving provenance states and derived facts so
 * recompute-and-diff replay still works on the stored snapshot.
 */
import { maskCnp } from '@/lib/security/encryption'

const PII_KEYS = new Set(['cnp', 'email', 'phone', 'name', 'value', 'target'])
const IDENTITY_SCOPE_KEYS = new Set(['customer', 'identity', 'fields'])

// Task 5.4 (D11): a CNP is exactly 13 digits — mask the shape ANYWHERE in
// the payload (dnt facts, typed answers), bare or embedded in prose.
const CNP_SHAPE = /(?<!\d)\d{13}(?!\d)/g
export function maskCnpShapes(s: string): string {
  return s.replace(CNP_SHAPE, (m) => maskCnp(m))
}

export function redactSnapshot(snapshot: unknown): unknown {
  const walk = (node: unknown, inIdentity: boolean): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, inIdentity))
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        const identityScope = inIdentity || IDENTITY_SCOPE_KEYS.has(k)
        if (identityScope && PII_KEYS.has(k) && typeof v === 'string') out[k] = '[redacted]'
        else out[k] = walk(v, identityScope)
      }
      return out
    }
    if (typeof node === 'string') return maskCnpShapes(node)
    return node
  }
  return walk(snapshot, false)
}
