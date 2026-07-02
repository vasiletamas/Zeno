import { PrismaClient, Prisma } from '../../lib/generated/prisma/client'
import type { InputJsonValue } from '@prisma/client/runtime/client'

// Helper: convert a value to Prisma-compatible nullable JSON
function jsonOrDbNull(val: unknown): InputJsonValue | typeof Prisma.DbNull {
  return val == null ? Prisma.DbNull : (val as InputJsonValue)
}

export async function seedQuestions(prisma: PrismaClient) {
  console.log('  Seeding question groups & questions...')

  // Look up the "protect" product for linking question groups
  const product = await prisma.product.findUnique({ where: { code: 'protect' } })
  if (!product) throw new Error('Product "protect" must be seeded before questions')

  // ── Helper: upsert a group then upsert all its questions ──────────
  // code -> id across ALL groups (cross-group parent gating, B2/T3.D6)
  const allQuestionIds: Record<string, string> = {}

  async function seedGroup(
    groupDef: {
      code: string
      name: { en: string; ro: string }
      description?: string
      orderIndex: number
      productId?: string | null
      phase?: 'dnt' | 'application' | null
    },
    questions: Array<{
      code: string
      text: { en: string; ro: string }
      helpText?: { en: string; ro: string } | null
      type: string
      options?: unknown | null
      validationRules?: unknown | null
      insightKey?: string | null
      orderIndex: number
      isRequired?: boolean
      parentQuestionCode?: string | null
      showWhenValue?: string | null
    }>,
  ) {
    const group = await prisma.questionGroup.upsert({
      where: { code: groupDef.code },
      update: {
        name: groupDef.name,
        description: groupDef.description ?? null,
        orderIndex: groupDef.orderIndex,
        productId: groupDef.productId ?? null,
        phase: groupDef.phase ?? null,
      },
      create: {
        code: groupDef.code,
        name: groupDef.name,
        description: groupDef.description ?? null,
        orderIndex: groupDef.orderIndex,
        productId: groupDef.productId ?? null,
        phase: groupDef.phase ?? null,
      },
    })

    // Build a map of code -> id for parent question linking. Lookups fall
    // back to the ACCUMULATED map so parents can live in earlier groups
    // (B2: DNT_LIFE_SUBTYPE gates the financial/investment/sustainability
    // groups, T3.D6).
    const questionIdMap: Record<string, string> = {}

    for (const q of questions) {
      // Resolve parent question id if specified (this group, then any prior)
      let parentQuestionId: string | null = null
      if (q.parentQuestionCode) {
        parentQuestionId = questionIdMap[q.parentQuestionCode] ?? allQuestionIds[q.parentQuestionCode] ?? null
      }

      const existing = await prisma.question.findFirst({
        where: { groupId: group.id, text: { equals: q.text } },
      })

      if (existing) {
        await prisma.question.update({
          where: { id: existing.id },
          data: {
            code: q.code,
            helpText: jsonOrDbNull(q.helpText),
            type: q.type,
            options: jsonOrDbNull(q.options),
            validationRules: jsonOrDbNull(q.validationRules),
            insightKey: q.insightKey ?? null,
            orderIndex: q.orderIndex,
            isRequired: q.isRequired ?? true,
            parentQuestionId,
            showWhenValue: q.showWhenValue ?? null,
          },
        })
        questionIdMap[q.code] = existing.id
        allQuestionIds[q.code] = existing.id
      } else {
        const created = await prisma.question.create({
          data: {
            groupId: group.id,
            code: q.code,
            text: q.text,
            helpText: jsonOrDbNull(q.helpText),
            type: q.type,
            options: jsonOrDbNull(q.options),
            validationRules: jsonOrDbNull(q.validationRules),
            insightKey: q.insightKey ?? null,
            orderIndex: q.orderIndex,
            isRequired: q.isRequired ?? true,
            parentQuestionId,
            showWhenValue: q.showWhenValue ?? null,
          },
        })
        questionIdMap[q.code] = created.id
        allQuestionIds[q.code] = created.id
      }
    }

    // B4: the seed is AUTHORITATIVE per group — questions removed from the
    // catalog (e.g. the T5.D2 selection questions) are deleted, answers
    // first (FK).
    const stale = await prisma.question.findMany({
      where: { groupId: group.id, code: { notIn: questions.map((q) => q.code) } },
      select: { id: true },
    })
    if (stale.length > 0) {
      const staleIds = stale.map((s) => s.id)
      await prisma.answer.deleteMany({ where: { questionId: { in: staleIds } } })
      await prisma.question.deleteMany({ where: { id: { in: staleIds } } })
    }

    return { group, questionIdMap }
  }

  // ── 1. dnt_consent — GDPR consents (3 questions) ─────────────────
  await seedGroup(
    {
      code: 'dnt_consent',
      name: { en: 'Consents', ro: 'Consimțăminte' },
      description: 'Regulatory consents required by IDD',
      orderIndex: 0,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_CONSULTATION_CONSENT',
        text: {
          en: 'Do you want the Allianz-Țiriac intermediary to provide consultation for all products according to your needs?',
          ro: 'Dorești ca intermediarul Allianz-Țiriac să îți ofere consultanță pentru produsele Allianz-Țiriac, conform cerințelor și necesităților tale?',
        },
        type: 'DROPDOWN',
        orderIndex: 1,
        options: [
          { value: 'yes_all', label: { en: 'Yes, for all products', ro: 'DA, pentru toate produsele' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_MARKETING_CONSENT',
        text: {
          en: 'Do you agree to receive marketing communications about insurance products and services?',
          ro: 'Dorești să primești informații utile despre asigurări și să afli cum te pot ajuta produsele și serviciile de la Allianz-Țiriac?',
        },
        type: 'DROPDOWN',
        orderIndex: 2,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_ELECTRONIC_COMMUNICATION',
        text: {
          en: 'Do you agree to receive all pre-contractual and contractual correspondence exclusively electronically?',
          ro: 'Ești de acord să primești toată corespondența precontractuală și contractuală pe cale exclusiv electronică?',
        },
        type: 'DROPDOWN',
        orderIndex: 3,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
    ],
  )
  console.log('    dnt_consent: 3 questions')

  // ── 2. dnt_general — Demographics (6 questions) ──────────────────
  await seedGroup(
    {
      code: 'dnt_general',
      name: { en: 'General Information', ro: 'Informații Generale' },
      description: 'Core demographic and regulatory questions applicable to all insurance types',
      orderIndex: 1,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_CNP',
        text: {
          en: 'Please enter your CNP (Personal Numeric Code)',
          ro: 'Te rugăm să introduci CNP-ul tău (Codul Numeric Personal)',
        },
        helpText: {
          en: 'Your 13-digit personal identification number. Required for insurance regulatory compliance.',
          ro: 'Codul tău numeric personal din 13 cifre. Necesar pentru conformitatea cu reglementările de asigurări.',
        },
        type: 'OPEN_ENDED',
        orderIndex: 0,
        validationRules: { pattern: '^[1-9]\\d{12}$', minLength: 13, maxLength: 13 },
      },
      {
        code: 'DNT_INCOME_SOURCE',
        text: {
          en: 'What is your source of income?',
          ro: 'Care este sursa veniturilor tale?',
        },
        helpText: {
          en: 'Select all that apply',
          ro: 'Selectează toate cele aplicabile',
        },
        type: 'MULTI_SELECT',
        orderIndex: 1,
        options: [
          { value: 'salary_pension', label: { en: 'Salary/Pension', ro: 'Salariu/Pensie' } },
          { value: 'other_sources', label: { en: 'Other sources (rent, royalties, dividends, etc.)', ro: 'Alte surse (chirie, rente, dividende, drepturi de autor etc.)' } },
        ],
      },
      {
        code: 'DNT_OCCUPATION',
        text: {
          en: 'What is your current occupation?',
          ro: 'Care este ocupația ta actuală?',
        },
        helpText: {
          en: 'Select the option that best describes your current work status',
          ro: 'Selectează opțiunea care descrie cel mai bine situația ta profesională actuală',
        },
        type: 'DROPDOWN',
        orderIndex: 2,
        options: [
          { value: 'employee', label: { en: 'Employee', ro: 'Angajat' } },
          { value: 'entrepreneur', label: { en: 'Entrepreneur', ro: 'Antreprenor' } },
          { value: 'freelancer', label: { en: 'Freelancer/Self-employed', ro: 'Liber Profesionist' } },
          { value: 'unemployed', label: { en: 'Unemployed', ro: 'Șomer' } },
          { value: 'retired', label: { en: 'Retired', ro: 'Pensionar' } },
          { value: 'student', label: { en: 'Student', ro: 'Student' } },
        ],
      },
      {
        code: 'DNT_FAMILY_SIZE',
        text: {
          en: 'How many members does your family have (including yourself)?',
          ro: 'Câți membri are familia ta (inclusiv tu)?',
        },
        helpText: {
          en: 'Include all household members',
          ro: 'Include toți membrii gospodăriei',
        },
        type: 'DROPDOWN',
        orderIndex: 3,
        options: [
          { value: '1', label: { en: '1', ro: '1' } },
          { value: '2', label: { en: '2', ro: '2' } },
          { value: '3', label: { en: '3', ro: '3' } },
          { value: '4', label: { en: '4', ro: '4' } },
          { value: '5+', label: { en: '5 or more', ro: '5 sau mai mulți' } },
        ],
      },
      {
        code: 'DNT_MINOR_CHILDREN',
        text: {
          en: 'How many family members are minor children?',
          ro: 'Câți dintre membrii familiei sunt copii minori?',
        },
        helpText: {
          en: 'Children under 18 years old',
          ro: 'Copii sub 18 ani',
        },
        type: 'DROPDOWN',
        orderIndex: 4,
        options: [
          { value: '0', label: { en: '0', ro: '0' } },
          { value: '1', label: { en: '1', ro: '1' } },
          { value: '2', label: { en: '2', ro: '2' } },
          { value: '3', label: { en: '3', ro: '3' } },
          { value: '4+', label: { en: '4 or more', ro: '4 sau mai mulți' } },
        ],
      },
      {
        code: 'DNT_EDUCATION',
        text: {
          en: 'What is your highest level of education completed?',
          ro: 'Care este ultimul sistem de învățământ absolvit?',
        },
        helpText: {
          en: 'Select your highest educational attainment',
          ro: 'Selectează nivelul de educație cel mai înalt absolvit',
        },
        type: 'DROPDOWN',
        orderIndex: 5,
        options: [
          { value: 'middle_school', label: { en: 'Middle School', ro: 'Gimnaziu' } },
          { value: 'high_school', label: { en: 'High School', ro: 'Liceu' } },
          { value: 'university', label: { en: 'University', ro: 'Universitar' } },
          { value: 'postgraduate', label: { en: 'Postgraduate', ro: 'Postuniversitar' } },
        ],
      },
    ],
  )
  console.log('    dnt_general: 6 questions')

  // ── 3. dnt_life_type — Life insurance subtype (1 question) ────────
  await seedGroup(
    {
      code: 'dnt_life_type',
      name: { en: 'Life Insurance Type', ro: 'Tip Asigurare de Viață' },
      description: 'Controls which LIFE_FINANCIAL and LIFE_INVESTMENT questions appear',
      orderIndex: 2,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_LIFE_SUBTYPE',
        text: {
          en: 'What type of life insurance protection are you interested in?',
          ro: 'Ce tip de protecție prin asigurare de viață te interesează?',
        },
        type: 'DROPDOWN',
        orderIndex: 1,
        options: [
          { value: 'simple_protection', label: { en: 'Simple protection', ro: 'Protecție simplă' } },
          { value: 'financial_protection', label: { en: 'Financial protection', ro: 'Protecție financiară' } },
          { value: 'financial_and_investment', label: { en: 'Financial protection and investment', ro: 'Protecție financiară și investiție' } },
        ],
      },
    ],
  )
  console.log('    dnt_life_type: 1 question')

  // ── 4. dnt_life_financial — Financial situation (11 questions) ────
  await seedGroup(
    {
      code: 'dnt_life_financial',
      name: { en: 'Life Insurance - Financial Protection', ro: 'Asigurări de Viață - Protecție Financiară' },
      description: 'Financial protection questions, shown when DNT_LIFE_SUBTYPE = financial_protection or financial_and_investment',
      orderIndex: 3,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_LIFE_NEEDS_PRIORITY',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Please rank your life insurance needs by importance (1 = most important, 6 = least important): Personal financial protection, Family financial protection, Child education supplementary income, Personal projects supplementary income, Investments, Pension supplementary income',
          ro: 'Te rugăm să ordonezi nevoile tale de asigurare de viață în funcție de importanță (1 = cea mai importantă, 6 = cea mai puțin importantă): Protecție financiară personală, Protecție financiară a familiei, Venituri suplimentare pentru educația copiilor, Venituri suplimentare pentru proiecte personale, Investiții, Venituri suplimentare pentru pensie',
        },
        type: 'OPEN_ENDED',
        orderIndex: 1,
        validationRules: { inputType: 'text', placeholder: 'e.g. 1,3,2,5,4,6', placeholderRo: 'ex: 1,3,2,5,4,6' },
      },
      {
        code: 'DNT_LIFE_FAMILY_INCOME',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: "What is your family's net monthly income?",
          ro: 'Care este valoarea venitului lunar net pe familie?',
        },
        type: 'DROPDOWN',
        orderIndex: 2,
        options: [
          { value: 'under_2000', label: { en: 'Under 2,000 RON', ro: 'Sub 2.000 RON' } },
          { value: '2000_5000', label: { en: '2,000 - 5,000 RON', ro: 'Între 2.000 și 5.000 RON' } },
          { value: '5000_10000', label: { en: '5,000 - 10,000 RON', ro: 'Între 5.000 și 10.000 RON' } },
          { value: 'over_10000', label: { en: 'Over 10,000 RON', ro: 'Peste 10.000 RON' } },
        ],
      },
      {
        code: 'DNT_LIFE_MONTHLY_EXPENSES',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: "What are your family's monthly expenses? (Please specify for: current expenses, occasional expenses, and credits)",
          ro: 'Care sunt cheltuielile lunare ale familiei tale? (Te rugăm să specifici pentru: cheltuieli curente, cheltuieli ocazionale și credite)',
        },
        type: 'OPEN_ENDED',
        orderIndex: 3,
        validationRules: { inputType: 'currency', min: 0, inputMode: 'decimal', placeholder: 'e.g. 3000 RON', placeholderRo: 'ex: 3000 RON' },
      },
      {
        code: 'DNT_LIFE_INSURANCE_VALIDITY',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'What duration do you prefer for the life insurance?',
          ro: 'Ce durată preferați pentru asigurarea de viață?',
        },
        type: 'DROPDOWN',
        orderIndex: 4,
        options: [
          { value: '1_4_years', label: { en: '1 to 4 years', ro: 'Între 1 an și 4 ani' } },
          { value: '5_9_years', label: { en: '5 to 9 years', ro: 'Între 5 și 9 ani' } },
          { value: 'over_10_years', label: { en: 'Over 10 years', ro: 'Peste 10 ani' } },
        ],
      },
      {
        code: 'DNT_LIFE_ACCIDENT_COVERAGE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Are you interested in accident coverage? (hospitalization, surgeries, medical expenses, temporary work incapacity)',
          ro: 'Ești interesat de acoperire pentru accidente? (spitalizare, intervenții chirurgicale, cheltuieli medicale, incapacitate temporară de muncă)',
        },
        type: 'DROPDOWN',
        orderIndex: 5,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_LIFE_ILLNESS_COVERAGE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Are you interested in accident or illness coverage? (hospitalization, surgeries, medical expenses)',
          ro: 'Ești interesat de acoperire pentru accident sau boală? (spitalizare, intervenții chirurgicale, cheltuieli medicale)',
        },
        type: 'DROPDOWN',
        orderIndex: 6,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_LIFE_SEVERE_CONDITIONS',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Are you interested in coverage for severe medical conditions? (serious medical conditions, optimal treatment abroad, for children)',
          ro: 'Ești interesat de acoperire pentru afecțiuni medicale grave? (afecțiuni medicale grave, tratament optim în străinătate, pentru copii)',
        },
        type: 'DROPDOWN',
        orderIndex: 7,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_LIFE_INVALIDITY_COVERAGE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Are you interested in Grade I invalidity coverage? (grade I invalidity, premium payment waiver)',
          ro: 'Ești interesat de acoperire pentru invaliditate de gradul I? (invaliditate de gradul I, scutire de la plata primelor)',
        },
        type: 'DROPDOWN',
        orderIndex: 8,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_LIFE_INDEXATION',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'Are you interested in indexation? (annual increase of benefits and premiums)',
          ro: 'Ești interesat de indexare? (majorarea anuală a beneficiilor și a primelor)',
        },
        type: 'DROPDOWN',
        orderIndex: 9,
        options: [
          { value: 'yes', label: { en: 'Yes', ro: 'DA' } },
          { value: 'no', label: { en: 'No', ro: 'NU' } },
        ],
      },
      {
        code: 'DNT_LIFE_PAYMENT_FREQUENCY',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'What payment frequency do you prefer for life insurance premiums?',
          ro: 'Ce frecvență de plată preferi pentru primele de asigurare de viață?',
        },
        type: 'DROPDOWN',
        orderIndex: 10,
        options: [
          { value: 'monthly', label: { en: 'Monthly', ro: 'Lunar' } },
          { value: 'quarterly', label: { en: 'Quarterly', ro: 'Trimestrial' } },
          { value: 'semi_annual', label: { en: 'Semi-annual', ro: 'Semestrial' } },
          { value: 'annual', label: { en: 'Annual', ro: 'Anual' } },
          { value: 'integral', label: { en: 'Full payment', ro: 'Integral' } },
        ],
      },
      {
        code: 'DNT_LIFE_BUDGET',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_protection,financial_and_investment',
        text: {
          en: 'What is your available budget for life insurance? (please specify per year and/or integral)',
          ro: 'Care este bugetul disponibil pentru achiziționarea asigurării de viață? (specifică pe an și/sau integral)',
        },
        type: 'OPEN_ENDED',
        orderIndex: 11,
        validationRules: { inputType: 'currency', min: 0, max: 100000, inputMode: 'decimal', placeholder: 'e.g. 5000 RON/year', placeholderRo: 'ex: 5000 RON/an' },
      },
    ],
  )
  console.log('    dnt_life_financial: 11 questions')

  // ── 5. dnt_life_investment — Investment preferences (3 questions) ──
  await seedGroup(
    {
      code: 'dnt_life_investment',
      name: { en: 'Life Insurance - Investment', ro: 'Asigurări de Viață - Investiții' },
      description: 'Investment questions, shown when DNT_LIFE_SUBTYPE = financial_and_investment',
      orderIndex: 4,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_LIFE_INVEST_KNOWLEDGE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_and_investment',
        text: {
          en: 'How well do you understand and use financial instruments? (bank deposits, life insurance, investment products, stock exchange transactions)',
          ro: 'Cât de bine înțelegi și utilizezi instrumente financiare? (depozite bancare, asigurări de viață, produse investiționale, tranzacții bursiere)',
        },
        type: 'DROPDOWN',
        orderIndex: 1,
        options: [
          { value: 'high', label: { en: 'To a large extent', ro: 'Într-o mare măsură' } },
          { value: 'low', label: { en: 'To a small extent', ro: 'Într-o mică măsură' } },
          { value: 'none', label: { en: 'Not at all', ro: 'Deloc' } },
        ],
      },
      {
        code: 'DNT_LIFE_INVEST_OBJECTIVES',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_and_investment',
        text: {
          en: 'What are your investment objectives?',
          ro: 'Care sunt obiectivele tale de investiții?',
        },
        type: 'MULTI_SELECT',
        orderIndex: 2,
        options: [
          { value: 'capital_accumulation', label: { en: 'Capital accumulation for personal projects', ro: 'Acumulare de capital pentru proiecte personale' } },
          { value: 'periodic_income', label: { en: 'Investment with periodic income (annuities)', ro: 'Investiție cu încasare periodică (rente)' } },
          { value: 'partial_withdrawal', label: { en: 'Investment with partial withdrawal before contract end', ro: 'Investiție cu posibilitate de retragere parțială' } },
        ],
      },
      {
        code: 'DNT_LIFE_RISK_TOLERANCE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_and_investment',
        text: {
          en: 'When investing in financial instruments, what level of risk and potential losses can you assume?',
          ro: 'Când decizi să investești în instrumente financiare, ce nivel de risc și pierderi potențiale îți asumi?',
        },
        type: 'DROPDOWN',
        orderIndex: 3,
        options: [
          { value: 'none', label: { en: 'None at all', ro: 'Deloc' } },
          { value: 'low', label: { en: 'Low', ro: 'Scăzut' } },
          { value: 'moderate', label: { en: 'Moderate', ro: 'Moderat' } },
          { value: 'high', label: { en: 'High', ro: 'Ridicat' } },
        ],
      },
    ],
  )
  console.log('    dnt_life_investment: 3 questions')

  // ── 6. dnt_sustainability — Sustainability preferences (2 questions)
  const sustainResult = await seedGroup(
    {
      code: 'dnt_sustainability',
      name: { en: 'Sustainability Preferences', ro: 'Preferințe Dezvoltare Durabilă' },
      description: 'Sustainability preferences, shown when DNT_LIFE_SUBTYPE = financial_and_investment',
      orderIndex: 5,
      phase: 'dnt',
    },
    [
      {
        code: 'DNT_SUSTAINABILITY_IMPORTANCE',
        parentQuestionCode: 'DNT_LIFE_SUBTYPE',
        showWhenValue: 'financial_and_investment',
        text: {
          en: 'How important is it for your insurance to follow sustainability principles?',
          ro: 'Cât de important este pentru tine ca asigurarea ta să respecte principiile dezvoltării durabile?',
        },
        type: 'DROPDOWN',
        orderIndex: 1,
        options: [
          { value: 'not_necessary', label: { en: 'Not necessary', ro: 'Nu e necesar' } },
          { value: 'somewhat', label: { en: 'Can be followed to some extent', ro: 'Pot fi respectate într-o oarecare măsură' } },
          { value: 'quite_important', label: { en: 'Quite important to me', ro: 'Este destul de important pentru mine' } },
          { value: 'very_important', label: { en: 'Very important to me', ro: 'Este foarte important pentru mine' } },
        ],
      },
      {
        code: 'DNT_SUSTAINABILITY_PREFERENCE',
        text: {
          en: 'What are your sustainability preferences?',
          ro: 'Ce preferințe ai privind dezvoltarea durabilă?',
        },
        type: 'DROPDOWN',
        orderIndex: 2,
        parentQuestionCode: 'DNT_SUSTAINABILITY_IMPORTANCE',
        showWhenValue: 'somewhat,quite_important,very_important',
        options: [
          { value: 'no_preference', label: { en: 'I want sustainability but have no clear preference', ro: 'Vreau dezvoltare durabilă, dar nu am o preferință clară' } },
          { value: 'specific', label: { en: 'I want specific sustainability principles followed', ro: 'Vreau ca asigurarea să respecte anumite principii specifice' } },
        ],
      },
    ],
  )
  // Ignore unused sustainResult
  void sustainResult
  console.log('    dnt_sustainability: 2 questions')

  // ── 7. application — Product application (5 questions) ────────────
  const appResult = await seedGroup(
    {
      code: 'application',
      name: { en: 'Insurance Application', ro: 'Cerere de Asigurare' },
      description: 'Protect product application questions: health declaration, package choice, level, BD interest, payment',
      orderIndex: 6,
      productId: product.id,
      phase: 'application',
    },
    [
      {
        code: 'HEALTH_DECLARATION_CONFIRM',
        text: {
          en: 'I confirm that I am in good health and have no known medical conditions that would affect this insurance',
          ro: 'Confirm că sunt sănătos/sănătoasă și nu am afecțiuni medicale cunoscute care ar afecta această asigurare',
        },
        type: 'BOOLEAN',
        orderIndex: 1,
        validationRules: {
          riskWeight: 5.0,
          flagAnswers: [{ value: 'false', action: 'escalate', reason: 'Customer declared existing health conditions — requires manual underwriting review' }],
        },
      },
      // B4/T5.D2: PACKAGE_CHOICE, PREMIUM_LEVEL and BD_ADDON_INTEREST left
      // the questionnaire — selection is select_coverage's Application
      // columns, the sole writer. PAYMENT_FREQUENCY moves in Block D.
      {
        code: 'PAYMENT_FREQUENCY',
        text: {
          en: 'How would you like to pay?',
          ro: 'Cum doriți să plătiți?',
        },
        type: 'DROPDOWN',
        orderIndex: 5,
        options: [
          { value: 'annual', label: { en: 'Annually', ro: 'Anual' } },
          { value: 'semi_annual', label: { en: 'Semi-annually', ro: 'Semestrial' } },
          { value: 'quarterly', label: { en: 'Quarterly', ro: 'Trimestrial' } },
        ],
      },
    ],
  )
  void appResult
  console.log('    application: 5 questions')

  // ── 8. bd_medical — BD Medical Questionnaire (6 questions) ────────
  await seedGroup(
    {
      code: 'bd_medical',
      name: { en: 'BD Medical Questionnaire', ro: 'Chestionar Medical BD' },
      description: 'Medical questionnaire for BD Treatment Abroad addon. Any YES = rejection.',
      orderIndex: 7,
      productId: product.id,
      phase: 'application',
    },
    [
      {
        code: 'BD_CANCER_HISTORY',
        text: {
          en: 'Have you ever been diagnosed with or treated for cancer, pre-cancerous conditions, or tumors?',
          ro: 'Ați fost vreodată diagnosticat(ă) sau tratat(ă) pentru cancer, stări pre-canceroase sau tumori?',
        },
        type: 'BOOLEAN',
        orderIndex: 1,
        validationRules: {
          riskWeight: 10.0,
        },
      },
      {
        code: 'BD_CARDIOVASCULAR',
        text: {
          en: 'Have you been diagnosed with or treated for cardiovascular conditions requiring surgery?',
          ro: 'Ați fost diagnosticat(ă) sau tratat(ă) pentru afecțiuni cardiovasculare care necesită intervenție chirurgicală?',
        },
        type: 'BOOLEAN',
        orderIndex: 2,
        validationRules: {
          riskWeight: 10.0,
        },
      },
      {
        code: 'BD_NEUROLOGICAL',
        text: {
          en: 'Have you been diagnosed with or treated for neurological conditions requiring neurosurgery?',
          ro: 'Ați fost diagnosticat(ă) sau tratat(ă) pentru afecțiuni neurologice care necesită neurochirurgie?',
        },
        type: 'BOOLEAN',
        orderIndex: 3,
        validationRules: {
          riskWeight: 10.0,
        },
      },
      {
        code: 'BD_TRANSPLANT',
        text: {
          en: 'Have you ever required or been evaluated for organ or bone marrow transplant?',
          ro: 'Ați necesitat vreodată sau ați fost evaluat(ă) pentru transplant de organe sau măduvă osoasă?',
        },
        type: 'BOOLEAN',
        orderIndex: 4,
        validationRules: {
          riskWeight: 10.0,
        },
      },
      {
        code: 'BD_CHRONIC_CONDITIONS',
        text: {
          en: 'Do you have any chronic medical conditions currently under treatment?',
          ro: 'Aveți afecțiuni medicale cronice aflate în prezent sub tratament?',
        },
        type: 'BOOLEAN',
        orderIndex: 5,
        validationRules: {
          riskWeight: 10.0,
        },
      },
      {
        code: 'BD_HOSPITALIZATION_RECENT',
        text: {
          en: 'Have you been hospitalized in the last 12 months for any reason other than accidents?',
          ro: 'Ați fost internat(ă) în ultimele 12 luni din alte motive decât accidente?',
        },
        type: 'BOOLEAN',
        orderIndex: 6,
        validationRules: {
          riskWeight: 10.0,
        },
      },
    ],
  )
  console.log('    bd_medical: 6 questions')

  console.log('  Questions seed complete. (8 groups, 37 questions total)')
}
