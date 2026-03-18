import { PrismaClient } from '../../lib/generated/prisma/client'

export async function seedProduct(prisma: PrismaClient) {
  console.log('  Seeding coverage types...')

  // ── 1. Coverage Types ──────────────────────────────────────────────
  const coverageTypes = [
    {
      code: 'DEATH_ANY_CAUSE',
      name: { en: 'Death from any cause', ro: 'Deces din orice cauză' },
      description: {
        en: 'Financial protection for legal heirs in case of death from any cause',
        ro: 'Protecție financiară pentru moștenitorii legali în caz de deces din orice cauză',
      },
      category: 'life',
      unit: 'lump_sum',
    },
    {
      code: 'PERMANENT_INVALIDITY_ACCIDENT',
      name: {
        en: 'Permanent invalidity from accident',
        ro: 'Invaliditate permanentă ca urmare a unui accident',
      },
      description: {
        en: 'Total or partial permanent invalidity compensation following an accident. Total invalidity = full sum. Partial = percentage per Continental scale.',
        ro: 'Compensație pentru invaliditate permanentă totală sau parțială ca urmare a unui accident. Totală = suma integrală. Parțială = procentual conform scalei Continental.',
      },
      category: 'accident',
      unit: 'lump_sum',
    },
    {
      code: 'SURGICAL_INTERVENTION_ACCIDENT',
      name: {
        en: 'Surgical interventions from accident',
        ro: 'Intervenții chirurgicale ca urmare a unui accident',
      },
      description: {
        en: 'Compensation for surgical interventions following an accident. Calculated as percentage of sum based on surgery complexity. Maximum per year: 100% of sum.',
        ro: 'Compensație pentru intervenții chirurgicale ca urmare a unui accident. Calculată procentual din sumă conform complexității intervenției. Maxim pe an: 100% din sumă.',
      },
      category: 'accident',
      unit: 'lump_sum',
    },
    {
      code: 'HOSPITALIZATION_ACCIDENT',
      name: {
        en: 'Hospitalization from accident',
        ro: 'Spitalizare ca urmare a unui accident',
      },
      description: {
        en: 'Daily indemnity for hospitalization following an accident. Deductible: first 3 days. Maximum: 90 days per insurance year.',
        ro: 'Indemnizație zilnică pentru spitalizare ca urmare a unui accident. Franșiză: primele 3 zile. Maxim: 90 zile pe an de asigurare.',
      },
      category: 'accident',
      unit: 'per_day',
      maxUnits: 90,
      deductibleDays: 3,
    },
    {
      code: 'TREATMENT_COSTS',
      name: {
        en: 'Medical treatment costs abroad',
        ro: 'Cheltuieli tratament medical în străinătate',
      },
      description: {
        en: 'Lifetime maximum across all modules',
        ro: 'Maxim pe viață pentru toate modulele',
      },
      category: 'health',
      unit: 'lump_sum',
    },
    {
      code: 'HOSPITALIZATION_ABROAD',
      name: {
        en: 'Daily hospitalization indemnity abroad',
        ro: 'Indemnizație zilnică spitalizare în străinătate',
      },
      description: {
        en: 'Per event. Deducted from treatment limit.',
        ro: 'Per eveniment. Se deduce din limita de tratament.',
      },
      category: 'health',
      unit: 'per_day',
      maxUnits: 60,
    },
    {
      code: 'POST_TREATMENT_MEDICATION',
      name: {
        en: 'Post-treatment medication',
        ro: 'Medicație post-tratament',
      },
      description: {
        en: 'For medication after treatment abroad. Deducted from treatment limit.',
        ro: 'Pentru medicație după tratament în străinătate. Se deduce din limita de tratament.',
      },
      category: 'health',
      unit: 'lump_sum',
    },
  ] as const

  const ctMap: Record<string, string> = {}
  for (const ct of coverageTypes) {
    const row = await prisma.coverageType.upsert({
      where: { code: ct.code },
      update: {
        name: ct.name,
        description: ct.description,
        category: ct.category,
        unit: ct.unit,
        maxUnits: 'maxUnits' in ct ? ct.maxUnits : null,
        deductibleDays: 'deductibleDays' in ct ? ct.deductibleDays : null,
      },
      create: {
        code: ct.code,
        name: ct.name,
        description: ct.description,
        category: ct.category,
        unit: ct.unit,
        maxUnits: 'maxUnits' in ct ? ct.maxUnits : null,
        deductibleDays: 'deductibleDays' in ct ? ct.deductibleDays : null,
      },
    })
    ctMap[ct.code] = row.id
  }
  console.log(`    ${coverageTypes.length} coverage types upserted`)

  // ── 2. Product ─────────────────────────────────────────────────────
  console.log('  Seeding product...')

  const product = await prisma.product.upsert({
    where: { code: 'protect' },
    update: {
      name: { en: 'Protect', ro: 'Protect' },
      description: {
        en: 'Term life insurance with accident coverage and optional medical treatment abroad for severe conditions. Two packages available: Standard and Optim.',
        ro: 'Asigurare de viață pe termen cu acoperire de accidente și opțional tratament medical în străinătate pentru afecțiuni grave. Două pachete disponibile: Standard și Optim.',
      },
      insuranceType: 'LIFE',
      subType: 'term_life',
      eligibility: {
        minAge: 18,
        maxAge: 64,
        residency: 'Romania',
        healthRequirements: 'Simplified health declaration',
        notes: 'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      },
      features: [
        'Two packages: Standard and Optim',
        'Three premium levels per package (I, II, III)',
        'Death from any cause coverage',
        'Permanent invalidity from accident coverage',
        'Surgical intervention from accident coverage',
        'Hospitalization from accident coverage',
        'Worldwide territorial coverage',
        '1-year contract with automatic renewal',
        '60-day grace period for premium payment',
        'No medical examination for base product',
        'Optional: Medical Treatment Abroad (BD) up to 2M EUR',
      ],
      exclusions: [
        'See Protect insurance conditions for detailed exclusions',
        'BD addon excludes treatment in Romania, Japan, Switzerland, USA',
        'BD addon requires passing 6-question medical questionnaire',
        'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      ],
      defaultPlaybook: `PRODUCT: Protect - Life Insurance with Medical Treatment Abroad

SALES APPROACH:
This is a simple, affordable product. The selling cycle should be SHORT - one conversation to close.

KEY VALUE PROPOSITION:
- Lead with the Medical Treatment Abroad (BD) addon - this is the differentiator
- EUR 2M coverage for cancer, cardiovascular surgery, neurosurgery, and transplants at top clinics worldwide
- The base life insurance is the vehicle, the BD addon is the destination
- Frame it: For the price of a coffee per week, your family is protected AND you have access to EUR 2M in world-class medical treatment

PACKAGE SELECTION:
- Budget-conscious: Standard Level I (190 RON/year)
- Balanced: Standard Level II or Optim Level I
- Maximum protection: Optim Level III (430 RON/year)
- ALWAYS suggest adding BD addon

OBJECTION HANDLING: Use get_objection_strategy tool for all customer objections. Do not improvise — the tool has tested, product-specific strategies.

BD ADDON MEDICAL QUESTIONNAIRE:
- 6 YES/NO health questions required
- ANY yes answer means BD addon is REJECTED
- If rejected, still offer base Protect
- Be sensitive about health disclosures`,
      pricingExplanation:
        'Protect has a simple pricing structure. TWO PACKAGES (Standard and Optim) determine accident coverage levels. THREE PREMIUM LEVELS (I, II, III) determine the death benefit amount. Higher premium = higher death benefit. Death benefit also varies by age (younger = higher). Annual premiums: Standard I=190, II=290, III=390 RON. Optim I=230, II=330, III=430 RON. If adding Medical Treatment Abroad (BD), additional premium applies. Payment: annual, semi-annual, or quarterly. 60-day grace period.',
      targetCustomer:
        'Young active individuals 25-45, medium+ income, families with dependents, employed professionals',
      targetAgeRange: '25-45',
      contractTerm: '1-year with automatic renewal',
      gracePeriod: '60 days for premium payment',
      medicalExamRequired: false,
      territoryCoverage: 'Worldwide',
      premiumRange: { min: 190, max: 430, currency: 'RON', frequency: 'annual' },
      paymentFrequencyOptions: {
        annual: { label: { en: 'Annually', ro: 'Anual' }, multiplier: 1.0 },
        semi_annual: { label: { en: 'Semi-annually', ro: 'Semestrial' }, multiplier: 0.5 },
        quarterly: { label: { en: 'Quarterly', ro: 'Trimestrial' }, multiplier: 0.25 },
      },
      quoteValidityDays: 30,
    },
    create: {
      code: 'protect',
      name: { en: 'Protect', ro: 'Protect' },
      description: {
        en: 'Term life insurance with accident coverage and optional medical treatment abroad for severe conditions. Two packages available: Standard and Optim.',
        ro: 'Asigurare de viață pe termen cu acoperire de accidente și opțional tratament medical în străinătate pentru afecțiuni grave. Două pachete disponibile: Standard și Optim.',
      },
      insuranceType: 'LIFE',
      subType: 'term_life',
      eligibility: {
        minAge: 18,
        maxAge: 64,
        residency: 'Romania',
        healthRequirements: 'Simplified health declaration',
        notes: 'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      },
      features: [
        'Two packages: Standard and Optim',
        'Three premium levels per package (I, II, III)',
        'Death from any cause coverage',
        'Permanent invalidity from accident coverage',
        'Surgical intervention from accident coverage',
        'Hospitalization from accident coverage',
        'Worldwide territorial coverage',
        '1-year contract with automatic renewal',
        '60-day grace period for premium payment',
        'No medical examination for base product',
        'Optional: Medical Treatment Abroad (BD) up to 2M EUR',
      ],
      exclusions: [
        'See Protect insurance conditions for detailed exclusions',
        'BD addon excludes treatment in Romania, Japan, Switzerland, USA',
        'BD addon requires passing 6-question medical questionnaire',
        'Maximum cumulative sum at risk across all life policies: 50,000 EUR',
      ],
      defaultPlaybook: `PRODUCT: Protect - Life Insurance with Medical Treatment Abroad

SALES APPROACH:
This is a simple, affordable product. The selling cycle should be SHORT - one conversation to close.

KEY VALUE PROPOSITION:
- Lead with the Medical Treatment Abroad (BD) addon - this is the differentiator
- EUR 2M coverage for cancer, cardiovascular surgery, neurosurgery, and transplants at top clinics worldwide
- The base life insurance is the vehicle, the BD addon is the destination
- Frame it: For the price of a coffee per week, your family is protected AND you have access to EUR 2M in world-class medical treatment

PACKAGE SELECTION:
- Budget-conscious: Standard Level I (190 RON/year)
- Balanced: Standard Level II or Optim Level I
- Maximum protection: Optim Level III (430 RON/year)
- ALWAYS suggest adding BD addon

OBJECTION HANDLING: Use get_objection_strategy tool for all customer objections. Do not improvise — the tool has tested, product-specific strategies.

BD ADDON MEDICAL QUESTIONNAIRE:
- 6 YES/NO health questions required
- ANY yes answer means BD addon is REJECTED
- If rejected, still offer base Protect
- Be sensitive about health disclosures`,
      pricingExplanation:
        'Protect has a simple pricing structure. TWO PACKAGES (Standard and Optim) determine accident coverage levels. THREE PREMIUM LEVELS (I, II, III) determine the death benefit amount. Higher premium = higher death benefit. Death benefit also varies by age (younger = higher). Annual premiums: Standard I=190, II=290, III=390 RON. Optim I=230, II=330, III=430 RON. If adding Medical Treatment Abroad (BD), additional premium applies. Payment: annual, semi-annual, or quarterly. 60-day grace period.',
      targetCustomer:
        'Young active individuals 25-45, medium+ income, families with dependents, employed professionals',
      targetAgeRange: '25-45',
      contractTerm: '1-year with automatic renewal',
      gracePeriod: '60 days for premium payment',
      medicalExamRequired: false,
      territoryCoverage: 'Worldwide',
      premiumRange: { min: 190, max: 430, currency: 'RON', frequency: 'annual' },
      paymentFrequencyOptions: {
        annual: { label: { en: 'Annually', ro: 'Anual' }, multiplier: 1.0 },
        semi_annual: { label: { en: 'Semi-annually', ro: 'Semestrial' }, multiplier: 0.5 },
        quarterly: { label: { en: 'Quarterly', ro: 'Trimestrial' }, multiplier: 0.25 },
      },
      quoteValidityDays: 30,
    },
  })
  console.log(`    Product "${product.code}" upserted (id: ${product.id})`)

  // ── 3. Pricing Tiers ──────────────────────────────────────────────
  console.log('  Seeding pricing tiers & levels...')

  const tierDefs = [
    { code: 'standard', name: { en: 'Standard', ro: 'Standard' }, orderIndex: 0 },
    { code: 'optim', name: { en: 'Optim', ro: 'Optim' }, orderIndex: 1 },
  ] as const

  const tierMap: Record<string, string> = {}
  for (const td of tierDefs) {
    const tier = await prisma.pricingTier.upsert({
      where: { productId_code: { productId: product.id, code: td.code } },
      update: { name: td.name, orderIndex: td.orderIndex },
      create: {
        productId: product.id,
        code: td.code,
        name: td.name,
        orderIndex: td.orderIndex,
      },
    })
    tierMap[td.code] = tier.id
  }
  console.log(`    ${tierDefs.length} pricing tiers upserted`)

  // ── 4. Pricing Levels ─────────────────────────────────────────────
  const levelDefs = [
    { tierCode: 'standard', code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premium: 190, order: 0 },
    { tierCode: 'standard', code: 'level_2', name: { en: 'Level II', ro: 'Nivelul II' }, premium: 290, order: 1 },
    { tierCode: 'standard', code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premium: 390, order: 2 },
    { tierCode: 'optim', code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premium: 230, order: 0 },
    { tierCode: 'optim', code: 'level_2', name: { en: 'Level II', ro: 'Nivelul II' }, premium: 330, order: 1 },
    { tierCode: 'optim', code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premium: 430, order: 2 },
  ] as const

  // levelKey = "standard:level_1" -> level.id
  const levelMap: Record<string, string> = {}
  for (const ld of levelDefs) {
    const tierId = tierMap[ld.tierCode]
    const level = await prisma.pricingLevel.upsert({
      where: { tierId_code: { tierId, code: ld.code } },
      update: { name: ld.name, premiumAnnual: ld.premium, orderIndex: ld.order },
      create: {
        tierId,
        code: ld.code,
        name: ld.name,
        premiumAnnual: ld.premium,
        currency: 'RON',
        orderIndex: ld.order,
      },
    })
    levelMap[`${ld.tierCode}:${ld.code}`] = level.id
  }
  console.log(`    ${levelDefs.length} pricing levels upserted`)

  // ── 5. Coverage Amounts ────────────────────────────────────────────
  console.log('  Seeding coverage amounts...')

  // Delete existing coverage amounts linked to our pricing levels to avoid duplicates
  const allLevelIds = Object.values(levelMap)
  await prisma.coverageAmount.deleteMany({
    where: { pricingLevelId: { in: allLevelIds } },
  })

  // Death amounts by age band (same for Standard and Optim at same level code)
  const deathAmountsByLevel: Record<string, number[]> = {
    level_1: [40000, 30000, 22000, 16000, 10000, 6000, 4000, 3000, 2000],
    level_2: [64000, 52000, 40000, 29000, 18000, 11000, 7500, 5500, 3500],
    level_3: [85000, 69000, 54000, 40000, 26000, 16000, 11000, 8000, 5000],
  }

  const ageBands = [
    { minAge: 18, maxAge: 25 },
    { minAge: 26, maxAge: 30 },
    { minAge: 31, maxAge: 35 },
    { minAge: 36, maxAge: 40 },
    { minAge: 41, maxAge: 45 },
    { minAge: 46, maxAge: 50 },
    { minAge: 51, maxAge: 55 },
    { minAge: 56, maxAge: 60 },
    { minAge: 61, maxAge: 64 },
  ]

  const coverageAmountRows: Array<{
    coverageTypeId: string
    pricingLevelId: string
    amount: number
    currency: string
    isAgeBased: boolean
    minAge: number | null
    maxAge: number | null
  }> = []

  // For each tier × level, add death age-banded amounts
  for (const tierCode of ['standard', 'optim'] as const) {
    for (const levelCode of ['level_1', 'level_2', 'level_3'] as const) {
      const levelId = levelMap[`${tierCode}:${levelCode}`]
      const amounts = deathAmountsByLevel[levelCode]

      for (let i = 0; i < ageBands.length; i++) {
        coverageAmountRows.push({
          coverageTypeId: ctMap['DEATH_ANY_CAUSE'],
          pricingLevelId: levelId,
          amount: amounts[i],
          currency: 'RON',
          isAgeBased: true,
          minAge: ageBands[i].minAge,
          maxAge: ageBands[i].maxAge,
        })
      }
    }
  }

  // Fixed coverage amounts per tier (same across all levels within a tier)
  const fixedCoverages: Array<{
    code: string
    standard: number
    optim: number
    currency: string
  }> = [
    { code: 'PERMANENT_INVALIDITY_ACCIDENT', standard: 10000, optim: 20000, currency: 'RON' },
    { code: 'SURGICAL_INTERVENTION_ACCIDENT', standard: 4000, optim: 6000, currency: 'RON' },
    { code: 'HOSPITALIZATION_ACCIDENT', standard: 20, optim: 30, currency: 'RON' },
  ]

  for (const fc of fixedCoverages) {
    for (const tierCode of ['standard', 'optim'] as const) {
      const amount = tierCode === 'standard' ? fc.standard : fc.optim
      for (const levelCode of ['level_1', 'level_2', 'level_3'] as const) {
        const levelId = levelMap[`${tierCode}:${levelCode}`]
        coverageAmountRows.push({
          coverageTypeId: ctMap[fc.code],
          pricingLevelId: levelId,
          amount,
          currency: fc.currency,
          isAgeBased: false,
          minAge: null,
          maxAge: null,
        })
      }
    }
  }

  // Bulk create all coverage amounts
  const created = await prisma.coverageAmount.createMany({ data: coverageAmountRows })
  console.log(`    ${created.count} coverage amounts created (54 death age-banded + 18 fixed)`)

  // ── 6. Addon ──────────────────────────────────────────────────────
  console.log('  Seeding addon...')

  const addon = await prisma.addon.upsert({
    where: { productId_code: { productId: product.id, code: 'TREATMENT_ABROAD_BD' } },
    update: {
      name: { en: 'Medical Treatment Abroad', ro: 'Tratament medical în străinătate' },
      description: {
        en: 'Coverage for severe medical conditions and specific medical procedures at top clinics abroad. Includes second medical opinion, treatment costs, hospitalization indemnity, post-treatment medication, and repatriation.',
        ro: 'Acoperire pentru afecțiuni medicale grave și proceduri medicale specifice în clinici de top din străinătate. Include a doua opinie medicală, costuri tratament, indemnizație spitalizare, medicație post-tratament și repatriere.',
      },
      waitingPeriod: '180 days',
    },
    create: {
      productId: product.id,
      code: 'TREATMENT_ABROAD_BD',
      name: { en: 'Medical Treatment Abroad', ro: 'Tratament medical în străinătate' },
      description: {
        en: 'Coverage for severe medical conditions and specific medical procedures at top clinics abroad. Includes second medical opinion, treatment costs, hospitalization indemnity, post-treatment medication, and repatriation.',
        ro: 'Acoperire pentru afecțiuni medicale grave și proceduri medicale specifice în clinici de top din străinătate. Include a doua opinie medicală, costuri tratament, indemnizație spitalizare, medicație post-tratament și repatriere.',
      },
      waitingPeriod: '180 days',
    },
  })
  console.log(`    Addon "${addon.code}" upserted (id: ${addon.id})`)

  // ── 7. Addon Pricing Rules ────────────────────────────────────────
  console.log('  Seeding addon pricing rules...')

  // Delete existing rules for this addon to avoid duplicates
  await prisma.addonPricingRule.deleteMany({ where: { addonId: addon.id } })

  const addonPricingRules = [
    { minAge: 18, maxAge: 30, premiumAnnual: 200 },
    { minAge: 31, maxAge: 45, premiumAnnual: 350 },
    { minAge: 46, maxAge: 55, premiumAnnual: 500 },
    { minAge: 56, maxAge: 64, premiumAnnual: 700 },
  ]

  await prisma.addonPricingRule.createMany({
    data: addonPricingRules.map((r) => ({
      addonId: addon.id,
      minAge: r.minAge,
      maxAge: r.maxAge,
      premiumAnnual: r.premiumAnnual,
      currency: 'RON',
    })),
  })
  console.log(`    ${addonPricingRules.length} addon pricing rules created`)

  // ── 8. Addon Coverage Amounts ─────────────────────────────────────
  console.log('  Seeding addon coverage amounts...')

  // Delete existing addon coverage amounts to avoid duplicates
  await prisma.coverageAmount.deleteMany({ where: { addonId: addon.id } })

  await prisma.coverageAmount.createMany({
    data: [
      {
        coverageTypeId: ctMap['TREATMENT_COSTS'],
        addonId: addon.id,
        amount: 2000000,
        currency: 'EUR',
        isAgeBased: false,
      },
      {
        coverageTypeId: ctMap['HOSPITALIZATION_ABROAD'],
        addonId: addon.id,
        amount: 100,
        currency: 'EUR',
        isAgeBased: false,
      },
      {
        coverageTypeId: ctMap['POST_TREATMENT_MEDICATION'],
        addonId: addon.id,
        amount: 50000,
        currency: 'EUR',
        isAgeBased: false,
      },
    ],
  })
  console.log('    3 addon coverage amounts created')

  console.log('  Product seed complete.')
}
