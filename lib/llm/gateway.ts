/**
 * LLM Gateway Facade
 *
 * Centralized entry point for all LLM calls. Loads agent config,
 * resolves providers, applies failover, and records call traces.
 *
 * Usage:
 *   const result = await gateway.call('main-chat', { messages, tools })
 *   const stream = await gateway.stream('main-chat', { messages })
 */

import { getAgentConfig } from '@/lib/llm/agent-config'
import { getProvider, callWithFailover } from '@/lib/llm/providers/registry'
import type {
  Message,
  ChatResponse,
  ChatWithToolsResponse,
  StreamChunk,
  LLMToolDefinition,
  ToolChoice,
  GatewayCallRecord,
  ReasoningConfig,
} from '@/lib/llm/providers/types'

// ==============================================
// GATEWAY OPTIONS
// ==============================================

export interface GatewayCallOptions {
  messages: Message[]
  tools?: LLMToolDefinition[]
  toolChoice?: ToolChoice
  reasoning?: ReasoningConfig
  /** Override the agent's system prompt entirely. */
  overrideSystemPrompt?: string
  /** Override temperature for this call. */
  temperature?: number
  /** Override maxTokens for this call. */
  maxTokens?: number
}

// ==============================================
// CALL RECORDS (in-memory trace buffer)
// ==============================================

const callRecords: GatewayCallRecord[] = []
const MAX_RECORDS = 200

function recordCall(record: GatewayCallRecord): void {
  callRecords.push(record)
  if (callRecords.length > MAX_RECORDS) {
    callRecords.splice(0, callRecords.length - MAX_RECORDS)
  }
}

/** Retrieve recent gateway call records (newest last). */
export function getCallRecords(limit = 50): GatewayCallRecord[] {
  return callRecords.slice(-limit)
}

// ==============================================
// GATEWAY
// ==============================================

export const gateway = {
  /**
   * Single LLM call (chat or chatWithTools based on whether tools are provided).
   * Automatically loads agent config, resolves providers, and applies failover.
   */
  async call(
    agentSlug: string,
    options: GatewayCallOptions,
  ): Promise<ChatResponse | ChatWithToolsResponse> {
    const config = await getAgentConfig(agentSlug)

    // Build messages: prepend system prompt unless overridden
    const messages = buildMessages(
      options.messages,
      options.overrideSystemPrompt ?? config.systemPrompt,
    )

    // Resolve providers
    const primaryProvider = getProvider(config.provider)
    const primary = { provider: primaryProvider, model: config.model }

    const fallback =
      config.fallbackProvider && config.fallbackModel
        ? { provider: getProvider(config.fallbackProvider), model: config.fallbackModel }
        : null

    const temperature = options.temperature ?? config.temperature
    const maxTokens = options.maxTokens ?? config.maxTokens
    const hasTools = options.tools && options.tools.length > 0

    const startMs = Date.now()

    const result = await callWithFailover(
      primary,
      fallback,
      async (provider, model) => {
        if (hasTools) {
          return provider.chatWithTools({
            messages,
            model,
            temperature,
            maxTokens,
            tools: options.tools!,
            toolChoice: options.toolChoice,
            reasoning: options.reasoning,
          })
        }
        return provider.chat({
          messages,
          model,
          temperature,
          maxTokens,
          reasoning: options.reasoning,
        })
      },
    )

    const durationMs = Date.now() - startMs

    // Record for tracing
    recordCall({
      agentSlug,
      provider: config.provider,
      model: config.model,
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
      cost: 0, // Cost calculation deferred to tracing layer
      durationMs,
      timestamp: new Date(),
    })

    return result
  },

  /**
   * Streaming LLM call (chatStream or chatStreamWithTools based on tools).
   * Returns an async iterable of StreamChunk.
   */
  async stream(
    agentSlug: string,
    options: GatewayCallOptions,
  ): Promise<AsyncIterable<StreamChunk>> {
    const config = await getAgentConfig(agentSlug)

    const messages = buildMessages(
      options.messages,
      options.overrideSystemPrompt ?? config.systemPrompt,
    )

    const primaryProvider = getProvider(config.provider)
    const primary = { provider: primaryProvider, model: config.model }

    const fallback =
      config.fallbackProvider && config.fallbackModel
        ? { provider: getProvider(config.fallbackProvider), model: config.fallbackModel }
        : null

    const temperature = options.temperature ?? config.temperature
    const maxTokens = options.maxTokens ?? config.maxTokens
    const hasTools = options.tools && options.tools.length > 0

    const startMs = Date.now()

    const iterable = await callWithFailover(
      primary,
      fallback,
      async (provider, model) => {
        if (hasTools) {
          return provider.chatStreamWithTools({
            messages,
            model,
            temperature,
            maxTokens,
            tools: options.tools!,
            toolChoice: options.toolChoice,
            reasoning: options.reasoning,
          })
        }
        return provider.chatStream({
          messages,
          model,
          temperature,
          maxTokens,
          reasoning: options.reasoning,
        })
      },
    )

    // Wrap iterable to record call on completion
    return trackStreamCompletion(iterable, {
      agentSlug,
      provider: config.provider,
      model: config.model,
      startMs,
    })
  },
}

// ==============================================
// HELPERS
// ==============================================

/**
 * Prepend system prompt as the first message unless already present.
 */
function buildMessages(messages: Message[], systemPrompt: string | null): Message[] {
  if (!systemPrompt) return messages

  // Check if messages already starts with a system message
  if (messages.length > 0 && messages[0].role === 'system') {
    return messages
  }

  return [{ role: 'system', content: systemPrompt }, ...messages]
}

/**
 * Wrap an async iterable to record a GatewayCallRecord when the stream ends.
 */
async function* trackStreamCompletion(
  iterable: AsyncIterable<StreamChunk>,
  meta: { agentSlug: string; provider: string; model: string; startMs: number },
): AsyncIterable<StreamChunk> {
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for await (const chunk of iterable) {
    if (chunk.type === 'done' && chunk.usage) {
      usage = chunk.usage
    }
    yield chunk
  }

  const durationMs = Date.now() - meta.startMs

  recordCall({
    agentSlug: meta.agentSlug,
    provider: meta.provider,
    model: meta.model,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cost: 0,
    durationMs,
    timestamp: new Date(),
  })
}
