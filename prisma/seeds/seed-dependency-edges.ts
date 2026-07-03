/**
 * Protect's canonical dependency edges (C1.2, contradiction #4):
 * selection:level VALIDITY-depends-on selection:tier; every bd_* question
 * VISIBILITY-gates on selection:addon; selection:addon
 * ELIGIBILITY-depends-on every bd_* answer being false; every legacy
 * parentQuestionId gate migrates into the graph — the DNT sustainability
 * chain plus the 15 DNT life questions gated on DNT_LIFE_SUBTYPE (C1.8:
 * the columns are retired, this is THE dependency store, T6.D1).
 */
import { PrismaClient } from '../../lib/generated/prisma/client'
import type { DependencyEdge } from '../../lib/engines/dependency-graph'

const BD_CODES = ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT'] as const

/** dnt_life_financial: shown for both protection-minded subtypes. */
const DNT_LIFE_FINANCIAL_CODES = [
  'DNT_LIFE_NEEDS_PRIORITY', 'DNT_LIFE_FAMILY_INCOME', 'DNT_LIFE_MONTHLY_EXPENSES',
  'DNT_LIFE_INSURANCE_VALIDITY', 'DNT_LIFE_ACCIDENT_COVERAGE', 'DNT_LIFE_ILLNESS_COVERAGE',
  'DNT_LIFE_SEVERE_CONDITIONS', 'DNT_LIFE_INVALIDITY_COVERAGE', 'DNT_LIFE_INDEXATION',
  'DNT_LIFE_PAYMENT_FREQUENCY', 'DNT_LIFE_BUDGET',
] as const

/** dnt_life_investment + sustainability importance: investment subtype only. */
const DNT_LIFE_INVESTMENT_CODES = [
  'DNT_LIFE_INVEST_KNOWLEDGE', 'DNT_LIFE_INVEST_OBJECTIVES', 'DNT_LIFE_RISK_TOLERANCE',
  'DNT_SUSTAINABILITY_IMPORTANCE',
] as const

export const PROTECT_DEPENDENCY_EDGES: DependencyEdge[] = [
  { subjectKey: 'selection:level', dependsOnKey: 'selection:tier', kind: 'VALIDITY', predicate: { op: 'any_answered' } },
  ...BD_CODES.map(c => ({ subjectKey: `answer:${c}`, dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } }) as DependencyEdge),
  ...BD_CODES.map(c => ({ subjectKey: 'selection:addon', dependsOnKey: `answer:${c}`, kind: 'ELIGIBILITY', predicate: { op: 'is_false' } }) as DependencyEdge),
  ...DNT_LIFE_FINANCIAL_CODES.map(c => ({ subjectKey: `answer:${c}`, dependsOnKey: 'answer:DNT_LIFE_SUBTYPE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['financial_protection', 'financial_and_investment'] } }) as DependencyEdge),
  ...DNT_LIFE_INVESTMENT_CODES.map(c => ({ subjectKey: `answer:${c}`, dependsOnKey: 'answer:DNT_LIFE_SUBTYPE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['financial_and_investment'] } }) as DependencyEdge),
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
