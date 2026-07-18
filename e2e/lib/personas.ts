/**
 * Test Personas and Answer Maps
 *
 * Deterministic data for the E2E client simulator.
 * Questionnaire answers come from here (no LLM needed).
 * The persona profile is used to prompt the LLM for free-form conversation.
 */

// ==============================================
// DEFAULT PERSONA
// ==============================================

export const DEFAULT_PERSONA = {
  name: 'Ion Popescu',
  age: 35,
  occupation: 'Inginer',
  income: '5000 RON',
  familySize: 4,
  children: 2,
  language: 'ro' as const,
}

// ==============================================
// DEFAULT ANSWER MAP
// ==============================================

/**
 * Complete answer map for the happy-path scenario.
 * Keys are question codes; values are the answer to submit.
 * All BD medical answers are "false" (no conditions → addon approved).
 */
export const DEFAULT_ANSWERS: Record<string, string> = {
  // DNT consent
  DNT_CONSULTATION_CONSENT: 'yes_all',
  DNT_MARKETING_CONSENT: 'true',
  DNT_ELECTRONIC_COMMUNICATION: 'true',

  // DNT general
  DNT_INCOME_SOURCE: 'salary_pension',
  DNT_OCCUPATION: 'employee',
  DNT_FAMILY_SIZE: '4',
  DNT_MINOR_CHILDREN: '2',
  DNT_EDUCATION: 'university',

  // DNT life type
  DNT_LIFE_SUBTYPE: 'simple_protection',

  // DNT financial
  DNT_LIFE_NEEDS_PRIORITY: '1',
  DNT_LIFE_FAMILY_INCOME: '5000_10000',
  DNT_LIFE_MONTHLY_EXPENSES: '3000',
  DNT_LIFE_INSURANCE_VALIDITY: '5_9_years',
  DNT_LIFE_ACCIDENT_COVERAGE: 'true',
  DNT_LIFE_ILLNESS_COVERAGE: 'true',
  DNT_LIFE_SEVERE_CONDITIONS: 'true',
  DNT_LIFE_INVALIDITY_COVERAGE: 'true',
  DNT_LIFE_INDEXATION: 'false',
  DNT_LIFE_PAYMENT_FREQUENCY: 'annual',
  DNT_LIFE_BUDGET: '500',

  // DNT investment
  DNT_LIFE_INVEST_KNOWLEDGE: 'low',
  DNT_LIFE_INVEST_OBJECTIVES: 'capital_accumulation',
  DNT_LIFE_RISK_TOLERANCE: 'low',

  // DNT sustainability
  DNT_SUSTAINABILITY_IMPORTANCE: 'not_necessary',
  DNT_SUSTAINABILITY_PREFERENCE: 'no_preference',

  // Application
  HEALTH_DECLARATION_CONFIRM: 'true',
  PACKAGE_CHOICE: 'standard',
  PREMIUM_LEVEL: 'level_2',
  BD_ADDON_INTEREST: 'true',
  PAYMENT_FREQUENCY: 'annual',

  // BD medical (all false for happy path)
  BD_CANCER_HISTORY: 'false',
  BD_CARDIOVASCULAR: 'false',
  BD_NEUROLOGICAL: 'false',
  BD_TRANSPLANT: 'false',
  BD_CHRONIC_CONDITIONS: 'false',
  BD_HOSPITALIZATION_RECENT: 'false',
}

// ==============================================
// SIMULATOR CONFIG TYPE
// ==============================================

export interface SimulatorConfig {
  persona: typeof DEFAULT_PERSONA
  behavior: {
    /** Question code → answer value. Used for deterministic questionnaire responses. */
    answersMap: Record<string, string>
    /** Inject objections at specific turn numbers */
    objections?: { turn: number; text: string }[]
    /** Request to change tier/level after seeing the first quote */
    changeOfMind?: { afterQuote: boolean; newTier?: string; newLevel?: string }
    /** Pause the conversation at this turn number */
    pauseAtTurn?: number
    /** Override specific BD answers (merged into answersMap) */
    bdAnswers?: Record<string, string>
  }
}

// ==============================================
// CONFIG FACTORY
// ==============================================

/**
 * Create a SimulatorConfig with the default persona and answers,
 * optionally overriding behavior fields.
 */
export function createConfig(
  overrides?: Partial<SimulatorConfig['behavior']>,
): SimulatorConfig {
  const baseAnswers = { ...DEFAULT_ANSWERS }

  // Merge BD answer overrides into the main answer map
  if (overrides?.bdAnswers) {
    Object.assign(baseAnswers, overrides.bdAnswers)
  }

  // Merge any answersMap overrides
  if (overrides?.answersMap) {
    Object.assign(baseAnswers, overrides.answersMap)
  }

  return {
    persona: { ...DEFAULT_PERSONA },
    behavior: {
      answersMap: baseAnswers,
      objections: overrides?.objections,
      changeOfMind: overrides?.changeOfMind,
      pauseAtTurn: overrides?.pauseAtTurn,
      bdAnswers: overrides?.bdAnswers,
    },
  }
}
