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
  /**
   * Prompt tokens served from the provider's prompt cache (A1 telemetry).
   * OpenAI: prompt_tokens_details.cached_tokens (a subset of promptTokens).
   * Anthropic: cache_read_input_tokens (NOT included in promptTokens).
   */
  cacheReadTokens?: number
  /** Anthropic cache_creation_input_tokens; always 0 on OpenAI. */
  cacheWriteTokens?: number
}

// ==============================================
// CACHE USAGE
// ==============================================

export interface CacheUsage {
  cacheRead: number
  cacheWrite: number
  cacheHit: boolean
}

/**
 * Parse cache telemetry from a provider's RAW usage object. Providers call
 * this at usage-normalization time (extractUsage) — the raw fields do not
 * survive normalization, which is exactly the bug that left cache:status
 * emitting zeros when this parsing ran at the gateway on normalized usage.
 */
export function parseCacheUsage(provider: string, usage: Record<string, unknown>): CacheUsage {
  if (provider === 'ANTHROPIC') {
    const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0
    const cacheWrite = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0
    return { cacheRead, cacheWrite, cacheHit: cacheRead > 0 }
  }
  if (provider === 'OPENAI') {
    const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
    const cached = typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0
    return { cacheRead: cached, cacheWrite: 0, cacheHit: cached > 0 }
  }
  return { cacheRead: 0, cacheWrite: 0, cacheHit: false }
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

/**
 * Both OpenAI and Anthropic providers implement this contract.
 *
 * The stream methods return a PROMISE of an iterable (not a bare async
 * generator) so that request-time failures — auth errors, connection
 * failures, rate limits — reject the awaited call inside the gateway's
 * callWithFailover, where retry/failover/circuit-breaker logic lives.
 * A bare `async *` method would defer the HTTP request to first iteration,
 * bypassing failover entirely.
 */
export interface LLMProviderInterface {
  chat(request: ChatRequest): Promise<ChatResponse>
  chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse>
  chatStream(request: ChatRequest): Promise<AsyncIterable<StreamChunk>>
  chatStreamWithTools(request: ChatWithToolsRequest): Promise<AsyncIterable<StreamChunk>>
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
