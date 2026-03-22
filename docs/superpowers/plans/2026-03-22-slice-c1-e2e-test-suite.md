# Slice C1: E2E Test Suite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated E2E test suite with 5 scenarios that simulate full sales conversations using an LLM-powered client simulator, calling the real chat API and verifying database state.

**Architecture:** Test library (SSE parser, client simulator, turn tracker, DB verifier) + 5 scenario test files. Client simulator uses deterministic answers for questionnaires and LLM (GPT-5.2-mini) for conversational turns. Tests run against the real dev server.

**Tech Stack:** Vitest (extended timeout), fetch-based SSE parsing, Prisma for DB verification, OpenAI SDK for client simulator

**Spec:** `docs/superpowers/specs/2026-03-22-slice-c1-e2e-test-suite-design.md`

---

## File Map

### New files (11)

| File | Responsibility |
|------|---------------|
| `e2e/lib/sse-parser.ts` | Send message to /api/chat, parse SSE stream, return structured result |
| `e2e/lib/personas.ts` | Default test persona + questionnaire answer maps |
| `e2e/lib/client-simulator.ts` | Hybrid response generation: deterministic for Qs, LLM for conversation |
| `e2e/lib/turn-tracker.ts` | Track turns, record assertions, generate summary |
| `e2e/lib/db-verifier.ts` | Verify DB state after each scenario |
| `e2e/lib/test-reporter.ts` | Console output + JSON report |
| `e2e/scenarios/happy-path.test.ts` | Full sale end-to-end |
| `e2e/scenarios/bd-rejection.test.ts` | BD medical rejection flow |
| `e2e/scenarios/objection-handling.test.ts` | 3 objection types triggered |
| `e2e/scenarios/change-of-mind.test.ts` | Modify quote mid-flow |
| `e2e/scenarios/dnt-pause-resume.test.ts` | Pause and resume DNT |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `test:e2e` script |
| `vitest.config.ts` | Add e2e test config or separate config |

---

## Task 1: Test Library (SSE Parser + Personas + Turn Tracker)

**Files:**
- Create: `e2e/lib/sse-parser.ts`, `e2e/lib/personas.ts`, `e2e/lib/turn-tracker.ts`, `e2e/lib/test-reporter.ts`
- Modify: `package.json`

- [ ] **Step 1: Create SSE parser**

`e2e/lib/sse-parser.ts`:

```typescript
interface ParsedTurn {
  content: string
  toolsCalled: string[]
  uiActions: { type: string; payload: Record<string, unknown> }[]
  errors: string[]
  done: { messageId?: string; conversationId?: string; customerId?: string } | null
}

// Send a message and parse the full SSE response
async function sendMessageAndParse(
  conversationId: string,
  customerId: string,
  message: string,
  baseUrl: string,
): Promise<ParsedTurn>

// Send an action and parse response
async function sendActionAndParse(
  conversationId: string,
  customerId: string,
  action: { type: string; payload: Record<string, unknown> },
  baseUrl: string,
): Promise<ParsedTurn>

// Create a new conversation via API
async function createTestConversation(baseUrl: string): Promise<{ conversationId: string; customerId: string }>
```

Implementation:
- `fetch(baseUrl + '/api/chat', { method: 'POST', body, headers })` → `response.body.getReader()`
- Parse SSE format: split on `\n\n`, extract `event:` and `data:` lines
- Accumulate events into ParsedTurn

For `createTestConversation`:
- POST to `/api/session` → get customerId
- POST to `/api/chat/create` with customerId → get conversationId

- [ ] **Step 2: Create personas**

`e2e/lib/personas.ts`: DEFAULT_PERSONA + DEFAULT_ANSWERS from spec Section 9. Export both + helper function to create scenario-specific overrides.

- [ ] **Step 3: Create turn tracker**

`e2e/lib/turn-tracker.ts`: TurnTracker class with addTurn(), assertToolCalled(), assertNoErrors(), assertTurnCount(), getSummary().

- [ ] **Step 4: Create test reporter**

`e2e/lib/test-reporter.ts`: Console-friendly summary (scenario name, turns, tools used, pass/fail, duration). Optional JSON output for CI.

- [ ] **Step 5: Add test:e2e script**

In `package.json`:
```json
"test:e2e": "vitest run e2e/scenarios/ --config vitest.e2e.config.ts"
```

Create `vitest.e2e.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/scenarios/**/*.test.ts'],
    testTimeout: 120000,  // 2 min per test
    hookTimeout: 30000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 6: Verify + commit**

```bash
npx tsc --noEmit
git add e2e/lib/ vitest.e2e.config.ts package.json
git commit -m "feat(c1): add E2E test library — SSE parser, personas, turn tracker, reporter"
```

---

## Task 2: Client Simulator + DB Verifier

**Files:**
- Create: `e2e/lib/client-simulator.ts`, `e2e/lib/db-verifier.ts`

- [ ] **Step 1: Create client simulator**

`e2e/lib/client-simulator.ts`:

Read spec Section 4 for the full response generation logic.

```typescript
export async function generateCustomerResponse(
  agentMessage: string,
  uiAction: { type: string; payload: Record<string, unknown> } | null,
  config: SimulatorConfig,
  turnNumber: number,
  conversationHistory: { role: string; content: string }[],
): Promise<string>
```

Logic (in priority order):
1. `show_question` → look up answer from `answersMap[question.code]`, return directly
2. `show_product_cards` → return tier selection text based on config
3. `show_quote` + changeOfMind → return modification request
4. `show_quote` → return "Da, accept oferta"
5. `show_payment` → return "Simulez plata"
6. `show_bd_result` / `show_bd_rejected` → return "Da, continua"
7. Objection injection by turn number → return objection text
8. Pause at turn → return "Trebuie sa plec, revin mai tarziu"
9. Default → call LLM (GPT-5.2-mini) with persona prompt + agent message

For LLM calls, use OpenAI SDK directly (not our gateway — tests shouldn't depend on our agent configs):
```typescript
import OpenAI from 'openai'
const openai = new OpenAI()
const response = await openai.chat.completions.create({
  model: 'gpt-5.2-mini',
  temperature: 0.7,
  max_tokens: 150,
  messages: [
    { role: 'system', content: personaPrompt },
    ...conversationHistory.slice(-4),  // last 4 messages for context
    { role: 'user', content: `Agentul a spus: "${agentMessage}". Raspunde ca ${config.persona.name}.` },
  ],
})
```

- [ ] **Step 2: Create DB verifier**

`e2e/lib/db-verifier.ts`:

Uses Prisma directly (import from `@/lib/db`).

```typescript
export async function verifyHappyPath(conversationId: string): Promise<VerificationResult>
export async function verifyBdRejection(conversationId: string): Promise<VerificationResult>
export async function verifyObjectionHandling(conversationId: string, minObjectionTypes: number): Promise<VerificationResult>
export async function verifyChangeOfMind(conversationId: string): Promise<VerificationResult>
export async function verifyDntPauseResume(conversationId: string): Promise<VerificationResult>
```

Each verifier loads relevant DB records and checks conditions. Returns `{ passed, checks: [{ name, passed, expected, actual }] }`.

Key queries per verifier:
- Load Conversation with status
- Load Application with tierId, levelId, includesAddon, status
- Load Answers count for DNT groups
- Load WorkflowSession.data for dntSignedAt
- Load Quote with premiumAnnual, status
- Load Policy with status
- Load Payment with status
- Load Customer with isAnonymous, magicLinkToken

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit
git add e2e/lib/client-simulator.ts e2e/lib/db-verifier.ts
git commit -m "feat(c1): add client simulator (hybrid LLM + deterministic) and DB verifier"
```

---

## Task 3: Test Scenarios (5 files)

**Files:**
- Create: all 5 files in `e2e/scenarios/`

- [ ] **Step 1: Create shared test helper**

Each test follows the same loop pattern. Create a helper in the scenarios or lib:

```typescript
async function runConversation(config: SimulatorConfig, options?: {
  maxTurns?: number
  stopOnUiAction?: string  // stop when this ui_action type is received
  baseUrl?: string
}): Promise<{ tracker: TurnTracker; conversationId: string; customerId: string }>
```

Loop:
1. Create conversation
2. Send opening message
3. Parse response → generate customer reply → send → parse → repeat
4. Stop on max turns, stopOnUiAction, or when done event has no more content

- [ ] **Step 2: Create happy-path.test.ts**

```typescript
import { describe, test, expect } from 'vitest'

describe('Happy Path — Full Sale', () => {
  test('discovery → DNT → application → BD → quote → payment → policy', async () => {
    const config = { persona: DEFAULT_PERSONA, behavior: { answersMap: DEFAULT_ANSWERS } }
    const { tracker, conversationId } = await runConversation(config, {
      maxTurns: 50,
      stopOnUiAction: 'show_payment_success',
    })

    // Verify conversation flow
    tracker.assertNoErrors()
    tracker.assertTurnCount(10, 50)

    // Verify DB state
    const result = await verifyHappyPath(conversationId)
    expect(result.passed).toBe(true)
    for (const check of result.checks) {
      expect(check.passed, `${check.name}: expected ${check.expected}, got ${check.actual}`).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Create bd-rejection.test.ts**

Same structure. Override: `bdAnswers: { BD_CANCER_HISTORY: 'true' }` merged into answersMap. Stop on `show_payment_success`. Verify with `verifyBdRejection()`.

- [ ] **Step 4: Create objection-handling.test.ts**

Config adds objections at turns 4, 12, 18. Verify `get_objection_strategy` was called 3+ times via turn tracker. Verify with `verifyObjectionHandling(conversationId, 3)`.

- [ ] **Step 5: Create change-of-mind.test.ts**

Config: answersMap starts with `PACKAGE_CHOICE: 'optim', PREMIUM_LEVEL: 'level_3'`. Set `changeOfMind: { afterQuote: true, newTier: 'standard', newLevel: 'level_1' }`. Verify with `verifyChangeOfMind()`.

- [ ] **Step 6: Create dnt-pause-resume.test.ts**

Config: `pauseAtTurn: 8`. After pause, wait 2s, send "Am revenit" in same conversation. Verify all DNT answers saved, no duplicates. Verify with `verifyDntPauseResume()`.

- [ ] **Step 7: Verify types compile**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: Commit**

```bash
git add e2e/scenarios/
git commit -m "feat(c1): add 5 E2E test scenarios — happy path, BD rejection, objections, change of mind, DNT pause"
```

---

## Task 4: Run Tests + Final Verification

- [ ] **Step 1: Ensure dev server is running**

The E2E tests need the dev server. Either:
- Start manually: `npm run dev` in another terminal
- Or add a programmatic server start in the test setup

- [ ] **Step 2: Run E2E tests**

```bash
npm run test:e2e
```

Expected: All 5 scenarios pass (with real LLM calls).

Note: These tests REQUIRE:
- `OPENAI_API_KEY` in `.env` (for client simulator LLM)
- `PAYMENT_PROVIDER=mock` in `.env`
- Dev server running on the expected port
- DB seeded

- [ ] **Step 3: Fix any failures**

E2E tests with real LLMs may fail due to:
- Agent not following the expected workflow (adjust persona prompt or add retries)
- Timeout (increase if needed)
- DB state not as expected (check tool handlers)

Iterate until all 5 pass.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Existing tests still pass**

```bash
npx vitest run
```

Expected: 84 unit tests still pass (E2E tests run separately via test:e2e).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(c1): complete Slice C1 — E2E test suite with 5 scenarios passing"
```

---

## Notes for Implementer

1. **E2E tests use real LLM calls.** They cost money (small — GPT-5.2-mini for simulator). Budget ~$0.10 per full run.

2. **Tests are non-deterministic.** LLM responses vary. The test framework should be tolerant: verify DB state (deterministic) rather than exact message content.

3. **The dev server must be running.** Tests call `http://localhost:3001/api/chat` (or whatever port). Use `APP_URL` env var or hardcode localhost.

4. **Questionnaire answers are deterministic.** When the agent shows a question card, the simulator returns the answer from the map immediately (no LLM call). This makes the questionnaire flow fast and predictable.

5. **Max turns safety.** Each test has a max turn limit (40-50). If the agent gets stuck in a loop, the test fails with a clear "max turns exceeded" message.

6. **DB verifier uses Prisma directly.** Import from `@/lib/db`. The tests run in the same Node.js process as the Vitest runner, so Prisma works.

7. **Cleanup optional.** Test data stays in the DB (useful for debugging). If cleanup is needed, the verifier can delete test conversations at the end.

8. **SSE parser is the same logic as useChat hook** but synchronous (waits for full response). Don't import from the hook — it's a client component. Reimplement the SSE parsing for Node.js.

9. **OpenAI SDK for simulator.** Import directly: `import OpenAI from 'openai'`. Don't use our gateway (that would test our agent config, not just generate responses).

10. **Objection injection timing.** The `turn` number in objections config is approximate. If the agent takes more or fewer turns than expected to reach that point, the objection may fire at a different conversation phase. This is OK — the test verifies that `get_objection_strategy` was called, not where exactly.
