/**
 * Protect's canonical dependency edges (C1.2, contradiction #4):
 * selection:level VALIDITY-depends-on selection:tier; every bd_* question
 * VISIBILITY-gates on selection:addon; selection:addon
 * ELIGIBILITY-depends-on every bd_* answer being false; the one legacy
 * parentQuestionId edge (DNT sustainability) migrates into the graph.
 */
import { PrismaClient } from '../../lib/generated/prisma/client'
import type { DependencyEdge } from '../../lib/engines/dependency-graph'

const BD_CODES = ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT'] as const

export const PROTECT_DEPENDENCY_EDGES: DependencyEdge[] = [
  { subjectKey: 'selection:level', dependsOnKey: 'selection:tier', kind: 'VALIDITY', predicate: { op: 'any_answered' } },
  ...BD_CODES.map(c => ({ subjectKey: `answer:${c}`, dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } }) as DependencyEdge),
  ...BD_CODES.map(c => ({ subjectKey: 'selection:addon', dependsOnKey: `answer:${c}`, kind: 'ELIGIBILITY', predicate: { op: 'is_false' } }) as DependencyEdge),
  { subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE', dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] } },
]

export async function seedDependencyEdges(prisma: PrismaClient) {
  const product = await prisma.product.findUnique({ where: { code: 'protect' } })
  if (!product) throw new Error('Product "protect" must be seeded before dependency edges')
  for (const e of PROTECT_DEPENDENCY_EDGES) {
    await prisma.questionDependency.upsert({
      where: { subjectKey_dependsOnKey_kind: { subjectKey: e.subjectKey, dependsOnKey: e.dependsOnKey, kind: e.kind } },
      update: { predicate: e.predicate as object, productId: product.id },
      create: { subjectKey: e.subjectKey, dependsOnKey: e.dependsOnKey, kind: e.kind, predicate: e.predicate as object, productId: product.id },
    })
  }
  console.log(`  Seeded ${PROTECT_DEPENDENCY_EDGES.length} dependency edges`)
}
