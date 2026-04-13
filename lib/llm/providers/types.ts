/**
 * Unified LLM Provider Types
 *
 * All types that cross provider boundaries live here.
 * Both OpenAI and Anthropic providers implement LLMProviderInterface
 * using these shared types — callers never see provider-specific structures.
 */

// ==============================================
// TOKEN USAGE
// ==============================================

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ==============================================
// REASONING CONFIG
// ==============================================

/** Provider-agnostic reasoning/thinking configuration. */
export interface ReasoningConfig {
  enabled: boolean
  effort: 'low' | 'medium' | 'high'
}

// ==============================================
// TOOL TYPES
// ==============================================

/** Tool call returned by the LLM (parsed arguments). */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Tool definition for LLM function calling.
 * Uses OpenAI shape as canonical; Anthropic provider converts internally.
 */
export interface LLMToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown> // JSON Schema
  }
}

/** How the LLM should choose tools. */
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string }

// ==============================================
// CACHE HINTS
// ==============================================

/** Provider-agnostic cache hint for prompt caching optimization. */
export interface CacheHint {
  /** 'ephemeral' = cache for this session; 'persistent' = long-lived cache */
  breakpoint: 'ephemeral' | 'persistent'
}

// ==============================================
// MESSAGE FORMAT
// ==============================================

/** Unified message format used across all providers. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Assistant messages: tools the LLM wants to call. */
  toolCalls?: ToolCall[]
  /** Tool messages: which call this result is for. */
  toolCallId?: string
  /** Preserve native provider content blocks (e.g. Anthropic thinking). Pass-through only. */
  _providerContent?: unknown
  /** Optional hint for provider-level prompt caching. */
  cacheHint?: CacheHint
}

// ==============================================
// REQUEST TYPES
// ==============================================

export interface ChatRequest {
  messages: Message[]
  model: string
  temperature?: number
  maxTokens?: number
  reasoning?: ReasoningConfig
}

export interface ChatWithToolsRequest extends ChatRequest {
  tools: LLMToolDefinition[]
  toolChoice?: ToolChoice
}

// ==============================================
// RESPONSE TYPES
// ==============================================

export interface ChatResponse {
  content: string | null
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  usage: TokenUsage
  /** Full assistant message (preserves _providerContent for multi-turn). */
  rawMessage: Message
}

export interface ChatWithToolsResponse extends ChatResponse {
  toolCalls: ToolCall[]
}

// ==============================================
// STREAMING
// ==============================================

export interface StreamChunk {
  type: 'content' | 'tool_calls' | 'done'
  content?: string
  toolCalls?: ToolCall[]
  usage?: TokenUsage
}

// ==============================================
// PROVIDER INTERFACE
// ==============================================

/** Both OpenAI and Anthropic providers implement this contract. */
export interface LLMProviderInterface {
  chat(request: ChatRequest): Promise<ChatResponse>
  chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse>
  chatStream(request: ChatRequest): AsyncIterable<StreamChunk>
  chatStreamWithTools(request: ChatWithToolsRequest): AsyncIterable<StreamChunk>
}

// ==============================================
// GATEWAY TRACING
// ==============================================

/** Record of a single LLM call for observability / cost tracking. */
export interface GatewayCallRecord {
  agentSlug: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  durationMs: number
  timestamp: Date
}
