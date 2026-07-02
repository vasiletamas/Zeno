import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { getRegisteredToolNames, getToolDefinition } from '@/lib/tools/registry'
import { ACTION_RULES } from '@/lib/engines/derive-and-expose'

describe('registry hygiene', () => {
  it('no alwaysAllowed metadata survives — exposure has exactly one authority', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../lib/tools/registry.ts'), 'utf8')
    expect(src).not.toMatch(/alwaysAllowed/)
    expect(src).not.toMatch(/REGISTER ALL 25 TOOLS/)
  })
  it('every non-internal registered tool has an exposure rule, and every rule names a registered tool', () => {
    const registered = getRegisteredToolNames().filter((n) => getToolDefinition(n)?.kind !== 'internal')
    const ruled = ACTION_RULES.map((r) => r.action)
    expect([...registered].sort()).toEqual([...ruled].sort())
  })
})
