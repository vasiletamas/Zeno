import { PrismaClient } from '../../lib/generated/prisma/client'
import { publishProductContent } from '../../lib/products/product-content'

/**
 * Protect's authored selling content (E1.8, T11.D5) — the claims the agent
 * may utter, distilled from the retired features[] column and the playbook's
 * value proposition. NUMERAL-FREE by the publish gate: amounts are
 * referenced via {{coverage:CODE}} placeholders (resolved at read time from
 * the coverage rows the engine prices with) and every price the agent
 * speaks comes from the DERIVED pricing_examples, never from prose.
 *
 * Authoring is versioned + published through the ONE workflow
 * (publishProductContent) so the seed passes the same locale-complete and
 * no-numerals gates as any operator edit. approvedBy 'seed:t11d5' marks the
 * migration provenance.
 */

const KEY_VALUE_PRODUCT_POINTS = {
  ro: [
    'Două pachete la alegere: Standard și Optim',
    'Acoperire pentru deces din orice cauză — protecție financiară pentru familie',
    'Invaliditate permanentă din accident acoperită',
    'Intervenții chirurgicale și spitalizare din accident incluse',
    'Acoperire teritorială globală',
    'Contract anual cu reînnoire automată',
    'Perioadă de grație generoasă la plata primelor',
    'Fără examen medical pentru produsul de bază',
    'Opțional: tratament medical în străinătate prin clauza BD, în clinici de top',
  ],
  en: [
    'Two packages to choose from: Standard and Optim',
    'Death from any cause covered — financial protection for your family',
    'Permanent invalidity from accident covered',
    'Surgical interventions and hospitalization from accident included',
    'Worldwide territorial coverage',
    'Annual contract with automatic renewal',
    'Generous grace period for premium payment',
    'No medical examination for the base product',
    'Optional: medical treatment abroad through the BD rider, at top clinics',
  ],
}

const SELL_SPECIFIC_INFO = {
  ro:
    'Condu cu clauza de Tratament Medical în Străinătate (BD) — diferențiatorul produsului: ' +
    'acoperire de până la {{coverage:TREATMENT_COSTS}} pentru cancer, chirurgie cardiovasculară, ' +
    'neurochirurgie și transplanturi în cele mai bune clinici din lume. Asigurarea de viață de ' +
    'bază e vehiculul, clauza BD e destinația. Pentru clienții deja asigurați, poziționează ' +
    'Protect drept complement, nu înlocuitor — protecțiile se completează, nu se exclud. ' +
    'Ancorează costul fără cifre inventate: prima lunară e comparabilă cu un abonament de ' +
    'streaming sau câteva cafele — cifrele exacte vin exclusiv din pricing_examples.',
  en:
    'Lead with the Medical Treatment Abroad rider (BD) — the product differentiator: coverage ' +
    'of up to {{coverage:TREATMENT_COSTS}} for cancer, cardiovascular surgery, neurosurgery and ' +
    'transplants at the best clinics in the world. The base life cover is the vehicle, the BD ' +
    'rider is the destination. For customers who already hold insurance, position Protect as a ' +
    'complement, never a replacement — the protections add up rather than compete. Anchor cost ' +
    'without invented figures: the monthly premium is comparable to a streaming subscription or ' +
    'a few coffees — exact numbers come exclusively from pricing_examples.',
}

const SELL_SPECIFIC_ADDON_INFO = {
  ro:
    'Nu e doar „o clauză” — e un pachet medical complet: tratament în clinici de top cu ' +
    'acoperire de până la {{coverage:TREATMENT_COSTS}}, indemnizație zilnică de spitalizare în ' +
    'străinătate de {{coverage:HOSPITALIZATION_ABROAD}} pe zi, medicație post-tratament de până ' +
    'la {{coverage:POST_TREATMENT_MEDICATION}} și a doua opinie medicală inclusă. Clauza se ' +
    'activează după perioada de așteptare și cere chestionarul medical — orice răspuns ' +
    'afirmativ înseamnă că rămâne disponibil doar produsul de bază.',
  en:
    'It is not just “a rider” — it is a complete medical package: treatment at top clinics with ' +
    'coverage of up to {{coverage:TREATMENT_COSTS}}, a daily hospitalization indemnity abroad of ' +
    '{{coverage:HOSPITALIZATION_ABROAD}} per day, post-treatment medication of up to ' +
    '{{coverage:POST_TREATMENT_MEDICATION}}, and a second medical opinion included. The rider ' +
    'starts after the waiting period and requires the medical questionnaire — any affirmative ' +
    'answer means only the base product remains available.',
}

const PRICING_NOTE = {
  ro:
    'Prețul depinde de pachetul ales (Standard sau Optim), de nivelul de primă (nivelurile I, ' +
    'II și III) și — pentru clauza BD — de vârsta clientului. Un nivel mai mare înseamnă o sumă ' +
    'asigurată mai mare; suma pentru deces variază și cu vârsta. Plata poate fi anuală, ' +
    'semestrială sau trimestrială. Prezintă cifre exclusiv din pricing_examples — niciodată din ' +
    'memorie sau din prospect.',
  en:
    'The price depends on the chosen package (Standard or Optim), the premium level (levels I, ' +
    'II and III) and — for the BD rider — the customer’s age. A higher level means a higher sum ' +
    'insured; the death benefit also varies with age. Payment can be annual, semi-annual or ' +
    'quarterly. Present figures exclusively from pricing_examples — never from memory or the ' +
    'brochure.',
}

export async function seedProductContent(prisma: PrismaClient) {
  console.log('  Seeding product content (T11.D5 authored claims)...')

  const product = await prisma.product.findUniqueOrThrow({ where: { code: 'protect' } })
  const addon = await prisma.addon.findUniqueOrThrow({
    where: { productId_code: { productId: product.id, code: 'TREATMENT_ABROAD_BD' } },
  })

  const rows: { addonId: string | null; field: 'KEY_VALUE_PRODUCT_POINTS' | 'SELL_SPECIFIC_INFO' | 'SELL_SPECIFIC_ADDON_INFO' | 'PRICING_NOTE'; locale: 'ro' | 'en'; content: unknown }[] = [
    { addonId: null, field: 'KEY_VALUE_PRODUCT_POINTS', locale: 'ro', content: KEY_VALUE_PRODUCT_POINTS.ro },
    { addonId: null, field: 'KEY_VALUE_PRODUCT_POINTS', locale: 'en', content: KEY_VALUE_PRODUCT_POINTS.en },
    { addonId: null, field: 'SELL_SPECIFIC_INFO', locale: 'ro', content: SELL_SPECIFIC_INFO.ro },
    { addonId: null, field: 'SELL_SPECIFIC_INFO', locale: 'en', content: SELL_SPECIFIC_INFO.en },
    { addonId: addon.id, field: 'SELL_SPECIFIC_ADDON_INFO', locale: 'ro', content: SELL_SPECIFIC_ADDON_INFO.ro },
    { addonId: addon.id, field: 'SELL_SPECIFIC_ADDON_INFO', locale: 'en', content: SELL_SPECIFIC_ADDON_INFO.en },
    { addonId: null, field: 'PRICING_NOTE', locale: 'ro', content: PRICING_NOTE.ro },
    { addonId: null, field: 'PRICING_NOTE', locale: 'en', content: PRICING_NOTE.en },
  ]

  const VERSION = 1
  let createdCount = 0
  for (const row of rows) {
    // idempotent: version 1 rows exist (any status) → leave them alone
    const existing = await prisma.productContent.findFirst({
      where: { productId: product.id, addonId: row.addonId, field: row.field, locale: row.locale, version: VERSION },
    })
    if (existing) continue
    await prisma.productContent.create({
      data: {
        productId: product.id,
        addonId: row.addonId,
        field: row.field,
        locale: row.locale,
        content: row.content as object,
        version: VERSION,
        authoredBy: 'seed:t11d5',
      },
    })
    createdCount += 1
  }

  // publish through the ONE workflow — same gates as an operator edit;
  // 'content_not_found' just means this version is already published
  for (const group of [
    { addonId: null, field: 'KEY_VALUE_PRODUCT_POINTS' as const },
    { addonId: null, field: 'SELL_SPECIFIC_INFO' as const },
    { addonId: addon.id, field: 'SELL_SPECIFIC_ADDON_INFO' as const },
    { addonId: null, field: 'PRICING_NOTE' as const },
  ]) {
    const result = await publishProductContent({
      productId: product.id,
      addonId: group.addonId,
      field: group.field,
      version: VERSION,
      approvedBy: 'seed:t11d5',
    })
    if (result.outcome === 'rejected' && result.reason !== 'content_not_found') {
      throw new Error(`seed-product-content: publish of ${group.field} rejected: ${result.reason} ${JSON.stringify(result.params)}`)
    }
  }

  console.log(`    ${createdCount} authored rows created; publish state reconciled`)
}
