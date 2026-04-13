import { describe, it, expect } from 'vitest'
import { getToolsForLLM } from '@/lib/tools/registry'

describe('getToolsForLLM deterministic ordering', () => {
  it('returns tools sorted by name', () => {
    const tools = getToolsForLLM()
    const names = tools.map(t => t.function.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('returns same order on repeated calls', () => {
    const names1 = getToolsForLLM().map(t => t.function.name)
    const names2 = getToolsForLLM().map(t => t.function.name)
    expect(names1).toEqual(names2)
  })
})
