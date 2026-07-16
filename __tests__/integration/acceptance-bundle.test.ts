/**
 * T23 (P2.9): ONE acceptance card — the get_acceptance_bundle read returns
 * the disclosure documents, the payment-frequency comparison (from the
 * quote's precomputed fields ∩ Product.paymentFrequencyOptions) and the
 * disclosuresAcked flag, riding a show_acceptance uiAction (reads CAN carry
 * a uiAction: the executor returns the handler ToolResult directly and the
 * orchestrator emits ui_action for any toolResult.uiAction, both paths).
 *
 * Evidence (2026-07-15 live test): acknowledge_disclosures was committed via
 * TYPED prose; payment frequency was a blind prose question; the QuoteCard's
 * Accept hard-coded paymentOption:'annual'.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildIssuedQuote, buildReadyApplication, buildAcceptReadyQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { getAcceptanceBundle } from '@/lib/tools/handlers/quote-handlers'
import { seedDocuments } from '@/prisma/seeds/seed-documents'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { INSTALLMENTS_BY_FREQUENCY } from '@/lib/engines/payment-schedule'

interface BundlePayload {
  quoteId: string
  premium: { annual: number; semiAnnual: number | null; quarterly: number | null; currency: string }
  frequencies: { option: string; perInstallment: number; installments: number; totalPerYear: number }[]
  documents: { id: string; kind: string; title: { en: string; ro: string }; url: string }[]
  disclosuresAcked: boolean
}

describe('get_acceptance_bundle (T23)', () => {
  beforeEach(async () => { await resetDb(); await seedDocuments(prisma) })

  it('(a) returns the bundle + show_acceptance card for an ISSUED quote', async () => {
    const fx = await buildIssuedQuote()
    const res = await getAcceptanceBundle({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(true)
    expect(res.uiAction?.type).toBe('show_acceptance')

    const p = res.uiAction!.payload as unknown as BundlePayload
    expect(p.quoteId).toBe(fx.quoteId)

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(p.premium).toEqual({
      annual: quote.premiumAnnual,
      semiAnnual: quote.premiumSemiAnnual,
      quarterly: quote.premiumQuarterly,
      currency: quote.currency,
    })

    // frequencies = Product.paymentFrequencyOptions ∩ the quote's priced
    // variants — protect offers all three sellable options (no monthly)
    expect(p.frequencies.map((f) => f.option).sort()).toEqual(['annual', 'quarterly', 'semi_annual'])
    for (const row of p.frequencies) {
      expect(row.installments).toBe(INSTALLMENTS_BY_FREQUENCY[row.option as keyof typeof INSTALLMENTS_BY_FREQUENCY])
      expect(row.totalPerYear).toBe(Math.round(row.perInstallment * row.installments * 100) / 100)
    }
    const annual = p.frequencies.find((f) => f.option === 'annual')!
    expect(annual.perInstallment).toBe(quote.premiumAnnual)
    expect(annual.totalPerYear).toBe(quote.premiumAnnual)

    // documents = the seeded IPID+TERMS rows for the product+language,
    // plain registry URLs (the card renders plain <a target="_blank">)
    const seeded = await prisma.document.findMany({ where: { productId: quote.productId, language: 'ro' } })
    expect(p.documents.map((d) => d.kind).sort()).toEqual(['IPID', 'TERMS'])
    for (const doc of p.documents) {
      expect(seeded.map((s) => s.id)).toContain(doc.id)
      expect(doc.url).toBe(`/api/documents/${doc.id}`)
      expect(doc.title.ro.length).toBeGreaterThan(0)
      expect(doc.title.en.length).toBeGreaterThan(0)
    }

    expect(p.disclosuresAcked).toBe(false)
    // the data facet mirrors the card payload (model-facing grounding)
    expect((res.data as unknown as BundlePayload).quoteId).toBe(fx.quoteId)
  })

  it('(b) after a gui acknowledge_disclosures commit the bundle reads disclosuresAcked true and the ack re-emits the card', async () => {
    const fx = await buildIssuedQuote()
    const ack = await executeCommit({
      tool: 'acknowledge_disclosures', args: {}, actor: 'gui',
      customerId: fx.customerId, conversationId: fx.conversationId,
      toolContext: fixtureCtx(fx.customerId, fx.conversationId),
    })
    expect(ack.outcome).toBe('applied')
    // the ack turn re-emits the acceptance card (the checkbox click marks the
    // old card answered — the fresh card renders checked+disabled, Accept
    // gated only on the frequency choice)
    const emitted = (ack.data as Record<string, unknown>)._uiAction as { type: string; payload: BundlePayload } | undefined
    expect(emitted?.type).toBe('show_acceptance')
    expect(emitted?.payload.disclosuresAcked).toBe(true)

    const res = await getAcceptanceBundle({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect((res.uiAction!.payload as unknown as BundlePayload).disclosuresAcked).toBe(true)
  })

  it('(c) gui accept_quote with paymentOption quarterly applies in ONE call and the frequency threads to the schedule', async () => {
    const fx = await buildAcceptReadyQuote()
    const res = await executeCommit({
      tool: 'accept_quote', args: { paymentOption: 'quarterly' }, actor: 'gui',
      customerId: fx.customerId, conversationId: fx.conversationId,
      toolContext: fixtureCtx(fx.customerId, fx.conversationId),
    })
    // gui-actor commits are confirmed by construction (P2.4) — no token round-trip
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })
    expect(quote.paymentFrequency).toBe('quarterly')
    const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: fx.quoteId } })
    expect(schedule.frequency).toBe('quarterly')
    expect(schedule.totalInstallments).toBe(4)
  })

  it('(d) exposure — absent without an ISSUED quote, exposed on one; the handler rejects without a quote', async () => {
    const noQuote = await buildReadyApplication()
    const snapBefore = await loadDomainSnapshot(noQuote.conversationId, prisma)
    expect(deriveAndExpose(snapBefore).actions.available).not.toContain('get_acceptance_bundle')
    const rejected = await getAcceptanceBundle({}, fixtureCtx(noQuote.customerId, noQuote.conversationId))
    expect(rejected.success).toBe(false)

    const fx = await buildIssuedQuote()
    const snapAfter = await loadDomainSnapshot(fx.conversationId, prisma)
    expect(deriveAndExpose(snapAfter).actions.available).toContain('get_acceptance_bundle')
  })
})
