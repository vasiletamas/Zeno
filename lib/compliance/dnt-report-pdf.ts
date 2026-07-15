/**
 * Shared compliance-PDF building blocks (C3.6, erratum 3): the localized
 * text/date/currency helpers extracted from dnt-report.ts plus the
 * suitability-report section builder. jsPDF + autotable, Romanian-first.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { SuitabilityResult } from '@/lib/engines/suitability'

export function getLocalizedText(json: unknown, lang = 'ro'): string {
  if (!json) return '-'
  if (typeof json === 'string') return json
  if (typeof json === 'object' && json !== null) {
    const obj = json as Record<string, string>
    return obj[lang] || obj.ro || obj.en || Object.values(obj)[0] || '-'
  }
  return '-'
}

export function formatDate(date: Date | null | undefined): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatCurrency(amount: number, currency = 'RON'): string {
  return `${amount.toLocaleString('ro-RO')} ${currency}`
}

const MISMATCH_TEXT: Record<string, { ro: string; en: string }> = {
  product_has_no_investment_component: {
    ro: 'Clientul a exprimat o cerință de investiție; Protect nu are componentă de investiție.',
    en: 'The customer expressed an investment demand; Protect has no investment component.',
  },
  severe_conditions_demand_needs_addon: {
    ro: 'Cerința privind afecțiunile grave este acoperită doar prin opțiunea de tratament în străinătate.',
    en: 'The severe-conditions demand is met only through the treatment-abroad option.',
  },
}

const VERDICT_TEXT: Record<SuitabilityResult['verdict'], { ro: string; en: string }> = {
  suitable: { ro: 'POTRIVIT — produsul corespunde cerințelor și necesităților declarate.', en: 'SUITABLE — the product matches the declared demands and needs.' },
  conditionally_suitable: { ro: 'POTRIVIT CONDIȚIONAT — potrivirea depinde de opțiunile alese.', en: 'CONDITIONALLY SUITABLE — the fit depends on the chosen options.' },
  unsuitable: { ro: 'NEPOTRIVIT — există o nepotrivire documentată; clientul a fost avertizat.', en: 'UNSUITABLE — a documented mismatch exists; the customer was warned.' },
}

export interface SuitabilityPdfInput {
  quote: {
    id: string
    premiumAnnual: number
    premiumMonthly: number
    currency: string
    createdAt: Date
    product: { name: unknown; code: string }
    customer: { name: string | null; email: string | null }
    application: { tier: { name: unknown } | null; level: { name: unknown } | null; includesAddon: boolean } | null
  }
  dntFacts: Record<string, string>
  result: SuitabilityResult
  ruleSetVersion: number
  language: 'ro' | 'en'
}

/**
 * The quote-keyed suitability report (IDD timing: at quote issuance):
 * the engine verdict of record, the mismatches (if any) with their stable
 * reason codes, and the DNT facts the verdict was computed from.
 */
export async function buildSuitabilityPdf(input: SuitabilityPdfInput): Promise<Buffer> {
  const { quote, dntFacts, result, ruleSetVersion, language: lang } = input
  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text(lang === 'ro' ? 'Raport de Suitabilitate (Cerințe și Necesități)' : 'Suitability Report (Demands and Needs)', 14, 18)
  doc.setFontSize(10)
  doc.text(`${lang === 'ro' ? 'Produs' : 'Product'}: ${getLocalizedText(quote.product.name, lang)} (${quote.product.code})`, 14, 28)
  doc.text(`${lang === 'ro' ? 'Ofertă' : 'Quote'}: ${quote.id} — ${formatDate(quote.createdAt)}`, 14, 34)
  doc.text(`${lang === 'ro' ? 'Client' : 'Customer'}: ${quote.customer.name ?? '-'} ${quote.customer.email ? `(${quote.customer.email})` : ''}`, 14, 40)
  const sel = quote.application
    ? `${getLocalizedText(quote.application.tier?.name, lang)} / ${getLocalizedText(quote.application.level?.name, lang)} / addon ${quote.application.includesAddon ? (lang === 'ro' ? 'da' : 'yes') : (lang === 'ro' ? 'nu' : 'no')}`
    : '-'
  doc.text(`${lang === 'ro' ? 'Selecție' : 'Selection'}: ${sel} — ${formatCurrency(quote.premiumAnnual, quote.currency)}/an`, 14, 46)

  doc.setFontSize(12)
  doc.text(`${lang === 'ro' ? 'Verdict' : 'Verdict'} (v${ruleSetVersion}): ${VERDICT_TEXT[result.verdict][lang]}`, 14, 58, { maxWidth: 180 })

  let y = 70
  if (result.mismatches.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [[lang === 'ro' ? 'Nepotrivire (cod)' : 'Mismatch (code)', lang === 'ro' ? 'Explicație' : 'Explanation']],
      body: result.mismatches.map((m) => [m.reason, MISMATCH_TEXT[m.reason]?.[lang] ?? m.reason]),
      styles: { fontSize: 9 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  autoTable(doc, {
    startY: y,
    head: [[lang === 'ro' ? 'Fapt DNT (cod)' : 'DNT fact (code)', lang === 'ro' ? 'Răspuns' : 'Answer']],
    body: Object.entries(dntFacts).map(([code, value]) => [code, value]),
    styles: { fontSize: 8 },
  })

  return Buffer.from(doc.output('arraybuffer'))
}
