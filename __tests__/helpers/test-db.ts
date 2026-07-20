import { prisma } from '@/lib/db'
import { ensurePartialUniqueIndexes } from '@/prisma/seeds/partial-indexes'
import { seedProduct } from '@/prisma/seeds/seed-product'
import { seedProductContent } from '@/prisma/seeds/seed-product-content'
import { seedQuestions } from '@/prisma/seeds/seed-questions'
import { seedDependencyEdges } from '@/prisma/seeds/seed-dependency-edges'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { openDntSession, writeDntAnswer, signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { answerAllDntQuestions } from './dnt-fixtures'

/**
 * The ONE truncate list for the real-DB integration ring (plan A2.ADD-1).
 * Later packages APPEND table names here — never create a second list.
 * Order is irrelevant: TRUNCATE ... CASCADE follows FKs (which also empties
 * dependents like User/Referral/WorkflowSession/ConversationScore/
 * SimulationConversation via their references into this set).
 */
export const DOMAIN_TABLES: string[] = [
  'ProductContent',
  'Document',
  'SuitabilityWarningAck',
  'CustomerDocument',
  'VerificationChallenge',
  'WorkItem',
  'DntAnswer',
  'Dnt',
  'DntSession',
  'ConsentEvent',
  'PurchaseIntent',
  'CustomerProfileField',
  'ProfileFieldDeferral',
  'CommitLedger',
  'DisclosureAck',
  'PaymentEvent',
  'Payment',
  'Installment',
  'PaymentSchedule',
  'Policy',
  'Quote',
  'Answer',
  'Application',
  'Message',
  'ConversationSummary',
  'TurnTrace',
  'TurnDebug',
  'Conversation',
  'CustomerInsight',
  'Customer',
]

export async function resetFunnelTables(): Promise<void> {
  // B0.1 guard: refuse to truncate anything that isn't opted in as a test DB.
  if (!process.env.DATABASE_URL?.includes('test') && process.env.ZENO_ALLOW_DB_TESTS !== '1') {
    throw new Error('refusing truncate: not a test DB (set ZENO_ALLOW_DB_TESTS=1 or use a *test* DATABASE_URL)')
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${DOMAIN_TABLES.map((t) => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`,
  )
}

/**
 * Truncate every domain table, then restore catalog data (product catalog +
 * question groups) via the idempotent seed entrypoints, on the SAME '@/lib/db'
 * client the code under test uses (single-client rule — never a second client
 * via the `datasources` constructor option).
 */
export async function resetDb(): Promise<void> {
  await resetFunnelTables()
  // partial unique indexes the runtime relies on (idempotent) — guarantees the
  // ring has them regardless of how this test DB was bootstrapped (P0-3).
  await ensurePartialUniqueIndexes(prisma)
  await seedProduct(prisma)
  await seedProductContent(prisma)
  await seedQuestions(prisma)
  await seedDependencyEdges(prisma)
}

export async function createCustomer(data: Record<string, unknown> = {}) {
  return prisma.customer.create({ data: { language: 'ro', ...data } })
}

/**
 * Minimal protect fixture for C-block integration tests (C1.4, erratum 4
 * contract): one Customer + Conversation + OPEN Application against the
 * seeded protect catalog. Options pre-select coverage facets (tier/level by
 * CODE, addon boolean). Call resetDb() first — questions/edges come from the
 * real seed.
 */
export async function seedMinimalProtectFixture(options: { tier?: string; level?: string; addon?: boolean } = {}) {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const tier = options.tier
    ? await prisma.pricingTier.findUniqueOrThrow({ where: { productId_code: { productId: product.id, code: options.tier } } })
    : null
  const level = options.level
    ? await prisma.pricingLevel.findUniqueOrThrow({ where: { tierId_code: { tierId: (tier ?? (() => { throw new Error('level requires tier') })()).id, code: options.level } } })
    : null

  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const application = await prisma.application.create({
    data: {
      customerId: customer.id,
      productId: product.id,
      status: 'OPEN',
      tierId: tier?.id ?? null,
      levelId: level?.id ?? null,
      includesAddon: options.addon ?? false,
    },
  })
  const conversation = await prisma.conversation.create({
    data: { customerId: customer.id, productId: product.id, activeApplicationId: application.id },
  })
  await prisma.application.update({
    where: { id: application.id },
    data: { originConversationId: conversation.id },
  })

  const questions = await prisma.question.findMany({ select: { id: true, code: true } })
  const questionIdByCode: Record<string, string> = {}
  for (const q of questions) if (q.code) questionIdByCode[q.code] = q.id

  return { conversationId: conversation.id, applicationId: application.id, customerId: customer.id, questionIdByCode }
}

/** Erratum 4: thin wrapper over A1's snapshot loader for integration tests. */
export async function loadSnapshot(conversationId: string) {
  return loadDomainSnapshot(conversationId)
}

/**
 * C3.4 (C errata 1): open a DNT session, write the given facts through the
 * real B2 surface, fill the remaining visible questions with defaults and
 * sign — leaving the customer with an ACTIVE Dnt whose facts drive the
 * suitability verdict. Facts are written FIRST so the default-filler never
 * overwrites them (write order matters for gated questions: put the gate
 * first, e.g. DNT_LIFE_SUBTYPE before DNT_LIFE_SEVERE_CONDITIONS).
 */
export async function signDntWithFacts(
  fx: { customerId: string; conversationId: string },
  facts: Record<string, string>,
): Promise<void> {
  // actor 'gui': fixture facts are the CUSTOMER's scripted input (P0-1 guard bypass)
  const ctx = { customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as import('@/lib/tools/types').ToolContext
  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`signDntWithFacts: open_dnt_session failed: ${opened.error}`)
  for (const [questionCode, value] of Object.entries(facts)) {
    const w = await writeDntAnswer({ questionCode, value }, ctx)
    if (!w.success) throw new Error(`signDntWithFacts: write_dnt_answer(${questionCode}) failed: ${w.error}`)
  }
  await answerAllDntQuestions(fx.customerId, fx.conversationId)
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`signDntWithFacts: sign_dnt failed: ${signed.error}`)
}

export async function ensureTestProduct() {
  const existing = await prisma.product.findFirst({ where: { code: 'protect' } })
  if (existing) return existing
  return prisma.product.create({
    data: {
      code: 'protect',
      name: { ro: 'Protect', en: 'Protect' },
      description: { ro: '-', en: '-' },
      insuranceType: 'LIFE',
      subType: 'TERM',
      eligibility: {},
      defaultPlaybook: '-',
      targetCustomer: '-',
      contractTerm: '-',
      gracePeriod: '-',
      territoryCoverage: 'RO',
      isActive: true,
    },
  })
}

/**
 * C3.6 (C errata 1): a DRAFT ("issued" until D1 renames the status) Quote
 * row for the fixture's application — the report generator's anchor.
 */
export async function issueTestQuote(fx: { customerId: string; applicationId: string }): Promise<string> {
  const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
  const quote = await prisma.quote.create({
    data: {
      applicationId: fx.applicationId,
      productId: app.productId,
      customerId: fx.customerId,
      premiumAnnual: 190,
      premiumMonthly: 15.83,
      coverages: {},
      status: 'ISSUED',
      validUntil: new Date(Date.now() + 30 * 86400e3),
    },
  })
  return quote.id
}
