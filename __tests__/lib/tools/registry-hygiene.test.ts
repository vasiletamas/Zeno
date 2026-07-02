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
    // Mid-B2 bridge: these actions have engine rules ahead of their tool
    // registration (open_dnt_session/write_dnt_answer land in B2.5). Shrinks
    // back to [] at the package boundary.
    const PENDING_REGISTRATION = ['open_dnt_session']
    const registered = getRegisteredToolNames().filter((n) => getToolDefinition(n)?.kind !== 'internal')
    const ruled = ACTION_RULES.map((r) => r.action).filter((a) => !PENDING_REGISTRATION.includes(a))
    expect([...registered].sort()).toEqual([...ruled].sort())
  })
})
