/**
 * Quote-keyed suitability report (C3.6, M7 — IDD timing: generated AT
 * QUOTE ISSUANCE, not post-policy). Embeds the engine verdict of record
 * computed from the signed DNT facts, registers the PDF in the Document
 * registry (D2 contract) keyed to the quote.
 *
 * EXPLICIT NON-GOAL (M9 coupled flip): lib/payments/post-payment.ts still
 * calls generateDntReport — D1's quote-issuance package wires
 * generateSuitabilityReport(quoteId) into generate_quote's apply AND
 * deletes the post-payment call in the same package, so there is never a
 * window with zero or two report paths.
 */
import { prisma } from '@/lib/db'
import { evaluateSuitability, parseSuitabilityRuleSet, type SuitabilityResult } from '@/lib/engines/suitability'
import { createDocument } from '@/lib/documents/registry'
import { buildSuitabilityPdf } from './dnt-report-pdf'

/** The signed Dnt's answers (questionCode → value) via B1's aggregate. */
async function loadDntFacts(customerId: string): Promise<Record<string, string>> {
  const signedDnt = await prisma.dnt.findFirst({
    where: { customerId, status: 'ACTIVE' },
    orderBy: { signedAt: 'desc' },
    include: { sourceSession: { include: { answers: { include: { question: { select: { code: true } } } } } } },
  })
  if (!signedDnt) return {}
  return Object.fromEntries(
    signedDnt.sourceSession.answers.filter((a) => a.question.code).map((a) => [a.question.code as string, a.value]),
  )
}

export async function generateSuitabilityReport(quoteId: string): Promise<{
  buffer: Buffer
  documentId: string
  meta: { verdict: SuitabilityResult['verdict']; ruleSetVersion: number }
}> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { product: true, customer: true, application: { include: { tier: true, level: true } } },
  })
  const ruleSet = parseSuitabilityRuleSet(quote.product.suitabilityRules)
  const dntFacts = await loadDntFacts(quote.customerId)
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
  })
  return { buffer, documentId: doc.id, meta: { verdict: result.verdict, ruleSetVersion: ruleSet.version } }
}
