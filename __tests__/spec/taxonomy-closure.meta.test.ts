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

describe('@judge tag <-> rubric closure (erratum 3 preferred mechanism)', () => {
  it('every @judge:<rubric-id> tag pairs 1:1 with a registry rubric, on the right scenario', () => {
    const tagged = parsed.scenarios
      .filter((s) => s.tags.some((t) => t.startsWith('@judge:')))
      .map((s) => ({
        specId: s.tags.find((t) => t.startsWith('@id:'))!.slice(4),
        rubricId: 'judge/' + s.tags.find((t) => t.startsWith('@judge:'))!.slice('@judge:'.length),
      }))
    expect(tagged.map((t) => t.rubricId).sort()).toEqual(JUDGE_RUBRICS.map((r) => r.id).sort())
    for (const t of tagged) {
      expect(JUDGE_RUBRICS.find((r) => r.id === t.rubricId)?.specId, t.rubricId).toBe(t.specId)
    }
  })
  it('every @agent-judge-primary scenario carries a @judge tag (no rubric-less judge scenarios)', () => {
    for (const s of parsed.scenarios.filter((x) => x.tags.includes('@agent-judge'))) {
      expect(s.tags.some((t) => t.startsWith('@judge:')), s.name).toBe(true)
    }
  })
})
