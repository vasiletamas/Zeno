/**
 * T8 (design 2026-07-15 §3.4): `_autoChain` single-hop — a commit handler may
 * declare data._autoChain = {tool, args}; the orchestrator executes that ONE
 * follow-up through the normal pipeline before the LLM rounds. This unit
 * tests the extraction seam: only an APPLIED envelope chains, the shape is
 * validated defensively, args default to {}.
 */
import { describe, it, expect } from 'vitest'
import { extractAutoChain } from '@/lib/chat/synthetic-turn'
import type { ToolResult } from '@/lib/tools/types'

const applied = (data: Record<string, unknown>): ToolResult => ({
  success: true,
  data,
  envelope: { outcome: 'applied', effects: [], data },
})

describe('extractAutoChain (T8 §3.4)', () => {
  it('returns {tool, args} from an applied envelope carrying _autoChain', () => {
    const r = applied({ _autoChain: { tool: 'start_channel_verification', args: { channel: 'email' } } })
    expect(extractAutoChain(r)).toEqual({ tool: 'start_channel_verification', args: { channel: 'email' } })
  })
  it('args default to {} when the declaration omits them', () => {
    expect(extractAutoChain(applied({ _autoChain: { tool: 'get_current_state' } }))).toEqual({ tool: 'get_current_state', args: {} })
  })
  it('returns null when there is no _autoChain', () => {
    expect(extractAutoChain(applied({ foo: 1 }))).toBeNull()
  })
  it('returns null on a non-applied envelope — a rejected/confirm commit never chains', () => {
    const r: ToolResult = { success: false, data: { _autoChain: { tool: 'x', args: {} } }, envelope: { outcome: 'requires_confirmation', effects: [], data: { _autoChain: { tool: 'x', args: {} } } } }
    expect(extractAutoChain(r)).toBeNull()
  })
  it('returns null when there is no envelope at all (reads never chain)', () => {
    expect(extractAutoChain({ success: true, data: { _autoChain: { tool: 'x', args: {} } } })).toBeNull()
  })
  it('returns null on malformed declarations (non-object, missing/empty tool)', () => {
    expect(extractAutoChain(applied({ _autoChain: 'start_channel_verification' }))).toBeNull()
    expect(extractAutoChain(applied({ _autoChain: { args: {} } }))).toBeNull()
    expect(extractAutoChain(applied({ _autoChain: { tool: '', args: {} } }))).toBeNull()
  })
})
