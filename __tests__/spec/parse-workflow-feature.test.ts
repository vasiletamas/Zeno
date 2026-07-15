import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { splitFeatures, parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'

const TWO = `# header\n@one\nFeature: First\n  Scenario: A\n    Given x\n\n@two @extra\nFeature: Second\n  Scenario Outline: B\n    Given <v>\n    Examples:\n      | v | consequence |\n      | 1 | applied     |\n      | 2 | re_rating   |\n`

describe('splitFeatures', () => {
  it('splits a multi-Feature document into chunks owning their tag lines', () => {
    const chunks = splitFeatures(TWO)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toContain('@one')
    expect(chunks[0]).not.toContain('Feature: Second')
    expect(chunks[1]).toContain('@two @extra')
  })
})

describe('parseWorkflowFeature', () => {
  it('extracts features, scenarios, tags, steps and Examples rows', () => {
    const p = parseWorkflowFeature(TWO)
    expect(p.features.map((f) => f.name)).toEqual(['First', 'Second'])
    const b = p.scenarios.find((s) => s.name === 'B')!
    expect(b.isOutline).toBe(true)
    expect(b.examples[0].header).toEqual(['v', 'consequence'])
    expect(b.examples[0].rows).toHaveLength(2)
    expect(b.featureTags).toEqual(['@two', '@extra'])
  })
  it('fails loudly on malformed gherkin (no silent skip)', () => {
    expect(() => parseWorkflowFeature('Feature: x\n  Scenario: y\n    | bare table |\n')).toThrow()
    expect(() => parseWorkflowFeature('# only comments, no Feature\n')).toThrow()
  })
  // The delivered spec (2026-07-03) differs from the plan's June grounding:
  // the modify-answer outline grew a 5th row (requires_confirmation) and the
  // quote-generation outline split its 4 rows into a live 2-row block plus a
  // @backlog-tagged 2-row block. The file is normative; the pin follows it.
  it('parses the real spec: 9 features, 61 scenarios, outline example rows 2+2+5', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8')
    const p = parseWorkflowFeature(src)
    expect(p.features).toHaveLength(9)
    expect(p.scenarios).toHaveLength(61)
    expect(p.scenarios.filter((s) => s.isOutline).flatMap((s) => s.examples).map((e) => e.rows.length).sort()).toEqual([2, 2, 5])
  })
})
