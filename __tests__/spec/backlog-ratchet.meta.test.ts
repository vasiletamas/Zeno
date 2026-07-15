import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'

describe('@backlog ratchet (T12 risk: backlog must not become a permanent escape hatch)', () => {
  it('current backlog count <= committed baseline (decrease the baseline when you translate, never silently grow it)', () => {
    const parsed = parseWorkflowFeature(fs.readFileSync(
      path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
    const current = parsed.scenarios.filter((s) => s.tags.includes('@backlog')).length
    const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs/spec-coverage-baseline.json'), 'utf8'))
    expect(current).toBeLessThanOrEqual(baseline.backlog.count)
  })
})
