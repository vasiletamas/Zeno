/**
 * Dependency graph (C1.1, contradiction #4) — PURE, no prisma. ONE typed
 * graph spans answers AND selection facets in node-key form
 * ('answer:<code>' | 'selection:<facet>'), replacing the legacy
 * parentQuestionId/showWhenValue mechanism (retired in C1.8). A question is
 * visible iff EVERY VISIBILITY edge with it as subject is satisfied (AND).
 */

export type SelectionFacet = 'tier' | 'level' | 'addon'
export type NodeKey = `answer:${string}` | `selection:${SelectionFacet}`
export type DependencyKind = 'VISIBILITY' | 'VALIDITY' | 'ELIGIBILITY'
export type EdgePredicate =
  | { op: 'equals'; value: string }
  | { op: 'not_equals'; value: string }
  | { op: 'in'; value: string[] }
  | { op: 'is_true' }
  | { op: 'is_false' }
  | { op: 'any_answered' }
export interface DependencyEdge {
  subjectKey: NodeKey
  dependsOnKey: NodeKey
  kind: DependencyKind
  predicate: EdgePredicate
}
export interface GraphFacts {
  answers: Record<string, string>
  selection: { tier: string | null; level: string | null; addon: boolean | null }
}

function normalizeBoolean(value: string): string | null {
  const lower = value.toLowerCase().trim()
  if (['true', 'yes', 'da', '1'].includes(lower)) return 'true'
  if (['false', 'no', 'nu', '0'].includes(lower)) return 'false'
  return null
}

export function nodeValue(key: NodeKey, facts: GraphFacts): string | null {
  if (key.startsWith('answer:')) {
    return facts.answers[key.slice('answer:'.length)] ?? null
  }
  const facet = key.slice('selection:'.length) as SelectionFacet
  const v = facts.selection[facet]
  if (v === null || v === undefined) return null
  return typeof v === 'boolean' ? String(v) : v
}

export function evaluatePredicate(predicate: EdgePredicate, value: string | null): boolean {
  if (value === null) return false
  switch (predicate.op) {
    case 'equals': return value === predicate.value
    case 'not_equals': return value !== predicate.value
    case 'in': return predicate.value.includes(value)
    case 'is_true': return normalizeBoolean(value) === 'true'
    case 'is_false': return normalizeBoolean(value) === 'false'
    case 'any_answered': return true
  }
}

export function edgeSatisfied(edge: DependencyEdge, facts: GraphFacts): boolean {
  return evaluatePredicate(edge.predicate, nodeValue(edge.dependsOnKey, facts))
}

/** Canonical visible set: a question is visible iff EVERY VISIBILITY edge with it as subject is satisfied. */
export function computeVisibleSet(
  graph: DependencyEdge[],
  questionCodes: string[],
  facts: GraphFacts,
): Set<string> {
  const visible = new Set<string>()
  for (const code of questionCodes) {
    const edges = graph.filter(e => e.kind === 'VISIBILITY' && e.subjectKey === `answer:${code}`)
    if (edges.every(e => edgeSatisfied(e, facts))) visible.add(code)
  }
  return visible
}
