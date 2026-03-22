# Slice C1: E2E Test Suite — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** C1 (End-to-End Test Suite with LLM-Powered Client Simulator)
**Date:** 2026-03-22
**Status:** Approved
**Depends on:** Phase B (complete)

---

## 1. Goal

Build an automated E2E test suite that simulates full sales conversations by calling the real `POST /api/chat` endpoint, using a cheap LLM to generate natural customer responses, and verifying database state after each scenario.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Customer responses | LLM-generated (GPT-5.2-mini) | Tests the full loop including agent reasoning. More realistic than scripts. |
| Questionnaire answers | Deterministic from answer map | Questionnaire answers are predictable — use LLM only for conversational turns. |
| Test framework | Vitest with extended timeouts | Already in project. E2E tests need 30-60s per scenario. |
| Test target | Real `/api/chat` endpoint | Tests the full stack: route → orchestrator → LLM → tools → DB. |
| Mock provider | Mock payment (no real Stripe) | Payment uses mock provider. All other layers are real. |

## 3. File Structure

```
e2e/
  lib/
    client-simulator.ts      — LLM-powered customer + deterministic questionnaire answers
    sse-parser.ts            — Parse SSE stream from POST /api/chat
    turn-tracker.ts          — Track turns, assertions, timing per conversation
    db-verifier.ts           — Verify DB state after test scenarios
    test-reporter.ts         — Console summary + JSON report output
    personas.ts              — Test personas and answer maps
  scenarios/
    happy-path.test.ts       — Full sale: discovery → DNT → app → BD → quote → pay → policy
    bd-rejection.test.ts     — BD medical YES → addon rejected → base only sale
    objection-handling.test.ts — 3 objection types triggered and handled
    change-of-mind.test.ts   — Modify quote mid-flow
    dnt-pause-resume.test.ts — Pause DNT, resume later
```

## 4. Client Simulator

### `e2e/lib/client-simulator.ts`

```typescript
interface SimulatorConfig {
  persona: {
    name: string
    age: number
    occupation: string
    income: string
    familySize: number
    children: number
    language: 'ro' | 'en'
  }
  behavior: {
    answersMap: Record<string, string>   // question code → answer value
    objections?: { turn: number; text: string }[]
    changeOfMind?: { afterQuote: boolean; newTier?: string; newLevel?: string }
    pauseAtTurn?: number
    bdAnswers?: Record<string, string>   // override specific BD answers
  }
}

async function generateCustomerResponse(
  agentMessage: string,
  uiAction: { type: string; payload: Record<string, unknown> } | null,
  config: SimulatorConfig,
  turnNumber: number,
  conversationHistory: { role: string; content: string }[],
): Promise<string>
```

**Response generation logic:**

1. **If `uiAction` is `show_question`:** Look up `payload.question.code` in `config.behavior.answersMap`. If found, return the mapped answer directly (no LLM call). If not found, use LLM to generate a natural answer.

2. **If `uiAction` is `show_product_cards`:** Return tier/level selection from config (e.g., "Vreau Standard Nivelul II").

3. **If `uiAction` is `show_quote`:**
   - If `config.behavior.changeOfMind?.afterQuote`: return "E prea scump, vreau varianta mai ieftina"
   - Otherwise: return "Da, accept oferta"

4. **If `uiAction` is `show_payment`:** Return "Simulez plata" (mock payment confirmation).

5. **If `uiAction` is `show_bd_result` or `show_bd_rejected`:** Return "Da, continua" (continue without addon).

6. **If `config.behavior.objections` has entry for this turn:** Return the objection text.

7. **If `config.behavior.pauseAtTurn === turnNumber`:** Return "Trebuie sa plec, revin mai tarziu" then stop.

8. **Otherwise:** Call LLM (GPT-5.2-mini) with persona prompt + last agent message → generate natural Romanian response.

**LLM persona prompt:**
```
Esti {name}, {occupation} roman de {age} de ani, casatorit cu {children} copii.
Venit: {income}/luna. Vorbesti romana natural.
Raspunsurile tale sunt SCURTE (1-3 propozitii).
Esti interesat de o asigurare de viata pentru protectia familiei.
Nu inventezi informatii. Raspunzi natural la intrebarile agentului.
```

## 5. SSE Parser

### `e2e/lib/sse-parser.ts`

```typescript
interface ParsedTurn {
  content: string                   // concatenated text from content events
  toolsCalled: string[]             // from tool_start events
  uiActions: { type: string; payload: Record<string, unknown> }[]
  errors: string[]                  // from error events
  done: { messageId: string; tokens?: unknown; latencyMs?: number } | null
}

async function sendMessageAndParse(
  conversationId: string,
  customerId: string,
  message: string,
  baseUrl: string,
): Promise<ParsedTurn>
```

Uses `fetch` with POST body → reads `response.body.getReader()` → parses SSE events (same format as the useChat hook). Accumulates all events into a `ParsedTurn` result.

Also supports sending actions:
```typescript
async function sendActionAndParse(
  conversationId: string,
  customerId: string,
  action: { type: string; payload: Record<string, unknown> },
  baseUrl: string,
): Promise<ParsedTurn>
```

## 6. Turn Tracker

### `e2e/lib/turn-tracker.ts`

```typescript
interface TrackedTurn {
  turnNumber: number
  role: 'user' | 'assistant'
  content: string
  toolsCalled: string[]
  uiActions: string[]          // ui_action types
  latencyMs: number
  assertions: { name: string; passed: boolean; detail?: string }[]
}

class TurnTracker {
  addTurn(turn: TrackedTurn): void
  assertToolCalled(toolName: string): void
  assertNoErrors(): void
  assertTurnCount(min: number, max: number): void
  getSummary(): { totalTurns: number; toolsUsed: string[]; passed: boolean; failures: string[] }
}
```

## 7. DB Verifier

### `e2e/lib/db-verifier.ts`

```typescript
interface VerificationResult {
  passed: boolean
  checks: { name: string; passed: boolean; expected: unknown; actual: unknown }[]
}

async function verifyHappyPath(conversationId: string): Promise<VerificationResult>
async function verifyBdRejection(conversationId: string): Promise<VerificationResult>
async function verifyObjectionHandling(conversationId: string, expectedTypes: string[]): Promise<VerificationResult>
async function verifyChangeOfMind(conversationId: string): Promise<VerificationResult>
async function verifyDntPauseResume(conversationId: string): Promise<VerificationResult>
```

**Happy path checks:**
- Conversation.status = COMPLETED
- Application exists, status = COMPLETED, tierId + levelId set, includesAddon = true
- All DNT questions answered (count matches expected)
- DNT signed (WorkflowSession.data has dntSignedAt)
- All BD answers = false
- Quote exists, status = ACCEPTED, premiumAnnual matches calculation
- Policy exists, status = PENDING_SUBMISSION or SUBMITTED
- Payment exists, status = COMPLETED
- Customer.isAnonymous = false
- Customer.magicLinkToken exists

**BD rejection checks:**
- Same as happy path except: Application.includesAddon = false, Quote has no addon premium

**Objection checks:**
- Conversation has messages where tool_calls include get_objection_strategy
- At least 3 distinct objection types used

## 8. Test Scenarios

### 8.1 Happy Path (`e2e/scenarios/happy-path.test.ts`)

```typescript
test('full sale: discovery → policy', async () => {
  // 1. Create customer + conversation
  // 2. Send opening message: "Buna, ma intereseaza o asigurare de viata"
  // 3. Loop: parse response → generate customer reply → send → repeat
  // 4. Max 40 turns. Break when uiAction is show_payment_success or show_policy_issued
  // 5. Verify DB state via verifyHappyPath()
}, { timeout: 120_000 })
```

Config: DEFAULT_PERSONA + DEFAULT_ANSWERS. No objections, no pause, no change of mind.

### 8.2 BD Rejection (`e2e/scenarios/bd-rejection.test.ts`)

Same as happy path but `bdAnswers: { BD_CANCER_HISTORY: 'true' }`. Expects BD rejection → continues without addon.

### 8.3 Objection Handling (`e2e/scenarios/objection-handling.test.ts`)

Config adds:
```typescript
objections: [
  { turn: 4, text: 'Hmm, mi se pare cam scump...' },           // price_base
  { turn: 12, text: 'Trebuie sa vorbesc cu sotia mea' },        // need_to_think
  { turn: 18, text: 'Nu prea am incredere in asigurari...' },   // no_trust
]
```

Verifies agent calls `get_objection_strategy` for each and conversation continues.

### 8.4 Change of Mind (`e2e/scenarios/change-of-mind.test.ts`)

Config: `changeOfMind: { afterQuote: true, newTier: 'standard', newLevel: 'level_1' }`. Selects Optim III first, then modifies after seeing the quote.

### 8.5 DNT Pause/Resume (`e2e/scenarios/dnt-pause-resume.test.ts`)

Config: `pauseAtTurn: 8`. After pause message, wait 2 seconds, send "Am revenit" → verify DNT resumes from the right question.

## 9. Test Personas

### `e2e/lib/personas.ts`

```typescript
export const DEFAULT_PERSONA = {
  name: 'Ion Popescu',
  age: 35,
  occupation: 'Inginer',
  income: '5000 RON',
  familySize: 4,
  children: 2,
  language: 'ro' as const,
}

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

## 10. Running Tests

**Package.json script:**
```json
"test:e2e": "vitest run e2e/scenarios/ --timeout 120000"
```

**Prerequisites:**
- Dev server running (`npm run dev`)
- DB seeded (`npx prisma db seed`)
- LLM API keys in `.env` (OPENAI_API_KEY at minimum for client simulator)
- `PAYMENT_PROVIDER=mock` in `.env`

**Each test:**
1. Creates its own customer + conversation (no shared state)
2. Runs to completion or max turns
3. Verifies DB state
4. Cleans up (optional — test data can stay for debugging)

## 11. Exit Criteria

- [ ] Client simulator: hybrid (deterministic for questionnaires, LLM for conversation)
- [ ] SSE parser handles all event types correctly
- [ ] Turn tracker with assertions
- [ ] DB verifier for all 5 scenarios
- [ ] Happy path scenario passing (full sale end-to-end)
- [ ] BD rejection scenario passing
- [ ] Objection handling scenario (3 types) passing
- [ ] Change of mind scenario passing
- [ ] DNT pause/resume scenario passing
- [ ] `npm run test:e2e` command works
- [ ] `npx tsc --noEmit` passes
- [ ] Tests require real LLM API keys (documented in README or .env.example)

## 12. What C1 does NOT include

- Performance benchmarking (latency targets)
- CI/CD integration (Phase D)
- Browser-based Playwright tests
- A/B test infrastructure (P1)
- Continuous test runner (run-on-loop from V1)
- Test coverage for admin panel or dashboard
