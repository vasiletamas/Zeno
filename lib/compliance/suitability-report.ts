/**
 * Quote-keyed suitability report (C3.6, M7 — IDD timing: generated AT
 * QUOTE ISSUANCE, not post-policy). Embeds the engine verdict of record
 * computed from the signed DNT facts, registers the PDF in the Document
 * registry (D2 contract) keyed to the quote.
 *
 * Wired into generate_quote's apply at D1 (the M9 flip): the post-payment
 * generateDntReport call died in the same package — one report path,
 * never zero or two.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { evaluateSuitability, parseSuitabilityRuleSet, type SuitabilityResult } from '@/lib/engines/suitability'
import { createDocument } from '@/lib/documents/registry'
import { buildSuitabilityPdf } from './dnt-report-pdf'

type Db = typeof prisma | Prisma.TransactionClient

/** The signed Dnt's answers (questionCode → value) via B1's aggregate. */
async function loadDntFacts(customerId: string, db: Db): Promise<Record<string, string>> {
  const signedDnt = await db.dnt.findFirst({
    where: { customerId, status: 'ACTIVE' },
    orderBy: { signedAt: 'desc' },
    include: { sourceSession: { include: { answers: { include: { question: { select: { code: true } } } } } } },
  })
  if (!signedDnt) return {}
  return Object.fromEntries(
    signedDnt.sourceSession.answers.filter((a) => a.question.code).map((a) => [a.question.code as string, a.value]),
  )
}

export async function generateSuitabilityReport(quoteId: string, db: Db = prisma): Promise<{
  buffer: Buffer
  documentId: string
  meta: { verdict: SuitabilityResult['verdict']; ruleSetVersion: number }
}> {
  const quote = await db.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { product: true, customer: true, application: { include: { tier: true, level: true } } },
  })
  const ruleSet = parseSuitabilityRuleSet(quote.product.suitabilityRules)
  const dntFacts = await loadDntFacts(quote.customerId, db)
  const result = evaluateSuitability(ruleSet, dntFacts)
  const buffer = await buildSuitabilityPdf({
    quote: {
      id: quote.id, premiumAnnual: quote.premiumAnnual, premiumMonthly: quote.premiumMonthly,
      currency: quote.currency, createdAt: quote.createdAt,
      product: { name: quote.product.name, code: quote.product.code },
      customer: { name: quote.customer.name, email: quote.customer.email },
      application: quote.application
        ? { tier: quote.application.tier, level: quote.application.level, includesAddon: quote.application.includesAddon }
        : null,
    },
    dntFacts,
    result,
    ruleSetVersion: ruleSet.version,
    language: 'ro',
  })
  const doc = await createDocument({
    kind: 'SUITABILITY_REPORT',
    language: 'ro',
    bytes: buffer,
    source: 'GENERATED',
    customerId: quote.customerId,
    quoteId: quote.id,
    productId: quote.productId,
  }, db)
  return { buffer, documentId: doc.id, meta: { verdict: result.verdict, ruleSetVersion: ruleSet.version } }
}
