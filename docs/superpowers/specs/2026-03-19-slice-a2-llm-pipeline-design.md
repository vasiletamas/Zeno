# Slice A2: LLM + Pipeline — Design Spec

**Project:** Zeno — AI Life Insurance Sales Agent V2
**Slice:** A2 (LLM Gateway, Streaming, Tool Pipeline)
**Date:** 2026-03-19
**Status:** Approved
**Depends on:** Slice A1 (Foundation) — complete

---

## 1. Goal

Deliver a working `POST /api/chat` endpoint that streams LLM responses via SSE, executes tools through a unified pipeline, and supports both LLM-initiated and UI-triggered actions through the same code path. First token visible in 200-400ms.

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Actions | Synthetic tool calls in A2 | Build complete now, don't defer. UI actions enter same pipeline as LLM tool calls. |
| Streaming | Option C — optimistic + background | Stream text immediately. Blocking tools pause stream with status messages. Background tools (profile extractor, summarizer) run async invisibly. |
| Tool classification | From brand book S16 | blocking+visible, blocking+silent, background. Status message pools per tool. |
| Architecture | Layered modules with orchestrator | Prevents V1's god-file problem. Orchestrator ~200-300 lines. Each module testable in isolation. |
| Circuit breaker | Deferred | Not enough traffic data. Add when real users exist. Simple retry + failover for now. |
| Reasoning gate | Wired as passthrough | Gate calls LLM and returns structured output. Full prompt assembly integration is A3. |

## 3. File structure

```
lib/llm/
  gateway.ts              — gateway.call() + gateway.stream() facade
  agent-config.ts         — DB config loading with 5-min cache + flushCache()
  providers/
    types.ts              — unified ChatRequest, ChatResponse, StreamChunk, Message types
    openai.ts             — OpenAI provider (chat, chatWithTools, chatStream)
    anthropic.ts          — Anthropic provider (chat, chatWithTools, chatStream)
    registry.ts           — provider resolution + failover logic

lib/tools/
  types.ts                — ToolHandler, ToolResult, ToolContext, ToolDefinition types
  registry.ts             — tool definitions, handler map, execution classification
  validation.ts           — Zod schemas per tool
  permissions.ts          — role-based access control
  executor.ts             — single tool: validate → permission → execute
  pipeline.ts             — workflow gate + tool loop orchestration

lib/chat/
  orchestrator.ts         — 10-step per-turn pipeline, returns ReadableStream
  stream-handler.ts       — SSE stream management (pause/resume, tool events)
  context-builder.ts      — build ToolContext from DB
  action-adapter.ts       — convert UI actions to synthetic tool calls

app/api/chat/route.ts     — thin HTTP handler, delegates to orchestrator
```

## 4. Dependencies (new in A2)

| Package | Purpose |
|---------|---------|
| `openai` | OpenAI SDK for LLM calls + streaming |
| `@anthropic-ai/sdk` | Anthropic SDK for LLM calls + streaming |

No other new deps. Zod already installed from A1.

## 5. LLM Gateway

### 5.1 Gateway facade (`lib/llm/gateway.ts`)

Two methods:

**`gateway.call(agentSlug, options)`**
- For secondary agents (reasoning gate, summarizer, profile extractor)
- Loads agent config from DB via `agent-config.ts` (cached)
- Resolves provider via `registry.ts`
- Calls `provider.chat()` or `provider.chatWithTools()`
- Returns `ChatResponse` or `ChatWithToolsResponse`
- Records call metadata (tokens, cost, duration) for turn trace

**`gateway.stream(agentSlug, options)`**
- For main-chat streaming
- Same config loading and provider resolution
- Calls `provider.chatStream()`
- Returns `AsyncIterable<StreamChunk>`
- Records metadata after stream completes

### 5.2 Agent config (`lib/llm/agent-config.ts`)

```typescript
interface AgentConfig {
  slug: string
  type: AgentType
  provider: LLMProvider
  model: string
  fallbackProvider: LLMProvider | null
  fallbackModel: string | null
  temperature: number
  maxTokens: number
  systemPrompt: string | null
  constraints: string | null
  isActive: boolean
}

getAgentConfig(slug: string): Promise<AgentConfig>   // 5-min cache
flushAgentConfigCache(): void                          // for admin UI
```

Cache is a simple in-memory Map with TTL. No Redis needed.

### 5.3 Failover strategy

1. Try primary provider + model
2. On provider-down error (401/402/403, connection refused, timeout) → try fallbackProvider + fallbackModel
3. On transient error (429, 500, 502, 503, 504) → retry up to 2 times with exponential backoff (1s, 3s)
4. If all fail → throw with original error details

Error classification:
```typescript
type ErrorClass = 'provider_down' | 'transient' | 'validation' | 'unknown'
classifyError(error: unknown): ErrorClass
```

## 6. Provider implementations

### 6.1 Unified types (`lib/llm/providers/types.ts`)

```typescript
// Request types
interface ChatRequest {
  messages: Message[]
  temperature?: number
  maxTokens?: number
  reasoning?: { enabled: boolean; effort: 'low' | 'medium' | 'high' }
}

interface ChatWithToolsRequest extends ChatRequest {
  tools: ToolDefinition[]
  toolChoice?: 'auto' | 'none' | 'required' | { name: string }
}

// Response types
interface ChatResponse {
  content: string | null
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  rawMessage: AssistantMessage  // preserves _providerContent
}

interface ChatWithToolsResponse extends ChatResponse {
  toolCalls: ToolCall[]
}

// Streaming
interface StreamChunk {
  type: 'content' | 'tool_calls' | 'done'
  content?: string
  toolCalls?: ToolCall[]
  usage?: TokenUsage
}

// Messages
interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ToolCall[]          // assistant messages with tool invocations
  toolCallId?: string             // tool result messages
  _providerContent?: unknown      // native provider blocks (Anthropic thinking)
}

interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// Provider interface
interface LLMProviderInterface {
  chat(request: ChatRequest): Promise<ChatResponse>
  chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse>
  chatStream(request: ChatRequest): AsyncIterable<StreamChunk>
  chatStreamWithTools(request: ChatWithToolsRequest): AsyncIterable<StreamChunk>
}
```

### 6.2 OpenAI provider (`lib/llm/providers/openai.ts`)

Implements `LLMProviderInterface`. Key behaviors:
- Model-specific token params: GPT-5+ uses `max_completion_tokens` (not `max_tokens`)
- Reasoning models: forbid custom `temperature`, minimum `max_completion_tokens = 4096`
- `reasoning_effort` parameter for models that support it
- Tool definitions passed as-is (our format matches OpenAI's)
- Streaming via OpenAI SDK's native `.stream()` method
- Stream chunks yield text content and tool calls separately

### 6.3 Anthropic provider (`lib/llm/providers/anthropic.ts`)

Implements `LLMProviderInterface`. Key behaviors:
- Message normalization on every call:
  - System messages extracted to `system` parameter
  - Consecutive same-role messages merged
  - Ensure conversation starts with user message
  - Tool results wrapped in user messages with `tool_result` content blocks
- Tool definition conversion: `parameters` → `input_schema`
- Tool choice mapping: `'required'` → `{ type: 'any' }`, `'auto'` → `{ type: 'auto' }`
- Thinking: `thinking: { type: 'adaptive' }`, preserved in `_providerContent`
- Streaming via Anthropic SDK's native stream, normalized to `StreamChunk`

### 6.4 Provider registry (`lib/llm/providers/registry.ts`)

```typescript
getProvider(providerName: LLMProvider): LLMProviderInterface
resolveProviderWithFailover(config: AgentConfig): {
  provider: LLMProviderInterface
  model: string
}
```

Instantiates providers lazily (singleton per provider). API keys from environment:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## 7. Tool pipeline

### 7.1 Tool types (`lib/tools/types.ts`)

```typescript
type ExecutionMode = 'blocking' | 'background'

interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>  // JSON Schema
  executionMode: ExecutionMode
  customerVisible: boolean
  statusMessages: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean               // bypasses workflow gate
  allowedRoles: UserRole[]
}

type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<ToolResult>

interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string                     // for LLM to incorporate in response
  uiAction?: {
    type: string
    payload: Record<string, unknown>
  }
}

interface ToolContext {
  customerId: string
  conversationId: string
  language: 'en' | 'ro'
  product?: { id: string; code: string; name: unknown; insuranceType: string }
  application?: { id: string; status: string; currentQuestionIndex: number }
  quote?: { id: string; status: string; premiumAnnual: number; premiumMonthly: number }
  workflowSession?: {
    id: string
    workflowId: string
    currentStepId: string
    currentStepCode: string
    data: unknown
  }
}
```

### 7.2 Tool registry (`lib/tools/registry.ts`)

Central registry of all tool definitions, handlers, and execution classification.

```typescript
const TOOL_REGISTRY: Record<string, {
  definition: ToolDefinition
  handler: ToolHandler
}>

getToolDefinition(name: string): ToolDefinition
getToolHandler(name: string): ToolHandler
getToolsForLLM(allowedTools?: string[]): ToolDefinition[]  // filter for LLM prompt
getAllToolNames(): string[]
```

**Tool execution classification** (from brand book S16):

| Tool | executionMode | customerVisible | statusMessages |
|------|--------------|-----------------|----------------|
| generate_quote | blocking | true | 5 RO/EN messages |
| sign_dnt | blocking | true | 4 RO/EN messages |
| accept_quote | blocking | true | 4 RO/EN messages |
| get_objection_strategy | blocking | false | 3 RO/EN enhanced typing |
| get_product_info | blocking | false | 3 RO/EN enhanced typing |
| list_products | blocking | false | 3 RO/EN enhanced typing |
| compare_products | blocking | false | 3 RO/EN enhanced typing |
| save_dnt_answer | blocking | false | null (fast, <200ms) |
| save_application_answer | blocking | false | null (fast, <200ms) |
| start_dnt_questionnaire | blocking | false | null |
| start_application | blocking | false | null |
| get_application_status | blocking | false | null |
| check_dnt_status | blocking | false | null |
| get_customer_profile | blocking | false | null |
| update_customer_profile | background | false | null |
| get_quote_details | blocking | false | null |
| accept_quote | blocking | true | 4 RO/EN messages |
| modify_quote | blocking | false | null |
| resume_application | blocking | false | null |
| cancel_application | blocking | false | null |
| set_conversation_product | blocking | false | null |
| get_objection_strategy | blocking | false | 3 RO/EN messages |
| profile_extractor | background | false | null |
| summarizer | background | false | null |

**A2 implements 2 example handlers** to prove the pipeline:
- `list_products` — reads from DB, returns product list
- `get_product_info` — reads from DB, returns full product with pricing

Remaining handlers are implemented in Slice A4.

### 7.3 Validation (`lib/tools/validation.ts`)

Zod schema per tool, all `.strict()`:
```typescript
const toolSchemas: Record<string, z.ZodSchema> = {
  list_products: z.object({
    insuranceType: z.string().optional(),
  }).strict(),
  get_product_info: z.object({
    productCode: z.string().optional(),
    productId: z.string().optional(),
  }).strict(),
  // ... remaining schemas added with their handlers in A4
}

validateToolArgs(name: string, args: unknown): { valid: boolean; data?: unknown; errors?: string[] }
```

### 7.4 Permissions (`lib/tools/permissions.ts`)

```typescript
interface ToolPermission {
  allowedRoles: UserRole[]
}

checkPermission(toolName: string, userRole: UserRole): { allowed: boolean; reason?: string }
```

Role hierarchy: ADMIN > OPERATOR > CUSTOMER. Higher roles inherit. All chat tools allow CUSTOMER in A2 (auth not yet enforced — role is always CUSTOMER).

### 7.5 Single tool executor (`lib/tools/executor.ts`)

```typescript
executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolExecutionResult>
```

Flow:
1. Get handler from registry
2. Validate args via Zod schema
3. Check permissions
4. Execute handler
5. Return result (success/error + data)

No workflow logic here — that's in pipeline.ts.

### 7.6 Pipeline (`lib/tools/pipeline.ts`)

```typescript
executeToolWithPipeline(
  name: string,
  args: unknown,
  context: ToolContext,
  workflowSession?: WorkflowSession
): Promise<PipelineResult>
```

Flow:
1. **Workflow gate** — check if tool is allowed at current step (skip for `alwaysAllowed` tools)
2. **Execute** via `executor.ts`
3. **Evaluate transitions** — check tool result against `StepTransition` conditions
4. **Apply transition** — if condition met, update `WorkflowSession.currentStepId`
5. **Return** result + transition info (if any) for orchestrator

```typescript
interface PipelineResult {
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

## 8. Chat orchestrator

### 8.1 Orchestrator (`lib/chat/orchestrator.ts`)

The per-turn pipeline. Accepts a user message, returns an SSE ReadableStream.

```typescript
handleChatTurn(input: {
  conversationId?: string
  customerId?: string
  message: string
  language?: 'en' | 'ro'
}): ReadableStream
```

**10-step flow:**

1. **Conversation resolution** — get or create conversation + customer. Load product if set.
2. **Save user message** — write to Message table, increment messageCount.
3. **Reasoning gate** — call `gateway.call('reasoning-gate', ...)` with last 3 messages, workflow state, concerns. Parse JSON response. If gate fails (timeout/parse error), use fallback (all sections included, moderate complexity).
4. **Context assembly** — build system prompt from agent config + gate-selected sections. In A2 this is simplified: agent systemPrompt + basic workflow instructions. Full 3-layer assembly is A3.
5. **Sliding window** — last 20 messages full. If conversation has >20 messages and no summary exists, trigger summarizer in background. In A2 this is simplified: just take last 20, no summary yet (A3).
6. **Dynamic prompt assembly** — In A2: agent systemPrompt + constraints + workflow step instructions + reasoning gate briefing. Full section registry is A3.
7. **Main LLM call with streaming + tool loop** — stream tokens via SSE. On tool_calls: pause stream, execute through pipeline, emit tool events, call LLM again. Max 5 rounds.
8. **Save assistant message** — write final assistant response to Message table with tool call data.
9. **Background agents** — fire-and-forget: profile extractor (if message had personal info), summarizer (if >20 messages).
10. **Turn trace** — fire-and-forget save to TurnTrace: phases, tokens, cost, latency, provider, model.

### 8.2 Stream handler (`lib/chat/stream-handler.ts`)

Creates and manages the SSE ReadableStream.

```typescript
createChatStream(generator: AsyncGenerator<SSEEvent>): ReadableStream

interface SSEEvent {
  event: 'content' | 'tool_start' | 'tool_complete' | 'ui_action' | 'error' | 'done'
  data: string  // JSON
}
```

**SSE event types:**

| Event | Data | When |
|-------|------|------|
| `content` | `{ text: "token" }` | Each streamed token from LLM |
| `tool_start` | `{ tool: "name", statusMessage: "..." }` | Before blocking tool executes |
| `tool_complete` | `{ tool: "name", success: bool, duration: ms }` | After tool finishes |
| `ui_action` | `{ type: "show_quote", payload: {...} }` | Tool returned a UI action |
| `error` | `{ message: "..." }` | Runtime error |
| `done` | `{ messageId, tokens, cost, latency }` | Turn complete |

**Status message selection:**
- Pick random message from the tool's `statusMessages` pool for the conversation language
- Track last used message per tool to avoid repeats within same conversation

### 8.3 Context builder (`lib/chat/context-builder.ts`)

```typescript
buildToolContext(customerId: string, conversationId: string, language: string): Promise<ToolContext>
```

Single DB query with includes: conversation → product, application, workflowSession → currentStep.

### 8.4 Action adapter (`lib/chat/action-adapter.ts`)

```typescript
adaptAction(action: { type: string; payload: Record<string, unknown> }): ToolCall
```

Converts UI button actions into tool calls:
```typescript
// Input (from frontend button click):
{ type: 'select_tier', payload: { tierCode: 'standard', levelCode: 'level_2' } }

// Output (synthetic tool call):
{ id: 'action_xxx', name: 'save_application_answer', arguments: { answer: 'standard_level_2' } }
```

Action mappings are a simple lookup table. New mappings added as UI components are built in Phase B.

## 9. Chat API route

### `app/api/chat/route.ts`

```typescript
POST /api/chat
Content-Type: application/json
Body: {
  conversationId?: string     // omit to start new conversation
  customerId?: string         // omit for anonymous (auto-created)
  message: string             // user's message
  action?: {                  // UI-triggered action (alternative to message)
    type: string
    payload: Record<string, unknown>
  }
}

Response: text/event-stream (SSE)
```

Thin handler:
1. Parse and validate request body (Zod)
2. If `action` present, convert via action adapter and pass as message context
3. Delegate to `orchestrator.handleChatTurn()`
4. Return the ReadableStream as SSE response
5. On validation error: return 400 JSON

## 10. Environment variables (new in A2)

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Added to `.env.example` with placeholder values.

## 11. What A2 delivers

- [ ] Working `POST /api/chat` endpoint that streams SSE responses
- [ ] LLM gateway with OpenAI + Anthropic providers, per-agent config from DB, 5-min cache
- [ ] Real SSE streaming: first token in 200-400ms, stream-pause-execute-resume for tools
- [ ] Tool pipeline: workflow gate → Zod validation → RBAC → execute → transition evaluation
- [ ] Tool execution classification: blocking+visible, blocking+silent, background
- [ ] Status messages from brand book S16 (randomized pool per tool per language)
- [ ] Action adapter for UI → synthetic tool calls (one execution path)
- [ ] 2 working tool handlers: `list_products`, `get_product_info`
- [ ] Reasoning gate wired (calls LLM, parses JSON, returns structured output)
- [ ] Turn trace recording (fire-and-forget)
- [ ] Background agent execution pattern (profile extractor, summarizer stubs)
- [ ] Failover: primary → fallback provider on error
- [ ] `npx tsc --noEmit` passes

## 12. What A2 does NOT include

- Full dynamic prompt assembly with 3-layer section registry (Slice A3)
- Sliding window + summarizer trigger logic (Slice A3)
- All 20+ tool handlers (Slice A4 — only list_products and get_product_info in A2)
- Quote engine, questionnaire engine, workflow engine logic (Slice A4)
- Frontend / UI (Phase B)
- Auth (Phase B)
- Rate limiting (post-launch)

## 13. Testing strategy

A2 introduces testable business logic (unlike A1 which was schema + data). Tests:

- **Unit tests** for each provider: message normalization, tool definition conversion, stream chunk parsing
- **Unit tests** for tool pipeline: gate check, validation, permission, execution flow
- **Unit tests** for orchestrator: mock providers, verify 10-step flow
- **Integration test**: `POST /api/chat` with real DB, mocked LLM provider, verify SSE events

Test framework: Vitest (standard for Next.js projects).
