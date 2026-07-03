import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, legality, turn } from './export-helpers'

const postCommit = (commitLedgerId: string, state: Record<string, unknown>) => ({
  point: 'post_commit', engineVersion: 'test-x', contentVersions: [], snapshot: {},
  commitLedgerId, state, actions: { available: [], blocked: [] },
})

describe('envelope/legality diagnostic checks (v2)', () => {
  it('blocked_action_attempted: an applied ledger commit whose tool was blocked at turn start (commitLedgerId join, erratum 3)', () => {
    const e = makeExport({
      turns: [turn(0, { legality: [
        ...legality({ phase: 'QUOTE', quote: { id: 'q1' } }, { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' }] }),
        postCommit('l1', { phase: 'PAYMENT', schedule: { exists: true } }),
      ] })] as never,
      ledger: [{ id: 'l1', tool: 'accept_quote', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'QUOTE', phaseTo: 'PAYMENT', idempotencyDisposition: 'fresh', targetRef: 'q1', createdAt: 'x' }] as never,
    })
    expect(runDiagnostics(e).find((x) => x.checkId === 'blocked_action_attempted')).toMatchObject({ severity: 'error', evidence: { tool: 'accept_quote', reason: 'requires_disclosures' } })
  })
  it('missing_consequences: a successful writing tool call with no ledger row in its conversation', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }] })] as never, ledger: [] })
    expect(runDiagnostics(e).find((x) => x.checkId === 'missing_consequences')).toMatchObject({ severity: 'error', evidence: { tool: 'sign_dnt' } })
  })
  it('recompute_drift: same-engine-version recomputation disagrees with the stored derivation (opt-in, erratum 2)', () => {
    const drifting = () => ({ state: { phase: 'APPLICATION', application: { id: 'a1' } }, actions: { available: [], blocked: [] } })
    const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'QUOTE', quote: { id: 'q1' } }) })] as never })
    const f = runDiagnostics(e, undefined, { derive: drifting as never, currentEngineVersion: 'test-x' })
    expect(f.find((x) => x.checkId === 'recompute_drift')?.severity).toBe('error')
    // without recompute options the check never runs (erratum 2: opt-in)
    expect(runDiagnostics(e).some((x) => x.checkId === 'recompute_drift')).toBe(false)
  })
})
