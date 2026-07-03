import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { TAXONOMY, PENDING_SPEC_AMENDMENTS } from '@/lib/spec/taxonomy'
import { JUDGE_RUBRICS } from '@/lib/testing/judge/rubrics'

const src = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8')
const parsed = parseWorkflowFeature(src)
const CONSEQUENCE_COLUMNS = ['consequence', 'consequences', 'outcome', 'effects', 'result']

describe('taxonomy closure (T12.D5 §3 — spec, catalog and code welded at CI time)', () => {
  it('every token in a consequence-typed Examples column is a CommitOutcome or CommitEffect', () => {
    const offenders: string[] = []
    for (const s of parsed.scenarios) for (const ex of s.examples) {
      ex.header.forEach((h, col) => {
        if (!CONSEQUENCE_COLUMNS.includes(h.trim().toLowerCase())) return
        for (const row of ex.rows) for (const tok of row[col].split(/[^a-z_]+/).filter((t) => t.length > 2)) {
          if (!(TAXONOMY as readonly string[]).includes(tok)) offenders.push(`${s.name}: ${tok}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
  it('every union member appears in the .feature, modulo the explicit pending-amendment list (emptied by F3)', () => {
    const missing = (TAXONOMY as readonly string[]).filter(
      (m) => !new RegExp(`\\b${m}\\b`).test(src) && !PENDING_SPEC_AMENDMENTS.includes(m))
    expect(missing, `union members the spec never mentions: ${missing.join(', ')}`).toEqual([])
  })
})

describe('@agent-judge <-> rubric closure', () => {
  it('judge scenarios and rubrics are 1:1', () => {
    const judgeIds = parsed.scenarios.filter((s) => s.tags.includes('@agent-judge'))
      .map((s) => s.tags.find((t) => t.startsWith('@id:'))!.slice(4))
    expect([...judgeIds].sort()).toEqual(JUDGE_RUBRICS.map((r) => r.specId).sort())
  })
})
