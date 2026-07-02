import { describe, it, expect } from 'vitest'
import { getToolDefinition } from '@/lib/tools/registry'

// A5.ADD-1 (closes G5): the two background stubs were registered but their
// handlers only returned 'Not yet implemented' — dead surface. The real
// extractor/summarizer run outside the tool registry.
describe('dead registered stubs are gone', () => {
  it('profile_extractor is not registered', () => {
    expect(getToolDefinition('profile_extractor')).toBeUndefined()
  })
  it('summarizer is not registered', () => {
    expect(getToolDefinition('summarizer')).toBeUndefined()
  })
})
