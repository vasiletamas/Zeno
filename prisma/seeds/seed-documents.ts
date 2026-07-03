/**
 * Protect disclosure documents (D2.2, T9.D1): IPID v1 + TERMS v1 in ro AND
 * en (M6 publish gate: both locales mandatory), source
 * STATIC_PER_PRODUCT_VERSION, registered through the Document registry so
 * bytes land behind the storage provider with a sha256 contentHash.
 * Idempotent: an existing (product, kind, language, version) row is kept.
 */
import { jsPDF } from 'jspdf'
import type { PrismaClient } from '../../lib/generated/prisma/client'
import { createDocument } from '../../lib/documents/registry'

type DisclosureKind = 'IPID' | 'TERMS'
const LANGUAGES = ['ro', 'en'] as const

function localized(json: unknown, lang: string): string {
  if (typeof json === 'string') return json
  const obj = (json ?? {}) as Record<string, string>
  return obj[lang] ?? obj.ro ?? obj.en ?? ''
}

function buildDisclosurePdf(kind: DisclosureKind, lang: 'ro' | 'en', product: {
  name: unknown; description: unknown; features: string[]; exclusions: string[]
  contractTerm: string | null; gracePeriod: string | null
}): Buffer {
  const doc = new jsPDF()
  const title = kind === 'IPID'
    ? (lang === 'ro' ? 'Document de informare despre produsul de asigurare (IPID)' : 'Insurance Product Information Document (IPID)')
    : (lang === 'ro' ? 'Termeni și condiții contractuale' : 'Contractual Terms and Conditions')
  doc.setFontSize(16)
  doc.text(title, 14, 20)
  doc.setFontSize(12)
  doc.text(localized(product.name, lang), 14, 32)
  doc.setFontSize(10)
  const body: string[] = []
  if (kind === 'IPID') {
    body.push(localized(product.description, lang))
    body.push('')
    body.push(lang === 'ro' ? 'Acoperiri principale:' : 'Main coverages:')
    for (const f of product.features) body.push(`• ${f}`)
    body.push('')
    body.push(lang === 'ro' ? 'Excluderi:' : 'Exclusions:')
    for (const e of product.exclusions) body.push(`• ${e}`)
  } else {
    body.push(lang === 'ro' ? `Durata contractului: ${product.contractTerm ?? '-'}` : `Contract term: ${product.contractTerm ?? '-'}`)
    body.push(lang === 'ro' ? `Perioada de grație: ${product.gracePeriod ?? '-'}` : `Grace period: ${product.gracePeriod ?? '-'}`)
    body.push('')
    body.push(localized(product.description, lang))
  }
  let y = 42
  for (const line of body) {
    const wrapped = doc.splitTextToSize(line, 180) as string[]
    for (const w of wrapped) {
      if (y > 280) { doc.addPage(); y = 20 }
      doc.text(w, 14, y)
      y += 6
    }
  }
  return Buffer.from(doc.output('arraybuffer'))
}

export async function seedDocuments(prisma: PrismaClient): Promise<void> {
  console.log('  Seeding disclosure documents (IPID/TERMS, ro+en)...')
  const product = await prisma.product.findFirst({ where: { code: 'protect' } })
  if (!product) throw new Error('seed-documents: protect product missing — run seedProduct first')
  let created = 0
  for (const kind of ['IPID', 'TERMS'] as DisclosureKind[]) {
    for (const lang of LANGUAGES) {
      const existing = await prisma.document.findFirst({
        where: { productId: product.id, kind, language: lang, version: 1, source: 'STATIC_PER_PRODUCT_VERSION' },
      })
      if (existing) continue
      const bytes = buildDisclosurePdf(kind, lang, {
        name: product.name, description: product.description,
        features: product.features, exclusions: product.exclusions,
        contractTerm: product.contractTerm, gracePeriod: product.gracePeriod,
      })
      await createDocument({
        kind, language: lang, bytes, source: 'STATIC_PER_PRODUCT_VERSION',
        productId: product.id, version: 1,
      }, prisma)
      created++
    }
  }
  console.log(`    ${created} disclosure documents registered (existing kept)`)
}
