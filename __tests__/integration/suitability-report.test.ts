import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { generateSuitabilityReport } from '@/lib/compliance/suitability-report'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts, issueTestQuote } from '../helpers/test-db'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection' })
})

describe('generateSuitabilityReport (quote-keyed — IDD timing: at quote issuance, not post-policy)', () => {
  it('produces a PDF buffer and registers a Document row keyed to the quote', async () => {
    const quoteId = await issueTestQuote(fx)
    const { buffer, documentId } = await generateSuitabilityReport(quoteId)
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } }) // D2 registry (contract landed early)
    expect(doc.kind).toBe('SUITABILITY_REPORT')
    expect(doc.quoteId).toBe(quoteId)
    expect(doc.language).toBe('ro')
    expect(doc.contentHash).toHaveLength(64) // sha256
  })
  it('embeds the engine verdict of record, not a recomputed-later one', async () => {
    const quoteId = await issueTestQuote(fx)
    const { meta } = await generateSuitabilityReport(quoteId)
    expect(meta.verdict).toBe('suitable')
    expect(meta.ruleSetVersion).toBe(1)
  })
  it('fails loudly when the quote does not exist (no silent skip)', async () => {
    await expect(generateSuitabilityReport('missing-quote-id')).rejects.toThrow()
  })
})
