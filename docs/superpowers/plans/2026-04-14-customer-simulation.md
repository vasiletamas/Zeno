# Customer Simulation Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated customer simulation module that drives realistic conversations against the live chat API, feeding the self-improvement pipeline with scored conversation data.

**Architecture:** Hybrid simulator — 6 scripted golden-path scenarios for deterministic baselines plus LLM-powered freeform personas for discovery. Conversations use `channel='simulation'` and are tracked via `SimulationRun` / `SimulationConversation` tables. Admin dashboard is extended (not separate) to show simulation runs, errors, and simulated-vs-real comparisons.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL 16, Vitest, OpenAI SDK (for customer simulator LLM), existing SSE chat API.

---

## File Structure

```
lib/simulation/
  types.ts                         # Shared interfaces (Persona, ScriptedScenario, SimulationConfig, RunResult)
  personas.ts                      # 8 persona definitions
  sse-client.ts                    # SSE stream parser + HTTP client (adapted from e2e/lib/sse-parser.ts)
  driver.ts                        # Single conversation driver (scripted + freeform modes)
  runner.ts                        # Run orchestration — concurrency pool, progress tracking
  scenarios/
    index.ts                       # Exports all scenarios
    happy-path.ts                  # Full purchase flow
    bd-clause-path.ts              # BD critical illness rider
    price-objection-conversion.ts  # Objects then accepts
    abandon-mid-questionnaire.ts   # Drops mid-DNT
    quote-modification.ts          # Modifies package then accepts
    escalation.ts                  # Requests human agent

scripts/
  simulate.ts                      # CLI entry point (npm run simulate)

app/api/admin/simulation/
  run/route.ts                     # POST — trigger simulation
  runs/route.ts                    # GET — list runs
  runs/[id]/route.ts               # GET — run detail with conversations
  conversations/[id]/route.ts      # GET — full transcript

components/admin/
  simulation-run-panel.tsx         # Run history + trigger button
  simulation-conversation-table.tsx # Conversation list within a run
  simulation-transcript-viewer.tsx  # Chat bubble transcript viewer
  simulation-error-panel.tsx        # Aggregated error view

prisma/migrations/
  20260414000000_add-simulation-tables/migration.sql

prisma/seeds/
  seed-simulator-agent.ts          # Customer-simulator agent config

__tests__/lib/simulation/
  types.test.ts
  personas.test.ts
  sse-client.test.ts
  driver.test.ts
  runner.test.ts
```

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260414000000_add-simulation-tables/migration.sql`

- [ ] **Step 1: Add SimulationRun and SimulationConversation models to schema**

Add to `prisma/schema.prisma` after the `ImprovementProposal` model (around line 760):

```prisma
// ==========================================
// DOMAIN: CUSTOMER SIMULATION
// ==========================================

model SimulationRun {
  id             String    @id @default(cuid())
  status         String    @default("RUNNING")
  trigger        String
  config         Json
  totalScenarios Int
  completedCount Int       @default(0)
  failedCount    Int       @default(0)
  avgScore       Float?
  errors         Json      @default("[]")
  startedAt      DateTime  @default(now())
  completedAt    DateTime?
  createdAt      DateTime  @default(now())

  conversations SimulationConversation[]

  @@index([status])
  @@index([startedAt])
}

model SimulationConversation {
  id             String   @id @default(cuid())
  runId          String
  conversationId String   @unique
  personaSlug    String
  scenarioType   String
  scenarioSlug   String?
  status         String   @default("RUNNING")
  turnCount      Int      @default(0)
  error          String?  @db.Text
  score          Float?
  durationMs     Int?
  createdAt      DateTime @default(now())

  run          SimulationRun @relation(fields: [runId], references: [id])
  conversation Conversation  @relation(fields: [conversationId], references: [id])

  @@index([runId])
  @@index([personaSlug])
}
```

Also add the reverse relation to the `Conversation` model (inside the model block, after the existing relations):

```prisma
  simulationConversation SimulationConversation?
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20260414000000_add-simulation-tables/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "SimulationRun" (
  "id"             TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "trigger"        TEXT NOT NULL,
  "config"         JSONB NOT NULL,
  "totalScenarios" INTEGER NOT NULL,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount"    INTEGER NOT NULL DEFAULT 0,
  "avgScore"       DOUBLE PRECISION,
  "errors"         JSONB NOT NULL DEFAULT '[]',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationConversation" (
  "id"             TEXT NOT NULL,
  "runId"          TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "personaSlug"    TEXT NOT NULL,
  "scenarioType"   TEXT NOT NULL,
  "scenarioSlug"   TEXT,
  "status"         TEXT NOT NULL DEFAULT 'RUNNING',
  "turnCount"      INTEGER NOT NULL DEFAULT 0,
  "error"          TEXT,
  "score"          DOUBLE PRECISION,
  "durationMs"     INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationRun_status_idx" ON "SimulationRun"("status");
CREATE INDEX "SimulationRun_startedAt_idx" ON "SimulationRun"("startedAt");
CREATE UNIQUE INDEX "SimulationConversation_conversationId_key" ON "SimulationConversation"("conversationId");
CREATE INDEX "SimulationConversation_runId_idx" ON "SimulationConversation"("runId");
CREATE INDEX "SimulationConversation_personaSlug_idx" ON "SimulationConversation"("personaSlug");

-- AddForeignKey
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SimulationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SimulationConversation" ADD CONSTRAINT "SimulationConversation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply migration and regenerate client**

Run: `npx prisma migrate deploy && npx prisma generate`

Expected: Migration applied, Prisma Client regenerated with `SimulationRun` and `SimulationConversation` types.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260414000000_add-simulation-tables/
git commit -m "feat(simulation): add SimulationRun and SimulationConversation tables"
```

---

## Task 2: Shared Types

**Files:**
- Create: `lib/simulation/types.ts`
- Test: `__tests__/lib/simulation/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/simulation/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  Persona,
  ScenarioStep,
  ScriptedScenario,
  SimulationConfig,
  ConversationResult,
  RunResult,
} from '@/lib/simulation/types'

describe('simulation types', () => {
  it('Persona interface accepts a valid persona', () => {
    const persona: Persona = {
      slug: 'young-parent',
      name: 'Maria Popescu',
      age: 32,
      language: 'ro',
      occupation: 'Contabil',
      familySize: 4,
      hasChildren: true,
      incomeLevel: 'medium',
      motivations: ['protect family'],
      personality: 'warm, budget-conscious',
      objectionTypes: ['price_base'],
      maxTurns: 30,
      expectedOutcome: 'purchase',
    }
    expect(persona.slug).toBe('young-parent')
  })

  it('ScriptedScenario interface accepts steps with all trigger types', () => {
    const scenario: ScriptedScenario = {
      slug: 'happy-path',
      name: 'Happy Path',
      personaSlug: 'quick-buyer',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna!' } },
        { trigger: { type: 'ui_action', actionType: 'show_question' }, response: { type: 'message', text: 'Da' } },
        { trigger: { type: 'contains', text: 'pret' }, response: { type: 'abandon' } },
      ],
    }
    expect(scenario.steps).toHaveLength(3)
  })

  it('SimulationConfig accepts valid config', () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: true,
      freeformCount: 10,
      concurrency: 3,
      runBatchAfter: true,
      trigger: 'cli',
    }
    expect(config.freeformCount).toBe(10)
  })

  it('RunResult tracks completion stats', () => {
    const result: RunResult = {
      runId: 'test-id',
      status: 'COMPLETED',
      totalScenarios: 16,
      completedCount: 14,
      failedCount: 2,
      conversations: [],
      errors: [],
      durationMs: 60000,
    }
    expect(result.completedCount + result.failedCount).toBe(16)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/simulation/types.test.ts`

Expected: FAIL — module `@/lib/simulation/types` not found.

- [ ] **Step 3: Write the types file**

Create `lib/simulation/types.ts`:

```typescript
/**
 * Customer Simulation — Shared Types
 */

import type { ParsedTurn } from '@/e2e/lib/sse-parser'

// ==============================================
// PERSONA
// ==============================================

export interface Persona {
  slug: string
  name: string
  age: number
  language: 'ro' | 'en'
  occupation: string
  familySize: number
  hasChildren: boolean
  incomeLevel: 'low' | 'medium' | 'high'
  motivations: string[]
  personality: string
  objectionTypes: string[]
  maxTurns: number
  expectedOutcome: 'purchase' | 'abandon' | 'escalate'
}

// ==============================================
// SCRIPTED SCENARIOS
// ==============================================

export interface ScenarioStep {
  trigger:
    | { type: 'turn'; number: number }
    | { type: 'ui_action'; actionType: string }
    | { type: 'contains'; text: string }
  response:
    | { type: 'message'; text: string }
    | { type: 'action'; action: { type: string; payload: Record<string, unknown> } }
    | { type: 'abandon' }
}

export interface ScriptedScenario {
  slug: string
  name: string
  personaSlug: string
  steps: ScenarioStep[]
}

// ==============================================
// CONFIGURATION
// ==============================================

export interface SimulationConfig {
  runScripted: boolean
  runFreeform: boolean
  freeformCount: number
  personas?: string[]
  concurrency: number
  runBatchAfter: boolean
  trigger: 'cli' | 'admin' | 'scheduled'
}

export const DEFAULT_CONFIG: SimulationConfig = {
  runScripted: true,
  runFreeform: true,
  freeformCount: 10,
  concurrency: 3,
  runBatchAfter: true,
  trigger: 'cli',
}

// ==============================================
// RESULTS
// ==============================================

export interface ConversationResult {
  conversationId: string
  personaSlug: string
  scenarioType: 'scripted' | 'freeform'
  scenarioSlug: string | null
  status: 'COMPLETED' | 'FAILED' | 'ABANDONED'
  turnCount: number
  durationMs: number
  error: string | null
  /** Last parsed turn for debugging */
  lastTurn: ParsedTurn | null
}

export interface RunResult {
  runId: string
  status: 'COMPLETED' | 'FAILED'
  totalScenarios: number
  completedCount: number
  failedCount: number
  conversations: ConversationResult[]
  errors: string[]
  durationMs: number
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/simulation/types.test.ts`

Expected: PASS — all 4 type-check tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/simulation/types.ts __tests__/lib/simulation/types.test.ts
git commit -m "feat(simulation): add shared types for personas, scenarios, config, results"
```

---

## Task 3: Persona Definitions

**Files:**
- Create: `lib/simulation/personas.ts`
- Test: `__tests__/lib/simulation/personas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/simulation/personas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ALL_PERSONAS, getPersona, getPersonasByOutcome, DEFAULT_ANSWERS } from '@/lib/simulation/personas'

describe('personas', () => {
  it('exports 8 personas', () => {
    expect(ALL_PERSONAS).toHaveLength(8)
  })

  it('each persona has a unique slug', () => {
    const slugs = ALL_PERSONAS.map(p => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('each persona has required fields', () => {
    for (const p of ALL_PERSONAS) {
      expect(p.slug).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.age).toBeGreaterThan(0)
      expect(['ro', 'en']).toContain(p.language)
      expect(p.maxTurns).toBeGreaterThan(0)
      expect(['purchase', 'abandon', 'escalate']).toContain(p.expectedOutcome)
      expect(p.personality).toBeTruthy()
    }
  })

  it('getPersona returns persona by slug', () => {
    const p = getPersona('skeptic')
    expect(p).toBeDefined()
    expect(p!.name).toBe('Ion Gheorghe')
  })

  it('getPersona returns undefined for unknown slug', () => {
    expect(getPersona('nonexistent')).toBeUndefined()
  })

  it('getPersonasByOutcome filters correctly', () => {
    const purchasers = getPersonasByOutcome('purchase')
    expect(purchasers.length).toBeGreaterThan(0)
    expect(purchasers.every(p => p.expectedOutcome === 'purchase')).toBe(true)

    const abandoners = getPersonasByOutcome('abandon')
    expect(abandoners.length).toBeGreaterThan(0)
  })

  it('DEFAULT_ANSWERS covers all DNT and application question codes', () => {
    expect(DEFAULT_ANSWERS['DNT_CONSULTATION_CONSENT']).toBeDefined()
    expect(DEFAULT_ANSWERS['PACKAGE_CHOICE']).toBeDefined()
    expect(DEFAULT_ANSWERS['BD_CANCER_HISTORY']).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/simulation/personas.test.ts`

Expected: FAIL — module `@/lib/simulation/personas` not found.

- [ ] **Step 3: Write the personas file**

Create `lib/simulation/personas.ts`:

```typescript
/**
 * Customer Simulation — Persona Definitions
 *
 * 8 personas covering the spectrum of Romanian insurance customers.
 * Used by both scripted scenarios and LLM-powered freeform runs.
 */

import type { Persona } from './types'

// ==============================================
// PERSONAS
// ==============================================

export const ALL_PERSONAS: Persona[] = [
  {
    slug: 'young-parent',
    name: 'Maria Popescu',
    age: 32,
    language: 'ro',
    occupation: 'Contabil',
    familySize: 4,
    hasChildren: true,
    incomeLevel: 'medium',
    motivations: ['protect family', 'children future'],
    personality: 'Warm, family-oriented, budget-conscious. Asks about coverage for children. Wants to understand what happens if something happens to her. Speaks simply, no jargon.',
    objectionTypes: ['price_base'],
    maxTurns: 30,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'professional',
    name: 'Andrei Ionescu',
    age: 42,
    language: 'ro',
    occupation: 'Director IT',
    familySize: 3,
    hasChildren: true,
    incomeLevel: 'high',
    motivations: ['comprehensive coverage', 'critical illness protection'],
    personality: 'Analytical, asks detailed questions about coverage amounts and exclusions. Wants the best package, not the cheapest. Interested in BD (boli grave) addon. Speaks professionally.',
    objectionTypes: [],
    maxTurns: 35,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'price-objector',
    name: 'Elena Dumitrescu',
    age: 37,
    language: 'ro',
    occupation: 'Profesoara',
    familySize: 3,
    hasChildren: true,
    incomeLevel: 'low',
    motivations: ['protect family'],
    personality: 'Interested but very price-sensitive. Always asks "cat costa?" and "nu e prea scump?". Needs to be convinced that the value justifies the cost. Will push back 2-3 times before accepting.',
    objectionTypes: ['price_base', 'price_total'],
    maxTurns: 35,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'skeptic',
    name: 'Ion Gheorghe',
    age: 48,
    language: 'ro',
    occupation: 'Mecanic auto',
    familySize: 2,
    hasChildren: false,
    incomeLevel: 'medium',
    motivations: ['spouse protection'],
    personality: 'Distrustful of insurance companies. Says things like "toate firmele de asigurari sunt la fel" and "nu am nevoie". Needs proof, statistics, real examples. Slowly warms up if given concrete answers.',
    objectionTypes: ['no_trust', 'no_need'],
    maxTurns: 40,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'quick-buyer',
    name: 'Ana Moldovan',
    age: 33,
    language: 'ro',
    occupation: 'Manager vanzari',
    familySize: 4,
    hasChildren: true,
    incomeLevel: 'high',
    motivations: ['protect family', 'already researched'],
    personality: 'Has already researched insurance online. Knows what she wants. Gives direct answers, no small talk. Wants to finish quickly. Says "da" a lot.',
    objectionTypes: [],
    maxTurns: 20,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'abandoner',
    name: 'Vlad Stanescu',
    age: 27,
    language: 'ro',
    occupation: 'Freelancer',
    familySize: 1,
    hasChildren: false,
    incomeLevel: 'medium',
    motivations: ['curiosity'],
    personality: 'Just browsing, not seriously interested. Gives short answers. After a few questions, says "trebuie sa ma gandesc" or just stops responding. Not rude, just disengaged.',
    objectionTypes: ['need_to_think'],
    maxTurns: 10,
    expectedOutcome: 'abandon',
  },
  {
    slug: 'credit-protector',
    name: 'Cristina Radu',
    age: 40,
    language: 'ro',
    occupation: 'Farmacist',
    familySize: 3,
    hasChildren: true,
    incomeLevel: 'medium',
    motivations: ['mortgage protection', 'family safety net'],
    personality: 'Recently took a mortgage and wants protection in case something happens. Focused on the loan amount. Asks about how the payout works if she passes away. Practical, wants clear numbers.',
    objectionTypes: [],
    maxTurns: 30,
    expectedOutcome: 'purchase',
  },
  {
    slug: 'confused-customer',
    name: 'Gheorghe Marin',
    age: 55,
    language: 'ro',
    occupation: 'Pensionar',
    familySize: 2,
    hasChildren: false,
    incomeLevel: 'low',
    motivations: ['spouse protection', 'peace of mind'],
    personality: 'Not comfortable with technology or insurance terms. Asks the same question multiple ways. Needs simple explanations. Says "nu inteleg" often. Very polite. Eventually trusts the agent if patient.',
    objectionTypes: [],
    maxTurns: 45,
    expectedOutcome: 'purchase',
  },
]

// ==============================================
// LOOKUP HELPERS
// ==============================================

const personaMap = new Map(ALL_PERSONAS.map(p => [p.slug, p]))

export function getPersona(slug: string): Persona | undefined {
  return personaMap.get(slug)
}

export function getPersonasByOutcome(outcome: Persona['expectedOutcome']): Persona[] {
  return ALL_PERSONAS.filter(p => p.expectedOutcome === outcome)
}

// ==============================================
// DEFAULT ANSWER MAP
// ==============================================

/**
 * Complete answer map for questionnaire questions.
 * Reused from e2e/lib/personas.ts — single source of truth for deterministic answers.
 * Keys are question codes; values are the answer to submit.
 */
export const DEFAULT_ANSWERS: Record<string, string> = {
  // DNT consent
  DNT_CONSULTATION_CONSENT: 'yes_all',
  DNT_MARKETING_CONSENT: 'true',
  DNT_ELECTRONIC_COMMUNICATION: 'true',

  // DNT general
  DNT_CNP: '1880515123456',
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/simulation/personas.test.ts`

Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/simulation/personas.ts __tests__/lib/simulation/personas.test.ts
git commit -m "feat(simulation): add 8 customer persona definitions with answer maps"
```

---

## Task 4: SSE Client

**Files:**
- Create: `lib/simulation/sse-client.ts`
- Test: `__tests__/lib/simulation/sse-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/simulation/sse-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSimulationConversation, sendSimulationMessage, setSimulationChannel } from '@/lib/simulation/sse-client'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

describe('sse-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createSimulationConversation calls session and create endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ customerId: 'cust-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conversationId: 'conv-1' }),
      })

    const result = await createSimulationConversation('http://localhost:3000')
    expect(result).toEqual({ customerId: 'cust-1', conversationId: 'conv-1' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/api/session', expect.objectContaining({ method: 'POST' }))
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://localhost:3000/api/chat/create', expect.objectContaining({ method: 'POST' }))
  })

  it('createSimulationConversation throws on session failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'error' })
    await expect(createSimulationConversation('http://localhost:3000')).rejects.toThrow('POST /api/session failed')
  })

  it('sendSimulationMessage parses SSE content events', async () => {
    const sseBody = 'event: content\ndata: {"text":"Hello"}\n\nevent: content\ndata: {"text":" world"}\n\nevent: done\ndata: {"messageId":"m1"}\n\n'
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream })

    const result = await sendSimulationMessage('conv-1', 'cust-1', 'test message', 'http://localhost:3000')
    expect(result.content).toBe('Hello world')
    expect(result.done).toEqual({ messageId: 'm1' })
    expect(result.errors).toHaveLength(0)
  })

  it('sendSimulationMessage parses tool and ui_action events', async () => {
    const sseBody = [
      'event: tool_start\ndata: {"tool":"list_products"}\n',
      'event: tool_complete\ndata: {"tool":"list_products","success":true}\n',
      'event: ui_action\ndata: {"type":"show_question","payload":{"code":"AGE"}}\n',
      'event: content\ndata: {"text":"response"}\n',
      'event: done\ndata: {}\n',
    ].join('\n')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream })

    const result = await sendSimulationMessage('conv-1', 'cust-1', 'test', 'http://localhost:3000')
    expect(result.toolsCalled).toEqual(['list_products'])
    expect(result.uiActions).toHaveLength(1)
    expect(result.uiActions[0].type).toBe('show_question')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/simulation/sse-client.test.ts`

Expected: FAIL — module `@/lib/simulation/sse-client` not found.

- [ ] **Step 3: Write the SSE client**

Create `lib/simulation/sse-client.ts`:

```typescript
/**
 * SSE Client for Customer Simulation
 *
 * HTTP client that calls the chat API and parses SSE responses.
 * Adapted from e2e/lib/sse-parser.ts for use in the simulation module.
 */

import { prisma } from '@/lib/db'

// ==============================================
// TYPES (inline — mirrors e2e/lib/sse-parser.ts)
// ==============================================

export interface ParsedTurn {
  content: string
  toolsCalled: string[]
  uiActions: { type: string; payload: Record<string, unknown> }[]
  errors: string[]
  done: Record<string, unknown> | null
  rawEvents: { event: string; data: unknown }[]
}

// ==============================================
// SSE PARSING
// ==============================================

function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  let eventType = 'message'
  let dataStr = ''

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataStr += line.slice('data:'.length).trim()
    }
  }

  if (!dataStr) return null

  try {
    return { event: eventType, data: JSON.parse(dataStr) }
  } catch {
    return { event: eventType, data: dataStr }
  }
}

async function parseSSEStream(stream: ReadableStream<Uint8Array>): Promise<ParsedTurn> {
  const turn: ParsedTurn = {
    content: '',
    toolsCalled: [],
    uiActions: [],
    errors: [],
    done: null,
    rawEvents: [],
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const trimmed = frame.trim()
          if (!trimmed) continue
          const parsed = parseSSEFrame(trimmed)
          if (parsed) routeEvent(turn, parsed.event, parsed.data)
        }
      }

      if (done) break
    }

    if (buffer.trim()) {
      const parsed = parseSSEFrame(buffer.trim())
      if (parsed) routeEvent(turn, parsed.event, parsed.data)
    }
  } finally {
    reader.releaseLock()
  }

  return turn
}

function routeEvent(turn: ParsedTurn, eventType: string, data: unknown): void {
  turn.rawEvents.push({ event: eventType, data })

  switch (eventType) {
    case 'content': {
      const d = data as Record<string, unknown>
      turn.content += (typeof d.text === 'string' ? d.text : '') || (typeof d.content === 'string' ? d.content : '')
      break
    }
    case 'tool_start': {
      const d = data as Record<string, unknown>
      const name = (typeof d.tool === 'string' ? d.tool : null) ?? (typeof d.name === 'string' ? d.name : null)
      if (name) turn.toolsCalled.push(name)
      break
    }
    case 'ui_action': {
      const d = data as Record<string, unknown>
      if (typeof d.type === 'string') {
        turn.uiActions.push({ type: d.type, payload: (d.payload as Record<string, unknown>) ?? {} })
      }
      break
    }
    case 'error': {
      const d = data as Record<string, unknown>
      turn.errors.push(typeof d.message === 'string' ? d.message : typeof d.error === 'string' ? d.error : JSON.stringify(d))
      break
    }
    case 'done':
      turn.done = data as Record<string, unknown>
      break
  }
}

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Create a new conversation for simulation.
 * Calls /api/session + /api/chat/create.
 */
export async function createSimulationConversation(
  baseUrl: string,
): Promise<{ customerId: string; conversationId: string }> {
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!sessionRes.ok) {
    throw new Error(`POST /api/session failed (${sessionRes.status}): ${await sessionRes.text()}`)
  }
  const { customerId } = (await sessionRes.json()) as { customerId: string }

  const createRes = await fetch(`${baseUrl}/api/chat/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  })
  if (!createRes.ok) {
    throw new Error(`POST /api/chat/create failed (${createRes.status}): ${await createRes.text()}`)
  }
  const { conversationId } = (await createRes.json()) as { conversationId: string }

  return { customerId, conversationId }
}

/**
 * Set the conversation channel to 'simulation'.
 */
export async function setSimulationChannel(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { channel: 'simulation' },
  })
}

/**
 * Send a text message and parse the full SSE response.
 */
export async function sendSimulationMessage(
  conversationId: string,
  customerId: string,
  message: string,
  baseUrl: string,
): Promise<ParsedTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, customerId, message }),
  })

  if (!response.ok) {
    throw new Error(`POST /api/chat failed (${response.status}): ${await response.text()}`)
  }
  if (!response.body) {
    throw new Error('POST /api/chat returned no body')
  }

  return parseSSEStream(response.body)
}

/**
 * Send a UI action and parse the full SSE response.
 */
export async function sendSimulationAction(
  conversationId: string,
  customerId: string,
  action: { type: string; payload: Record<string, unknown> },
  baseUrl: string,
): Promise<ParsedTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, customerId, action }),
  })

  if (!response.ok) {
    throw new Error(`POST /api/chat (action) failed (${response.status}): ${await response.text()}`)
  }
  if (!response.body) {
    throw new Error('POST /api/chat (action) returned no body')
  }

  return parseSSEStream(response.body)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/simulation/sse-client.test.ts`

Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/simulation/sse-client.ts __tests__/lib/simulation/sse-client.test.ts
git commit -m "feat(simulation): add SSE client for programmatic chat API calls"
```

---

## Task 5: Conversation Driver

**Files:**
- Create: `lib/simulation/driver.ts`
- Test: `__tests__/lib/simulation/driver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/simulation/driver.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { driveConversation } from '@/lib/simulation/driver'
import type { Persona, ScriptedScenario } from '@/lib/simulation/types'

// Mock SSE client
vi.mock('@/lib/simulation/sse-client', () => ({
  createSimulationConversation: vi.fn().mockResolvedValue({ customerId: 'cust-1', conversationId: 'conv-1' }),
  setSimulationChannel: vi.fn().mockResolvedValue(undefined),
  sendSimulationMessage: vi.fn(),
}))

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    simulationConversation: {
      create: vi.fn().mockResolvedValue({ id: 'sc-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock OpenAI for freeform LLM
vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Da, sunt interesat' } }],
        }),
      },
    }
  },
}))

import { sendSimulationMessage } from '@/lib/simulation/sse-client'

const mockSend = vi.mocked(sendSimulationMessage)

describe('driveConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const testPersona: Persona = {
    slug: 'test-persona',
    name: 'Test User',
    age: 35,
    language: 'ro',
    occupation: 'Tester',
    familySize: 2,
    hasChildren: false,
    incomeLevel: 'medium',
    motivations: ['testing'],
    personality: 'Direct, gives short answers.',
    objectionTypes: [],
    maxTurns: 5,
    expectedOutcome: 'purchase',
  }

  it('runs a scripted scenario to completion', async () => {
    const scenario: ScriptedScenario = {
      slug: 'test-scenario',
      name: 'Test Scenario',
      personaSlug: 'test-persona',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua' } },
        { trigger: { type: 'turn', number: 2 }, response: { type: 'message', text: 'Da' } },
      ],
    }

    // Turn 0 (greeting): agent responds
    mockSend.mockResolvedValueOnce({
      content: 'Buna! Cu ce te pot ajuta?',
      toolsCalled: [],
      uiActions: [],
      errors: [],
      done: { messageId: 'm1' },
      rawEvents: [],
    })
    // Turn 1: agent responds
    mockSend.mockResolvedValueOnce({
      content: 'Perfect, continuam.',
      toolsCalled: [],
      uiActions: [],
      errors: [],
      done: { messageId: 'm2' },
      rawEvents: [],
    })
    // Turn 2: agent responds, then no more steps → stop
    mockSend.mockResolvedValueOnce({
      content: 'Multumesc!',
      toolsCalled: [],
      uiActions: [{ type: 'show_payment_success', payload: {} }],
      errors: [],
      done: { messageId: 'm3' },
      rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.conversationId).toBe('conv-1')
    expect(result.turnCount).toBeGreaterThan(0)
  })

  it('stops on abandon response', async () => {
    const scenario: ScriptedScenario = {
      slug: 'abandon-test',
      name: 'Abandon Test',
      personaSlug: 'test-persona',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'abandon' } },
      ],
    }

    mockSend.mockResolvedValueOnce({
      content: 'Buna!',
      toolsCalled: [],
      uiActions: [],
      errors: [],
      done: { messageId: 'm1' },
      rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('ABANDONED')
  })

  it('records error when SSE returns errors', async () => {
    mockSend.mockResolvedValueOnce({
      content: '',
      toolsCalled: [],
      uiActions: [],
      errors: ['Service unavailable'],
      done: null,
      rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('Service unavailable')
  })

  it('respects maxTurns limit', async () => {
    const limitedPersona = { ...testPersona, maxTurns: 2 }

    mockSend.mockResolvedValue({
      content: 'response',
      toolsCalled: [],
      uiActions: [],
      errors: [],
      done: { messageId: 'm1' },
      rawEvents: [],
    })

    const result = await driveConversation({
      persona: limitedPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.turnCount).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/simulation/driver.test.ts`

Expected: FAIL — module `@/lib/simulation/driver` not found.

- [ ] **Step 3: Write the conversation driver**

Create `lib/simulation/driver.ts`:

```typescript
/**
 * Conversation Driver
 *
 * Drives a single simulated conversation end-to-end.
 * Supports both scripted scenarios (deterministic) and freeform (LLM-powered).
 */

import OpenAI from 'openai'
import { prisma } from '@/lib/db'
import {
  createSimulationConversation,
  setSimulationChannel,
  sendSimulationMessage,
  type ParsedTurn,
} from './sse-client'
import type { Persona, ScriptedScenario, ScenarioStep, ConversationResult } from './types'

// ==============================================
// TYPES
// ==============================================

export interface DriverOptions {
  persona: Persona
  scenario: ScriptedScenario | null   // null = freeform
  runId: string
  baseUrl: string
  answersMap: Record<string, string>
}

// ==============================================
// CONSTANTS
// ==============================================

const TERMINAL_UI_ACTIONS = new Set([
  'show_payment_success',
  'show_policy_issued',
])

const MAX_CONSECUTIVE_ERRORS = 3

// ==============================================
// LLM CLIENT (lazy singleton for freeform)
// ==============================================

let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI()
  return _openai
}

// ==============================================
// SCRIPTED STEP MATCHING
// ==============================================

function matchStep(
  steps: ScenarioStep[],
  turnNumber: number,
  lastTurn: ParsedTurn | null,
): ScenarioStep | null {
  for (const step of steps) {
    const t = step.trigger
    if (t.type === 'turn' && t.number === turnNumber) return step
    if (t.type === 'ui_action' && lastTurn?.uiActions.some(a => a.type === t.actionType)) return step
    if (t.type === 'contains' && lastTurn?.content.toLowerCase().includes(t.text.toLowerCase())) return step
  }
  return null
}

// ==============================================
// QUESTION ANSWER LOOKUP
// ==============================================

function extractQuestionCode(payload: Record<string, unknown>): string | null {
  if (payload.question && typeof payload.question === 'object') {
    const q = payload.question as Record<string, unknown>
    if (typeof q.code === 'string') return q.code
  }
  if (typeof payload.code === 'string') return payload.code
  if (typeof payload.questionCode === 'string') return payload.questionCode
  return null
}

function getQuestionAnswer(
  uiActions: { type: string; payload: Record<string, unknown> }[],
  answersMap: Record<string, string>,
): string | null {
  for (const action of uiActions) {
    if (action.type === 'show_question') {
      const code = extractQuestionCode(action.payload)
      if (code && answersMap[code] !== undefined) return answersMap[code]
    }
  }
  return null
}

function getProductCardResponse(
  uiActions: { type: string; payload: Record<string, unknown> }[],
  answersMap: Record<string, string>,
): string | null {
  if (!uiActions.some(a => a.type === 'show_product_cards')) return null
  const tier = answersMap['PACKAGE_CHOICE'] ?? 'standard'
  const level = answersMap['PREMIUM_LEVEL'] ?? 'level_2'
  return `Vreau ${tier.charAt(0).toUpperCase() + tier.slice(1)} ${level.replace('level_', 'Nivelul ')}`
}

function getQuoteResponse(uiActions: { type: string; payload: Record<string, unknown> }[]): string | null {
  if (uiActions.some(a => a.type === 'show_quote')) return 'Da, accept oferta'
  return null
}

function getPaymentResponse(uiActions: { type: string; payload: Record<string, unknown> }[]): string | null {
  if (uiActions.some(a => a.type === 'show_payment')) return 'Simulez plata'
  return null
}

function getBdResponse(uiActions: { type: string; payload: Record<string, unknown> }[]): string | null {
  if (uiActions.some(a => a.type === 'show_bd_result' || a.type === 'show_bd_rejected')) return 'Da, continua'
  return null
}

// ==============================================
// FREEFORM LLM RESPONSE
// ==============================================

async function generateFreeformResponse(
  persona: Persona,
  agentMessage: string,
  conversationHistory: { role: string; content: string }[],
): Promise<string> {
  const openai = getOpenAI()
  const systemPrompt = [
    `Esti ${persona.name}, ${persona.occupation} roman de ${persona.age} de ani.`,
    `Familie: ${persona.familySize} persoane. Venit: ${persona.incomeLevel}.`,
    `Personalitate: ${persona.personality}`,
    `Motivatii: ${persona.motivations.join(', ')}.`,
    `Raspunsurile tale sunt SCURTE (1-3 propozitii). Vorbesti romana natural.`,
  ].join(' ')

  const recent = conversationHistory.slice(-4).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.8,
      max_tokens: 150,
      messages: [
        { role: 'system', content: systemPrompt },
        ...recent,
        { role: 'user', content: `Agentul a spus: "${agentMessage.slice(0, 500)}". Raspunde ca ${persona.name}.` },
      ],
    })
    return response.choices[0]?.message?.content || 'Da'
  } catch {
    return 'Da'
  }
}

// ==============================================
// MAIN DRIVER
// ==============================================

export async function driveConversation(options: DriverOptions): Promise<ConversationResult> {
  const { persona, scenario, runId, baseUrl, answersMap } = options
  const startMs = Date.now()
  let conversationId = ''
  let customerId = ''
  let turnCount = 0
  let lastTurn: ParsedTurn | null = null
  let consecutiveErrors = 0
  const conversationHistory: { role: string; content: string }[] = []

  try {
    // 1. Create conversation
    const created = await createSimulationConversation(baseUrl)
    conversationId = created.conversationId
    customerId = created.customerId

    // 2. Mark as simulation
    await setSimulationChannel(conversationId)

    // 3. Create SimulationConversation record
    await prisma.simulationConversation.create({
      data: {
        runId,
        conversationId,
        personaSlug: persona.slug,
        scenarioType: scenario ? 'scripted' : 'freeform',
        scenarioSlug: scenario?.slug ?? null,
      },
    })

    // 4. Send opening message
    const openingMessage = `Buna ziua, sunt interesat de o asigurare de viata.`
    lastTurn = await sendSimulationMessage(conversationId, customerId, openingMessage, baseUrl)
    conversationHistory.push({ role: 'user', content: openingMessage })
    conversationHistory.push({ role: 'assistant', content: lastTurn.content })
    turnCount++

    if (lastTurn.errors.length > 0) {
      throw new Error(`Turn 1 errors: ${lastTurn.errors.join('; ')}`)
    }

    // 5. Conversation loop
    while (turnCount < persona.maxTurns) {
      // Check for terminal UI actions
      if (lastTurn.uiActions.some(a => TERMINAL_UI_ACTIONS.has(a.type))) {
        break
      }

      // Determine next customer message
      let customerMessage: string | null = null

      // Priority 1: Scripted step match
      if (scenario) {
        const step = matchStep(scenario.steps, turnCount + 1, lastTurn)
        if (step) {
          if (step.response.type === 'abandon') {
            await prisma.simulationConversation.update({
              where: { conversationId },
              data: { status: 'ABANDONED', turnCount, durationMs: Date.now() - startMs },
            })
            return {
              conversationId,
              personaSlug: persona.slug,
              scenarioType: 'scripted',
              scenarioSlug: scenario.slug,
              status: 'ABANDONED',
              turnCount,
              durationMs: Date.now() - startMs,
              error: null,
              lastTurn,
            }
          }
          customerMessage = step.response.type === 'message' ? step.response.text : null
        }
      }

      // Priority 2: Deterministic UI action responses
      if (!customerMessage) customerMessage = getQuestionAnswer(lastTurn.uiActions, answersMap)
      if (!customerMessage) customerMessage = getProductCardResponse(lastTurn.uiActions, answersMap)
      if (!customerMessage) customerMessage = getQuoteResponse(lastTurn.uiActions)
      if (!customerMessage) customerMessage = getPaymentResponse(lastTurn.uiActions)
      if (!customerMessage) customerMessage = getBdResponse(lastTurn.uiActions)

      // Priority 3: Freeform LLM
      if (!customerMessage) {
        customerMessage = await generateFreeformResponse(persona, lastTurn.content, conversationHistory)
      }

      // Send the message
      lastTurn = await sendSimulationMessage(conversationId, customerId, customerMessage, baseUrl)
      conversationHistory.push({ role: 'user', content: customerMessage })
      conversationHistory.push({ role: 'assistant', content: lastTurn.content })
      turnCount++

      // Update progress
      await prisma.simulationConversation.update({
        where: { conversationId },
        data: { turnCount },
      })

      // Error handling
      if (lastTurn.errors.length > 0) {
        consecutiveErrors++
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${lastTurn.errors.join('; ')}`)
        }
      } else {
        consecutiveErrors = 0
      }
    }

    // Success
    const durationMs = Date.now() - startMs
    await prisma.simulationConversation.update({
      where: { conversationId },
      data: { status: 'COMPLETED', turnCount, durationMs },
    })

    return {
      conversationId,
      personaSlug: persona.slug,
      scenarioType: scenario ? 'scripted' : 'freeform',
      scenarioSlug: scenario?.slug ?? null,
      status: 'COMPLETED',
      turnCount,
      durationMs,
      error: null,
      lastTurn,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const durationMs = Date.now() - startMs

    if (conversationId) {
      await prisma.simulationConversation.update({
        where: { conversationId },
        data: { status: 'FAILED', turnCount, durationMs, error: errorMsg },
      }).catch(() => {})
    }

    return {
      conversationId,
      personaSlug: persona.slug,
      scenarioType: scenario ? 'scripted' : 'freeform',
      scenarioSlug: scenario?.slug ?? null,
      status: 'FAILED',
      turnCount,
      durationMs,
      error: errorMsg,
      lastTurn,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/simulation/driver.test.ts`

Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/simulation/driver.ts __tests__/lib/simulation/driver.test.ts
git commit -m "feat(simulation): add conversation driver with scripted + freeform modes"
```

---

## Task 6: Scripted Scenarios

**Files:**
- Create: `lib/simulation/scenarios/index.ts`
- Create: `lib/simulation/scenarios/happy-path.ts`
- Create: `lib/simulation/scenarios/bd-clause-path.ts`
- Create: `lib/simulation/scenarios/price-objection-conversion.ts`
- Create: `lib/simulation/scenarios/abandon-mid-questionnaire.ts`
- Create: `lib/simulation/scenarios/quote-modification.ts`
- Create: `lib/simulation/scenarios/escalation.ts`

- [ ] **Step 1: Create happy-path scenario**

Create `lib/simulation/scenarios/happy-path.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const happyPath: ScriptedScenario = {
  slug: 'happy-path',
  name: 'Happy Path — Full Purchase',
  personaSlug: 'quick-buyer',
  steps: [
    // Opening: show interest
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, vreau o asigurare de viata pentru familie. Am 33 de ani, casatorita, 2 copii.' } },
    // After agent pitches product
    { trigger: { type: 'contains', text: 'Protect' }, response: { type: 'message', text: 'Da, sunt interesata. Ce trebuie sa fac?' } },
    // If agent asks about critical illness
    { trigger: { type: 'contains', text: 'boli grave' }, response: { type: 'message', text: 'Da, ma intereseaza si clauza pentru boli grave.' } },
    // Quote acceptance is handled by deterministic UI action logic in driver
    // Payment is handled by deterministic UI action logic in driver
  ],
}

export default happyPath
```

- [ ] **Step 2: Create bd-clause-path scenario**

Create `lib/simulation/scenarios/bd-clause-path.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const bdClausePath: ScriptedScenario = {
  slug: 'bd-clause-path',
  name: 'BD Clause — Critical Illness Rider',
  personaSlug: 'professional',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua, sunt interesat de o asigurare completa cu protectie pentru boli grave. Am 42 de ani, director IT.' } },
    { trigger: { type: 'contains', text: 'Protect' }, response: { type: 'message', text: 'Vreau varianta cea mai completa, inclusiv BD. Care sunt acoperirile exacte?' } },
    { trigger: { type: 'contains', text: 'addon' }, response: { type: 'message', text: 'Da, vreau addon-ul pentru tratament medical in strainatate.' } },
    { trigger: { type: 'contains', text: 'intrebari medicale' }, response: { type: 'message', text: 'Sunt sanatos, nu am probleme medicale. Sa continuam.' } },
  ],
}

export default bdClausePath
```

- [ ] **Step 3: Create price-objection-conversion scenario**

Create `lib/simulation/scenarios/price-objection-conversion.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const priceObjectionConversion: ScriptedScenario = {
  slug: 'price-objection-conversion',
  name: 'Price Objection → Conversion',
  personaSlug: 'price-objector',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, vreau sa vad cat costa o asigurare de viata. Am 37 de ani, profesoara, 1 copil.' } },
    { trigger: { type: 'contains', text: 'RON' }, response: { type: 'message', text: 'E cam scump... nu aveti ceva mai ieftin?' } },
    { trigger: { type: 'contains', text: 'nivel' }, response: { type: 'message', text: 'Hmm, tot mi se pare mult. Chiar merita?' } },
    { trigger: { type: 'contains', text: 'protectie' }, response: { type: 'message', text: 'OK, hai sa vedem varianta standard, nivelul 1. Cea mai ieftina.' } },
    // After reconsidering, accept
    { trigger: { type: 'ui_action', actionType: 'show_quote' }, response: { type: 'message', text: 'Bon, accept. Hai sa facem.' } },
  ],
}

export default priceObjectionConversion
```

- [ ] **Step 4: Create abandon-mid-questionnaire scenario**

Create `lib/simulation/scenarios/abandon-mid-questionnaire.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const abandonMidQuestionnaire: ScriptedScenario = {
  slug: 'abandon-mid-questionnaire',
  name: 'Abandon Mid-Questionnaire',
  personaSlug: 'abandoner',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Salut, vreau sa vad ce asigurari aveti. Am 27 de ani.' } },
    { trigger: { type: 'contains', text: 'intreb' }, response: { type: 'message', text: 'OK dar nu dureaza mult, nu?' } },
    // Answer first 3 questions, then abandon
    { trigger: { type: 'turn', number: 6 }, response: { type: 'message', text: 'Stai, trebuie sa plec. Revin mai tarziu.' } },
    { trigger: { type: 'turn', number: 7 }, response: { type: 'abandon' } },
  ],
}

export default abandonMidQuestionnaire
```

- [ ] **Step 5: Create quote-modification scenario**

Create `lib/simulation/scenarios/quote-modification.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const quoteModification: ScriptedScenario = {
  slug: 'quote-modification',
  name: 'Quote Modification — Change Package',
  personaSlug: 'young-parent',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna, sunt Maria, 32 de ani, 2 copii. Vreau o asigurare de viata.' } },
    { trigger: { type: 'contains', text: 'pachet' }, response: { type: 'message', text: 'Vreau sa vad pachetul Optim, nivelul 2.' } },
    // First quote → ask to change
    { trigger: { type: 'ui_action', actionType: 'show_quote' }, response: { type: 'message', text: 'E prea scump, pot sa schimb la Standard nivel 1?' } },
    // After modification flow, driver handles the rest via deterministic logic
  ],
}

export default quoteModification
```

- [ ] **Step 6: Create escalation scenario**

Create `lib/simulation/scenarios/escalation.ts`:

```typescript
import type { ScriptedScenario } from '../types'

const escalation: ScriptedScenario = {
  slug: 'escalation',
  name: 'Escalation — Request Human Agent',
  personaSlug: 'confused-customer',
  steps: [
    { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua, am 55 de ani si vreau o asigurare dar nu ma pricep deloc la astea.' } },
    { trigger: { type: 'turn', number: 3 }, response: { type: 'message', text: 'Nu inteleg, puteti sa imi explicati mai simplu?' } },
    { trigger: { type: 'turn', number: 5 }, response: { type: 'message', text: 'Tot nu inteleg. Pot sa vorbesc cu cineva la telefon?' } },
    { trigger: { type: 'turn', number: 7 }, response: { type: 'message', text: 'Vreau sa vorbesc cu un om, va rog. Nu ma descurc online.' } },
  ],
}

export default escalation
```

- [ ] **Step 7: Create scenario index**

Create `lib/simulation/scenarios/index.ts`:

```typescript
import type { ScriptedScenario } from '../types'
import happyPath from './happy-path'
import bdClausePath from './bd-clause-path'
import priceObjectionConversion from './price-objection-conversion'
import abandonMidQuestionnaire from './abandon-mid-questionnaire'
import quoteModification from './quote-modification'
import escalation from './escalation'

export const ALL_SCENARIOS: ScriptedScenario[] = [
  happyPath,
  bdClausePath,
  priceObjectionConversion,
  abandonMidQuestionnaire,
  quoteModification,
  escalation,
]

const scenarioMap = new Map(ALL_SCENARIOS.map(s => [s.slug, s]))

export function getScenario(slug: string): ScriptedScenario | undefined {
  return scenarioMap.get(slug)
}
```

- [ ] **Step 8: Commit**

```bash
git add lib/simulation/scenarios/
git commit -m "feat(simulation): add 6 scripted scenarios (happy-path through escalation)"
```

---

## Task 7: Run Orchestration

**Files:**
- Create: `lib/simulation/runner.ts`
- Test: `__tests__/lib/simulation/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/simulation/runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSimulation, isSimulationRunning } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'

// Mock driver
vi.mock('@/lib/simulation/driver', () => ({
  driveConversation: vi.fn().mockResolvedValue({
    conversationId: 'conv-1',
    personaSlug: 'quick-buyer',
    scenarioType: 'scripted',
    scenarioSlug: 'happy-path',
    status: 'COMPLETED',
    turnCount: 10,
    durationMs: 5000,
    error: null,
    lastTurn: null,
  }),
}))

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    simulationRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock batch runner
vi.mock('@/lib/self-improvement/batch-runner', () => ({
  runDailyBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

import { driveConversation } from '@/lib/simulation/driver'
import { prisma } from '@/lib/db'

describe('runSimulation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs scripted-only config', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(6) // 6 scripted scenarios
    expect(vi.mocked(driveConversation)).toHaveBeenCalledTimes(6)
  })

  it('runs freeform-only config', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 3,
      concurrency: 2,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(3)
    expect(vi.mocked(driveConversation)).toHaveBeenCalledTimes(3)
  })

  it('creates SimulationRun record', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'admin',
    }

    await runSimulation(config)
    expect(vi.mocked(prisma.simulationRun.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: 'admin',
        status: 'RUNNING',
      }),
    })
  })

  it('prevents concurrent runs', async () => {
    // This test verifies isSimulationRunning works
    expect(isSimulationRunning()).toBe(false)
  })

  it('handles mixed failures gracefully', async () => {
    vi.mocked(driveConversation)
      .mockResolvedValueOnce({
        conversationId: 'c1', personaSlug: 'p1', scenarioType: 'scripted',
        scenarioSlug: 's1', status: 'COMPLETED', turnCount: 5,
        durationMs: 1000, error: null, lastTurn: null,
      })
      .mockResolvedValueOnce({
        conversationId: 'c2', personaSlug: 'p2', scenarioType: 'scripted',
        scenarioSlug: 's2', status: 'FAILED', turnCount: 2,
        durationMs: 500, error: 'API error', lastTurn: null,
      })
      // Remaining 4 scenarios succeed
      .mockResolvedValue({
        conversationId: 'c3', personaSlug: 'p3', scenarioType: 'scripted',
        scenarioSlug: 's3', status: 'COMPLETED', turnCount: 5,
        durationMs: 1000, error: null, lastTurn: null,
      })

    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.failedCount).toBe(1)
    expect(result.completedCount).toBe(5)
    expect(result.errors).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/simulation/runner.test.ts`

Expected: FAIL — module `@/lib/simulation/runner` not found.

- [ ] **Step 3: Write the runner**

Create `lib/simulation/runner.ts`:

```typescript
/**
 * Simulation Runner
 *
 * Orchestrates a full simulation run: scripted scenarios first,
 * then freeform personas with a concurrency pool.
 */

import { prisma } from '@/lib/db'
import { logInfo, logError } from '@/lib/errors/logger'
import { runDailyBatch } from '@/lib/self-improvement/batch-runner'
import { driveConversation } from './driver'
import { ALL_PERSONAS, getPersona, DEFAULT_ANSWERS } from './personas'
import { ALL_SCENARIOS } from './scenarios'
import type { SimulationConfig, ConversationResult, RunResult } from './types'

// ==============================================
// SINGLETON GUARD
// ==============================================

let running = false

export function isSimulationRunning(): boolean {
  return running
}

// ==============================================
// CONCURRENCY POOL
// ==============================================

async function runWithPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = []
  const executing: Promise<void>[] = []

  for (const task of tasks) {
    const p = task().then(result => {
      results.push(result)
    })
    executing.push(p)

    if (executing.length >= concurrency) {
      await Promise.race(executing)
      // Remove settled promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const status = await Promise.race([executing[i].then(() => 'done'), Promise.resolve('pending')])
        if (status === 'done') executing.splice(i, 1)
      }
    }
  }

  await Promise.all(executing)
  return results
}

// ==============================================
// MAIN RUNNER
// ==============================================

export async function runSimulation(config: SimulationConfig): Promise<RunResult> {
  if (running) {
    return {
      runId: '',
      status: 'FAILED',
      totalScenarios: 0,
      completedCount: 0,
      failedCount: 0,
      conversations: [],
      errors: ['Simulation is already running'],
      durationMs: 0,
    }
  }

  running = true
  const startMs = Date.now()
  const conversations: ConversationResult[] = []
  const errors: string[] = []
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000'

  // Calculate total
  const scriptedCount = config.runScripted ? ALL_SCENARIOS.length : 0
  const freeformCount = config.runFreeform ? config.freeformCount : 0
  const totalScenarios = scriptedCount + freeformCount

  // Create run record
  const run = await prisma.simulationRun.create({
    data: {
      status: 'RUNNING',
      trigger: config.trigger,
      config: config as unknown as Record<string, unknown>,
      totalScenarios,
    },
  })

  try {
    logInfo({
      layer: 'simulation',
      category: 'run',
      message: `Starting simulation: ${scriptedCount} scripted + ${freeformCount} freeform`,
    })

    // 1. Run scripted scenarios (sequentially — deterministic baselines)
    if (config.runScripted) {
      for (const scenario of ALL_SCENARIOS) {
        const persona = getPersona(scenario.personaSlug)
        if (!persona) {
          errors.push(`Persona not found: ${scenario.personaSlug}`)
          continue
        }

        const result = await driveConversation({
          persona,
          scenario,
          runId: run.id,
          baseUrl,
          answersMap: { ...DEFAULT_ANSWERS },
        })

        conversations.push(result)
        if (result.error) errors.push(`[${scenario.slug}] ${result.error}`)

        // Update progress
        await prisma.simulationRun.update({
          where: { id: run.id },
          data: {
            completedCount: conversations.filter(c => c.status !== 'FAILED').length,
            failedCount: conversations.filter(c => c.status === 'FAILED').length,
          },
        })
      }
    }

    // 2. Run freeform personas (with concurrency pool)
    if (config.runFreeform && freeformCount > 0) {
      // Select personas — round-robin if count > persona count
      const selectedPersonas = config.personas
        ? ALL_PERSONAS.filter(p => config.personas!.includes(p.slug))
        : ALL_PERSONAS

      const freeformTasks: (() => Promise<ConversationResult>)[] = []
      for (let i = 0; i < freeformCount; i++) {
        const persona = selectedPersonas[i % selectedPersonas.length]
        freeformTasks.push(() =>
          driveConversation({
            persona,
            scenario: null,
            runId: run.id,
            baseUrl,
            answersMap: { ...DEFAULT_ANSWERS },
          }),
        )
      }

      const freeformResults = await runWithPool(freeformTasks, config.concurrency)
      for (const result of freeformResults) {
        conversations.push(result)
        if (result.error) errors.push(`[freeform:${result.personaSlug}] ${result.error}`)
      }
    }

    // 3. Finalize run
    const completedCount = conversations.filter(c => c.status !== 'FAILED').length
    const failedCount = conversations.filter(c => c.status === 'FAILED').length
    const status = failedCount > totalScenarios / 2 ? 'FAILED' as const : 'COMPLETED' as const

    await prisma.simulationRun.update({
      where: { id: run.id },
      data: {
        status,
        completedCount,
        failedCount,
        errors: errors as unknown as Record<string, unknown>,
        completedAt: new Date(),
      },
    })

    // 4. Trigger self-improvement batch if requested
    if (config.runBatchAfter) {
      logInfo({ layer: 'simulation', category: 'run', message: 'Triggering self-improvement batch...' })
      await runDailyBatch().catch(err => {
        logError({ layer: 'simulation', category: 'batch', message: 'Post-simulation batch failed', error: err })
      })
    }

    const durationMs = Date.now() - startMs
    logInfo({
      layer: 'simulation',
      category: 'run',
      message: `Simulation ${status}: ${completedCount}/${totalScenarios} completed, ${failedCount} failed, ${durationMs}ms`,
    })

    return {
      runId: run.id,
      status,
      totalScenarios,
      completedCount,
      failedCount,
      conversations,
      errors,
      durationMs,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await prisma.simulationRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', errors: [errorMsg] as unknown as Record<string, unknown>, completedAt: new Date() },
    }).catch(() => {})

    return {
      runId: run.id,
      status: 'FAILED',
      totalScenarios,
      completedCount: conversations.filter(c => c.status !== 'FAILED').length,
      failedCount: conversations.filter(c => c.status === 'FAILED').length,
      conversations,
      errors: [...errors, errorMsg],
      durationMs: Date.now() - startMs,
    }
  } finally {
    running = false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/lib/simulation/runner.test.ts`

Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/simulation/runner.ts __tests__/lib/simulation/runner.test.ts
git commit -m "feat(simulation): add run orchestration with concurrency pool and batch trigger"
```

---

## Task 8: Customer Simulator Agent Seed

**Files:**
- Create: `prisma/seeds/seed-simulator-agent.ts`
- Modify: `prisma/seeds/index.ts`

- [ ] **Step 1: Create the seed file**

Create `prisma/seeds/seed-simulator-agent.ts`:

```typescript
import type { PrismaClient } from '@/lib/generated/prisma/client'

export async function seedSimulatorAgent(prisma: PrismaClient): Promise<void> {
  await prisma.agent.upsert({
    where: { slug: 'customer-simulator' },
    update: {},
    create: {
      slug: 'customer-simulator',
      name: 'Customer Simulator',
      role: 'customer-simulator',
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      fallbackProvider: null,
      fallbackModel: null,
      temperature: 0.8,
      maxTokens: 512,
      systemPrompt: null,
      constraints: null,
      isActive: true,
    },
  })

  console.log('  ✓ customer-simulator agent seeded')
}
```

- [ ] **Step 2: Add to seed index**

In `prisma/seeds/index.ts`, add the import and call after the existing seed functions:

```typescript
import { seedSimulatorAgent } from './seed-simulator-agent'
```

And in the `main()` function body, add at the end:

```typescript
await seedSimulatorAgent(prisma)
```

- [ ] **Step 3: Run the seed**

Run: `npx prisma db seed`

Expected: `✓ customer-simulator agent seeded`

- [ ] **Step 4: Commit**

```bash
git add prisma/seeds/seed-simulator-agent.ts prisma/seeds/index.ts
git commit -m "feat(simulation): add customer-simulator agent seed"
```

---

## Task 9: CLI Script

**Files:**
- Create: `scripts/simulate.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Create the CLI script**

Create `scripts/simulate.ts`:

```typescript
/**
 * CLI: npm run simulate
 *
 * Runs the customer simulation against the local (or configured) app.
 */

import { runSimulation } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'
import { DEFAULT_CONFIG } from '@/lib/simulation/types'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const config: SimulationConfig = { ...DEFAULT_CONFIG }

  // Parse CLI flags
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--scripted-only':
        config.runScripted = true
        config.runFreeform = false
        break
      case '--freeform-only':
        config.runScripted = false
        config.runFreeform = true
        break
      case '--count':
        config.freeformCount = parseInt(args[++i], 10)
        break
      case '--persona':
        config.personas = args[++i].split(',')
        break
      case '--run-batch':
        config.runBatchAfter = true
        break
      case '--no-batch':
        config.runBatchAfter = false
        break
      case '--concurrency':
        config.concurrency = parseInt(args[++i], 10)
        break
    }
  }

  config.trigger = 'cli'

  console.log('\n🔬 Starting Customer Simulation')
  console.log(`   Scripted: ${config.runScripted ? 'yes' : 'no'}`)
  console.log(`   Freeform: ${config.runFreeform ? `yes (${config.freeformCount})` : 'no'}`)
  console.log(`   Concurrency: ${config.concurrency}`)
  console.log(`   Batch after: ${config.runBatchAfter ? 'yes' : 'no'}`)
  console.log('')

  const result = await runSimulation(config)

  // Summary table
  console.log('\n━━━ Simulation Results ━━━')
  console.log(`   Status:    ${result.status}`)
  console.log(`   Total:     ${result.totalScenarios}`)
  console.log(`   Completed: ${result.completedCount}`)
  console.log(`   Failed:    ${result.failedCount}`)
  console.log(`   Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
  console.log('')

  // Conversation details
  console.log('┌──────────────────────────────┬──────────┬───────┬────────┬─────────┐')
  console.log('│ Scenario/Persona             │ Type     │ Turns │ Status │ Time    │')
  console.log('├──────────────────────────────┼──────────┼───────┼────────┼─────────┤')

  for (const c of result.conversations) {
    const name = (c.scenarioSlug ?? c.personaSlug).padEnd(28)
    const type = c.scenarioType.padEnd(8)
    const turns = String(c.turnCount).padStart(5)
    const status = c.status.padEnd(6)
    const time = `${(c.durationMs / 1000).toFixed(1)}s`.padStart(7)
    console.log(`│ ${name} │ ${type} │ ${turns} │ ${status} │ ${time} │`)
  }

  console.log('└──────────────────────────────┴──────────┴───────┴────────┴─────────┘')

  if (result.errors.length > 0) {
    console.log('\nErrors:')
    for (const err of result.errors) {
      console.log(`  - ${err}`)
    }
  }

  process.exit(result.failedCount > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal simulation error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Add npm script to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"simulate": "npx tsx scripts/simulate.ts"
```

- [ ] **Step 3: Verify the script loads**

Run: `npm run simulate -- --scripted-only --no-batch`

Expected: Starts running scripted scenarios against localhost:3000 (app must be running). If app is not running, you'll see connection errors — that's expected.

- [ ] **Step 4: Commit**

```bash
git add scripts/simulate.ts package.json
git commit -m "feat(simulation): add CLI script (npm run simulate)"
```

---

## Task 10: Admin API Endpoints

**Files:**
- Create: `app/api/admin/simulation/run/route.ts`
- Create: `app/api/admin/simulation/runs/route.ts`
- Create: `app/api/admin/simulation/runs/[id]/route.ts`
- Create: `app/api/admin/simulation/conversations/[id]/route.ts`

- [ ] **Step 1: Create POST /api/admin/simulation/run**

Create `app/api/admin/simulation/run/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { runSimulation, isSimulationRunning } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'
import { DEFAULT_CONFIG } from '@/lib/simulation/types'

const COOKIE_NAME = 'zeno_auth'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (isSimulationRunning()) {
    return NextResponse.json({ error: 'Simulation already running' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({})) as Partial<SimulationConfig>
  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    ...body,
    trigger: 'admin',
  }

  // Fire and forget — don't hold the HTTP connection
  runSimulation(config).catch(() => {})

  return NextResponse.json({ message: 'Simulation started', config })
}
```

- [ ] **Step 2: Create GET /api/admin/simulation/runs**

Create `app/api/admin/simulation/runs/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'zeno_auth'

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)

  const runs = await prisma.simulationRun.findMany({
    where: status ? { status } : undefined,
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: {
      _count: { select: { conversations: true } },
    },
  })

  return NextResponse.json({ runs })
}
```

- [ ] **Step 3: Create GET /api/admin/simulation/runs/[id]**

Create `app/api/admin/simulation/runs/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'zeno_auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const run = await prisma.simulationRun.findUnique({
    where: { id },
    include: {
      conversations: {
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  return NextResponse.json({ run })
}
```

- [ ] **Step 4: Create GET /api/admin/simulation/conversations/[id]**

Create `app/api/admin/simulation/conversations/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'zeno_auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const simConv = await prisma.simulationConversation.findUnique({
    where: { id },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 100 },
          score: true,
          turnTraces: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!simConv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  return NextResponse.json({
    simulation: {
      id: simConv.id,
      personaSlug: simConv.personaSlug,
      scenarioType: simConv.scenarioType,
      scenarioSlug: simConv.scenarioSlug,
      status: simConv.status,
      turnCount: simConv.turnCount,
      error: simConv.error,
      durationMs: simConv.durationMs,
    },
    messages: simConv.conversation.messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults,
      createdAt: m.createdAt.toISOString(),
    })),
    score: simConv.conversation.score,
    turnTraces: simConv.conversation.turnTraces,
  })
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/simulation/
git commit -m "feat(simulation): add admin API endpoints (trigger, list runs, run detail, transcript)"
```

---

## Task 11: Admin Dashboard Integration

**Files:**
- Create: `components/admin/simulation-run-panel.tsx`
- Create: `components/admin/simulation-conversation-table.tsx`
- Create: `components/admin/simulation-transcript-viewer.tsx`
- Create: `components/admin/simulation-error-panel.tsx`
- Modify: `app/admin/(protected)/self-improvement/page.tsx`
- Modify: `components/admin/self-improvement-dashboard.tsx`

This is a larger UI task. Each component follows the existing Tailwind patterns from `self-improvement-dashboard.tsx`.

- [ ] **Step 1: Create SimulationRunPanel component**

Create `components/admin/simulation-run-panel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SimulationConversationTable from './simulation-conversation-table'

interface SimulationRun {
  id: string
  status: string
  trigger: string
  totalScenarios: number
  completedCount: number
  failedCount: number
  avgScore: number | null
  errors: string[]
  startedAt: string
  completedAt: string | null
}

interface SimulationRunPanelProps {
  runs: SimulationRun[]
  simulationRunning: boolean
}

export default function SimulationRunPanel({ runs, simulationRunning }: SimulationRunPanelProps) {
  const router = useRouter()
  const [running, setRunning] = useState(simulationRunning)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  async function handleRunSimulation(mode: 'all' | 'scripted' | 'freeform') {
    setRunning(true)
    try {
      await fetch('/api/admin/simulation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runScripted: mode !== 'freeform',
          runFreeform: mode !== 'scripted',
          freeformCount: 10,
          runBatchAfter: true,
        }),
      })
      setTimeout(() => {
        router.refresh()
        setRunning(false)
      }, 10000)
    } catch {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-night">Customer Simulation</h3>
        <div className="flex gap-2">
          <button
            onClick={() => handleRunSimulation('all')}
            disabled={running}
            className="rounded-md bg-forest px-3 py-1 text-xs font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
          >
            {running ? 'Running...' : 'Run All'}
          </button>
          <button
            onClick={() => handleRunSimulation('scripted')}
            disabled={running}
            className="rounded-md border border-forest px-3 py-1 text-xs font-medium text-forest hover:bg-forest/10 transition-colors disabled:opacity-50"
          >
            Scripted Only
          </button>
          <button
            onClick={() => handleRunSimulation('freeform')}
            disabled={running}
            className="rounded-md border border-forest px-3 py-1 text-xs font-medium text-forest hover:bg-forest/10 transition-colors disabled:opacity-50"
          >
            Freeform Only
          </button>
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="space-y-2">
          {runs.map(run => (
            <div key={run.id} className="rounded-lg border border-warm-border bg-white">
              <button
                onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-cloud-100/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${run.status === 'COMPLETED' ? 'bg-forest' : run.status === 'RUNNING' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className="text-night font-medium">
                    {new Date(run.startedAt).toLocaleDateString('ro-RO')} {new Date(run.startedAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-muted">{run.trigger}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-forest">{run.completedCount} ok</span>
                  {run.failedCount > 0 && <span className="text-red-700">{run.failedCount} failed</span>}
                  {run.avgScore !== null && <span className="text-night">{(run.avgScore * 100).toFixed(0)}% avg</span>}
                  <span className="text-muted">{expandedRunId === run.id ? '▲' : '▼'}</span>
                </div>
              </button>
              {expandedRunId === run.id && (
                <div className="border-t border-warm-border p-3">
                  <SimulationConversationTable runId={run.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">No simulation runs yet. Click &quot;Run All&quot; to start.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create SimulationConversationTable component**

Create `components/admin/simulation-conversation-table.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import SimulationTranscriptViewer from './simulation-transcript-viewer'

interface SimConversation {
  id: string
  personaSlug: string
  scenarioType: string
  scenarioSlug: string | null
  status: string
  turnCount: number
  error: string | null
  score: number | null
  durationMs: number | null
}

export default function SimulationConversationTable({ runId }: { runId: string }) {
  const [conversations, setConversations] = useState<SimConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/simulation/runs/${runId}`)
      .then(r => r.json())
      .then(data => {
        setConversations(data.run?.conversations ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [runId])

  if (loading) return <p className="text-xs text-muted">Loading conversations...</p>
  if (conversations.length === 0) return <p className="text-xs text-muted">No conversations in this run.</p>

  return (
    <div className="space-y-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-medium">Persona</th>
            <th className="pb-1 font-medium">Type</th>
            <th className="pb-1 font-medium">Scenario</th>
            <th className="pb-1 font-medium text-right">Turns</th>
            <th className="pb-1 font-medium text-right">Score</th>
            <th className="pb-1 font-medium text-right">Time</th>
            <th className="pb-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map(c => (
            <tr
              key={c.id}
              onClick={() => setSelectedConvId(selectedConvId === c.id ? null : c.id)}
              className="cursor-pointer border-t border-warm-border/50 hover:bg-cloud-100/30"
            >
              <td className="py-1.5 text-night">{c.personaSlug}</td>
              <td className="py-1.5 text-muted">{c.scenarioType}</td>
              <td className="py-1.5 text-muted">{c.scenarioSlug ?? '—'}</td>
              <td className="py-1.5 text-right text-night">{c.turnCount}</td>
              <td className="py-1.5 text-right text-night">{c.score !== null ? `${(c.score * 100).toFixed(0)}%` : '—'}</td>
              <td className="py-1.5 text-right text-muted">{c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : '—'}</td>
              <td className="py-1.5">
                <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                  c.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                  c.status === 'ABANDONED' ? 'bg-amber-100 text-amber-800' :
                  c.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {c.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedConvId && (
        <SimulationTranscriptViewer conversationId={selectedConvId} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create SimulationTranscriptViewer component**

Create `components/admin/simulation-transcript-viewer.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface TranscriptMessage {
  id: string
  role: string
  content: string
  toolCalls: unknown
  toolResults: unknown
  createdAt: string
}

interface TranscriptData {
  simulation: {
    personaSlug: string
    scenarioType: string
    scenarioSlug: string | null
    status: string
    error: string | null
  }
  messages: TranscriptMessage[]
  score: { score: number } | null
}

export default function SimulationTranscriptViewer({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<TranscriptData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/simulation/conversations/${conversationId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [conversationId])

  if (loading) return <p className="text-xs text-muted py-2">Loading transcript...</p>
  if (!data) return <p className="text-xs text-red-700 py-2">Failed to load transcript.</p>

  return (
    <div className="rounded-lg border border-warm-border bg-cloud-100/30 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-night font-medium">
          {data.simulation.personaSlug} — {data.simulation.scenarioSlug ?? 'freeform'}
        </span>
        {data.score && (
          <span className="text-forest font-medium">Score: {(data.score.score * 100).toFixed(0)}%</span>
        )}
      </div>

      {data.simulation.error && (
        <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">
          {data.simulation.error}
        </div>
      )}

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {data.messages.map(msg => (
          <div
            key={msg.id}
            className={`rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'ml-8 bg-forest/10 text-night'
                : msg.role === 'assistant'
                ? 'mr-8 bg-white border border-warm-border text-night'
                : 'mx-4 bg-amber-50 text-amber-800 text-xs italic'
            }`}
          >
            <span className="text-xs font-medium text-muted block mb-0.5">
              {msg.role === 'user' ? 'Customer' : msg.role === 'assistant' ? 'Zeno' : 'System'}
            </span>
            {msg.content}
            {msg.toolCalls && (
              <div className="mt-1 text-xs text-muted">
                Tools: {JSON.stringify(msg.toolCalls)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create SimulationErrorPanel component**

Create `components/admin/simulation-error-panel.tsx`:

```tsx
'use client'

interface SimulationError {
  runId: string
  runDate: string
  errors: string[]
}

export default function SimulationErrorPanel({ errorsByRun }: { errorsByRun: SimulationError[] }) {
  const allErrors = errorsByRun.flatMap(r => r.errors.map(e => ({ runDate: r.runDate, error: e })))

  if (allErrors.length === 0) {
    return <p className="text-sm text-muted">No simulation errors.</p>
  }

  // Group by error type (first word before colon)
  const grouped = new Map<string, { count: number; samples: string[] }>()
  for (const { error } of allErrors) {
    const key = error.includes(']') ? error.slice(1, error.indexOf(']')) : 'other'
    const existing = grouped.get(key) ?? { count: 0, samples: [] }
    existing.count++
    if (existing.samples.length < 3) existing.samples.push(error)
    grouped.set(key, existing)
  }

  return (
    <div className="space-y-2">
      {Array.from(grouped.entries()).map(([type, data]) => (
        <div key={type} className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-red-700">{type}</span>
            <span className="text-xs text-red-600">{data.count} occurrence{data.count > 1 ? 's' : ''}</span>
          </div>
          {data.samples.map((s, i) => (
            <p key={i} className="text-xs text-red-600 truncate">{s}</p>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Modify the self-improvement dashboard page to include simulation data**

In `app/admin/(protected)/self-improvement/page.tsx`, add simulation data queries inside the existing `Promise.all` and pass them to the dashboard component.

Add to the destructured `Promise.all` array:

```typescript
prisma.simulationRun.findMany({
  orderBy: { startedAt: 'desc' },
  take: 10,
}),
```

Add to the component's `data` prop:

```typescript
simulationRuns: simulationRuns.map((r) => ({
  id: r.id,
  status: r.status,
  trigger: r.trigger,
  totalScenarios: r.totalScenarios,
  completedCount: r.completedCount,
  failedCount: r.failedCount,
  avgScore: r.avgScore,
  errors: r.errors as string[],
  startedAt: r.startedAt.toISOString(),
  completedAt: r.completedAt?.toISOString() ?? null,
})),
simulationRunning: false, // TODO: wire to isSimulationRunning() when imported
```

- [ ] **Step 6: Modify the self-improvement dashboard component to render simulation panels**

In `components/admin/self-improvement-dashboard.tsx`, add imports for the simulation components and render them after the existing sections:

Add imports:

```typescript
import SimulationRunPanel from './simulation-run-panel'
import SimulationErrorPanel from './simulation-error-panel'
```

Add to `DashboardData` interface:

```typescript
simulationRuns: {
  id: string; status: string; trigger: string; totalScenarios: number
  completedCount: number; failedCount: number; avgScore: number | null
  errors: string[]; startedAt: string; completedAt: string | null
}[]
simulationRunning: boolean
```

Add JSX after the existing Regressions section:

```tsx
{/* Simulation */}
<div className="rounded-lg border border-warm-border bg-white p-4">
  <SimulationRunPanel
    runs={data.simulationRuns}
    simulationRunning={data.simulationRunning}
  />
</div>

{/* Simulation Errors */}
{data.simulationRuns.some(r => (r.errors as string[]).length > 0) && (
  <div className="rounded-lg border border-warm-border bg-white p-4">
    <h3 className="text-sm font-medium text-night mb-3">Simulation Errors</h3>
    <SimulationErrorPanel
      errorsByRun={data.simulationRuns
        .filter(r => (r.errors as string[]).length > 0)
        .map(r => ({ runId: r.id, runDate: r.startedAt, errors: r.errors as string[] }))}
    />
  </div>
)}
```

- [ ] **Step 7: Commit**

```bash
git add components/admin/simulation-run-panel.tsx components/admin/simulation-conversation-table.tsx components/admin/simulation-transcript-viewer.tsx components/admin/simulation-error-panel.tsx app/admin/(protected)/self-improvement/page.tsx components/admin/self-improvement-dashboard.tsx
git commit -m "feat(simulation): integrate simulation panels into self-improvement dashboard"
```

---

## Task 12: Extend Self-Improvement Dashboard with Simulated vs Real Comparison

**Files:**
- Modify: `app/admin/(protected)/self-improvement/page.tsx`
- Modify: `components/admin/self-improvement-dashboard.tsx`

- [ ] **Step 1: Add simulated vs real score query to the page**

In `app/admin/(protected)/self-improvement/page.tsx`, add two more queries to the `Promise.all`:

```typescript
// Simulated scores (7d)
prisma.conversationScore.findMany({
  where: {
    scoredAt: { gte: sevenDaysAgo },
    conversation: { channel: 'simulation' },
  },
  select: { score: true },
}),
// Real scores (7d)
prisma.conversationScore.findMany({
  where: {
    scoredAt: { gte: sevenDaysAgo },
    conversation: { channel: { not: 'simulation' } },
  },
  select: { score: true },
}),
```

Pass computed averages to the dashboard:

```typescript
simulatedAvg7d: simulatedScores.length > 0
  ? simulatedScores.reduce((s, x) => s + x.score, 0) / simulatedScores.length
  : null,
simulatedCount7d: simulatedScores.length,
realAvg7d: realScores.length > 0
  ? realScores.reduce((s, x) => s + x.score, 0) / realScores.length
  : null,
realCount7d: realScores.length,
```

- [ ] **Step 2: Add comparison display to dashboard component**

In `components/admin/self-improvement-dashboard.tsx`, add to `DashboardData`:

```typescript
simulatedAvg7d: number | null
simulatedCount7d: number
realAvg7d: number | null
realCount7d: number
```

Add a new stat card row after the existing overview cards:

```tsx
{/* Simulated vs Real comparison */}
{(data.simulatedCount7d > 0 || data.realCount7d > 0) && (
  <div className="grid grid-cols-2 gap-4">
    <StatCard
      label="Simulated Avg (7d)"
      value={data.simulatedAvg7d !== null ? `${(data.simulatedAvg7d * 100).toFixed(1)}%` : 'N/A'}
      sub={`${data.simulatedCount7d} conversations`}
    />
    <StatCard
      label="Real Avg (7d)"
      value={data.realAvg7d !== null ? `${(data.realAvg7d * 100).toFixed(1)}%` : 'N/A'}
      sub={`${data.realCount7d} conversations`}
    />
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add app/admin/(protected)/self-improvement/page.tsx components/admin/self-improvement-dashboard.tsx
git commit -m "feat(simulation): add simulated vs real score comparison to dashboard"
```

---

## Task 13: Integration Test

**Files:**
- Create: `__tests__/integration/simulation-runner.test.ts`

- [ ] **Step 1: Write integration test**

Create `__tests__/integration/simulation-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSimulation } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'

// Mock the driver to avoid actual HTTP calls
vi.mock('@/lib/simulation/driver', () => ({
  driveConversation: vi.fn().mockImplementation(async (options) => ({
    conversationId: `conv-${Math.random().toString(36).slice(2)}`,
    personaSlug: options.persona.slug,
    scenarioType: options.scenario ? 'scripted' : 'freeform',
    scenarioSlug: options.scenario?.slug ?? null,
    status: 'COMPLETED',
    turnCount: 10,
    durationMs: 3000,
    error: null,
    lastTurn: null,
  })),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    simulationRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-integration-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/self-improvement/batch-runner', () => ({
  runDailyBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

import { runDailyBatch } from '@/lib/self-improvement/batch-runner'

describe('simulation runner integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('full run: scripted + freeform + batch trigger', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: true,
      freeformCount: 3,
      concurrency: 2,
      runBatchAfter: true,
      trigger: 'cli',
    }

    const result = await runSimulation(config)

    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(9)  // 6 scripted + 3 freeform
    expect(result.completedCount).toBe(9)
    expect(result.failedCount).toBe(0)
    expect(result.conversations).toHaveLength(9)
    expect(vi.mocked(runDailyBatch)).toHaveBeenCalledOnce()
  })

  it('persona filter works for freeform runs', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 4,
      personas: ['skeptic', 'young-parent'],
      concurrency: 2,
      runBatchAfter: false,
      trigger: 'admin',
    }

    const result = await runSimulation(config)

    expect(result.conversations).toHaveLength(4)
    const slugs = new Set(result.conversations.map(c => c.personaSlug))
    expect(slugs.size).toBeLessThanOrEqual(2)
    expect(slugs).toContain('skeptic')
    expect(slugs).toContain('young-parent')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run __tests__/integration/simulation-runner.test.ts`

Expected: PASS — both integration tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/simulation-runner.test.ts
git commit -m "test(simulation): add integration tests for runner orchestration"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run all simulation tests**

Run: `npx vitest run --reporter verbose __tests__/lib/simulation/ __tests__/integration/simulation-runner.test.ts`

Expected: All tests pass.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`

Expected: No lint errors in new files.

- [ ] **Step 4: Verify admin dashboard loads**

With the dev server running (`npm run dev`), navigate to the admin self-improvement page and verify:
- Simulation Run Panel appears with "Run All" button
- No console errors
- If you click "Run All", it triggers the simulation

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix(simulation): address lint and type issues from final verification"
```
