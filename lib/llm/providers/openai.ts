/**
 * OpenAI Provider Implementation
 *
 * Implements LLMProviderInterface for OpenAI models including GPT-4o,
 * GPT-5, and o-series reasoning models. Handles message format conversion,
 * model-specific quirks, streaming, and tool calling.
 */

import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat'

import type {
  LLMProviderInterface,
  ChatRequest,
  ChatResponse,
  ChatWithToolsRequest,
  ChatWithToolsResponse,
  StreamChunk,
  Message,
  ToolCall,
  TokenUsage,
  LLMToolDefinition,
  ToolChoice,
  ReasoningConfig,
} from './types'
import { parseCacheUsage } from './types'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// MODEL QUIRKS
// ==============================================

/**
 * Models from GPT-4o onward and all o-series require max_completion_tokens
 * instead of the legacy max_tokens parameter.
 */
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = [
  'gpt-4o', 'gpt-4o-mini', 'gpt-4o-audio',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4.5', 'gpt-5',
  'o1', 'o1-mini', 'o1-pro', 'o3', 'o3-mini', 'o4-mini',
]

function useMaxCompletionTokens(model: string): boolean {
  return MODELS_REQUIRING_MAX_COMPLETION_TOKENS.some(m => model.startsWith(m))
}

/**
 * Reasoning models (o-series, gpt-5+) must not receive temperature and
 * need a higher minimum for max_completion_tokens to leave room for
 * internal chain-of-thought.
 */
function isReasoningModel(model: string): boolean {
  return /^(o[0-9]|gpt-5)/.test(model)
}

const MIN_REASONING_COMPLETION_TOKENS = 4096

/**
 * Models whose /v1/chat/completions rejects function tools while reasoning
 * is active — including the DEFAULT effort applied when the param is omitted
 * (400: "Function tools with reasoning_effort are not supported for
 * gpt-5.6-sol in /v1/chat/completions. To use function tools, use
 * /v1/responses or set reasoning_effort to 'none'."). Tool-bearing calls to
 * these models must send reasoning_effort: 'none' explicitly; non-tool calls
 * are unaffected.
 */
const MODELS_REQUIRING_REASONING_NONE_WITH_TOOLS = ['gpt-5.6-sol']

function requiresReasoningNoneWithTools(model: string): boolean {
  return MODELS_REQUIRING_REASONING_NONE_WITH_TOOLS.some(m => model.startsWith(m))
}

function adjustTokensForReasoning(
  maxTokens: number | undefined,
  reasoning: boolean,
): number | undefined {
  if (!reasoning || !maxTokens) return maxTokens
  return Math.max(maxTokens, MIN_REASONING_COMPLETION_TOKENS)
}

// ==============================================
// OPENAI PROVIDER
// ==============================================

export class OpenAIProvider implements LLMProviderInterface {
  private client: OpenAI

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      logWarn({
        layer: 'provider',
        category: 'config',
        message: 'No API key configured. Set OPENAI_API_KEY.',
      })
    }

    this.client = new OpenAI({
      apiKey: apiKey ?? 'missing-key',
      maxRetries: 0, // Gateway handles retries
    })
  }

  // ==============================================
  // MESSAGE CONVERSION (internal → OpenAI)
  // ==============================================

  private convertMessages(messages: Message[]): ChatCompletionMessageParam[] {
    return messages.map((msg): ChatCompletionMessageParam => {
      if (msg.role === 'system') {
        return { role: 'system' as const, content: msg.content }
      }

      if (msg.role === 'user') {
        return { role: 'user' as const, content: msg.content }
      }

      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          tool_call_id: msg.toolCallId ?? '',
        }
      }

      // assistant
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        }
      }

      return { role: 'assistant' as const, content: msg.content ?? null }
    })
  }

  private convertToolChoice(choice?: ToolChoice): ChatCompletionToolChoiceOption | undefined {
    if (choice === undefined || choice === 'auto') return 'auto'
    if (choice === 'none') return 'none'
    if (choice === 'required') return 'required'
    // Specific tool: { name }
    return { type: 'function' as const, function: { name: choice.name } }
  }

  // ==============================================
  // RESPONSE HELPERS
  // ==============================================

  private mapFinishReason(
    reason: string | null,
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'stop': return 'stop'
      case 'length': return 'length'
      case 'tool_calls': return 'tool_calls'
      case 'content_filter': return 'content_filter'
      default: return 'stop'
    }
  }

  private extractUsage(usage: OpenAI.CompletionUsage | undefined): TokenUsage {
    const cache = parseCacheUsage('OPENAI', (usage ?? {}) as unknown as Record<string, unknown>)
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      cacheReadTokens: cache.cacheRead,
      cacheWriteTokens: cache.cacheWrite,
    }
  }

  private parseToolCalls(
    rawCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
  ): ToolCall[] {
    if (!rawCalls) return []
    return rawCalls
      .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
        tc.type === 'function',
      )
      .map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParse(tc.function.arguments),
      }))
  }

  // ==============================================
  // BUILD PARAMS HELPERS
  // ==============================================

  private buildTokenParam(
    model: string,
    maxTokens: number | undefined,
  ): Record<string, unknown> {
    const reasoning = isReasoningModel(model)
    const tokens = adjustTokensForReasoning(maxTokens, reasoning)

    if (useMaxCompletionTokens(model)) {
      return { max_completion_tokens: tokens }
    }
    return { max_tokens: tokens }
  }

  private buildReasoningParam(
    model: string,
    reasoning?: ReasoningConfig,
  ): Record<string, unknown> {
    if (!reasoning?.enabled || !isReasoningModel(model)) return {}
    return { reasoning_effort: reasoning.effort }
  }

  /**
   * Tool-bearing calls to quirked models (see
   * MODELS_REQUIRING_REASONING_NONE_WITH_TOOLS) must force
   * reasoning_effort: 'none' — spread AFTER buildReasoningParam so it wins
   * over any requested effort, which the API would reject anyway.
   */
  private buildToolsReasoningOverride(model: string): Record<string, unknown> {
    if (!requiresReasoningNoneWithTools(model)) return {}
    return { reasoning_effort: 'none' }
  }

  // ==============================================
  // chat()
  // ==============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const reasoning = isReasoningModel(request.model)

    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: reasoning ? undefined : request.temperature,
      ...this.buildTokenParam(request.model, request.maxTokens),
      ...this.buildReasoningParam(request.model, request.reasoning),
      stream: false,
    })

    const choice = response.choices[0]

    const rawMessage: Message = {
      role: 'assistant',
      content: choice.message.content ?? '',
    }

    return {
      content: choice.message.content,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: this.extractUsage(response.usage),
      rawMessage,
    }
  }

  // ==============================================
  // chatWithTools()
  // ==============================================

  async chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
    const reasoning = isReasoningModel(request.model)

    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      tools: request.tools.map(t => ({
        type: 'function' as const,
        function: t.function,
      })),
      tool_choice: this.convertToolChoice(request.toolChoice),
      temperature: reasoning ? undefined : request.temperature,
      ...this.buildTokenParam(request.model, request.maxTokens),
      ...this.buildReasoningParam(request.model, request.reasoning),
      ...this.buildToolsReasoningOverride(request.model),
      stream: false,
    })

    const choice = response.choices[0]
    const message = choice.message
    const toolCalls = this.parseToolCalls(message.tool_calls)

    const rawMessage: Message = {
      role: 'assistant',
      content: message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }

    return {
      content: message.content,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: this.extractUsage(response.usage),
      rawMessage,
      toolCalls,
    }
  }

  // ==============================================
  // chatStream()
  // ==============================================

  async chatStream(request: ChatRequest): Promise<AsyncIterable<StreamChunk>> {
    const reasoning = isReasoningModel(request.model)

    // The request fires HERE, inside the awaited call, so auth/connection
    // errors reject this promise and reach the gateway's failover logic.
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: reasoning ? undefined : request.temperature,
      ...this.buildTokenParam(request.model, request.maxTokens),
      stream: true,
      stream_options: { include_usage: true },
    })

    return this.emitStreamChunks(stream)
  }

  private async *emitStreamChunks(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  ): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    let finished = false

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        yield { type: 'content', content: delta.content }
      }

      // stream_options.include_usage: usage arrives on a FINAL chunk with an
      // empty choices array, AFTER the finish_reason chunk — so `done` must
      // wait for stream end or it can never carry usage.
      if (chunk.usage) {
        usage = this.extractUsage(chunk.usage)
      }

      // P1-9 / A1a: usage rides a FINAL chunk AFTER finish_reason (choices
      // empty). Yielding done at finish_reason recorded 0 tokens on every
      // streamed turn; done now waits for stream end. Gating on `finished`
      // preserves abort semantics (no finish_reason → no done).
      if (chunk.choices[0]?.finish_reason) {
        finished = true
      }
    }

    if (finished) {
      yield { type: 'done', usage }
    }
  }

  // ==============================================
  // chatStreamWithTools()
  // ==============================================

  async chatStreamWithTools(request: ChatWithToolsRequest): Promise<AsyncIterable<StreamChunk>> {
    const reasoning = isReasoningModel(request.model)

    // The request fires HERE, inside the awaited call, so auth/connection
    // errors reject this promise and reach the gateway's failover logic.
    const stream = await this.client.chat.completions.create({
      model: request.model,
      messages: this.convertMessages(request.messages),
      tools: request.tools.map(t => ({
        type: 'function' as const,
        function: t.function,
      })),
      tool_choice: this.convertToolChoice(request.toolChoice),
      temperature: reasoning ? undefined : request.temperature,
      ...this.buildTokenParam(request.model, request.maxTokens),
      ...this.buildToolsReasoningOverride(request.model),
      stream: true,
      stream_options: { include_usage: true },
    })

    return this.emitStreamWithToolsChunks(stream)
  }

  private async *emitStreamWithToolsChunks(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  ): AsyncIterable<StreamChunk> {
    // Accumulate tool call deltas across chunks
    const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map()
    let usage: TokenUsage | undefined
    let finished = false

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // Text content
      if (delta?.content) {
        yield { type: 'content', content: delta.content }
      }

      // Tool call deltas
      if (delta?.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index
          let accum = toolCallAccum.get(idx)

          if (!accum) {
            accum = { id: tcDelta.id ?? '', name: '', args: '' }
            toolCallAccum.set(idx, accum)
          }

          if (tcDelta.id) accum.id = tcDelta.id
          if (tcDelta.function?.name) accum.name += tcDelta.function.name
          if (tcDelta.function?.arguments) accum.args += tcDelta.function.arguments
        }
      }

      // stream_options.include_usage: usage arrives on a FINAL chunk with an
      // empty choices array, AFTER the finish_reason chunk — so tool_calls +
      // done must wait for stream end or done can never carry usage.
      if (chunk.usage) {
        usage = this.extractUsage(chunk.usage)
      }

      // P1-9 / A1a: same trailing-usage-chunk rule as emitStreamChunks — tool
      // calls and done wait for stream END so the usage chunk (which arrives
      // AFTER finish_reason) is never lost; `finished` preserves abort semantics.
      if (chunk.choices[0]?.finish_reason) {
        finished = true
      }
    }

    // Stream finished — emit accumulated tool calls then done
    if (finished) {
      if (toolCallAccum.size > 0) {
        const toolCalls: ToolCall[] = Array.from(toolCallAccum.values()).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: safeParse(tc.args),
        }))
        yield { type: 'tool_calls', toolCalls }
      }

      yield { type: 'done', usage }
    }
  }
}

// ==============================================
// HELPER
// ==============================================

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}
