import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'

const LIB = path.resolve(__dirname, '../../../lib')
function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) { if (!p.includes('generated')) out.push(...tsFiles(p)); continue }
    if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('vocabulary closure (taxonomy-closure seed; full gherkin meta-test is Block F)', () => {
  it('both old vocabulary modules are gone', () => {
    expect(existsSync(path.join(LIB, 'chat/derive-state.ts'))).toBe(false)
    expect(existsSync(path.join(LIB, 'chat/phase.ts'))).toBe(false)
  })
  it('no module under lib/ outside engines/domain-types.ts declares a Phase union or ConversationPhase', () => {
    const offenders = tsFiles(LIB)
      .filter((p) => !p.endsWith(path.join('engines', 'domain-types.ts')))
      .filter((p) => { const src = readFileSync(p, 'utf8'); return /type\s+Phase\s*=/.test(src) || /ConversationPhase/.test(src) })
    expect(offenders).toEqual([])
  })
  it('retired phase literals no longer appear as phase values in lib/', () => {
    const offenders = tsFiles(LIB).filter((p) => /'(SELECTION|CONSENT|CLOSING)'/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
  it('the SkillPack subsystem is gone (M12)', () => {
    expect(existsSync(path.join(LIB, 'skills/skill-pack-loader.ts'))).toBe(false)
    const offenders = tsFiles(LIB).filter((p) => /SkillPack|activeSkillPacks/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
  it('the workflow step machine is gone (T1.D3)', () => {
    const offenders = tsFiles(LIB).filter((p) => /WorkflowSession|WorkflowStep|StepTransition|workflowInstructions/.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })
})
