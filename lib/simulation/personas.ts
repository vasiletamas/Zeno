/**
 * Customer Simulation — Persona Definitions
 *
 * 8 realistic Romanian customer personas for AI sales agent testing.
 */

import type { Persona } from '@/lib/simulation/types'

// ==============================================
// PERSONA DEFINITIONS
// ==============================================

const youngParent: Persona = {
  slug: 'young-parent',
  name: 'Maria Popescu',
  age: 32,
  language: 'ro',
  occupation: 'Contabil',
  familySize: 4,
  hasChildren: true,
  incomeLevel: 'medium',
  motivations: [
    'Protejarea familiei in cazul unui eveniment neasteptat',
    'Siguranta financiara a copiilor',
    'Cost lunar accesibil',
  ],
  personality:
    'Calduroasa si orientata catre familie, dar atenta la buget. Pune intrebari despre ce se intampla cu polita daca isi pierde locul de munca.',
  objectionTypes: ['price_base', 'affordability'],
  maxTurns: 30,
  expectedOutcome: 'purchase',
}

const professional: Persona = {
  slug: 'professional',
  name: 'Andrei Ionescu',
  age: 42,
  language: 'ro',
  occupation: 'Director IT',
  familySize: 3,
  hasChildren: true,
  incomeLevel: 'high',
  motivations: [
    'Acoperire comprehensiva pentru boli grave',
    'Protectie invaliditate pentru venit',
    'Planificare financiara pe termen lung',
  ],
  personality:
    'Analitic si orientat catre detalii. Citeste prospectul inainte de intalnire, vrea sa compare optiunile si intreaba despre acoperirea pentru boli diagnosticate (BD).',
  objectionTypes: ['coverage_gaps', 'fine_print'],
  maxTurns: 40,
  expectedOutcome: 'purchase',
}

const priceObjector: Persona = {
  slug: 'price-objector',
  name: 'Elena Dumitrescu',
  age: 37,
  language: 'ro',
  occupation: 'Profesoara',
  familySize: 3,
  hasChildren: true,
  incomeLevel: 'medium',
  motivations: [
    'Protectie de baza pentru familie',
    'Prima accesibila cu bugetul de invatamant',
  ],
  personality:
    'Interesata de asigurare, dar contesta pretul de 2-3 ori inainte de a accepta. Compara cu alte oferte pe care le-a vazut online si cere reduceri sau pachete mai mici.',
  objectionTypes: ['price_base', 'competitor_price', 'discount_request'],
  maxTurns: 35,
  expectedOutcome: 'purchase',
}

const skeptic: Persona = {
  slug: 'skeptic',
  name: 'Ion Gheorghe',
  age: 48,
  language: 'ro',
  occupation: 'Mecanic auto',
  familySize: 4,
  hasChildren: true,
  incomeLevel: 'medium',
  motivations: [
    'Protectie pentru familie daca i se intampla ceva',
    'Vrea sa fie convins cu fapte concrete',
  ],
  personality:
    'Neincrezator in companiile de asigurari bazat pe experiente negative din trecut. Pune la indoiala fiecare afirmatie si cere dovezi, statistici sau exemple reale. Se incalzeste daca agentul este direct si onest.',
  objectionTypes: ['trust', 'past_bad_experience', 'claims_difficulty'],
  maxTurns: 45,
  expectedOutcome: 'purchase',
}

const quickBuyer: Persona = {
  slug: 'quick-buyer',
  name: 'Ana Moldovan',
  age: 33,
  language: 'ro',
  occupation: 'Manager vanzari',
  familySize: 2,
  hasChildren: false,
  incomeLevel: 'high',
  motivations: [
    'Protectie rapida si simpla',
    'Nu vrea sa piarda timp cu detalii inutile',
  ],
  personality:
    'Directa si eficienta, stie ce vrea si are buget. Raspunde scurt la intrebari, doreste sa finalizeze rapid. Se enerveaza daca procesul este prea lung sau repetitiv.',
  objectionTypes: ['process_too_long'],
  maxTurns: 20,
  expectedOutcome: 'purchase',
}

const abandoner: Persona = {
  slug: 'abandoner',
  name: 'Vlad Stanescu',
  age: 27,
  language: 'ro',
  occupation: 'Freelancer',
  familySize: 1,
  hasChildren: false,
  incomeLevel: 'low',
  motivations: [
    'Curiozitate generala despre asigurari de viata',
  ],
  personality:
    'Vaneaza informatii, nu este gata sa cumpere. Incepe chestionarul dar se opreste la mijloc cand vede pretul sau cand procesul devine prea serios. Poate reveni mai tarziu.',
  objectionTypes: ['not_ready', 'price_shock', 'no_urgency'],
  maxTurns: 15,
  expectedOutcome: 'abandon',
}

const creditProtector: Persona = {
  slug: 'credit-protector',
  name: 'Cristina Radu',
  age: 40,
  language: 'ro',
  occupation: 'Farmacist',
  familySize: 4,
  hasChildren: true,
  incomeLevel: 'medium',
  motivations: [
    'Acoperirea creditului ipotecar in caz de deces sau invaliditate',
    'Liniste sufleteasca pentru familia cu ipoteca',
    'Conditie impusa de banca pentru credit',
  ],
  personality:
    'Practica si orientata spre protectia ipotecii. Vrea suma asigurata egala cu soldul creditului si durata politei aliniata cu creditul. Nu este interesata de produse suplimentare.',
  objectionTypes: ['scope_creep', 'unnecessary_addons'],
  maxTurns: 30,
  expectedOutcome: 'purchase',
}

const confusedCustomer: Persona = {
  slug: 'confused-customer',
  name: 'Gheorghe Marin',
  age: 55,
  language: 'ro',
  occupation: 'Pensionar',
  familySize: 2,
  hasChildren: false,
  incomeLevel: 'low',
  motivations: [
    'Sa lase ceva familiei dupa ce pleaca',
    'Sa nu fie o povara pentru copii',
  ],
  personality:
    'Bine intentionat dar nesigur pe terminologia de asigurari. Cere explicatii simple, repetate. Se pierde daca sunt prea multe optiuni odata. Apreciaza rabdarea si claritatea agentului.',
  objectionTypes: ['complexity', 'information_overload'],
  maxTurns: 50,
  expectedOutcome: 'purchase',
}

// ==============================================
// EXPORTS
// ==============================================

export const ALL_PERSONAS: Persona[] = [
  youngParent,
  professional,
  priceObjector,
  skeptic,
  quickBuyer,
  abandoner,
  creditProtector,
  confusedCustomer,
]

export function getPersona(slug: string): Persona | undefined {
  return ALL_PERSONAS.find(p => p.slug === slug)
}

export function getPersonasByOutcome(
  outcome: Persona['expectedOutcome']
): Persona[] {
  return ALL_PERSONAS.filter(p => p.expectedOutcome === outcome)
}

// ==============================================
// DEFAULT ANSWERS
// Complete answer map for all questionnaire question codes.
// Used by the simulation engine when a persona does not have
// a specific override for a question.
// ==============================================

export const DEFAULT_ANSWERS: Record<string, string> = {
  // Data needing treatment / consent
  DNT_CONSULTATION_CONSENT: 'yes_all',
  DNT_MARKETING_CONSENT: 'true',
  DNT_ELECTRONIC_COMMUNICATION: 'true',

  // Personal data
  DNT_INCOME_SOURCE: 'salary_pension',
  DNT_OCCUPATION: 'employee',
  DNT_FAMILY_SIZE: '4',
  DNT_MINOR_CHILDREN: '2',
  DNT_EDUCATION: 'university',

  // Life insurance needs analysis
  DNT_LIFE_SUBTYPE: 'simple_protection',
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

  // Investment profile (for unit-linked products)
  DNT_LIFE_INVEST_KNOWLEDGE: 'low',
  DNT_LIFE_INVEST_OBJECTIVES: 'capital_accumulation',
  DNT_LIFE_RISK_TOLERANCE: 'low',

  // Sustainability
  DNT_SUSTAINABILITY_IMPORTANCE: 'not_necessary',
  DNT_SUSTAINABILITY_PREFERENCE: 'no_preference',

  // Health declaration
  HEALTH_DECLARATION_CONFIRM: 'true',

  // Package & payment
  PACKAGE_CHOICE: 'standard',
  PREMIUM_LEVEL: 'level_2',
  BD_ADDON_INTEREST: 'true',
  PAYMENT_FREQUENCY: 'annual',

  // Bonus disease (BD) health questions
  BD_CANCER_HISTORY: 'false',
  BD_CARDIOVASCULAR: 'false',
  BD_NEUROLOGICAL: 'false',
  BD_TRANSPLANT: 'false',
  BD_CHRONIC_CONDITIONS: 'false',
  BD_HOSPITALIZATION_RECENT: 'false',
}
