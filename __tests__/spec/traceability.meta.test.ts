import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature, type ParsedScenario } from '@/lib/spec/parse-workflow-feature'
import { scanSpecRegistrations } from '@/lib/spec/registry'

const ROOT = process.cwd()
const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(ROOT, 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const registrations = scanSpecRegistrations(path.join(ROOT, '__tests__'))
const idOf = (s: ParsedScenario) => s.tags.find((t) => t.startsWith('@id:'))!.slice(4)
const isBacklog = (s: ParsedScenario) => s.tags.includes('@backlog')
const isJudge = (s: ParsedScenario) => s.tags.includes('@agent-judge')

describe('spec<->test bidirectional traceability (T12.D5)', () => {
  it('every non-backlog, non-judge scenario maps to >=1 registered test', () => {
    const unmapped = parsed.scenarios.filter((s) => !isBacklog(s) && !isJudge(s))
      .map(idOf).filter((id) => !registrations.has(id))
    expect(unmapped, `untranslated scenarios:\n${unmapped.join('\n')}`).toEqual([])
  })
  it('every live Examples block of a mapped outline is covered (bare id = test.each over AST rows)', () => {
    for (const s of parsed.scenarios.filter((x) => x.isOutline && !isBacklog(x) && !isJudge(x))) {
      const id = idOf(s)
      const liveRows = s.examples.filter((e) => !e.tags.includes('@backlog')).reduce((n, e) => n + e.rows.length, 0)
      const rowRegs = [...registrations.keys()].filter((k) => k.startsWith(`${id}#ex`)).length
      expect(registrations.has(id) || rowRegs >= liveRows,
        `outline ${id}: ${liveRows} live rows, bare=${registrations.has(id)}, rowRegs=${rowRegs}`).toBe(true)
    }
  })
  it('no orphan registrations — every registered id exists in the .feature', () => {
    const known = new Set(parsed.scenarios.map(idOf))
    const orphans = [...registrations.keys()].map((id) => id.replace(/#ex\d+$/, '')).filter((id) => !known.has(id))
    expect(orphans, `tests claiming dead scenarios:\n${orphans.join('\n')}`).toEqual([])
  })
  it('REPORTS coverage and writes artifacts/spec-coverage.json (backlog counted, not failed)', () => {
    const byClass = { engine: 0, agent: 0, judge: 0 }
    for (const s of parsed.scenarios) {
      if (s.tags.includes('@engine')) byClass.engine++
      else if (s.tags.includes('@agent-judge')) byClass.judge++
      else byClass.agent++
    }
    const backlogIds = parsed.scenarios.filter(isBacklog).map(idOf)
    const report = {
      generatedAt: new Date().toISOString(),
      scenarios: parsed.scenarios.length,
      cases: parsed.scenarios.reduce((n, s) => n + Math.max(1, s.examples.reduce((m, e) => m + e.rows.length, 0)), 0),
      byClass,
      covered: parsed.scenarios.filter((s) => registrations.has(idOf(s))).length,
      backlog: { count: backlogIds.length, ids: backlogIds },
      judge: { count: parsed.scenarios.filter(isJudge).length, ids: parsed.scenarios.filter(isJudge).map(idOf) },
    }
    fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, 'artifacts/spec-coverage.json'), JSON.stringify(report, null, 2))
    console.log(`[spec-coverage] scenarios=${report.scenarios} covered=${report.covered} backlog=${report.backlog.count} judge=${report.judge.count}`)
    expect(report.scenarios).toBe(61)
  })
})
