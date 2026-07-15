import { describe, it, expect } from 'vitest'
import { buildTurnTools } from '@/lib/chat/turn-tools'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('buildTurnTools — the LLM tool list IS the exposure set', () => {
  it('returns exactly the available actions as LLM tool definitions (registered ones)', () => {
    const { actions } = deriveAndExpose(makeSnapshot())
    const tools = buildTurnTools(actions)
    const names = tools.map((t) => t.function.name)
    for (const n of names) expect(actions.available).toContain(n)
    expect(names).toContain('escalate_to_human') // funnel-regression fix: commits reachable, floor always present
    expect(names).toContain('list_products')
  })
  it('never returns internal tools', () => {
    const { actions } = deriveAndExpose(makeSnapshot())
    const names = buildTurnTools(actions).map((t) => t.function.name)
    expect(names).not.toContain('profile_extractor')
    expect(names).not.toContain('summarizer')
  })
})
