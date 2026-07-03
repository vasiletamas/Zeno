/**
 * The typed dependency graph from its single store (T6.D1) — the impure
 * counterpart to the pure lib/engines/dependency-graph.ts. Kept in its own
 * module so the snapshot loader, questionnaire engine and consequence
 * applier can all load edges without importing each other.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import type { DependencyEdge, DependencyKind, EdgePredicate } from './dependency-graph'

type Db = typeof prisma | Prisma.TransactionClient

export async function loadDependencyGraph(db: Db, productId?: string | null): Promise<DependencyEdge[]> {
  const rows = await db.questionDependency.findMany({
    where: productId ? { OR: [{ productId }, { productId: null }] } : {},
  })
  return rows.map((r) => ({
    subjectKey: r.subjectKey as DependencyEdge['subjectKey'],
    dependsOnKey: r.dependsOnKey as DependencyEdge['dependsOnKey'],
    kind: r.kind as DependencyKind,
    predicate: r.predicate as unknown as EdgePredicate,
  }))
}
