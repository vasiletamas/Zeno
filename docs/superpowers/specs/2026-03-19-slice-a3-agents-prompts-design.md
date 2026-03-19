# Slice A3: Agents + Prompts — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** A3 (Reasoning Gate, Dynamic Prompt Assembly, Sliding Window, Context Loaders)
**Date:** 2026-03-19
**Status:** Approved
**Depends on:** Slice A2 (LLM + Pipeline) — complete

---

## 1. Goal

Replace the stub implementations in the orchestrator's steps 3-6 with the full reasoning gate, 3-layer dynamic prompt assembly, sliding window with summarizer, and section-specific context loaders. Make the AI agent intelligent about what context to include per turn.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token budgets | No hard limits | Build plan says "token budgeting" but we defer enforcement. Record section sizes in turn traces for analysis. Optimize when cost data exists. Conscious deviation from build plan. |
| customerMemory section | Registered, returns null | Section infrastructure ready. Content populated when P2 learning loop ships. |
| agentKnowledge section | Registered, returns null | Same as customerMemory. |
| Fast path | Detect simple questionnaire answers | Skip reasoning gate on Da/Nu/single-word answers when questionnaire is active. ~2K prompt vs ~6-8K. |
| Summarizer timing | Synchronous on first invocation | We need the summary for this turn's prompt. Subsequent updates when coverage is stale. |

## 3. File structure

```
lib/chat/
  prompt-builder.ts       — NEW: 3-layer section registry, gate-driven assembly
  reasoning-gate.ts       — NEW: full gate input building, output parsing, briefing formatting
  sliding-window.ts       — NEW: window management + summarizer trigger
  context-loaders.ts      — NEW: section content loaders for all 10 sections
  orchestrator.ts         — MODIFIED: steps 3-6 replaced, step 9 enhanced

__tests__/
  lib/chat/
    prompt-builder.test.ts    — section selection, gate-driven inclusion/exclusion
    reasoning-gate.test.ts    — input building, output parsing, fallback behavior
    sliding-window.test.ts    — window sizing, summarizer trigger logic
```

## 4. Prompt Builder

> Note: This is a NEW `lib/chat/prompt-builder.ts` file. There is no existing V2 prompt builder — the A2 orchestrator assembles prompts inline. V1 had `lib/agents/prompt-builder.ts` with 13 sections. V2 reduces to 10 sections: V1's `globalWisdom` → renamed to `agentKnowledge`, V1's `capabilities` → merged into `capabilityManifest`, V1's `metadata` → dropped (conversion scoring removed per build plan). Off-topic rules and customer autonomy rules are embedded in `agentIdentity` (part of the main-chat agent seed prompt from A1).

### 4.1 Section registry

10 sections registered with metadata. Section ordering follows V1's priority-based system (lower = renders earlier). Dynamic sections render after the `[INTERNAL GUIDANCE]` separator, so they come after constitution. This ordering differs from the build plan's Section 6.3 list order, which is conceptual, not rendering order. The priority values control what the LLM sees first (identity/constraints) vs last (product details that may change per turn).

```typescript
interface SectionConfig {
  key: string
  priority: number        // lower = renders earlier
  layer: 'constitution' | 'reasoning' | 'dynamic'
  alwaysInclude: boolean  // cannot be excluded by gate
  prefix: string          // section header text
}
```

| Priority | Key | Layer | Always? | Prefix |
|----------|-----|-------|---------|--------|
| 1 | agentIdentity | constitution | YES | (none — renders first, no header) |
| 2 | capabilityManifest | constitution | NO | `WHAT I CAN DO:` |
| 5 | constraints | constitution | YES | `CRITICAL CONSTRAINTS:` |
| 10 | situationalBriefing | reasoning | YES | `=== SITUATIONAL ANALYSIS ===` |
| 20 | customerMemory | dynamic | NO | `=== RETURNING CUSTOMER ===` |
| 21 | agentKnowledge | dynamic | NO | `=== PROVEN PATTERNS ===` |
| 22 | customerContext | dynamic | NO | `=== CUSTOMER PROFILE ===` |
| 23 | coachingBriefing | dynamic | NO | `=== PRODUCT SALES PLAYBOOK ===` |
| 24 | workflowInstructions | dynamic | YES | `=== ACTIVE WORKFLOW ===` |
| 25 | questionnaireContext | dynamic | NO | `=== ACTIVE QUESTIONNAIRE ===` |
| 26 | productContext | dynamic | NO | `=== PRODUCT CONTEXT ===` |

### 4.2 PromptSections type

```typescript
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
```

### 4.3 Gate-driven selection

```typescript
interface GateSelection {
  requiredSections: string[]
  excludedSections: string[]
  confidence: number
}
```

Logic:
- Gate active if: `(requiredSections.length > 0 || excludedSections.length > 0) && confidence >= 0.3`
- If gate NOT active: include all non-empty sections (conservative fallback)
- If gate active:
  - `alwaysInclude` sections: always rendered (gate cannot exclude them)
  - Sections in `excludedSections`: skipped (unless alwaysInclude)
  - Sections in `requiredSections`: explicitly included
  - Sections not mentioned: included by default (conservative)
  - Empty/null sections: always skipped regardless

### 4.4 Assembly

```typescript
function buildPrompt(
  sections: PromptSections,
  gateSelection: GateSelection,
): { prompt: string; sectionSizes: Record<string, number>; gateActive: boolean; includedSections: string[]; excludedSections: string[] }
```

Rendering order follows priority (ascending). Insert `\n\n[INTERNAL GUIDANCE - Do not mention this directly to the customer]\n` before the first section with `layer: 'dynamic'` or `layer: 'reasoning'` (whichever comes first after constitution sections).

### 4.5 Fast path

```typescript
function detectFastPath(message: string, hasActiveQuestionnaire: boolean): boolean
```

Returns true if:
- `hasActiveQuestionnaire` is true AND
- Message matches simple answer pattern: single word, "da"/"nu", a number, a dropdown selection value

On fast path: skip reasoning gate entirely, build prompt with only constitution + questionnaireContext + workflowInstructions sections.

## 5. Reasoning Gate

### 5.1 Full input building

```typescript
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
```

Builds a compact context string (~500-800 tokens) from these fields for the gate LLM call.

### 5.2 Full output type

```typescript
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
```

### 5.3 Execution

```typescript
async function executeReasoningGate(input: ReasoningGateInput): Promise<ReasoningGateOutput>
```

1. Load reasoning-gate agent config. The system prompt was seeded in A1 (`prisma/seeds/seed-agents.ts`, slug: `reasoning-gate`) and contains the full gate prompt ported from V1 (`extraction/prompts/synthesizer-prompt.md`). It instructs the LLM to output JSON with all fields from ReasoningGateOutput including complexity, contradictions, concernActions, requiredSections, excludedSections, briefing, toolGuidance, and knowledgeGaps.
2. Build context message from input
3. Call `gateway.call('reasoning-gate', { messages: [contextMessage] })`
4. Parse JSON from response (handle markdown fences, validate enums, clamp confidence)
5. On any failure: return fallback output `{ complexity: 'moderate', confidence: 0, requiredSections: [], excludedSections: [], briefing: '', toolGuidance: { prioritize: [], discourage: [] } }`

### 5.4 Briefing formatting

```typescript
function formatGateBriefing(output: ReasoningGateOutput): string
```

Formats the gate output into the `situationalBriefing` prompt section string:
```
=== SITUATIONAL ANALYSIS (moderate) ===
{briefing text}

RESOLVED CONTRADICTIONS:
- {tension} -> {resolution} (deferred to: {winner})

CONCERNS TO ADDRESS NOW:
- {concern} ({gateAssessment}): {reason}
Monitoring: {concern1}, {concern2}

Tool guidance: Prioritize: {tool1}, {tool2}. Discourage: {tool3}.
```

## 6. Sliding Window + Summarizer

### 6.1 Window management

```typescript
async function buildSlidingWindow(
  conversationId: string,
  totalMessages: number,
): Promise<{ messages: Message[]; summaryPrefix: string | null }>
```

Logic:
1. If totalMessages <= 20: load all messages, return `{ messages, summaryPrefix: null }`
2. If totalMessages > 20:
   - Load last 20 messages
   - Check for existing `ConversationSummary` where `messagesUpTo >= (totalMessages - 20)`
   - If current summary exists: return `{ messages: last20, summaryPrefix: summary.summary }`
   - If no summary or stale: trigger summarizer

### 6.2 Summarizer invocation

```typescript
async function triggerSummarizer(
  conversationId: string,
  messagesToSummarize: Message[],
): Promise<string>
```

1. Call `gateway.call('summarizer', { messages: [system instruction, ...messagesToSummarize] })`
2. Save to `ConversationSummary`: `{ conversationId, summary: response, messagesUpTo: count }`
3. Return the summary text
4. First invocation per conversation: synchronous (blocking — we need it for this turn)
5. No token limits on summary length

### 6.3 Summary injection

When summaryPrefix exists, it's injected as a system message before the sliding window messages:

```
[Previous conversation summary]
{summaryPrefix}
[End of summary — recent messages follow]
```

## 7. Context Loaders

### `lib/chat/context-loaders.ts`

Each function loads one section's content from DB and formats it as a prompt-ready string.

```typescript
// Constitution layer
function loadAgentIdentity(agentConfig: AgentConfig): string | null
function loadCapabilityManifest(allowedTools: string[]): string
function loadConstraints(agentConfig: AgentConfig): string | null

// Dynamic layer
async function loadProductContext(productId: string, language: 'en' | 'ro'): Promise<string | null>
async function loadCoachingBriefing(productId: string): Promise<string | null>
async function loadWorkflowInstructions(workflowSession: WorkflowSessionWithStep | null): Promise<string | null>
async function loadQuestionnaireContext(conversationId: string, language: 'en' | 'ro'): Promise<string | null>
async function loadCustomerContext(customerId: string): Promise<string | null>
async function loadCustomerMemory(customerId: string): Promise<string | null>       // returns null (P2)
async function loadAgentKnowledge(productId: string | null): Promise<string | null>  // returns null (P2)
```

**Content format per loader** (matches V1 extraction `prompts/main-agent-prompt.md`):

- **loadProductContext:** Product name, type, description, features, coverages with amounts, pricing tiers/levels, premium range, addon details
- **loadCoachingBriefing:** Raw text from `Product.defaultPlaybook`
- **loadWorkflowInstructions:** Current step name, agentInstructions, available tools list, workflow data collected so far
- **loadQuestionnaireContext:** Active questionnaire type (DNT/Application/BD), current question text+options, progress (answered/total), previous answers summary
- **loadCustomerContext:** Customer name, age, family, employment, extracted profile data
- **loadCapabilityManifest:** Formatted list of available tools with descriptions

## 8. Orchestrator Enhancement

### Steps 3-6 replacement

The current orchestrator has inline stubs for steps 3-6. A3 replaces them:

**Step 3 (new):**
```
if fast path detected → skip gate, set gateOutput to fast-path defaults
else → executeReasoningGate(input) → gateOutput
```

**Step 4 (new):**
```
Load agent config for 'main-chat'
Call all context loaders → populate PromptSections object
Format gate briefing → sections.situationalBriefing
```

**Step 5 (new):**
```
buildSlidingWindow(conversationId, messageCount) → { messages, summaryPrefix }
```

**Step 6 (new):**
```
buildPrompt(sections, gateSelection from gateOutput) → { prompt, sectionSizes, ... }
Build messages array: [system prompt] + [summary if exists] + [window messages] + [current user message]
```

### Step 9 enhancement (profile extractor)

Currently a stub log. A3 makes it real:
- Check if user message likely contains personal info (name patterns, numbers, age mentions, family references)
- If yes: fire-and-forget `gateway.call('profile-extractor', { messages })`
- Parse JSON response → merge into `Customer.extractedProfile` (additive, don't overwrite existing fields)

### Step 10 enhancement (turn trace)

Add to TurnTrace.phases:
- `sectionSizes`: which sections were included and their character counts
- `gateActive`: whether the gate drove section selection
- `gateComplexity`: the complexity assessment
- `fastPath`: whether fast path was used
- `summarizerTriggered`: whether the summarizer ran this turn

## 9. What A3 delivers

- [ ] 3-layer prompt builder with 10 registered sections and gate-driven selection
- [ ] Full reasoning gate: structured input, JSON output parsing, fallback handling, briefing formatting
- [ ] Sliding window: last 20 messages + summarizer for older, ConversationSummary persistence
- [ ] Context loaders for all sections (customerMemory and agentKnowledge return null, ready for P2)
- [ ] Fast path detection for simple questionnaire answers (~2K prompt)
- [ ] Profile extractor (fire-and-forget, merges into Customer.extractedProfile)
- [ ] Enhanced turn traces with section size tracking
- [ ] `npx tsc --noEmit` passes
- [ ] Unit tests for prompt builder, gate parsing, sliding window

## 10. What A3 does NOT include

- customerMemory content (P2 learning loop)
- agentKnowledge content (P2 learning loop)
- Token budget enforcement (deferred — record sizes, don't limit)
- Individual tool handlers beyond list_products/get_product_info (Slice A4)

## 11. Implementation notes

**Sliding window bug in A2 orchestrator:** The current Step 5 (orchestrator.ts) orders by `createdAt: 'asc'` with `take: 20`, which fetches the FIRST 20 messages, not the last 20. The A3 replacement must use `orderBy: { createdAt: 'desc' }, take: 20` then reverse the result, or use `skip: Math.max(0, total - 20)`.

**Reasoning gate `toolGuidance` shape change:** A2's orchestrator treats `toolGuidance` as a string. A3 changes it to `{ prioritize: string[]; discourage: string[] }`. The orchestrator must be updated to handle the new object shape when formatting the briefing.

**`situationType` from gate output:** Used only for tracing (stored in TurnTrace.phases). Not used for section selection or any branching logic.

**`loadQuestionnaireContext` active questionnaire detection:** The active questionnaire is determined by the current workflow step code:
- Step `dnt_questionnaire` → load DNT QuestionGroups (dnt_consent, dnt_general, dnt_life_type, dnt_life_financial, dnt_life_investment, dnt_sustainability)
- Step `application_fill` → load Application QuestionGroup
- Step containing `bd` → load BD medical QuestionGroup
- Find the first unanswered question: query Questions in group ordered by orderIndex, LEFT JOIN with Answers for this conversationId. First question with no answer = current question. Progress = answered count / total count.

**`loadCustomerContext` when extractedProfile is null:** Return basic info only (name, language, isAnonymous). When extractedProfile exists, merge in demographics, employment, family from the JSON blob. Empty extractedProfile on first conversation is expected — the section will be sparse.

**Profile extractor merge logic:** The fire-and-forget block in Step 9 must: (1) call gateway, (2) parse JSON response, (3) read current Customer.extractedProfile, (4) deep-merge new fields into existing (don't overwrite), (5) update Customer record. All inside the async closure — the orchestrator does not await this.

**Summarizer system prompt:** The summarizer agent was seeded in A1 with a prompt covering: customer needs, products discussed, concerns raised, sales stage, personal details, commitments. No additional prompt definition needed — the seed prompt is sufficient.

**Fast-path GateSelection defaults:**
```typescript
const FAST_PATH_GATE: GateSelection = {
  requiredSections: ['questionnaireContext', 'workflowInstructions'],
  excludedSections: ['productContext', 'coachingBriefing', 'customerContext', 'customerMemory', 'agentKnowledge', 'capabilityManifest'],
  confidence: 1.0,
}
```

**BD questionnaire in `loadQuestionnaireContext`:** BD medical questions are handled by the same loader. When the workflow step indicates BD questionnaire is active, the loader fetches the `bd_medical` QuestionGroup. The same current-question and progress logic applies. The only difference is the rejection rule (any YES = BD rejected), which is handled by the tool handler in A4, not the context loader.

## 12. Testing strategy

- **prompt-builder.test.ts:** Test section rendering order, gate-driven inclusion/exclusion, alwaysInclude enforcement, empty section skipping, internal guidance separator
- **reasoning-gate.test.ts:** Test input building, JSON parsing from LLM response (clean JSON, markdown-fenced JSON, malformed JSON), fallback behavior, enum validation
- **sliding-window.test.ts:** Test window sizing (<=20 vs >20), summary reuse, stale summary detection
