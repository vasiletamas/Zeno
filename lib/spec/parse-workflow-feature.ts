/**
 * Multi-Feature Gherkin parsing for zeno_workflow.feature (F1.1, T12).
 *
 * The workflow spec holds 9 Feature blocks in ONE file; standard Gherkin
 * allows one Feature per document, so splitFeatures cuts the source into
 * per-Feature chunks (each owning its preceding tag/comment/blank lines)
 * and parseWorkflowFeature runs @cucumber/gherkin over each chunk. Parse
 * errors propagate — the meta-suite fails loudly, never skips silently.
 */
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'

export interface ParsedExamplesBlock { tags: string[]; header: string[]; rows: string[][] }
export interface ParsedFeature { name: string; tags: string[] }
export interface ParsedScenario {
  featureName: string
  featureTags: string[]
  name: string
  tags: string[]
  isOutline: boolean
  steps: string[]
  examples: ParsedExamplesBlock[]
}
export interface ParsedWorkflow { features: ParsedFeature[]; scenarios: ParsedScenario[] }

export function splitFeatures(source: string): string[] {
  const lines = source.split(/\r?\n/)
  const starts: number[] = []
  lines.forEach((l, i) => { if (/^Feature:/.test(l)) starts.push(i) })
  const owned = starts.map((start) => {
    let s = start
    while (s > 0 && /^(\s*@|\s*#|\s*$)/.test(lines[s - 1])) s--
    return s
  })
  return starts.map((_, k) =>
    lines.slice(owned[k], k + 1 < starts.length ? owned[k + 1] : lines.length).join('\n'))
}

export function parseWorkflowFeature(source: string): ParsedWorkflow {
  const chunks = splitFeatures(source)
  if (chunks.length === 0) throw new Error('No Feature blocks found in workflow spec')
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher())
  const features: ParsedFeature[] = []
  const scenarios: ParsedScenario[] = []
  for (const chunk of chunks) {
    const doc = parser.parse(chunk) // parse errors propagate — the meta-suite fails loudly
    const feature = doc.feature
    if (!feature) throw new Error('Chunk parsed without a feature')
    const featureTags = feature.tags.map((t) => t.name)
    features.push({ name: feature.name, tags: featureTags })
    for (const child of feature.children) {
      const sc = child.scenario
      if (!sc) continue
      // Strictness: gherkin swallows stray content (e.g. a bare table) as a
      // scenario "description", leaving a step-less scenario — for this spec
      // that is malformed input, and it must fail loudly, not parse to noise.
      if (sc.steps.length === 0) {
        throw new Error(`Scenario "${sc.name}" in feature "${feature.name}" has no steps — malformed gherkin`)
      }
      scenarios.push({
        featureName: feature.name,
        featureTags,
        name: sc.name,
        tags: sc.tags.map((t) => t.name),
        isOutline: sc.examples.length > 0,
        steps: sc.steps.map((s) => `${s.keyword}${s.text}`),
        examples: sc.examples.map((ex) => ({
          tags: ex.tags.map((t) => t.name),
          header: ex.tableHeader?.cells.map((c) => c.value) ?? [],
          rows: (ex.tableBody ?? []).map((r) => r.cells.map((c) => c.value)),
        })),
      })
    }
  }
  return { features, scenarios }
}
