import { createHash } from 'crypto'

/**
 * Args that carry confirmation intent, not commit content. They are stripped
 * before hashing so a confirmed resubmit hashes identically to its preview
 * call (replay detection keys on MATERIAL args only — #8).
 */
const NON_MATERIAL = new Set(['confirm', 'confirmAcceptance', 'confirmSignature', 'confirmToken'])

export function stripConfirmArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([k]) => !NON_MATERIAL.has(k)))
}

export function materialArgsHash(tool: string, targetRef: string, args: Record<string, unknown>): string {
  const material = Object.fromEntries(Object.entries(stripConfirmArgs(args)).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha256').update(JSON.stringify({ tool, targetRef, material })).digest('hex')
}
