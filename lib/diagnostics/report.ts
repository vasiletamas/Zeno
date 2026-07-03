/**
 * Pure report formatting for the diagnose-conversation CLI (F4.4).
 */
import type { Finding, FindingSeverity } from './types'

export function formatFindingsTable(conversationId: string, findings: Finding[]): string {
  const header = `── ${conversationId} ──`
  if (findings.length === 0) return `${header}\n  ✓ no findings`
  const rows = findings.map((f) =>
    `  ${f.severity.padEnd(5)} | ${f.checkId.padEnd(28)} | ${f.turn === null ? '—     ' : `turn ${f.turn}`} | ${JSON.stringify(f.evidence)}`)
  return [header, ...rows].join('\n')
}

export function summarize(findings: Finding[]): Record<FindingSeverity, number> {
  const out: Record<FindingSeverity, number> = { error: 0, warn: 0, info: 0 }
  for (const f of findings) out[f.severity]++
  return out
}
