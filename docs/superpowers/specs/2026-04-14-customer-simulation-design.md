# Customer Simulation Module — Design Spec

**Date:** 2026-04-14
**Status:** Approved
**Approach:** Hybrid (scripted golden paths + LLM-powered freeform personas)

---

## 1. Overview

An automated customer simulation module that drives realistic conversations against the live chat API. It creates varied customer personas, runs them through scripted or LLM-powered conversation flows, and feeds results directly into the existing self-improvement pipeline (scorer → analyzer → proposer → tracker).

Simulated conversations use `channel: 'simulation'` to distinguish them from real customer traffic. The admin dashboard is extended to show simulation runs, errors, and simulated-vs-real comparisons — all integrated into the existing self-improvement section.

### Architecture

```
┌─────────────────────────────────────────────────┐
│              Simulation Runner                   │
│  ┌──────────┐  ┌───────────────────────────┐    │
│  │ Scripted │  │   LLM Freeform Personas   │    │
│  │ Scenarios│  │ (young-parent, skeptic...) │    │
│  └────┬─────┘  └────────────┬──────────────┘    │
│       └──────────┬──────────┘                    │
│            Conversation Driver                   │
│         (calls POST /api/chat)                   │
└──────────────────┬──────────────────────────────┘
                   │ channel='simulation'
                   ▼
         ┌─────────────────┐
         │  Chat Pipeline  │  (existing orchestrator)
         └────────┬────────┘
                  ▼
    ┌──────────────────────────┐
    │  Self-Improvement Batch  │  (scorer → analyzer → proposer → tracker)
    │  + admin dashboard       │  (shows simulation vs real, errors, patterns)
    └──────────────────────────┘
```

---

## 2. Data Model

### 2.1 SimulationRun

Tracks each batch of simulated conversations.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | String | cuid() | Primary key |
| status | String | "RUNNING" | RUNNING, COMPLETED, FAILED |
| trigger | String | — | 'cli', 'admin', 'scheduled' |
| config | Json | — | Personas used, scenario list, counts |
| totalScenarios | Int | — | Total conversations planned |
| completedCount | Int | 0 | Conversations completed |
| failedCount | Int | 0 | Conversations failed |
| avgScore | Float? | null | Computed after scoring |
| errors | Json | [] | Aggregated error log |
| startedAt | DateTime | now() | Run start time |
| completedAt | DateTime? | null | Run completion time |
| createdAt | DateTime | now() | Record creation |

### 2.2 SimulationConversation

Links each simulated conversation to its run and persona.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | String | cuid() | Primary key |
| runId | String | — | FK → SimulationRun |
| conversationId | String | unique | FK → Conversation |
| personaSlug | String | — | e.g. 'young-parent', 'skeptic' |
| scenarioType | String | — | 'scripted' or 'freeform' |
| scenarioSlug | String? | null | e.g. 'happy-path', null for freeform |
| status | String | "RUNNING" | RUNNING, COMPLETED, FAILED, ABANDONED |
| turnCount | Int | 0 | Number of turns completed |
| error | String? | null | Error message if failed |
| score | Float? | null | Copied from ConversationScore after scoring |
| durationMs | Int? | null | Total conversation duration |
| createdAt | DateTime | now() | Record creation |

### 2.3 Existing Tables — No Changes

Simulated conversations are regular `Conversation` records with `channel: 'simulation'`. The existing `ConversationScore`, `TurnTrace`, `Message`, etc. all work as-is.

---

## 3. Persona Definitions

Static config in `lib/simulation/personas.ts`. Each persona drives how the LLM responds during freeform runs.

```typescript
interface Persona {
  slug: string
  name: string              // "Maria Popescu"
  age: number
  language: 'ro' | 'en'
  occupation: string
  familySize: number
  hasChildren: boolean
  incomeLevel: 'low' | 'medium' | 'high'
  motivations: string[]     // ["protect family", "mortgage coverage"]
  personality: string       // LLM instruction: "skeptical, asks many questions"
  objectionTypes: string[]  // which objections this persona raises
  maxTurns: number          // safety cap per conversation
  expectedOutcome: 'purchase' | 'abandon' | 'escalate'
}
```

### Initial Personas (8)

| Slug | Name | Age | Profile | Expected Outcome |
|------|------|-----|---------|-----------------|
| young-parent | Maria Popescu | 32 | Family-focused, budget-conscious, wants basic protection | purchase |
| professional | Andrei Ionescu | 42 | Higher income, wants comprehensive coverage + BD clause | purchase |
| price-objector | Elena Dumitrescu | 37 | Interested but pushes back hard on cost | purchase (after objection handling) |
| skeptic | Ion Gheorghe | 48 | Doesn't trust insurance, needs convincing | purchase (slow) |
| quick-buyer | Ana Moldovan | 33 | Knows what she wants, minimal objections | purchase |
| abandoner | Vlad Stanescu | 27 | Starts but drops mid-questionnaire | abandon |
| credit-protector | Cristina Radu | 40 | Wants to protect a mortgage/loan | purchase |
| confused-customer | Gheorghe Marin | 55 | Needs lots of explanation, asks repeated questions | purchase (many turns) |

---

## 4. Scripted Scenarios

Each scenario lives in `lib/simulation/scenarios/` as a separate file. Uses a decision tree that maps agent responses + UI actions to deterministic customer replies.

```typescript
interface ScriptedScenario {
  slug: string
  name: string
  persona: Persona
  steps: ScenarioStep[]
}

interface ScenarioStep {
  trigger:
    | { type: 'turn'; number: number }
    | { type: 'ui_action'; actionType: string }
    | { type: 'contains'; text: string }
  response:
    | { type: 'message'; text: string }
    | { type: 'action'; action: { type: string; payload: Record<string, unknown> } }
    | { type: 'abandon' }
}
```

### Initial Scenarios (6)

| Slug | Persona | Flow | Expected Result |
|------|---------|------|-----------------|
| happy-path | quick-buyer | Discovery → DNT → application → quote → accept | COMPLETED, score ~1.0 |
| bd-clause-path | professional | Full flow including BD (critical illness) rider | COMPLETED, score ~1.0 |
| price-objection-conversion | price-objector | Objects to price → objection strategy → accepts | COMPLETED, score ~1.0 |
| abandon-mid-questionnaire | abandoner | Starts DNT → stops responding after 3 questions | ABANDONED, score ~0.0 |
| quote-modification | young-parent | Gets quote → asks to modify package → accepts revised | COMPLETED, score ~1.0 |
| escalation | confused-customer | Asks many questions → requests human agent | IDLE, score ~0.0 |

---

## 5. Conversation Driver

`lib/simulation/driver.ts` — runs a single conversation end-to-end.

### Flow

1. Call `POST /api/session` → get customerId
2. Call `POST /api/chat/create` with customerId → get conversationId
3. Update the Conversation record: set `channel = 'simulation'`
4. Create `SimulationConversation` record
5. Loop (max turns capped by persona.maxTurns):
   - Send message via `POST /api/chat` (SSE stream)
   - Parse all events: content, tool_start/complete, ui_action, error, done
   - If error event → record it, decide retry (max 2) or abort
   - If scripted: match triggers → get next response
   - If freeform: send agent response + UI actions + persona to LLM → get next customer message
   - If conversation completed (show_policy_issued, show_payment_success) → break
   - If abandon scenario → stop sending messages
   - Increment turnCount on SimulationConversation
6. Update SimulationConversation: final status, turnCount, durationMs, error

### Freeform LLM

Uses a separate agent slug `'customer-simulator'` — a lightweight agent config in the DB using a cheap model (gpt-4.1-mini). The system prompt instructs it to role-play as the persona, stay in character, respond naturally in Romanian, and follow the persona's personality/objection traits.

### SSE Parsing

Reuse the existing `parseSSEStream` helper from `e2e/lib/sse-parser.ts` — extract into a shared `lib/simulation/sse-client.ts` that both the e2e tests and the simulator can import.

---

## 6. Run Orchestration

`lib/simulation/runner.ts` — orchestrates a full simulation run.

### Flow

1. Create `SimulationRun` record (status: RUNNING)
2. Run scripted scenarios first (all 6, sequentially — deterministic baselines)
3. Run freeform personas (configurable count, default 10, random persona selection with even distribution)
4. Concurrency: freeform conversations use a pool of 3 concurrent to avoid rate-limiting
5. After all conversations finish:
   - Update `SimulationRun` with completedCount, failedCount, errors
   - Set status to COMPLETED (or FAILED if >50% errored)
6. If `runBatchAfter` option is true: trigger `runDailyBatch()` to immediately score and analyze

### Configuration

```typescript
interface SimulationConfig {
  runScripted: boolean        // default true
  runFreeform: boolean        // default true
  freeformCount: number       // default 10
  personas?: string[]         // filter to specific persona slugs
  concurrency: number         // default 3
  runBatchAfter: boolean      // default true
  trigger: 'cli' | 'admin' | 'scheduled'
}
```

---

## 7. CLI

Script at `scripts/simulate.ts`, exposed as `npm run simulate`.

```
npm run simulate                           # all: 6 scripted + 10 freeform
npm run simulate -- --scripted-only        # just golden paths
npm run simulate -- --freeform-only        # just freeform personas
npm run simulate -- --count 30             # override freeform count
npm run simulate -- --persona skeptic,young-parent  # specific personas
npm run simulate -- --run-batch            # trigger self-improvement batch after
npm run simulate -- --no-batch             # skip batch trigger
```

Outputs a summary table to stdout. Returns exit code 1 if any conversation errored.

---

## 8. Scheduled Execution

Cron-style trigger, same pattern as the self-improvement batch.

- Default: nightly at 2 AM (configurable via `SIMULATION_CRON` env var)
- Disabled with `SIMULATION_ENABLED=false`
- Runs: all 6 scripted + 15 freeform conversations
- Automatically triggers `runDailyBatch()` after completion
- Uses trigger type `'scheduled'`

---

## 9. Admin Dashboard Integration

Extends the existing self-improvement page — not a separate section.

### 9.1 Simulation Run Panel

Added to the top of the self-improvement dashboard, next to the existing "Run Batch" button.

- **"Run Simulation" button** with config options (all, scripted only, freeform only, custom count)
- **Run history table:** timestamp, trigger, status, total/completed/failed, avg score, duration
- **Click a run** → expands to show individual conversations

### 9.2 Conversation Browser

Within a run's expanded view:

- Table: persona, scenario type, status, turn count, score, duration, error indicator
- Click a conversation → full transcript viewer:
  - User/assistant messages in chat bubble format
  - Tool calls highlighted inline
  - UI actions shown as cards
  - Errors shown in red with context
  - Score breakdown at the bottom

### 9.3 Error Aggregation

New tab within self-improvement section:

- Grouped by error type: API errors (400/500), tool failures, conversation loops, unexpected states
- Per error: count, affected personas/scenarios, sample conversation links
- Trend line: errors per run over time

### 9.4 Existing Sections Enhanced

- **Score chart:** adds "simulated" series alongside "real" — two lines on the same chart
- **Skill pack performance:** shows simulated vs real scores per pack
- **Proposals:** proposals from simulated data appear normally (no change needed)
- **A/B test results:** simulated conversations participate in tests, with filter toggle: all / real only / simulated only

---

## 10. API Endpoints

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/admin/simulation/run | Trigger a simulation run |
| GET | /api/admin/simulation/runs | List runs (paginated, filtered by status) |
| GET | /api/admin/simulation/runs/[id] | Run detail with conversation list |
| GET | /api/admin/simulation/conversations/[id] | Full transcript + events for one conversation |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| GET | /api/admin/self-improvement | Add simulation stats: total runs, last run, simulated vs real avg scores |

All new endpoints require admin auth (same as existing `/api/admin/*` routes).

---

## 11. New Files

```
lib/simulation/
  runner.ts                    # Run orchestration, concurrency pool
  driver.ts                    # Single conversation driver (scripted + freeform)
  personas.ts                  # 8 persona definitions
  sse-client.ts                # SSE stream parser (extracted from e2e helper)
  types.ts                     # Shared interfaces
  scenarios/
    happy-path.ts
    bd-clause-path.ts
    price-objection-conversion.ts
    abandon-mid-questionnaire.ts
    quote-modification.ts
    escalation.ts

scripts/
  simulate.ts                  # CLI entry point

app/api/admin/simulation/
  run/route.ts                 # POST trigger
  runs/route.ts                # GET list
  runs/[id]/route.ts           # GET detail
  conversations/[id]/route.ts  # GET transcript

prisma/migrations/
  YYYYMMDD_add-simulation-tables/migration.sql

# Admin UI components (within existing self-improvement page):
components/admin/simulation/
  simulation-run-panel.tsx
  simulation-run-table.tsx
  simulation-conversation-browser.tsx
  simulation-transcript-viewer.tsx
  simulation-error-panel.tsx
  score-comparison-chart.tsx     # simulated vs real chart
```

---

## 12. Agent Config (DB seed)

New agent record for the customer simulator LLM:

| Field | Value |
|-------|-------|
| slug | customer-simulator |
| name | Customer Simulator |
| role | customer-simulator |
| provider | OPENAI |
| model | gpt-4.1-mini |
| temperature | 0.8 |
| maxTokens | 512 |
| systemPrompt | (role-play prompt — stay in character, respond in Romanian, follow persona traits) |

---

## 13. Testing Strategy

- **Unit tests:** persona loading, scenario step matching, SSE parsing
- **Integration tests:** driver runs a scripted scenario against live API, verifies conversation is created with channel='simulation', messages stored correctly, SimulationConversation record populated
- **E2E test:** full runner with 1 scripted + 1 freeform, verify SimulationRun record, verify self-improvement scorer picks them up
- **Admin API tests:** CRUD endpoints return correct data, auth required

---

## 14. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| SIMULATION_ENABLED | true | Enable/disable scheduled runs |
| SIMULATION_CRON | 0 2 * * * | Cron schedule (default: 2 AM daily) |
| SIMULATION_FREEFORM_COUNT | 10 | Default freeform conversation count |
| SIMULATION_CONCURRENCY | 3 | Max concurrent freeform conversations |
