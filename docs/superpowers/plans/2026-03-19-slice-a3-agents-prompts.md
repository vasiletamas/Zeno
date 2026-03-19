# Slice A3: Agents + Prompts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace orchestrator stub steps 3-6 with full reasoning gate, 3-layer dynamic prompt assembly, sliding window with summarizer, and section-specific context loaders.

**Architecture:** Four new focused modules (prompt-builder, reasoning-gate, sliding-window, context-loaders) that the orchestrator delegates to. Each module has a single responsibility and is testable in isolation. The orchestrator stays thin — it coordinates but doesn't contain prompt or gate logic.

**Tech Stack:** TypeScript, Prisma v7, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-slice-a3-agents-prompts-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/chat/prompt-builder.ts` | 3-layer section registry, gate-driven assembly, fast-path detection |
| `lib/chat/reasoning-gate.ts` | Full gate input building, JSON output parsing, briefing formatting |
| `lib/chat/sliding-window.ts` | Window management (last 20 full) + summarizer trigger |
| `lib/chat/context-loaders.ts` | Load content for all 10 prompt sections from DB |
| `__tests__/lib/chat/prompt-builder.test.ts` | Section selection, gate-driven inclusion/exclusion tests |
| `__tests__/lib/chat/reasoning-gate.test.ts` | Input building, output parsing, fallback tests |

### Modified files

| File | Change |
|------|--------|
| `lib/chat/orchestrator.ts` | Steps 3-6 replaced with real implementations, step 9 enhanced (profile extractor), step 10 enhanced (section tracking in turn trace) |
| `prisma/seeds/seed-agents.ts` | Update reasoning gate prompt: `globalWisdom` → `agentKnowledge`, remove `metadata` references |

---

## Task 1: Prompt Builder

**Files:**
- Create: `lib/chat/prompt-builder.ts`
- Create: `__tests__/lib/chat/prompt-builder.test.ts`

- [ ] **Step 1: Create prompt-builder.ts**

This is the 3-layer section registry with gate-driven assembly.

**Read before implementing:**
- `docs/superpowers/specs/2026-03-19-slice-a3-agents-prompts-design.md` — Section 4 (Prompt Builder)
- `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/agents/prompt-builder.ts` — V1 reference implementation

Define these types and exports:

```typescript
// Section configuration
interface SectionConfig {
  key: string
  priority: number
  layer: 'constitution' | 'reasoning' | 'dynamic'
  alwaysInclude: boolean
  prefix: string
}

// All section contents (string | null for each)
interface PromptSections {
  agentIdentity: string | null
  capabilityManifest: string | null
  constraints: string | null
  situationalBriefing: string | null
  customerMemory: string | null
  agentKnowledge: string | null
  customerContext: string | null
  coachingBriefing: string | null
  workflowInstructions: string | null
  questionnaireContext: string | null
  productContext: string | null
}

// Gate's section selection
interface GateSelection {
  requiredSections: string[]
  excludedSections: string[]
  confidence: number
}

// Build result
interface PromptBuildResult {
  prompt: string
  sectionSizes: Record<string, number>
  gateActive: boolean
  includedSections: string[]
  excludedSections: string[]
}
```

Register 10 sections with the registry from spec Section 4.1 (priorities 1-26).

Implement:

```typescript
export function buildPrompt(sections: PromptSections, gateSelection: GateSelection): PromptBuildResult
export function detectFastPath(message: string, hasActiveQuestionnaire: boolean): boolean
export const FAST_PATH_GATE: GateSelection  // the fast-path defaults from spec Section 11
export type { PromptSections, GateSelection, PromptBuildResult }
```

**buildPrompt logic:**
1. Determine if gate is active: `(requiredSections.length > 0 || excludedSections.length > 0) && confidence >= 0.3`
2. For each section config (sorted by priority ascending):
   - Skip if content is null/empty
   - If gate active: skip if in excludedSections AND not alwaysInclude
   - Render: prefix (if any) + content
3. Insert `\n\n[INTERNAL GUIDANCE - Do not mention this directly to the customer]\n` before first non-constitution section
4. Return concatenated prompt + metadata

**detectFastPath logic:**
- Returns true if hasActiveQuestionnaire AND message matches: single word, "da"/"nu" (case insensitive), a number, or a short selection value (< 30 chars, no spaces beyond one word)

- [ ] **Step 2: Write prompt-builder tests**

`__tests__/lib/chat/prompt-builder.test.ts`:

Tests:
1. Renders sections in priority order (agentIdentity first, productContext last)
2. Gate-driven exclusion: excludedSections removes non-alwaysInclude sections
3. alwaysInclude sections cannot be excluded (constraints, agentIdentity, workflowInstructions, situationalBriefing)
4. Null/empty sections are always skipped
5. Gate not active (confidence < 0.3): all non-empty sections included
6. Internal guidance separator inserted before first dynamic/reasoning section
7. Fast path detection: "Da" → true, "Nu" → true, "3" → true, "level_2" → true, "Vreau sa stiu mai multe" → false
8. Fast path requires hasActiveQuestionnaire=true

- [ ] **Step 3: Run tests**

Run: `npx vitest run __tests__/lib/chat/prompt-builder.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt-builder.ts __tests__/lib/chat/prompt-builder.test.ts
git commit -m "feat(a3): add 3-layer prompt builder with gate-driven section selection"
```

---

## Task 2: Reasoning Gate

**Files:**
- Create: `lib/chat/reasoning-gate.ts`
- Create: `__tests__/lib/chat/reasoning-gate.test.ts`

- [ ] **Step 1: Create reasoning-gate.ts**

**Read before implementing:**
- Spec Section 5 (Reasoning Gate)
- Spec Section 11 (Implementation notes — toolGuidance shape, situationType usage)
- `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/agents/reasoning-gate.ts` — V1 reference
- `C:/GitHub/ai_sales_agent_crm/extraction/prompts/synthesizer-prompt.md` — gate prompt details
- `lib/llm/gateway.ts` — gateway.call() signature

Implement:

```typescript
// Full input type
interface ReasoningGateInput {
  lastUserMessage: string
  last3Messages: { role: string; content: string }[]
  hasActiveQuestionnaire: boolean
  currentQuestionText: string | null
  workflowStepCode: string | null
  availableTools: string[]
  customerProfile: {
    name: string | null
    age: number | null
    family: string | null
    occupation: string | null
    isReturningCustomer: boolean
  }
  businessState: {
    selectedProduct: string | null
    dntProgress: string | null
    applicationProgress: string | null
    hasQuote: boolean
    quoteValue: number | null
    hasPolicy: boolean
  }
}

// Full output type
interface ReasoningGateOutput {
  situationType: string
  complexity: 'simple' | 'moderate' | 'complex'
  confidence: number
  contradictions?: { tension: string; resolution: string; winner: string }[]
  concernActions?: { concern: string; gateAssessment: string; action: string; reason: string }[]
  requiredSections: string[]
  excludedSections: string[]
  briefing: string
  toolGuidance: { prioritize: string[]; discourage: string[] }
  knowledgeGaps?: string[]
}

export async function executeReasoningGate(input: ReasoningGateInput): Promise<ReasoningGateOutput>
export function formatGateBriefing(output: ReasoningGateOutput): string
export function buildGateContextMessage(input: ReasoningGateInput): string
export type { ReasoningGateInput, ReasoningGateOutput }
```

**executeReasoningGate:**
1. Build context message from input (compact ~500-800 token string)
2. Call `gateway.call('reasoning-gate', { messages: [{ role: 'user', content: contextMessage }] })`
3. Extract JSON from response (handle markdown code fences: ```json ... ```)
4. Validate: complexity must be 'simple'|'moderate'|'complex', clamp confidence to [0,1], ensure arrays are arrays
5. On any failure: return FALLBACK_OUTPUT

**FALLBACK_OUTPUT:**
```typescript
{ situationType: 'unknown', complexity: 'moderate', confidence: 0, requiredSections: [], excludedSections: [], briefing: '', toolGuidance: { prioritize: [], discourage: [] } }
```

**formatGateBriefing:** Formats output into the situationalBriefing prompt section string (see spec Section 5.4 for exact format).

**buildGateContextMessage:** Formats all input fields into a compact context string:
```
RECENT CONVERSATION:
Customer: {msg1}
Agent: {msg2}
Customer: {msg3}

ACTIVE WORKFLOW STEP: {stepCode}
QUESTIONNAIRE ACTIVE: Yes/No
CURRENT QUESTION: {text}
AVAILABLE TOOLS: tool1, tool2, tool3
CUSTOMER: {name}, age {age}, {occupation}, {family}
BUSINESS STATE: Product: {product} | DNT: {progress} | Application: {progress} | Quote: {value}

CURRENT CUSTOMER MESSAGE: {lastUserMessage}
```

- [ ] **Step 2: Write reasoning-gate tests**

`__tests__/lib/chat/reasoning-gate.test.ts`:

Tests (mock gateway.call):
1. Parse clean JSON response → correct ReasoningGateOutput
2. Parse markdown-fenced JSON (```json ... ```) → correct output
3. Malformed JSON → fallback output
4. Gateway timeout/error → fallback output
5. Invalid complexity value → fallback
6. Confidence clamped to [0, 1]
7. formatGateBriefing produces correct string format
8. buildGateContextMessage includes all input fields

- [ ] **Step 3: Run tests**

Run: `npx vitest run __tests__/lib/chat/reasoning-gate.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/chat/reasoning-gate.ts __tests__/lib/chat/reasoning-gate.test.ts
git commit -m "feat(a3): add full reasoning gate with structured output parsing"
```

---

## Task 3: Sliding Window + Context Loaders

**Files:**
- Create: `lib/chat/sliding-window.ts`
- Create: `lib/chat/context-loaders.ts`

- [ ] **Step 1: Create sliding-window.ts**

**Read:** Spec Section 6 (Sliding Window + Summarizer), Section 11 (sliding window bug note)

```typescript
import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import type { Message } from '@/lib/llm/providers/types'

export async function buildSlidingWindow(
  conversationId: string,
  totalMessages: number,
): Promise<{ messages: Message[]; summaryPrefix: string | null }>
```

Logic:
1. If totalMessages <= 20: load all messages ordered by createdAt asc, return `{ messages, summaryPrefix: null }`
2. If totalMessages > 20:
   - Load last 20: `orderBy: { createdAt: 'desc' }, take: 20` then REVERSE (fix the A2 bug!)
   - Check `ConversationSummary` for this conversationId
   - If summary exists and `messagesUpTo >= (totalMessages - 20)`: return `{ messages: last20, summaryPrefix: summary.summary }`
   - If no summary or stale: load messages NOT in last 20, call summarizer, save ConversationSummary, return with new summary

**Summarizer invocation:**
```typescript
async function triggerSummarizer(conversationId: string, messagesToSummarize: Message[]): Promise<string>
```
- Call `gateway.call('summarizer', { messages: [{ role: 'user', content: formatMessagesForSummary(messages) }] })`
- Save to ConversationSummary via prisma upsert
- Return summary text

**Message to Message type conversion:** Load from DB, map to `{ role, content, toolCalls: parsed JSON or undefined, toolCallId: undefined }`.

- [ ] **Step 2: Create context-loaders.ts**

**Read:** Spec Section 7 (Context Loaders), Section 11 (questionnaire detection, customerContext null behavior)

```typescript
import { prisma } from '@/lib/db'
import type { PromptSections } from './prompt-builder'

// Constitution layer
export function loadAgentIdentity(systemPrompt: string | null): string | null
export function loadCapabilityManifest(allowedTools: string[]): string
export function loadConstraints(constraints: string | null): string | null

// Dynamic layer
export async function loadProductContext(productId: string, language: 'en' | 'ro'): Promise<string | null>
export async function loadCoachingBriefing(productId: string): Promise<string | null>
export function loadWorkflowInstructions(workflowSession: WorkflowSessionData | null): string | null
export async function loadQuestionnaireContext(conversationId: string, workflowStepCode: string | null, language: 'en' | 'ro'): Promise<string | null>
export async function loadCustomerContext(customerId: string): Promise<string | null>
export async function loadCustomerMemory(customerId: string): Promise<string | null>  // returns null (P2)
export async function loadAgentKnowledge(productId: string | null): Promise<string | null>  // returns null (P2)

// Convenience: load all sections at once
export async function loadAllSections(params: {
  agentConfig: { systemPrompt: string | null; constraints: string | null }
  allowedTools: string[]
  productId: string | null
  conversationId: string
  customerId: string
  workflowSession: WorkflowSessionData | null
  workflowStepCode: string | null
  situationalBriefing: string | null
  language: 'en' | 'ro'
}): Promise<PromptSections>
```

**Key loader details:**

**loadProductContext:** Query Product with PricingTiers → PricingLevels, Addons → PricingRules. Format as:
```
[PRODUCT CONTEXT]
Product: Protect (Protect)
Type: LIFE / term_life
Description: ...
Key Features: ...
Pricing: Standard I=190, II=290, III=390 RON/year | Optim I=230, II=330, III=430 RON/year
BD Addon: Medical Treatment Abroad, 200-700 RON/year by age
```

**loadCoachingBriefing:** Return `Product.defaultPlaybook` text directly.

**loadWorkflowInstructions:** Format current step name, agentInstructions, allowed tools, and workflow session data.

**loadQuestionnaireContext:** Determine active questionnaire from workflowStepCode (see spec Section 11):
- `dnt_questionnaire` → DNT groups
- `application_fill` → Application group
- Step containing `bd` → BD medical group
- Find first unanswered question via Question LEFT JOIN Answer for conversationId
- Format: questionnaire type, current question text+options, progress (answered/total)

**loadCustomerContext:** Load Customer, format name/language/dateOfBirth. If extractedProfile exists (Json), merge demographics, employment, family info. If null, return basic info only.

**loadCustomerMemory / loadAgentKnowledge:** Return null (P2 placeholders).

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/chat/sliding-window.ts lib/chat/context-loaders.ts
git commit -m "feat(a3): add sliding window with summarizer and context loaders for all 10 sections"
```

---

## Task 4: Orchestrator Enhancement + Gate Seed Update

**Files:**
- Modify: `lib/chat/orchestrator.ts`
- Modify: `prisma/seeds/seed-agents.ts`

- [ ] **Step 1: Update reasoning gate seed prompt**

In `prisma/seeds/seed-agents.ts`, find the reasoning-gate agent's systemPrompt. Replace references to `globalWisdom` with `agentKnowledge` and remove any references to `metadata` section. The gate needs to emit V2 section names.

- [ ] **Step 2: Re-run seeds**

Run: `npx prisma db seed`

- [ ] **Step 3: Rewrite orchestrator steps 3-6**

**Read:** Current `lib/chat/orchestrator.ts` — understand the full file structure, especially the async generator and how steps flow.

Replace the stub implementations of steps 3-6 with calls to the new modules:

**Step 3 (reasoning gate) — replace current inline stub:**
```typescript
// Fast path check
const hasActiveQuestionnaire = /* derive from workflow step */
if (detectFastPath(input.message, hasActiveQuestionnaire)) {
  gateOutput = null  // skip gate
  gateSelection = FAST_PATH_GATE
} else {
  // Build full gate input
  const gateInput: ReasoningGateInput = {
    lastUserMessage: input.message,
    last3Messages: /* from recent messages query */,
    hasActiveQuestionnaire,
    currentQuestionText: /* from context */,
    workflowStepCode: /* from workflow session */,
    availableTools: /* from tool registry filtered by workflow */,
    customerProfile: /* from customer record */,
    businessState: /* from conversation state */,
  }
  gateOutput = await executeReasoningGate(gateInput)
  gateSelection = { requiredSections: gateOutput.requiredSections, excludedSections: gateOutput.excludedSections, confidence: gateOutput.confidence }
}
```

**Step 4 (context assembly) — replace current inline append:**
```typescript
const agentConfig = await getAgentConfig('main-chat')
const situationalBriefing = gateOutput ? formatGateBriefing(gateOutput) : null
const sections = await loadAllSections({
  agentConfig,
  allowedTools: /* filtered tools */,
  productId: state.productId,
  conversationId: state.conversationId,
  customerId: state.customerId,
  workflowSession: /* loaded session */,
  workflowStepCode: /* step code */,
  situationalBriefing,
  language: state.language,
})
```

**Step 5 (sliding window) — replace current buggy fetch:**
```typescript
const { messages: windowMessages, summaryPrefix } = await buildSlidingWindow(
  state.conversationId,
  state.messageCount,
)
```

**Step 6 (prompt assembly) — replace current concatenation:**
```typescript
const { prompt: systemPrompt, sectionSizes, gateActive, includedSections, excludedSections } = buildPrompt(sections, gateSelection)
const messages: Message[] = [
  { role: 'system', content: systemPrompt },
]
if (summaryPrefix) {
  messages.push({ role: 'system', content: `[Previous conversation summary]\n${summaryPrefix}\n[End of summary — recent messages follow]` })
}
messages.push(...windowMessages)
messages.push({ role: 'user', content: input.message })
```

**Step 9 enhancement (profile extractor) — replace stub:**
```typescript
// Fire-and-forget profile extraction
const hasPersonalInfo = /\b(ani|varsta|copil|sot|sotie|lucrez|casatorit|familie|venit|salariu|\d{13})\b/i.test(input.message)
if (hasPersonalInfo) {
  void (async () => {
    try {
      const response = await gateway.call('profile-extractor', {
        messages: [{ role: 'user', content: input.message }],
      })
      if (response.content) {
        const extracted = JSON.parse(response.content)
        const current = await prisma.customer.findUnique({ where: { id: state.customerId }, select: { extractedProfile: true } })
        const merged = { ...(current?.extractedProfile as Record<string, unknown> ?? {}), ...extracted }
        await prisma.customer.update({ where: { id: state.customerId }, data: { extractedProfile: merged } })
      }
    } catch (e) { console.error('Profile extractor failed:', e) }
  })()
}
```

**Step 10 enhancement — add section tracking to turn trace:**
Add `sectionSizes`, `gateActive`, `gateComplexity`, `fastPath`, `includedSections`, `excludedSections` to the TurnTrace.phases JSON.

- [ ] **Step 4: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add lib/chat/orchestrator.ts prisma/seeds/seed-agents.ts
git commit -m "feat(a3): integrate prompt builder, reasoning gate, sliding window into orchestrator"
```

---

## Task 5: Final Verification

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (prompt-builder + reasoning-gate + any existing tests).

- [ ] **Step 3: Re-seed database**

Run: `npx prisma db seed`
Expected: All seeds pass (including updated reasoning gate prompt).

- [ ] **Step 4: Verify dev server**

Run: `npm run dev` (start, verify it compiles, stop)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(a3): complete Slice A3 — prompt assembly, reasoning gate, sliding window, context loaders"
```

---

## Notes for Implementer

1. **Import paths:** Use `@/` alias for all imports. PrismaClient from `@/lib/generated/prisma/client`. Gateway from `@/lib/llm/gateway`.

2. **The A2 orchestrator sliding window bug:** Current step 5 orders `asc` with `take: 20`, fetching the FIRST 20 messages. Fix this by using `orderBy: { createdAt: 'desc' }, take: 20` then reversing the array.

3. **Gate seed prompt update:** The reasoning gate prompt in `seed-agents.ts` references V1 section names (`globalWisdom`, `metadata`). Update to V2 names (`agentKnowledge`, remove `metadata`).

4. **Prisma Json fields:** When reading `Customer.extractedProfile` or `WorkflowSession.data`, they are `Prisma.JsonValue`. Cast through `unknown` to your target type.

5. **V1 reference files** (read for implementation patterns):
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/agents/prompt-builder.ts` — section registry pattern
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/agents/reasoning-gate.ts` — gate execution pattern
   - `C:/GitHub/ai_sales_agent_crm/extraction/prompts/prompt-composition.md` — section rendering documentation
   - `C:/GitHub/ai_sales_agent_crm/extraction/prompts/main-agent-prompt.md` — section format examples

6. **Fire-and-forget pattern:** Use `void someAsyncFn().catch(console.error)` — don't await.

7. **Questionnaire detection:** Active questionnaire is derived from workflow step code, NOT from a direct DB query. The step code tells you which question group is active (dnt_questionnaire → DNT, application_fill → Application, bd → BD medical).

8. **customerMemory and agentKnowledge loaders** just return null. Don't add DB queries — these are P2 placeholders.
