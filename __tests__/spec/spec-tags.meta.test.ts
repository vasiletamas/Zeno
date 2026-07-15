import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { SPEC_ID_RE } from '@/lib/spec/registry'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const CLASS_TAGS = ['@engine', '@agent', '@agent-judge']

describe('spec tagging (T12.D2 — per-scenario classification committed as data)', () => {
  it('every scenario carries exactly one valid, unique @id: tag', () => {
    const ids: string[] = []
    for (const s of parsed.scenarios) {
      const idTags = s.tags.filter((t) => t.startsWith('@id:'))
      expect(idTags, `"${s.name}" needs exactly one @id:`).toHaveLength(1)
      const id = idTags[0].slice(4)
      expect(id, `bad id on "${s.name}"`).toMatch(SPEC_ID_RE)
      ids.push(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every scenario carries exactly one primary class tag', () => {
    for (const s of parsed.scenarios) {
      expect(s.tags.filter((t) => CLASS_TAGS.includes(t)), `"${s.name}" class`).toHaveLength(1)
    }
  })
  it('@agent-judge scenarios are never simultaneously @backlog', () => {
    for (const s of parsed.scenarios.filter((x) => x.tags.includes('@agent-judge'))) {
      expect(s.tags, s.name).not.toContain('@backlog')
    }
  })
})
