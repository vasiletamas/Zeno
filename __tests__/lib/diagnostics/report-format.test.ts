import { describe, it, expect } from 'vitest'
import { formatFindingsTable, summarize } from '@/lib/diagnostics/report'

const findings = [
  { checkId: 'tool_call_failed', severity: 'error' as const, turn: 2, evidence: { tool: 'sign_dnt' } },
  { checkId: 'latency_outlier', severity: 'warn' as const, turn: 5, evidence: { latencyMs: 31000 } },
]

describe('diagnostics report formatting', () => {
  it('renders a stable table and a severity summary', () => {
    const table = formatFindingsTable('c1', findings)
    expect(table).toContain('tool_call_failed')
    expect(table).toContain('turn 2')
    expect(summarize(findings)).toEqual({ error: 1, warn: 1, info: 0 })
  })
  it('renders a clean row for zero findings', () => {
    expect(formatFindingsTable('c1', [])).toContain('no findings')
    expect(summarize([])).toEqual({ error: 0, warn: 0, info: 0 })
  })
})
