/**
 * Anthropic Provider Implementation
 *
 * Implements LLMProviderInterface for Anthropic Claude models.
 * Handles message format normalization (strict alternation, system extraction),
 * tool definition conversion, thinking blocks, and streaming.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageParam,
  ContentBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  Tool as AnthropicTool,
  TextBlock,
  ToolUseBlock,
  ContentBlock,
  MessageCreateParamsNonStreaming,
  ThinkingBlock,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages'

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
} from './types'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// ANTHROPIC PROVIDER
// ==============================================

export class AnthropicProvider implements LLMProviderInterface {
  private client: Anthropic

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      logWarn({
        layer: 'provider',
        category: 'config',
        message: 'No API key configured. Set ANTHROPIC_API_KEY.',
      })
    }

    this.client = new Anthropic({
      apiKey: apiKey ?? 'missing-key',
      maxRetries: 0, // Gateway handles retries
    })
  }

  // ==============================================
  // MESSAGE CONVERSION (internal → Anthropic)
  // ==============================================

  /**
   * Convert internal Message[] to Anthropic format.
   *
   * Key transformations:
   * 1. System messages extracted to top-level `system` param
   * 2. Tool result messages wrapped in user messages with tool_result content blocks
   * 3. Assistant messages with toolCalls become content blocks (text + tool_use)
   * 4. _providerContent preserved for thinking block round-trips
   * 5. Consecutive same-role messages merged (Anthropic requires strict alternation)
   * 6. Conversation must start with user message
   */
  private convertMessages(messages: Message[]): {
    system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> | undefined
    messages: MessageParam[]
  } {
    // 1. Extract system messages — each becomes a separate text block (supports per-block cache hints)
    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = []
    const nonSystemMessages: Message[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (msg.content) {
          if (msg.cacheHint) {
            systemBlocks.push({
              type: 'text' as const,
              text: msg.content,
              cache_control: { type: 'ephemeral' as const },
            })
          } else {
            systemBlocks.push({
              type: 'text' as const,
              text: msg.content,
            })
          }
        }
      } else {
        nonSystemMessages.push(msg)
      }
    }

    // Backward compat: if there's exactly one system block without cache_control,
    // add it (preserves existing behavior for callers not using cache hints)
    if (systemBlocks.length === 1 && !systemBlocks[0].cache_control) {
      systemBlocks[0].cache_control = { type: 'ephemeral' as const }
    }

    const system = systemBlocks.length > 0 ? systemBlocks : undefined

    // 2. Convert individual messages
    const converted: MessageParam[] = []

    for (const msg of nonSystemMessages) {
      if (msg.role === 'tool') {
        // Tool result → user message with tool_result content block
        const toolResultBlock: ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId ?? '',
          content: msg.content ?? '',
        }

        // Merge into previous user message if exists (multiple tool results)
        const lastMsg = converted[converted.length - 1]
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          ;(lastMsg.content as ContentBlockParam[]).push(toolResultBlock)
        } else {
          converted.push({ role: 'user', content: [toolResultBlock] })
        }
      } else if (msg.role === 'assistant') {
        // If raw provider content blocks preserved (includes thinking blocks), use directly
        if (msg._providerContent && Array.isArray(msg._providerContent)) {
          converted.push({
            role: 'assistant',
            content: msg._providerContent as ContentBlockParam[],
          })
        } else if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Reconstruct content blocks from text + tool_calls
          const contentBlocks: ContentBlockParam[] = []

          if (msg.content) {
            contentBlocks.push({ type: 'text', text: msg.content })
          }

          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            } as ToolUseBlockParam)
          }

          converted.push({ role: 'assistant', content: contentBlocks })
        } else {
          converted.push({ role: 'assistant', content: msg.content ?? '' })
        }
      } else if (msg.role === 'user') {
        converted.push({ role: 'user', content: msg.content ?? '' })
      }
    }

    // 3. Merge consecutive same-role messages
    const merged = this.mergeConsecutiveMessages(converted)

    return { system, messages: merged }
  }

  /**
   * Merge consecutive messages with the same role.
   * Anthropic API requires strict user/assistant alternation.
   */
  private mergeConsecutiveMessages(messages: MessageParam[]): MessageParam[] {
    if (messages.length === 0) return []

    const result: MessageParam[] = [messages[0]]

    for (let i = 1; i < messages.length; i++) {
      const current = messages[i]
      const prev = result[result.length - 1]

      if (current.role === prev.role) {
        const prevBlocks = this.toContentBlocks(prev.content)
        const currentBlocks = this.toContentBlocks(current.content)
        prev.content = [...prevBlocks, ...currentBlocks]
      } else {
        result.push(current)
      }
    }

    // Ensure conversation starts with a user message
    if (result.length > 0 && result[0].role === 'assistant') {
      result.unshift({ role: 'user', content: '(continuing conversation)' })
    }

    return result
  }

  private toContentBlocks(content: MessageParam['content']): ContentBlockParam[] {
    if (typeof content === 'string') {
      return [{ type: 'text', text: content }]
    }
    return content as ContentBlockParam[]
  }

  // ==============================================
  // TOOL DEFINITION CONVERSION
  // ==============================================

  /**
   * Convert internal (OpenAI-style) tool defs to Anthropic format.
   *
   * Internal: { type: 'function', function: { name, description, parameters } }
   * Anthropic: { name, description, input_schema }
   */
  private convertToolDefinitions(tools: LLMToolDefinition[]): AnthropicTool[] {
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: {
        type: 'object' as const,
        ...tool.function.parameters,
      },
    }))
  }

  /**
   * Convert internal ToolChoice to Anthropic's tool_choice format.
   */
  private convertToolChoice(
    choice?: ToolChoice,
  ): MessageCreateParamsNonStreaming['tool_choice'] | undefined {
    if (!choice || choice === 'auto') return { type: 'auto' }
    if (choice === 'required') return { type: 'any' }
    if (choice === 'none') return undefined // Anthropic: omit tools entirely
    // Specific tool: { name }
    return { type: 'tool', name: choice.name }
  }

  // ==============================================
  // RESPONSE HELPERS
  // ==============================================

  private mapStopReason(
    stopReason: string | null,
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (stopReason) {
      case 'end_turn': return 'stop'
      case 'stop_sequence': return 'stop'
      case 'max_tokens': return 'length'
      case 'tool_use': return 'tool_calls'
      default: return 'stop'
    }
  }

  private extractTextContent(content: ContentBlock[]): string | null {
    const textParts = content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)

    return textParts.length > 0 ? textParts.join('') : null
  }

  private extractToolCalls(content: ContentBlock[]): ToolCall[] {
    return content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      }))
  }

  private extractUsage(usage: { input_tokens: number; output_tokens: number }): TokenUsage {
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
    }
  }

  // ==============================================
  // chat()
  // ==============================================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = this.convertMessages(request.messages)

    const params: MessageCreateParamsNonStreaming = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: false,
    }

    if (system) params.system = system
    if (request.temperature !== undefined) params.temperature = request.temperature

    const response = await this.client.messages.create(params)
    const textContent = this.extractTextContent(response.content)

    const rawMessage: Message = {
      role: 'assistant',
      content: textContent ?? '',
    }

    return {
      content: textContent,
      finishReason: this.mapStopReason(response.stop_reason),
      usage: this.extractUsage(response.usage),
      rawMessage,
    }
  }

  // ==============================================
  // chatWithTools()
  // ==============================================

  async chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
    const { system, messages } = this.convertMessages(request.messages)
    const tools = this.convertToolDefinitions(request.tools)
    const toolChoice = this.convertToolChoice(request.toolChoice)

    // When toolChoice is 'none', omit tools entirely from request
    const shouldIncludeTools = request.toolChoice !== 'none'

    const params: MessageCreateParamsNonStreaming = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ? Math.max(request.maxTokens, 8192) : 16000,
      stream: false,
    }

    // Enable adaptive thinking (Claude decides when and how much to think)
    params.thinking = { type: 'adaptive' }

    if (system) params.system = system
    if (request.temperature !== undefined) params.temperature = request.temperature

    if (shouldIncludeTools && tools.length > 0) {
      params.tools = tools
      if (toolChoice) params.tool_choice = toolChoice
    }

    const response = await this.client.messages.create(params)

    const textContent = this.extractTextContent(response.content)
    const toolCalls = this.extractToolCalls(response.content)

    // Preserve full content blocks (including thinking) for multi-turn continuity
    const rawMessage: Message = {
      role: 'assistant',
      content: textContent ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      _providerContent: response.content,
    }

    return {
      content: textContent,
      finishReason: this.mapStopReason(response.stop_reason),
      usage: this.extractUsage(response.usage),
      rawMessage,
      toolCalls,
    }
  }

  // ==============================================
  // chatStream()
  // ==============================================

  async chatStream(request: ChatRequest): Promise<AsyncIterable<StreamChunk>> {
    const { system, messages } = this.convertMessages(request.messages)

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
    }

    if (system) params.system = system
    if (request.temperature !== undefined) params.temperature = request.temperature

    // messages.create (unlike the lazy messages.stream helper) issues the
    // request HERE, so auth/connection errors reject this awaited call and
    // reach the gateway's failover logic instead of exploding mid-iteration.
    const stream = await this.client.messages.create(params)

    return this.emitStreamChunks(stream)
  }

  private async *emitStreamChunks(
    stream: AsyncIterable<Anthropic.RawMessageStreamEvent>,
  ): AsyncIterable<StreamChunk> {
    // P1-9: message_start carries input_tokens, message_delta the cumulative
    // output_tokens — previously neither was read and every streamed turn
    // recorded 0 tokens.
    let inputTokens = 0
    let outputTokens = 0
    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens ?? 0
        outputTokens = event.message.usage.output_tokens ?? 0
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens ?? outputTokens
      }
      if (event.type === 'content_block_delta') {
        const delta = event.delta
        if ('text' in delta && delta.type === 'text_delta') {
          yield { type: 'content', content: (delta as { text: string }).text }
        }
      }

      if (event.type === 'message_stop') {
        yield { type: 'done', usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens } }
      }
    }
  }

  // ==============================================
  // chatStreamWithTools()
  // ==============================================

  async chatStreamWithTools(request: ChatWithToolsRequest): Promise<AsyncIterable<StreamChunk>> {
    const { system, messages } = this.convertMessages(request.messages)
    const tools = this.convertToolDefinitions(request.tools)
    const toolChoice = this.convertToolChoice(request.toolChoice)

    const shouldIncludeTools = request.toolChoice !== 'none'

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ? Math.max(request.maxTokens, 8192) : 16000,
      stream: true,
    }

    if (system) params.system = system
    if (request.temperature !== undefined) params.temperature = request.temperature

    if (shouldIncludeTools && tools.length > 0) {
      params.tools = tools
      if (toolChoice) params.tool_choice = toolChoice
    }

    // messages.create (unlike the lazy messages.stream helper) issues the
    // request HERE, so auth/connection errors reject this awaited call and
    // reach the gateway's failover logic instead of exploding mid-iteration.
    const stream = await this.client.messages.create(params)

    return this.emitStreamWithToolsChunks(stream)
  }

  private async *emitStreamWithToolsChunks(
    stream: AsyncIterable<Anthropic.RawMessageStreamEvent>,
  ): AsyncIterable<StreamChunk> {
    // Accumulate tool use blocks during streaming
    const toolUseAccum: Map<number, { id: string; name: string; jsonChunks: string }> = new Map()
    // P1-9: usage from message_start (input) + message_delta (output)
    let inputTokens = 0
    let outputTokens = 0

    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message.usage.input_tokens ?? 0
        outputTokens = event.message.usage.output_tokens ?? 0
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens ?? outputTokens
      }
      // Text content deltas
      if (event.type === 'content_block_delta') {
        const delta = event.delta
        if ('text' in delta && delta.type === 'text_delta') {
          yield { type: 'content', content: (delta as { text: string }).text }
        }

        // Accumulate tool input JSON deltas
        if (delta.type === 'input_json_delta') {
          const accum = toolUseAccum.get(event.index)
          if (accum) {
            accum.jsonChunks += (delta as { partial_json: string }).partial_json
          }
        }
      }

      // Tool use block starts
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'tool_use') {
          toolUseAccum.set(event.index, {
            id: block.id,
            name: block.name,
            jsonChunks: '',
          })
        }
      }

      // Message complete — emit accumulated tool calls
      if (event.type === 'message_stop') {
        if (toolUseAccum.size > 0) {
          const toolCalls: ToolCall[] = Array.from(toolUseAccum.values()).map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: safeParse(tc.jsonChunks),
          }))
          yield { type: 'tool_calls', toolCalls }
        }

        yield { type: 'done', usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens } }
      }
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
