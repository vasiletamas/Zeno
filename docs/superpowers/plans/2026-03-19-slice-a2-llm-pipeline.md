# Slice A2: LLM + Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working `POST /api/chat` endpoint that streams LLM responses via SSE, executes tools through a unified pipeline, supports both LLM-initiated and UI-triggered actions, with OpenAI + Anthropic failover.

**Architecture:** Three layers — LLM (gateway + providers + agent config), Tools (registry + validation + permissions + pipeline), Chat (orchestrator + stream handler + context builder + action adapter). Orchestrator is the thin coordinator (~200-300 lines) that delegates to focused modules.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma v7 (PrismaPg adapter), OpenAI SDK, Anthropic SDK, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-slice-a2-llm-pipeline-design.md`

---

## File Map

### New files (17 source + tests)

| File | Responsibility |
|------|---------------|
| `lib/llm/providers/types.ts` | Unified ChatRequest, ChatResponse, StreamChunk, Message, ToolCall types |
| `lib/llm/errors.ts` | Error classification (provider_down, transient, validation, unknown) |
| `lib/llm/agent-config.ts` | Load Agent config from DB with 5-min TTL cache |
| `lib/llm/providers/openai.ts` | OpenAI provider: chat, chatWithTools, chatStream, chatStreamWithTools |
| `lib/llm/providers/anthropic.ts` | Anthropic provider: same interface, message normalization, thinking blocks |
| `lib/llm/providers/registry.ts` | Provider resolution + failover (primary → fallback) |
| `lib/llm/gateway.ts` | gateway.call() + gateway.stream() facade |
| `lib/tools/types.ts` | ToolHandler, ToolResult, ToolContext, ToolDefinition, ExecutionMode types |
| `lib/tools/registry.ts` | Tool definitions, handlers, execution classification from brand book S16 |
| `lib/tools/validation.ts` | Zod schemas per tool |
| `lib/tools/permissions.ts` | Role-based access control |
| `lib/tools/executor.ts` | Single tool: validate → permission → execute |
| `lib/tools/pipeline.ts` | Workflow gate + transition evaluation |
| `lib/chat/context-builder.ts` | Build ToolContext from DB |
| `lib/chat/stream-handler.ts` | SSE ReadableStream management |
| `lib/chat/action-adapter.ts` | UI actions → synthetic ToolCalls |
| `lib/chat/orchestrator.ts` | 10-step per-turn pipeline |
| `app/api/chat/route.ts` | POST /api/chat HTTP handler |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add openai, @anthropic-ai/sdk, vitest deps |
| `.env.example` | Add OPENAI_API_KEY, ANTHROPIC_API_KEY |

---

## Task 1: Setup — Dependencies, Vitest, Environment

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install LLM SDKs**

```bash
cd C:/GitHub/v2_ai_sales_agent
npm install openai @anthropic-ai/sdk
```

- [ ] **Step 2: Install Vitest**

```bash
npm install -D vitest @vitejs/plugin-react
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 4: Add test script to package.json**

Add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Update .env.example**

Add:
```
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

Also add these to your `.env` file with real keys.

- [ ] **Step 6: Verify setup**

Run: `npx tsc --noEmit`
Run: `npx vitest run` (should pass with 0 tests found)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(a2): setup LLM SDKs, Vitest, and environment"
```

---

## Task 2: LLM Types + Errors

**Files:**
- Create: `lib/llm/providers/types.ts`
- Create: `lib/llm/errors.ts`

- [ ] **Step 1: Create unified LLM types**

`lib/llm/providers/types.ts` — all types used across both providers and the gateway. This is the contract that keeps everything provider-agnostic.

Key types to define:
- `Message` — with role, content, toolCalls?, toolCallId?, _providerContent?
- `ToolCall` — with id, name, arguments
- `ChatRequest` — messages, temperature?, maxTokens?, reasoning?
- `ChatWithToolsRequest` extends ChatRequest — tools, toolChoice?
- `ChatResponse` — content, finishReason, usage, rawMessage
- `ChatWithToolsResponse` extends ChatResponse — toolCalls
- `StreamChunk` — type: 'content' | 'tool_calls' | 'done', content?, toolCalls?, usage?
- `TokenUsage` — promptTokens, completionTokens, totalTokens
- `ReasoningConfig` — enabled, effort: 'low' | 'medium' | 'high'
- `LLMProviderInterface` — chat(), chatWithTools(), chatStream(), chatStreamWithTools()
- `GatewayCallRecord` — agentSlug, provider, model, inputTokens, outputTokens, cost, durationMs, timestamp

The ToolDefinition for LLM function calling (JSON Schema format):
```typescript
interface LLMToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>  // JSON Schema
  }
}
```

- [ ] **Step 2: Create error classification**

`lib/llm/errors.ts`:

```typescript
export type ErrorClass = 'provider_down' | 'transient' | 'validation' | 'unknown'

export function classifyError(error: unknown): ErrorClass {
  // provider_down: 401, 402, 403, connection refused, ECONNREFUSED, timeout
  // transient: 429, 500, 502, 503, 504
  // validation: 400 (bad request, invalid params)
  // unknown: everything else
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ErrorClass,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}
```

Check for OpenAI SDK error shapes (`error.status`, `error.code`) and Anthropic SDK error shapes (`error.status`, `error.error.type`).

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/llm/providers/types.ts lib/llm/errors.ts
git commit -m "feat(a2): add unified LLM types and error classification"
```

---

## Task 3: Agent Config with Cache

**Files:**
- Create: `lib/llm/agent-config.ts`
- Create: `__tests__/lib/llm/agent-config.test.ts`

- [ ] **Step 1: Write agent-config.ts**

Uses Prisma to load Agent records by slug. 5-minute in-memory cache (Map with TTL). Returns typed config.

```typescript
import { prisma } from '@/lib/db'

interface AgentConfig {
  slug: string
  name: string
  type: string          // AgentType enum value
  provider: string      // LLMProvider enum value
  model: string
  fallbackProvider: string | null
  fallbackModel: string | null
  temperature: number
  maxTokens: number
  systemPrompt: string | null
  constraints: string | null
  isActive: boolean
}

const cache = new Map<string, { config: AgentConfig; expiresAt: number }>()
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

export async function getAgentConfig(slug: string): Promise<AgentConfig>
export function flushAgentConfigCache(): void
```

Key: query `prisma.agent.findUnique({ where: { slug } })`, cache result, check TTL on read.

- [ ] **Step 2: Write test**

`__tests__/lib/llm/agent-config.test.ts`:
- Test cache hit (same slug returns cached, no DB query)
- Test cache miss (expired TTL, re-queries)
- Test flush clears cache
- Test throws on unknown slug

Mock prisma with `vi.mock('@/lib/db')`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run __tests__/lib/llm/agent-config.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/llm/agent-config.ts __tests__/lib/llm/agent-config.test.ts
git commit -m "feat(a2): add agent config loading with 5-min cache"
```

---

## Task 4: OpenAI Provider

**Files:**
- Create: `lib/llm/providers/openai.ts`

- [ ] **Step 1: Implement OpenAI provider**

Implements `LLMProviderInterface` from types.ts.

**Reference:** Read `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/llm/providers/openai.ts` for V1 patterns.

Key implementation details:
1. Create OpenAI client from `OPENAI_API_KEY` env var
2. `chat()` — convert Messages to OpenAI format, call `openai.chat.completions.create()`, normalize response
3. `chatWithTools()` — same + add tools and toolChoice, extract toolCalls from response
4. `chatStream()` — call with `stream: true`, yield StreamChunks from async iterator
5. `chatStreamWithTools()` — same + tools, yield both content and tool_calls chunks

**Model quirks to handle:**
- GPT-5+ requires `max_completion_tokens` not `max_tokens`
- Reasoning models forbid custom `temperature` (omit it)
- `reasoning_effort` for models that support it
- Tool calls in streaming: accumulate tool call deltas, yield complete ToolCall when done

**Message conversion:** Internal Message → OpenAI ChatCompletionMessageParam:
- system → { role: 'system', content }
- user → { role: 'user', content }
- assistant → { role: 'assistant', content, tool_calls? }
- tool → { role: 'tool', content, tool_call_id }

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add lib/llm/providers/openai.ts
git commit -m "feat(a2): add OpenAI provider with streaming and tool support"
```

---

## Task 5: Anthropic Provider

**Files:**
- Create: `lib/llm/providers/anthropic.ts`

- [ ] **Step 1: Implement Anthropic provider**

Implements `LLMProviderInterface`.

**Reference:** Read `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/llm/providers/anthropic.ts` for V1 patterns.

**Critical message normalization (on every call):**
1. Extract system messages → Anthropic `system` parameter
2. Merge consecutive same-role messages (Anthropic requires alternation)
3. Ensure conversation starts with user message (prepend placeholder if needed)
4. Tool result messages → wrap in user messages with `tool_result` content blocks
5. Preserve `_providerContent` from assistant messages (thinking blocks)

**Tool definition conversion:**
```
Internal: { type: 'function', function: { name, description, parameters } }
Anthropic: { name, description, input_schema: parameters }
```

**Tool choice mapping:**
```
'auto' → { type: 'auto' }
'required' → { type: 'any' }
'none' → omit tools entirely
{ name } → { type: 'tool', name }
```

**Thinking blocks:**
- Use `thinking: { type: 'adaptive' }` on all calls
- Preserve full response content (including ThinkingBlock) in `rawMessage._providerContent`
- When converting assistant messages back, include preserved thinking blocks

**Streaming:** Use Anthropic SDK's `.stream()` method, handle `content_block_delta` events.

- [ ] **Step 2: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add lib/llm/providers/anthropic.ts
git commit -m "feat(a2): add Anthropic provider with message normalization and thinking blocks"
```

---

## Task 6: Provider Registry + Gateway

**Files:**
- Create: `lib/llm/providers/registry.ts`
- Create: `lib/llm/gateway.ts`

- [ ] **Step 1: Implement provider registry**

`lib/llm/providers/registry.ts`:
- Singleton instances per provider (lazy creation)
- `getProvider(name: 'OPENAI' | 'ANTHROPIC'): LLMProviderInterface`
- Failover helper: try primary, catch provider_down errors, retry with fallback

```typescript
export async function callWithFailover<T>(
  primary: { provider: LLMProviderInterface; model: string },
  fallback: { provider: LLMProviderInterface; model: string } | null,
  fn: (provider: LLMProviderInterface, model: string) => Promise<T>,
): Promise<T>
```

For transient errors (429, 5xx): retry up to 2 times with exponential backoff (1s, 3s) before trying fallback.

- [ ] **Step 2: Implement gateway facade**

`lib/llm/gateway.ts`:

```typescript
import { getAgentConfig } from './agent-config'
import { getProvider, callWithFailover } from './providers/registry'

export const gateway = {
  async call(agentSlug: string, options: {
    messages: Message[]
    tools?: LLMToolDefinition[]
    toolChoice?: ToolChoice
    overrideSystemPrompt?: string
  }): Promise<ChatResponse | ChatWithToolsResponse>,

  async stream(agentSlug: string, options: {
    messages: Message[]
    tools?: LLMToolDefinition[]
    toolChoice?: ToolChoice
    overrideSystemPrompt?: string
  }): Promise<AsyncIterable<StreamChunk>>,
}
```

Both methods:
1. Load agent config via `getAgentConfig(slug)`
2. Build primary provider + model, fallback provider + model
3. Prepend systemPrompt as system message (if not overridden)
4. Set temperature, maxTokens from config
5. Call through `callWithFailover()`
6. Return response

The `call()` method also creates a `GatewayCallRecord` for turn trace tracking.

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/llm/providers/registry.ts lib/llm/gateway.ts
git commit -m "feat(a2): add provider registry with failover and gateway facade"
```

---

## Task 7: Tool Types + Registry + Classification

**Files:**
- Create: `lib/tools/types.ts`
- Create: `lib/tools/registry.ts`

- [ ] **Step 1: Create tool types**

`lib/tools/types.ts`:

```typescript
export type ExecutionMode = 'blocking' | 'background'
export type UserRole = 'CUSTOMER' | 'ADMIN' | 'OPERATOR'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema for LLM
  executionMode: ExecutionMode
  customerVisible: boolean
  statusMessage: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean
  allowedRoles: UserRole[]
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult>

export interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
  uiAction?: { type: string; payload: Record<string, unknown> }
}

export interface ToolContext {
  customerId: string
  conversationId: string
  language: 'en' | 'ro'
  product?: {
    id: string
    code: string
    name: { en: string; ro: string }
    insuranceType: string
  }
  application?: {
    id: string
    status: string
    currentQuestionIndex: number
  }
  quote?: {
    id: string
    status: string
    premiumAnnual: number
    premiumMonthly: number
  }
  workflowSession?: {
    id: string
    workflowId: string
    currentStepId: string
    currentStepCode: string
    data: unknown
  }
}

export interface PipelineResult {
  toolResult: ToolResult
  transition?: {
    previousStepCode: string
    newStepCode: string
    newStepName: string
    newStepInstructions: string | null
    newStepAutoTool: string | null
  }
}
```

- [ ] **Step 2: Create tool registry**

`lib/tools/registry.ts`:

Registry of all tool definitions with execution classification from brand book S16. Include the status message pools verbatim from `zeno-brand-book.md` Section 16.

```typescript
const TOOL_REGISTRY: Map<string, { definition: ToolDefinition; handler: ToolHandler }>

export function registerTool(name: string, definition: ToolDefinition, handler: ToolHandler): void
export function getToolDefinition(name: string): ToolDefinition | undefined
export function getToolHandler(name: string): ToolHandler | undefined
export function getToolsForLLM(allowedTools?: string[]): LLMToolDefinition[]
export function getAllToolNames(): string[]
```

Define all 23 tool definitions from the spec's classification table (Section 7.2). For handlers, only `list_products` and `get_product_info` are implemented in A2 — all others get a stub handler that returns `{ success: false, error: 'Not implemented yet' }`.

Read `C:/GitHub/v2_ai_sales_agent/zeno-brand-book.md` starting at line 762 for the complete status message pools.

**Always-allowed tools** (bypass workflow gate):
```typescript
const ALWAYS_ALLOWED = new Set([
  'list_products', 'get_product_info', 'compare_products',
  'get_customer_profile', 'update_customer_profile',
  'get_objection_strategy', 'set_conversation_product',
  'check_dnt_status',
])
```

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/tools/types.ts lib/tools/registry.ts
git commit -m "feat(a2): add tool types and registry with brand book S16 classification"
```

---

## Task 8: Tool Validation + Permissions

**Files:**
- Create: `lib/tools/validation.ts`
- Create: `lib/tools/permissions.ts`

- [ ] **Step 1: Create Zod validation**

`lib/tools/validation.ts`:

```typescript
import { z } from 'zod'

const toolSchemas: Record<string, z.ZodSchema> = {
  list_products: z.object({
    insuranceType: z.string().optional(),
  }).strict(),

  get_product_info: z.object({
    productCode: z.string().optional(),
    productId: z.string().optional(),
  }).strict(),

  // Stubs for remaining tools — add real schemas in A4
  save_dnt_answer: z.object({ answer: z.string() }).passthrough(),
  sign_dnt: z.object({ confirmSignature: z.boolean(), gdprConsent: z.boolean() }).passthrough(),
  start_dnt_questionnaire: z.object({}).passthrough(),
  save_application_answer: z.object({ answer: z.string() }).passthrough(),
  start_application: z.object({}).passthrough(),
  get_application_status: z.object({}).passthrough(),
  resume_application: z.object({}).passthrough(),
  cancel_application: z.object({ reason: z.string().optional() }).passthrough(),
  generate_quote: z.object({}).passthrough(),
  get_quote_details: z.object({}).passthrough(),
  accept_quote: z.object({}).passthrough(),
  modify_quote: z.object({}).passthrough(),
  check_dnt_status: z.object({}).passthrough(),
  get_customer_profile: z.object({}).passthrough(),
  update_customer_profile: z.object({}).passthrough(),
  compare_products: z.object({ productCodes: z.array(z.string()) }).passthrough(),
  set_conversation_product: z.object({ productCode: z.string() }).passthrough(),
  get_objection_strategy: z.object({ type: z.string() }).passthrough(),
  check_bd_eligibility: z.object({}).passthrough(),
}

export function validateToolArgs(name: string, args: unknown): {
  valid: boolean
  data?: Record<string, unknown>
  errors?: string[]
}
```

- [ ] **Step 2: Create permissions**

`lib/tools/permissions.ts`:

```typescript
import type { UserRole } from './types'

const ROLE_HIERARCHY: Record<UserRole, number> = {
  CUSTOMER: 0,
  OPERATOR: 1,
  ADMIN: 2,
}

export function checkPermission(
  toolName: string,
  userRole: UserRole,
): { allowed: boolean; reason?: string }
```

Gets the tool's `allowedRoles` from the registry. Checks if userRole's hierarchy level >= minimum required role. ADMIN bypasses all checks.

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/tools/validation.ts lib/tools/permissions.ts
git commit -m "feat(a2): add tool validation (Zod) and role-based permissions"
```

---

## Task 9: Tool Executor + Pipeline

**Files:**
- Create: `lib/tools/executor.ts`
- Create: `lib/tools/pipeline.ts`
- Create: `__tests__/lib/tools/pipeline.test.ts`

- [ ] **Step 1: Create single tool executor**

`lib/tools/executor.ts`:

```typescript
export async function executeTool(
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolResult>
```

Flow:
1. Get handler from registry (throw if not found)
2. Validate args via `validateToolArgs()` → if invalid, return error ToolResult
3. Check permissions via `checkPermission()` → if denied, return error ToolResult
4. Call handler(validated args, context)
5. Catch handler errors → return error ToolResult (never throw)

- [ ] **Step 2: Create pipeline with workflow gate**

`lib/tools/pipeline.ts`:

```typescript
import { prisma } from '@/lib/db'

export async function executeToolWithPipeline(
  name: string,
  args: unknown,
  context: ToolContext,
  workflowSession?: {
    id: string
    currentStepId: string
    currentStepCode: string
    workflow: { id: string }
  },
): Promise<PipelineResult>
```

Flow:
1. **Workflow gate:** If workflowSession exists, load WorkflowStep's `allowedTools`. If tool name not in allowedTools AND not in ALWAYS_ALLOWED → return error PipelineResult.
2. **Execute:** Call `executeTool(name, args, context)`
3. **Evaluate transitions:** If workflowSession exists and tool succeeded, query `StepTransition` records for the current step. Check if any condition matches the tool result (conditionType 'TOOL_RESULT', conditionValue matches tool name or result pattern). If match found with highest priority → update WorkflowSession.currentStepId, load new step's data.
4. Return `PipelineResult` with toolResult + optional transition info.

Transition evaluation logic:
- `conditionType: 'TOOL_RESULT'` → check if conditionValue matches `toolName` or a pattern like `toolName:resultKey`
- `conditionType: 'DATA_CHECK'` → check if conditionValue expression matches WorkflowSession.data
- Transitions sorted by priority (descending), first match wins

- [ ] **Step 3: Write pipeline tests**

`__tests__/lib/tools/pipeline.test.ts`:
- Test workflow gate blocks disallowed tool
- Test always-allowed tool bypasses gate
- Test tool execution through pipeline
- Test transition evaluation on successful tool
- Test no transition when no condition matches

Mock prisma and tool registry.

- [ ] **Step 4: Run tests**

Run: `npx vitest run __tests__/lib/tools/pipeline.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/tools/executor.ts lib/tools/pipeline.ts __tests__/lib/tools/pipeline.test.ts
git commit -m "feat(a2): add tool executor and pipeline with workflow gate and transitions"
```

---

## Task 10: Context Builder + Stream Handler

**Files:**
- Create: `lib/chat/context-builder.ts`
- Create: `lib/chat/stream-handler.ts`

- [ ] **Step 1: Create context builder**

`lib/chat/context-builder.ts`:

```typescript
import { prisma } from '@/lib/db'
import type { ToolContext } from '@/lib/tools/types'

export async function buildToolContext(
  customerId: string,
  conversationId: string,
  language: 'en' | 'ro',
): Promise<ToolContext>
```

Single DB query with includes:
```typescript
prisma.conversation.findUniqueOrThrow({
  where: { id: conversationId },
  include: {
    product: true,
    application: true,
    workflowSession: {
      include: {
        currentStep: true,
        workflow: true,
      },
    },
  },
})
```

Map Prisma result → `ToolContext`. Cast Json fields to typed objects.

- [ ] **Step 2: Create stream handler**

`lib/chat/stream-handler.ts`:

```typescript
export interface SSEEvent {
  event: 'content' | 'tool_start' | 'tool_complete' | 'ui_action' | 'error' | 'done'
  data: Record<string, unknown>
}

export function createSSEStream(
  generator: () => AsyncGenerator<SSEEvent>,
): ReadableStream<Uint8Array>
```

Uses `ReadableStream` constructor with `TextEncoder`. Each SSEEvent → `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`.

Also export helpers:
```typescript
export function pickStatusMessage(
  statusMessage: { ro: string[]; en: string[] } | null,
  language: 'en' | 'ro',
  lastUsed?: string,
): string | null
```

Picks random message from pool, avoids repeat of `lastUsed`.

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/chat/context-builder.ts lib/chat/stream-handler.ts
git commit -m "feat(a2): add tool context builder and SSE stream handler"
```

---

## Task 11: Action Adapter + Orchestrator

**Files:**
- Create: `lib/chat/action-adapter.ts`
- Create: `lib/chat/orchestrator.ts`

- [ ] **Step 1: Create action adapter**

`lib/chat/action-adapter.ts`:

```typescript
import type { ToolCall } from '@/lib/llm/providers/types'

interface UIAction {
  type: string
  payload: Record<string, unknown>
}

const ACTION_MAPPINGS: Record<string, (payload: Record<string, unknown>) => ToolCall> = {
  select_tier: (p) => ({
    id: `action_${Date.now()}`,
    name: 'save_application_answer',
    arguments: { answer: `${p.tierCode}_${p.levelCode}` },
  }),
  select_addon: (p) => ({
    id: `action_${Date.now()}`,
    name: 'save_application_answer',
    arguments: { answer: p.includeAddon ? 'yes' : 'no' },
  }),
  // Add more mappings as UI components are built in Phase B
}

export function adaptAction(action: UIAction): ToolCall | null
```

Returns null for unknown action types (logged, not thrown).

- [ ] **Step 2: Create orchestrator**

`lib/chat/orchestrator.ts` — the 10-step per-turn pipeline:

```typescript
import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { executeToolWithPipeline } from '@/lib/tools/pipeline'
import { buildToolContext } from './context-builder'
import { createSSEStream, pickStatusMessage } from './stream-handler'
import { getToolDefinition, getToolsForLLM } from '@/lib/tools/registry'
import type { ToolCall, Message } from '@/lib/llm/providers/types'

export function handleChatTurn(input: {
  conversationId?: string
  customerId?: string
  message: string
  language?: 'en' | 'ro'
  syntheticToolCall?: ToolCall
}): ReadableStream<Uint8Array>
```

Returns a `ReadableStream` immediately (SSE). The async generator inside implements the 10 steps:

**Step 1 — Resolve conversation:** Get or create customer (anonymous if no customerId). Get or create conversation. Load product if set.

**Step 2 — Save user message:** Write to Message table. Atomic increment of messageCount.

**Step 3 — Reasoning gate:** Call `gateway.call('reasoning-gate', ...)` with context. Parse JSON. On failure → use moderate fallback. Skip if `syntheticToolCall` present.

**Step 4 — Context assembly (simplified for A2):** Agent systemPrompt + constraints + workflow step agentInstructions + reasoning gate briefing.

**Step 5 — Sliding window:** Load last 20 messages from DB. (Summary logic deferred to A3.)

**Step 6 — Prompt assembly (simplified for A2):** System message = concatenation of step 4 parts. User messages from step 5.

**Step 7 — Main LLM call + tool loop:**
- If `syntheticToolCall`: execute through pipeline directly, then call LLM with tool result for natural response.
- Otherwise: call `gateway.stream('main-chat', { messages, tools })`, yield content chunks.
- On tool_calls in stream: pause, execute each through pipeline, emit tool_start/tool_complete events, call LLM again.
- Max 5 rounds. On round 6: force `toolChoice: 'none'`.
- Background tools (`executionMode: 'background'`): fire-and-forget, don't pause stream.

**Step 8 — Save assistant message:** Write final response to Message table with tool call data.

**Step 9 — Background agents:** Fire-and-forget: profile extractor if message had personal info (simple heuristic). Summarizer if messageCount > 20 and no summary exists (stub for A2).

**Step 10 — Turn trace:** Fire-and-forget save to TurnTrace table.

**Error handling:** Empty message + no action → throw (caught by route.ts as 400). Conversation COMPLETED/ABANDONED → throw. DB errors → throw (caught by route.ts as 500). LLM/tool errors within the stream → emit SSE error event.

- [ ] **Step 3: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add lib/chat/action-adapter.ts lib/chat/orchestrator.ts
git commit -m "feat(a2): add action adapter and 10-step chat orchestrator"
```

---

## Task 12: Chat API Route + Example Tool Handlers

**Files:**
- Create: `app/api/chat/route.ts`
- Modify: `lib/tools/registry.ts` (add real handlers for list_products, get_product_info)

- [ ] **Step 1: Create chat API route**

`app/api/chat/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { adaptAction } from '@/lib/chat/action-adapter'

const requestSchema = z.object({
  conversationId: z.string().optional(),
  customerId: z.string().optional(),
  message: z.string().min(1).optional(),
  action: z.object({
    type: z.string(),
    payload: z.record(z.unknown()),
  }).optional(),
}).refine(
  (data) => data.message || data.action,
  { message: 'Either message or action is required' },
)

export async function POST(request: NextRequest) {
  // 1. Parse and validate body
  // 2. If action, convert via adaptAction
  // 3. Call handleChatTurn() → get ReadableStream
  // 4. Return as SSE response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream', ... } })
  // 5. On validation error → 400 JSON
  // 6. On orchestrator error → 500 JSON or SSE error
}
```

- [ ] **Step 2: Implement list_products handler**

Add to registry or create as a separate handler file. Reads from DB:

```typescript
async function handleListProducts(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      code: true, name: true, description: true,
      insuranceType: true, subType: true,
      premiumRange: true, features: true,
      targetCustomer: true, targetAgeRange: true,
    },
  })
  return {
    success: true,
    data: { products },
    message: `Found ${products.length} available product(s).`,
  }
}
```

- [ ] **Step 3: Implement get_product_info handler**

```typescript
async function handleGetProductInfo(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { code: args.productCode as string },
        { id: args.productId as string },
      ],
      isActive: true,
    },
    include: {
      pricingTiers: {
        include: {
          levels: { orderBy: { orderIndex: 'asc' } },
        },
        orderBy: { orderIndex: 'asc' },
      },
      addons: {
        include: { pricingRules: true },
      },
    },
  })
  if (!product) return { success: false, error: 'Product not found' }
  return {
    success: true,
    data: { product },
    message: `Product details for ${(product.name as any).en || product.code}.`,
  }
}
```

Register both handlers in the tool registry.

- [ ] **Step 4: Verify compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts lib/tools/registry.ts
git commit -m "feat(a2): add POST /api/chat route and list_products + get_product_info handlers"
```

---

## Task 13: Integration Test + Final Verification

**Files:**
- Create: `__tests__/integration/chat-api.test.ts`

- [ ] **Step 1: Write integration test**

Test the full `POST /api/chat` flow with a mocked LLM provider. The test should:
1. Seed test data (product exists from A1 seeds)
2. Send a POST request to `/api/chat` with `{ message: "Ce produse aveti?" }`
3. Read the SSE stream
4. Verify `content` events are received
5. Verify `done` event is received with metadata

Mock the LLM gateway to return a simple text response without tool calls for the basic test. Add a second test that mocks a tool-calling response to verify the tool pipeline.

Use Vitest with Next.js test utilities or a direct fetch to the dev server.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Manual smoke test**

Start the dev server and test with curl:
```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Ce produse aveti?"}' \
  --no-buffer
```

Expected: SSE stream with content events and a done event.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(a2): complete Slice A2 — LLM gateway, tool pipeline, chat API with SSE streaming"
```

---

## Notes for Implementer

1. **Import paths:** PrismaClient is at `@/lib/generated/prisma/client` (Prisma v7, NOT `@prisma/client`). Use the `@/` alias for all imports.

2. **PrismaPg adapter:** The `lib/db.ts` uses `PrismaPg` adapter. All DB access goes through the singleton from `lib/db.ts`.

3. **V1 reference files** (read for implementation patterns):
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/llm/providers/openai.ts` — OpenAI provider
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/llm/providers/anthropic.ts` — Anthropic provider
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/llm/gateway.ts` — gateway pattern
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/chat-handler.ts` — tool execution loop
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/tools/executor.ts` — tool executor
   - `C:/GitHub/ai_sales_agent_crm/ai-sales-agent-crm/lib/workflows/gate.ts` — workflow gate

4. **Brand book S16:** Read `C:/GitHub/v2_ai_sales_agent/zeno-brand-book.md` starting at line 762 for complete status message pools per tool.

5. **Streaming pattern:** Use Web Streams API (`ReadableStream`) for SSE. Next.js App Router supports returning `ReadableStream` from route handlers.

6. **Background tool execution:** Use `Promise.resolve().then(() => { ... })` or `setTimeout(() => { ... }, 0)` for fire-and-forget. Don't await.

7. **Token budget note:** GPT-5+ reasoning models need minimum `max_completion_tokens: 4096` because reasoning consumes tokens internally. If agent config sets lower, override to 4096 for reasoning models.

8. **No tests needed for providers in A2.** Provider testing requires mocking SDK internals which is brittle. The integration test verifies the full path. Unit tests focus on agent-config cache behavior and pipeline logic.
