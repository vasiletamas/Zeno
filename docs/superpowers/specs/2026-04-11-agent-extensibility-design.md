# Sub-Project #4: Agent Extensibility

**Date:** 2026-04-11
**Status:** Approved
**Author:** Vasile Tamas + Claude Code
**Depends on:** Sub-project #1 (Context & Memory) — prompt section registry, token budgets; Sub-project #2 (Error Recovery) — circuit breakers, structured logger; Sub-project #3 (Tool System) — tool filtering, caching, parallel execution
**Depended on by:** Sub-project #5 (Observability & Hooks) — lifecycle events for mode transitions, skill pack changes; Sub-project #7 (Self-Improvement Engine) — debrief agent uses agent config system

## Overview

Introduce a skill-pack-based extensibility system that lets agents dynamically load different prompt sections, tools, and behavioral constraints per turn — without multiplying agents. Extend the reasoning gate to select skill packs and detect conversation mode transitions. Add a compliance-checker agent that runs in parallel when gate-triggered. Support seamless in-conversation transitions between sales and post-sale modes.

## Motivation

The current system has 4 hardcoded agents with fixed roles. The orchestrator references `main-chat` by slug in 5 locations, making it impossible to vary agent behavior by product, conversation phase, or post-sale context without code changes. The `AgentType` enum constrains the system to exactly 4 agent types — adding a new role requires a schema migration.

Real-world insurance sales requires contextual adaptation:
- **Product variations** — life insurance vs. health insurance need different knowledge and sales strategies
- **Conversation phases** — discovery, questionnaire facilitation, closing, and post-sale each need different behavioral instructions
- **Post-sale modes** — onboarding, support, claims, and renewal are fundamentally different conversation types
- **Compliance monitoring** — IDD requires suitability assessment at key moments, not every turn
- **Questionnaire management** — all questionnaires (DNT, BD, underwriting, data collection) share common patterns: interruption handling, answer confirmation, resume logic, progress tracking

## Architecture Decision: Skill Packs over Multi-Agent

We evaluated two approaches:

1. **Multi-agent** — one agent per product, per post-sale mode, per specialist role. Clean isolation but expensive (many LLM configs, persona inconsistency, routing complexity).
2. **Skill packs** — few agents, each dynamically configured with prompt sections + tools + constraints per turn. Variation through configuration, not multiplication.

**Chosen: Skill packs.** The key insight is that most variation is about *what the agent knows and how it behaves*, not *who it is*. Zeno's core persona stays consistent across product types and conversation phases. Only genuinely different personas (sales vs. post-sale), execution modes (parallel compliance check), or processing contexts (batch debrief) warrant separate agents.

Separate agents are reserved for when:
- Different persona is needed (post-sale support ≠ sales persuasion) — currently handled by skill packs changing behavioral instructions within main-chat, but can be split later if needed
- Different model/temperature is needed (compliance checker needs low temp, focused evaluation)
- Parallel execution is needed (compliance runs alongside main response)
- Context isolation is needed (debrief agent in sub-project #7 analyzes historical data, not current conversation)

## Component 1: Skill Pack Model

### Problem

No mechanism to bundle and dynamically load context-specific prompt sections, tools, and constraints. All behavioral variation is either hardcoded in the orchestrator or embedded in a single monolithic system prompt.

### New Model: `SkillPack`

```prisma
model SkillPack {
  id              String   @id @default(cuid())
  slug            String   @unique
  name            String
  category        String   // "PRODUCT", "WORKFLOW_PHASE", "POST_SALE"
  description     String
  promptSections  Json     // { sectionKey: content } — merged into prompt builder
  allowedTools    String[] // tool names available when this pack is active
  constraints     String?  // behavioral constraints text injected into constraints section
  flags           Json?    // behavioral flags: { persuasive: boolean, empathetic: boolean, ... }
  isActive        Boolean  @default(true)
  priority        Int      @default(0) // higher priority wins on section conflicts
  agents          Agent[]  // many-to-many: which agents can use this pack
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Prompt Section Merging

Skill pack `promptSections` is a JSON map where keys correspond to existing section registry keys (`productContext`, `coachingBriefing`, `workflowInstructions`, etc.) or new custom keys.

**Merge rules:**
- Constitution layer sections (`agentIdentity`, `constraints`, `capabilityManifest`) are NEVER overridden by skill packs
- When multiple active skill packs define the same section key, higher `priority` wins
- Skill pack sections are merged AFTER context loaders run — they override loader output for the same key
- Skill pack `constraints` field is appended to the agent's base constraints, not replaced

### Tool Scoping

When skill packs are active, tool availability is computed as:

```
effectiveTools = intersection(workflowStep.allowedTools, union(skillPack1.allowedTools, skillPack2.allowedTools))
```

Workflow step is the hard constraint (security boundary). Skill packs refine within that boundary. If no skill packs are active, workflow step tools are used directly (backward compatible).

### Initial Seed Data

| Slug | Category | Purpose |
|------|----------|---------|
| `life-insurance-discovery` | PRODUCT | Allianz Protect product knowledge, discovery-phase sales strategy, needs-identification guidance |
| `life-insurance-closing` | WORKFLOW_PHASE | Closing techniques, urgency creation, objection handling strategies, commitment language |
| `questionnaire-facilitation` | WORKFLOW_PHASE | Generic questionnaire management: interruption handling (customer asks own question mid-Q&A → answer then resume), answer confirmation (reuse previously stated info with "is this still correct?"), progress tracking ("question 12 of 20"), sensitivity adaptation (medical Qs need softer tone), resume from last unanswered question |
| `post-sale-onboarding` | POST_SALE | Welcome messaging, document download guidance, policy explanation, next-steps checklist |
| `post-sale-support` | POST_SALE | FAQ handling, policy questions, contact escalation, general help |
| `post-sale-claims` | POST_SALE | Claims initiation process, required documentation, timeline expectations, empathetic tone |
| `post-sale-renewal` | POST_SALE | Renewal options, coverage review, upgrade/downgrade guidance, retention language |

### New File: `lib/skills/skill-pack-loader.ts`

**Exports:**
- `getSkillPack(slug: string): Promise<SkillPack>` — load by slug, cached with 5-minute TTL (reuses LRUCache pattern from sub-project #1)
- `getActiveSkillPacks(slugs: string[]): Promise<SkillPack[]>` — load multiple, sorted by priority descending
- `mergeSkillPackSections(baseSections: PromptSections, packs: SkillPack[]): PromptSections` — merge pack sections into base, respecting priority and constitution protection
- `computeAllowedTools(workflowStepTools: string[], packs: SkillPack[]): string[]` — intersection logic
- `flushSkillPackCache(): void` — called on admin updates

## Component 2: Conversation Mode & Routing

### Problem

All conversations are implicitly "sales." No mechanism to track or transition between conversation types (sales, onboarding, support, claims, renewal). Post-sale customers enter the same sales-optimized flow.

### Schema Changes

**Add to Conversation model:**

```prisma
model Conversation {
  // ...existing fields
  mode             String    @default("SALES")   // SALES, ONBOARDING, SUPPORT, CLAIMS, RENEWAL
  activeSkillPacks String[]  // currently active skill pack slugs, updated per turn
}
```

Mode values are strings, not enums, for extensibility without migrations.

### Mode Transition Rules

**Workflow-triggered transitions (automatic, no gate involvement):**
- Payment completed successfully → mode changes to `ONBOARDING`
- These are set by tool handlers or post-payment flow, not by the gate

**Gate-triggered transitions (requires confidence > 0.7):**
- Returning customer with existing policy asks about documents → gate recommends `modeTransition: "SUPPORT"`
- Customer asks about filing a claim → gate recommends `modeTransition: "CLAIMS"`
- Customer asks about renewal → gate recommends `modeTransition: "RENEWAL"`

**Transition processing (orchestrator, between Steps 2 and 3):**
1. Check if previous turn's gate output included a `modeTransition`
2. If yes, update `conversation.mode` in DB
3. Log transition in turn trace

**Temporary skill pack loading (no mode transition):**
- Customer mid-sales asks "what if I need to make a claim later?" → gate does NOT transition mode
- Instead, gate includes `post-sale-claims` in `recommendedSkillPacks` for this turn only
- Next turn, if context is back to sales, gate drops the pack

### Agent Resolution

**New function: `resolveAgent(mode: string): string`**

```typescript
function resolveAgent(mode: string): string {
  // All modes currently use main-chat with different skill packs.
  // Architecture supports per-mode agents when needed later.
  return 'main-chat'
}
```

This is intentionally simple. The function exists as the abstraction point — when post-sale conversations eventually need a separate agent (different persona), only this function changes.

## Component 3: Extended Reasoning Gate

### Problem

The reasoning gate currently outputs section selection and situational analysis. It has no awareness of skill packs, conversation modes, or compliance relevance.

### Extended Output

```typescript
interface ReasoningGateOutput {
  // Existing fields — unchanged
  situationType: string
  complexity: 'simple' | 'moderate' | 'complex'
  confidence: number
  requiredSections: string[]
  excludedSections: string[]
  briefing: string
  toolGuidance: { recommend: string[]; discourage: string[] }
  contradictions: string[]
  concernActions: string[]

  // New fields
  recommendedSkillPacks: string[]       // skill pack slugs to activate this turn
  modeTransition?: string               // set only when mode should change (e.g. "SUPPORT")
  complianceRelevant: boolean           // true when compliance checker should run
}
```

### Gate Input Enhancement

The gate currently receives a compact context message about customer state. Extend it with:

- `currentMode` — the conversation's current mode
- `availableSkillPacks` — list of all active skill pack slugs with one-line descriptions (so the gate can choose)
- `activeSkillPacks` — what's currently loaded (so the gate can confirm or change)

### Gate System Prompt Update

The reasoning gate's system prompt (stored in DB, editable by admin) is updated to include instructions for:

1. **Skill pack selection** — given the customer's message, current workflow step, and conversation context, which skill packs should be active? Always include the relevant PRODUCT pack. Add WORKFLOW_PHASE packs when applicable.
2. **Mode detection** — if the customer's intent clearly belongs to a different mode AND confidence > 0.7, recommend a transition. Never transition during active workflows (questionnaire in progress, payment pending).
3. **Compliance flagging** — flag `complianceRelevant: true` when the turn involves: product recommendations, suitability assessment, health/financial disclosure, quote presentation, payment initiation, policy issuance. These are the IDD-relevant moments.

### Fallback Behavior

If gate fails or returns low confidence (< 0.3):
- `recommendedSkillPacks`: empty array (no packs loaded, base agent behavior)
- `modeTransition`: undefined (no transition)
- `complianceRelevant`: false (skip compliance check)

This is safe — the system works without skill packs (backward compatible), just less optimized.

## Component 4: Compliance Checker Agent

### Problem

No automated compliance monitoring during conversations. IDD compliance (suitability assessment, proper disclosure, needs identification) is entirely dependent on the main agent's system prompt — no verification that requirements are actually met.

### New Agent: `compliance-checker`

**Seeded configuration:**

| Field | Value |
|-------|-------|
| slug | `compliance-checker` |
| role | `compliance-checker` |
| provider | OPENAI |
| model | gpt-5.4-mini |
| fallbackProvider | ANTHROPIC |
| fallbackModel | claude-haiku-4-5-20251001 |
| temperature | 0.1 |
| maxTokens | 1024 |

Low temperature, small model — this is a focused evaluation task, not creative generation.

### Execution Model

**Trigger:** Gate sets `complianceRelevant: true` on the current turn.

**Timing:** Runs in parallel with Step 4 (context assembly). By the time prompt building completes, compliance result is ready. Zero added latency on the critical path.

**Input:** Recent conversation messages (last 10 or current window) + current workflow step + customer profile.

**Output:**
```typescript
interface ComplianceCheckResult {
  passed: boolean
  gaps: string[]        // e.g. ["Customer needs not formally identified before recommendation"]
  suggestions: string[] // e.g. ["Ask customer to confirm their protection needs before presenting quote"]
}
```

**Integration:** If `passed === false`, compliance result is injected into main-chat's context as a `complianceGuidance` prompt section:

```
[COMPLIANCE GUIDANCE - Address before responding]
The following compliance gaps were detected:
- Customer needs not formally identified before recommendation
Suggested actions:
- Ask customer to confirm their protection needs before presenting quote
```

**Non-blocking:** Compliance checker guides the main agent but does not veto responses. It's a guardrail, not a gate. If the compliance agent fails (timeout, error), the turn proceeds normally — structured logger records the failure for review.

### New File: `lib/chat/compliance-checker.ts`

**Exports:**
- `executeComplianceCheck(input: ComplianceCheckInput): Promise<ComplianceCheckResult>` — runs the check, parses structured output, returns result with fallback on parse failure
- Internally calls `gateway.call('compliance-checker', { messages })` with a system prompt focused on IDD/GDPR evaluation

### Compliance Check Categories

The compliance checker evaluates against these categories (configured in its system prompt):

1. **Needs identification (DNT)** — has the customer's insurance need been properly identified before any product recommendation?
2. **Suitability assessment** — does the recommended product match the customer's stated needs, financial situation, and risk appetite?
3. **Disclosure** — has the agent properly disclosed its role, the insurer relationship, and any relevant limitations?
4. **Informed consent** — has the customer been given enough information to make an informed decision?
5. **Data handling** — has GDPR consent been obtained before collecting personal data?

## Component 5: Schema Migration

### Agent Model Changes

```prisma
model Agent {
  id               String      @id @default(cuid())
  slug             String      @unique
  name             String
  role             String      // replaces AgentType enum — freeform string
  provider         LLMProvider
  model            String
  fallbackProvider LLMProvider?
  fallbackModel    String?
  temperature      Float       @default(0.7)
  maxTokens        Int         @default(4096)
  systemPrompt     String?     @db.Text
  constraints      String?     @db.Text
  isActive         Boolean     @default(true)
  skillPacks       SkillPack[] // many-to-many: packs this agent can use
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
}
```

**Migration steps:**
1. Add `role` String field with default value
2. Migrate data: copy `type` enum value to `role` as lowercase string (MAIN_CHAT → "main-chat", etc.)
3. Drop `type` field
4. Drop `AgentType` enum
5. Add `SkillPack` model
6. Add implicit many-to-many between Agent and SkillPack
7. Add `mode` and `activeSkillPacks` to Conversation
8. Seed initial skill packs
9. Seed `compliance-checker` agent

### Backward Compatibility

- `getAgentConfig()` continues to work — it loads by slug, not by type
- Existing admin UI agent table continues to work — just shows new `role` column instead of `type`
- Conversations without `mode` default to "SALES"
- Conversations without `activeSkillPacks` default to empty array (base behavior, no packs)

## Component 6: Orchestrator Changes

### Hardcoded Slug Removal

**Step 3 — Reasoning Gate (extended):**
```
Before: executeReasoningGate(input) → { situationType, complexity, requiredSections, ... }
After:  executeReasoningGate(input, { currentMode, availableSkillPacks, activeSkillPacks }) 
        → { ...same, recommendedSkillPacks[], modeTransition?, complianceRelevant }
```

**Step 4 — Context Assembly (skill-pack-aware):**
```
Before: getAgentConfig('main-chat')
        loadAllSections()
After:  getAgentConfig(resolveAgent(conversation.mode))
        activePacks = getActiveSkillPacks(gate.recommendedSkillPacks)
        baseSections = loadAllSections()
        mergedSections = mergeSkillPackSections(baseSections, activePacks)
```

**Step 4b — NEW: Conditional Compliance Check:**
```
If gate.complianceRelevant === true:
  compliancePromise = executeComplianceCheck({ messages, workflowStep, customer })
  // Runs in parallel with rest of Step 4
  complianceResult = await compliancePromise
  If !complianceResult.passed:
    Inject complianceGuidance section into mergedSections
```

**Steps 6-8 — Main Chat (dynamic agent + tools):**
```
Before: gateway.stream('main-chat', { tools: getToolsForLLM(stepAllowedTools) })
After:  gateway.stream(resolveAgent(conversation.mode), { 
          tools: getToolsForLLM(computeAllowedTools(stepAllowedTools, activePacks))
        })
```

**Step 9 — Background Agents:**
Profile extractor unchanged — `gateway.call('profile-extractor', ...)` stays hardcoded (fixed role).

**Step 10 — Turn Trace (extended):**
```
Before: { agent, tokens, duration }
After:  { agent, tokens, duration, activeSkillPacks, conversationMode, complianceResult }
```

**Mode Transition (new, between Steps 2 and 3):**
```
If previous gate output had modeTransition AND confidence > 0.7:
  Update conversation.mode in DB
  Log mode transition event
```

### Unchanged References

These hardcoded slugs remain — they are fixed utility roles with no routing need:
- `gateway.call('reasoning-gate', ...)` in `reasoning-gate.ts`
- `gateway.call('summarizer', ...)` in `sliding-window.ts` and `compaction.ts`
- `gateway.call('profile-extractor', ...)` in orchestrator Step 9

## Component 7: Admin UI Changes

### Agent Config Page (minor updates)

- Display `role` field (read-only) instead of `type` enum
- New `compliance-checker` agent appears in the list automatically from seed
- No other changes to existing agent editing functionality

### New Page: Skill Packs (`/admin/skill-packs`)

**List view:**
- Table: name, slug, category, priority, active status
- Category filter tabs: ALL | PRODUCT | WORKFLOW_PHASE | POST_SALE
- Active/inactive toggle per row

**Detail view (click to edit):**
- **Header:** Name, slug (read-only), category (read-only), description
- **Prompt Sections:** Key-value editor. Each row is a section key (dropdown of known keys + custom) and a text area for content. Add/remove rows.
- **Allowed Tools:** Checklist of all registered tool names. Check to include, uncheck to exclude.
- **Constraints:** Text area for behavioral constraints
- **Flags:** Simple JSON editor for behavioral flags
- **Priority:** Number input
- **Active toggle:** Enable/disable

**Admin capabilities:**
- Edit all fields within existing skill packs
- Toggle skill packs active/inactive
- Reorder priority
- Flush skill pack cache (button, same pattern as agent config flush)

**NOT available in admin UI (requires developer):**
- Creating new skill packs
- Creating new agents
- Modifying routing rules (`resolveAgent`)
- Editing constitution layer sections

### API Routes

- `GET /api/admin/skill-packs` — list all skill packs
- `GET /api/admin/skill-packs/[id]` — single skill pack detail
- `PUT /api/admin/skill-packs/[id]` — update skill pack fields
- `POST /api/admin/skill-packs/[id]/toggle` — activate/deactivate
- `POST /api/admin/skill-packs/flush-cache` — flush skill pack LRU cache

All routes protected by RBAC middleware (ADMIN role required).

## Component 8: Testing Strategy

### Unit Tests

**Skill pack loading and merging:**
- `mergeSkillPackSections` — verify sections merge correctly with priority ordering
- Constitution layer protection — verify `agentIdentity`, `constraints`, `capabilityManifest` are never overridden
- Multiple packs with same section key — higher priority wins
- Empty packs — no-op, base sections pass through unchanged

**Tool scoping:**
- `computeAllowedTools` — intersection of workflow step tools and skill pack tools
- No active packs — workflow step tools used directly (backward compatible)
- Multiple packs — union of pack tools, then intersect with workflow step

**Agent resolution:**
- `resolveAgent` maps each mode string to correct agent slug
- Unknown mode falls back to `main-chat`

**Extended gate output parsing:**
- `recommendedSkillPacks`, `modeTransition`, `complianceRelevant` parse correctly from JSON
- Missing new fields fall back to safe defaults (empty array, undefined, false)
- Malformed JSON falls back to `FALLBACK_OUTPUT` (existing behavior preserved)

**Compliance checker output parsing:**
- Valid `{ passed, gaps, suggestions }` parses correctly
- Missing fields default to `{ passed: true, gaps: [], suggestions: [] }`
- Parse failure returns passing result (fail-open, non-blocking)

**Mode transition logic:**
- Transition applied when confidence > 0.7
- Transition rejected when confidence ≤ 0.7
- Transition rejected during active workflow (questionnaire in progress)
- DB update verified after transition

### Integration Tests

**Orchestrator with skill packs:**
- Full turn with active skill packs — verify correct prompt sections and tools reach the gateway call
- Turn without skill packs — backward compatible, base behavior

**Mode transition:**
- Sales → onboarding after payment completion — verify mode persists on conversation record
- Gate-triggered transition — mock gate returning `modeTransition: "SUPPORT"` with confidence 0.8, verify DB update
- Gate-triggered transition blocked — mock gate with confidence 0.5, verify no transition

**Compliance checker parallel execution:**
- Gate flags `complianceRelevant: true` — verify compliance checker runs alongside context assembly
- Compliance gaps found — verify `complianceGuidance` section injected into prompt
- Compliance checker timeout/failure — verify turn proceeds normally, error logged

**Admin API:**
- Update skill pack → verify cache flushed → next turn loads updated content
- Toggle skill pack inactive → verify next turn doesn't load it
- List/detail endpoints return correct data

### E2E Scenarios

**Post-sale conversation:**
- Seed customer with existing policy
- Start new conversation — gate detects returning customer with post-sale intent
- Verify mode transitions to SUPPORT
- Verify Zeno responds with support-appropriate knowledge and tone

**Questionnaire with interruption:**
- Start DNT questionnaire flow
- Mid-questionnaire, customer asks unrelated question
- Verify `questionnaire-facilitation` skill pack handles: answer the question, then resume at correct position
- Verify previously answered questions are confirmed, not re-asked

## Scope

**In scope:**
- SkillPack model, loader, cache, merging logic
- Conversation mode field and transition logic
- Extended reasoning gate (skill packs, mode transitions, compliance flag)
- Compliance checker agent (gate-triggered, parallel execution)
- Orchestrator refactoring (remove main-chat hardcoding, add skill pack awareness)
- Agent schema migration (enum → string role)
- Admin UI for skill pack editing
- Seed data for 7 initial skill packs + compliance-checker agent
- Unit, integration, and E2E tests

**Deferred to Sub-Project #5 (Observability & Hooks):**
- Lifecycle events for mode transitions and skill pack changes
- Metrics dashboard for skill pack usage and compliance check frequency

**Deferred to Sub-Project #7 (Self-Improvement Engine):**
- Debrief agent (batch analysis of conversations)
- Automated skill pack content suggestions based on conversation outcomes
- A/B testing of skill pack variations

**Not planned:**
- Per-mode separate agents (all modes use main-chat with skill packs for now)
- Dynamic skill pack creation from admin UI (requires developer + seed)
- Speculative skill pack pre-loading
