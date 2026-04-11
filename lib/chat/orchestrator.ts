/**
 * Chat Orchestrator
 *
 * The 10-step per-turn pipeline. Wires together:
 * - LLM gateway (reasoning gate + main chat)
 * - Tool registry and pipeline
 * - SSE streaming
 * - DB persistence (messages, traces)
 *
 * Returns a ReadableStream immediately; an async generator
 * drives the pipeline steps inside.
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { getAgentConfig } from '@/lib/llm/agent-config'
import type {
  Message,
  ToolCall,
  LLMToolDefinition,
} from '@/lib/llm/providers/types'
import { getToolDefinition, getToolsForLLM } from '@/lib/tools/registry'
import { executeToolWithPipeline } from '@/lib/tools/pipeline'
import { buildToolContext } from './context-builder'
import { createSSEStream, pickStatusMessage, type SSEEvent } from './stream-handler'
import type { ToolContext, PipelineResult } from '@/lib/tools/types'
import { buildPrompt, detectFastPath, FAST_PATH_GATE, type GateSelection } from './prompt-builder'
import { executeReasoningGate, formatGateBriefing, type ReasoningGateInput, type ReasoningGateOutput } from './reasoning-gate'
import { buildSlidingWindow } from './sliding-window'
import { loadAllSections, type WorkflowSessionData } from './context-loaders'
import { trackChatStarted } from '@/lib/analytics/events'
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'
import { compactMessages } from '@/lib/chat/compaction'
import { isContextLengthError, parseTokenDeficit } from '@/lib/llm/errors'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'

// ==============================================
// CONSTANTS
// ==============================================

const MAX_TOOL_ROUNDS = 5
const PIPELINE_TIMEOUT_MS = 90_000

async function withPipelineTimeout<T>(
  fn: () => Promise<T>,
  operation: string,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new TimeoutError(operation, PIPELINE_TIMEOUT_MS)),
        PIPELINE_TIMEOUT_MS,
      ),
    ),
  ])
}

// ==============================================
// TOOL CALL PARTITIONING
// ==============================================

/**
 * Partition tool calls into three groups for execution ordering.
 * - readOnly: sideEffects=false — can run in parallel
 * - writing: sideEffects=true (default) — must run sequentially
 * - background: executionMode='background' — fire-and-forget
 */
export function partitionToolCalls(
  toolCalls: ToolCall[],
): { readOnly: ToolCall[]; writing: ToolCall[]; background: ToolCall[] } {
  const readOnly: ToolCall[] = []
  const writing: ToolCall[] = []
  const background: ToolCall[] = []

  for (const tc of toolCalls) {
    const def = getToolDefinition(tc.name)

    if (def?.executionMode === 'background') {
      background.push(tc)
    } else if (def?.sideEffects === false) {
      readOnly.push(tc)
    } else {
      writing.push(tc)
    }
  }

  return { readOnly, writing, background }
}

// ==============================================
// INPUT TYPE
// ==============================================

export interface ChatTurnInput {
  conversationId?: string
  customerId?: string
  message: string
  language?: 'en' | 'ro'
  syntheticToolCall?: ToolCall
}

// ==============================================
// INTERNAL STATE
// ==============================================

interface TurnState {
  conversationId: string
  customerId: string
  language: 'en' | 'ro'
  messageCount: number
  productId: string | null
  workflowSessionId: string | null
  workflowStepCode: string | null
  savedMessageId: string | null
  totalInputTokens: number
  totalOutputTokens: number
  provider: string | null
  model: string | null
  startMs: number
  phases: Record<string, unknown>
}

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Handle a single chat turn. Returns a ReadableStream of SSE events immediately.
 * The async generator inside drives the 10-step pipeline.
 */
export function handleChatTurn(input: ChatTurnInput): ReadableStream<Uint8Array> {
  return createSSEStream(() => chatTurnGenerator(input))
}

// ==============================================
// 10-STEP PIPELINE GENERATOR
// ==============================================

async function* chatTurnGenerator(input: ChatTurnInput): AsyncGenerator<SSEEvent> {
  const state: TurnState = {
    conversationId: input.conversationId ?? '',
    customerId: input.customerId ?? '',
    language: input.language ?? 'ro',
    messageCount: 0,
    productId: null,
    workflowSessionId: null,
    workflowStepCode: null,
    savedMessageId: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    provider: null,
    model: null,
    startMs: Date.now(),
    phases: {},
  }

  // =============================================
  // STEP 1 — Resolve conversation
  // =============================================
  const step1Start = Date.now()

  const resolveConversation = async () => {
    if (!state.customerId) {
      const customer = await prisma.customer.create({
        data: { isAnonymous: true, language: state.language },
      })
      state.customerId = customer.id
    }

    if (!state.conversationId) {
      const conv = await prisma.conversation.create({
        data: {
          customerId: state.customerId,
          language: state.language,
          channel: 'web',
        },
      })
      state.conversationId = conv.id
      trackChatStarted(state.customerId)
    }

    return prisma.conversation.findUniqueOrThrow({
      where: { id: state.conversationId },
      include: {
        product: { select: { id: true } },
        workflowSession: {
          include: {
            currentStep: {
              select: {
                id: true,
                code: true,
                name: true,
                agentInstructions: true,
                allowedTools: true,
                autoTool: true,
              },
            },
          },
        },
      },
    })
  }

  let conversation: Awaited<ReturnType<typeof resolveConversation>>
  try {
    conversation = await resolveConversation()
  } catch (err) {
    const errorId = logFatal({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Failed to resolve conversation',
      context: { conversationId: state.conversationId, customerId: state.customerId },
      error: err,
    })
    yield {
      event: 'error',
      data: { errorId, type: 'internal', message: 'Service temporarily unavailable', retryable: true },
    }
    return
  }

  // Guard: conversation must be active
  if (conversation.status === 'COMPLETED' || conversation.status === 'ABANDONED') {
    throw new Error(`Conversation ${state.conversationId} is ${conversation.status}`)
  }

  // Guard: must have content
  if (!input.message && !input.syntheticToolCall) {
    throw new Error('Either message or syntheticToolCall is required')
  }

  state.messageCount = conversation.messageCount
  state.productId = conversation.productId
  state.workflowSessionId = conversation.workflowSession?.id ?? null
  state.workflowStepCode = conversation.workflowSession?.currentStep.code ?? null
  state.phases['step1_resolve'] = Date.now() - step1Start

  // =============================================
  // STEP 2 — Save user message
  // =============================================
  const step2Start = Date.now()

  try {
    const userMsg = await prisma.message.create({
      data: {
        conversationId: state.conversationId,
        role: 'user',
        content: input.message,
      },
    })

    await prisma.conversation.update({
      where: { id: state.conversationId },
      data: {
        messageCount: { increment: 1 },
        lastActivityAt: new Date(),
      },
    })
    state.messageCount += 1
  } catch (err) {
    const errorId = logFatal({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Failed to save user message',
      context: { conversationId: state.conversationId, customerId: state.customerId },
      error: err,
    })
    yield {
      event: 'error',
      data: { errorId, type: 'internal', message: 'Service temporarily unavailable', retryable: true },
    }
    return
  }
  state.phases['step2_save_user'] = Date.now() - step2Start

  // =============================================
  // STEP 3 — Reasoning gate (skip for synthetic tool calls)
  // =============================================
  const step3Start = Date.now()

  // Determine if fast path applies
  const hasActiveQuestionnaire = !!(state.workflowStepCode &&
    (['dnt_questionnaire', 'application_fill'].includes(state.workflowStepCode) ||
      state.workflowStepCode.includes('bd')))

  let gateOutput: ReasoningGateOutput | null = null
  let gateSelection: GateSelection

  if (detectFastPath(input.message, hasActiveQuestionnaire) && !input.syntheticToolCall) {
    // Fast path: skip reasoning gate
    gateSelection = FAST_PATH_GATE
    state.phases['reasoningGate'] = { skipped: true, fastPath: true, durationMs: 0 }
  } else if (input.syntheticToolCall) {
    // Synthetic tool call: skip gate
    gateSelection = { requiredSections: [], excludedSections: [], confidence: 0 }
    state.phases['reasoningGate'] = { skipped: true, syntheticAction: true, durationMs: 0 }
  } else {
    // Full reasoning gate
    const gateStart = Date.now()

    try {
      // Load recent messages for gate context
      const recentMsgs = await prisma.message.findMany({
        where: { conversationId: state.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { role: true, content: true },
      })
      const last3Messages = recentMsgs
        .reverse()
        .map((m) => ({ role: m.role, content: m.content.slice(0, 300) }))

      // Load customer profile for gate input
      const customer = await prisma.customer.findUnique({
        where: { id: state.customerId },
        select: {
          name: true,
          dateOfBirth: true,
          extractedProfile: true,
        },
      })
      const extractedProfile = (customer?.extractedProfile as Record<string, unknown>) ?? {}
      const customerAge = customer?.dateOfBirth
        ? Math.floor((Date.now() - customer.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null

      // Derive business state from conversation
      const application = await prisma.application.findUnique({
        where: { conversationId: state.conversationId },
        select: {
          status: true,
          currentQuestionIndex: true,
          totalQuestions: true,
          quote: {
            select: {
              status: true,
              premiumAnnual: true,
              policy: { select: { id: true } },
            },
          },
        },
      })

      // Available tools: filter by workflow step's allowed tools if applicable
      const gateStepTools = conversation.workflowSession?.currentStep.allowedTools ?? []
      const availableToolDefs = getToolsForLLM(gateStepTools.length > 0 ? gateStepTools : undefined)
      const availableToolNames = availableToolDefs.map((t) => t.function.name)

      // Current questionnaire question text (for gate context)
      let currentQuestionText: string | null = null
      // We'll leave this null since loading questionnaire context is handled in step 4

      const gateInput: ReasoningGateInput = {
        lastUserMessage: input.message,
        last3Messages,
        hasActiveQuestionnaire,
        currentQuestionText,
        workflowStepCode: state.workflowStepCode,
        availableTools: availableToolNames,
        customerProfile: {
          name: customer?.name ?? null,
          age: customerAge,
          family: typeof extractedProfile.familySize === 'number'
            ? `family of ${extractedProfile.familySize}`
            : typeof extractedProfile.hasChildren === 'boolean'
              ? (extractedProfile.hasChildren ? 'has children' : 'no children')
              : null,
          occupation: typeof extractedProfile.occupation === 'string'
            ? extractedProfile.occupation
            : null,
          isReturningCustomer: false, // P2: returning customer detection
        },
        businessState: {
          selectedProduct: conversation.product?.id ?? null,
          dntProgress: null, // Simplified: DNT progress tracked via questionnaire
          applicationProgress: application
            ? `${application.currentQuestionIndex}/${application.totalQuestions} (${application.status})`
            : null,
          hasQuote: !!application?.quote,
          quoteValue: application?.quote?.premiumAnnual ?? null,
          hasPolicy: !!application?.quote?.policy,
        },
      }

      gateOutput = await executeReasoningGate(gateInput)
      gateSelection = {
        requiredSections: gateOutput.requiredSections,
        excludedSections: gateOutput.excludedSections,
        confidence: gateOutput.confidence,
      }
      state.phases['reasoningGate'] = {
        durationMs: Date.now() - gateStart,
        complexity: gateOutput.complexity,
        situationType: gateOutput.situationType,
        confidence: gateOutput.confidence,
      }
    } catch (err: unknown) {
      // Reasoning gate failure is non-fatal: use defaults
      logWarn({
        layer: 'orchestrator',
        category: 'reasoning_gate',
        message: 'Reasoning gate failed, using defaults',
        context: { conversationId: state.conversationId },
        error: err,
      })
      gateSelection = { requiredSections: [], excludedSections: [], confidence: 0 }
      state.phases['reasoningGate'] = {
        durationMs: Date.now() - gateStart,
        error: true,
      }
    }
  }

  state.phases['step3_reasoning_gate'] = Date.now() - step3Start

  // =============================================
  // STEP 4 — Context assembly
  // =============================================
  const step4Start = Date.now()

  const agentConfig = await getAgentConfig('main-chat')
  const situationalBriefing = gateOutput ? formatGateBriefing(gateOutput) : null

  let sections: Awaited<ReturnType<typeof loadAllSections>>
  try {
    // Build WorkflowSessionData from current conversation state
    const workflowSessionData: WorkflowSessionData | null = conversation.workflowSession
      ? {
          currentStepCode: conversation.workflowSession.currentStep.code,
          currentStepName: conversation.workflowSession.currentStep.name,
          agentInstructions: conversation.workflowSession.currentStep.agentInstructions,
          allowedTools: conversation.workflowSession.currentStep.allowedTools,
          data: conversation.workflowSession.data,
        }
      : null

    // Determine allowed tools for this step
    const stepAllowedTools = conversation.workflowSession?.currentStep.allowedTools ?? []

    sections = await loadAllSections({
      agentConfig: { systemPrompt: agentConfig.systemPrompt, constraints: agentConfig.constraints },
      allowedTools: stepAllowedTools,
      productId: state.productId,
      conversationId: state.conversationId,
      customerId: state.customerId,
      workflowSession: workflowSessionData,
      workflowStepCode: state.workflowStepCode,
      situationalBriefing,
      language: state.language,
    })
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Context assembly failed, using minimal context',
      context: { conversationId: state.conversationId },
      error: err,
    })
    // Minimal fallback — identity and constraints only
    sections = {
      agentIdentity: agentConfig.systemPrompt,
      capabilityManifest: null,
      constraints: agentConfig.constraints,
      situationalBriefing: null,
      customerMemory: null,
      agentKnowledge: null,
      customerContext: null,
      coachingBriefing: null,
      workflowInstructions: null,
      questionnaireContext: null,
      productContext: null,
    }
  }

  state.provider = agentConfig.provider
  state.model = agentConfig.model

  // Build prompt early — needed for token budget calculation
  const buildResult = buildPrompt(sections, gateSelection)
  const { prompt: systemPrompt } = buildResult

  state.phases['step4_context'] = Date.now() - step4Start

  // =============================================
  // STEP 4b — Calculate token budget
  // =============================================
  const contextWindow = agentConfig.provider === 'ANTHROPIC' ? 200_000 : 128_000
  const systemPromptTokens = estimateTokens(buildResult.prompt, state.language)
  const toolDefs = getToolsForLLM()
  const toolDefTokens = estimateTokens(JSON.stringify(toolDefs), 'en')
  const availableTokenBudget = calculateMessageBudget({
    modelContextWindow: contextWindow,
    systemPromptTokens,
    toolDefinitionTokens: toolDefTokens,
    outputReservation: agentConfig.maxTokens,
  })

  state.phases['step4b_token_budget'] = {
    contextWindow,
    systemPromptTokens,
    toolDefTokens,
    availableTokenBudget,
  }

  // =============================================
  // STEP 5 — Sliding window
  // =============================================
  const step5Start = Date.now()

  let windowMessages: Message[]
  let summaryPrefix: string | null
  try {
    const windowResult = await buildSlidingWindow(
      state.conversationId,
      state.messageCount,
      availableTokenBudget,
    )
    windowMessages = windowResult.messages
    summaryPrefix = windowResult.summaryPrefix
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Sliding window failed, using empty window',
      context: { conversationId: state.conversationId },
      error: err,
    })
    windowMessages = []
    summaryPrefix = null
  }

  state.phases['step5_sliding_window'] = Date.now() - step5Start

  // =============================================
  // STEP 6 — Build messages array
  // =============================================
  const step6Start = Date.now()

  const messages: Message[] = [
    { role: 'system' as const, content: systemPrompt },
  ]
  if (summaryPrefix) {
    messages.push({
      role: 'system' as const,
      content: `[Previous conversation summary]\n${summaryPrefix}\n[End of summary — recent messages follow]`,
    })
  }
  messages.push(...windowMessages)
  messages.push({ role: 'user' as const, content: input.message })

  state.phases['step6_build_messages'] = Date.now() - step6Start

  // =============================================
  // STEP 7 — Main LLM call + tool loop
  // =============================================
  const step7Start = Date.now()

  let toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
  const tools: LLMToolDefinition[] = getToolsForLLM()
  let finalContent = ''
  let lastStatusMessage: string | undefined

  if (input.syntheticToolCall) {
    // ----- Synthetic tool call path -----
    const tc = input.syntheticToolCall
    const def = getToolDefinition(tc.name)
    const isBlocking = def?.executionMode === 'blocking'

    if (isBlocking && def?.statusMessage) {
      const status = pickStatusMessage(def.statusMessage, state.language)
      if (status) {
        lastStatusMessage = status
        yield {
          event: 'tool_start',
          data: { tool: tc.name, status },
        }
      }
    }

    const pipelineResult = await executeToolWithPipeline(
      tc.name,
      tc.arguments,
      toolContext,
      toolContext.workflowSession
        ? {
            id: toolContext.workflowSession.id,
            currentStepId: toolContext.workflowSession.currentStepId,
            workflowId: toolContext.workflowSession.workflowId,
          }
        : null,
    )

    if (isBlocking) {
      yield {
        event: 'tool_complete',
        data: {
          tool: tc.name,
          success: pipelineResult.toolResult.success,
        },
      }
    }

    if (pipelineResult.toolResult.uiAction) {
      yield {
        event: 'ui_action',
        data: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown>,
      }
    }

    // Build tool result message for LLM
    const toolResultMessage: Message = {
      role: 'tool',
      content: JSON.stringify({
        success: pipelineResult.toolResult.success,
        data: pipelineResult.toolResult.data,
        error: pipelineResult.toolResult.error,
        message: pipelineResult.toolResult.message,
      }),
      toolCallId: tc.id,
    }

    // Add the assistant message (with tool call) and tool result
    const syntheticAssistantMsg: Message = {
      role: 'assistant',
      content: '',
      toolCalls: [tc],
    }
    messages.push(syntheticAssistantMsg, toolResultMessage)

    // If transition occurred, inject context
    if (pipelineResult.transition) {
      const trParts = [
        `[Workflow Transition]`,
        `Previous step: "${pipelineResult.transition.previousStepCode}"`,
        `New step: "${pipelineResult.transition.newStepName}"`,
      ]
      if (pipelineResult.transition.newStepInstructions) {
        trParts.push(`\nNew step instructions:\n${pipelineResult.transition.newStepInstructions}`)
      }
      if (pipelineResult.transition.newStepAutoTool) {
        trParts.push(`\nYou should now call: ${pipelineResult.transition.newStepAutoTool}`)
      }
      messages.push({ role: 'system', content: trParts.join('\n') })
    }

    // Stream a natural language response
    const responseStream = await gateway.stream('main-chat', {
      messages,
      overrideSystemPrompt: systemPrompt,
    })

    for await (const chunk of responseStream) {
      if (chunk.type === 'content' && chunk.content) {
        finalContent += chunk.content
        yield { event: 'content', data: { text: chunk.content } }
      }
      if (chunk.type === 'done' && chunk.usage) {
        state.totalInputTokens += chunk.usage.promptTokens
        state.totalOutputTokens += chunk.usage.completionTokens
      }
    }
  } else {
    // ----- Standard chat path with tool loop -----
    let round = 0

    while (round <= MAX_TOOL_ROUNDS) {
      const toolChoice = round >= MAX_TOOL_ROUNDS ? 'none' as const : 'auto' as const

      let stream: AsyncIterable<import('@/lib/llm/providers/types').StreamChunk>
      try {
        stream = await gateway.stream('main-chat', {
          messages,
          tools: toolChoice === 'none' ? undefined : tools,
          toolChoice: toolChoice === 'none' ? undefined : toolChoice,
          overrideSystemPrompt: systemPrompt,
        })
      } catch (err) {
        if (round === 0 && isContextLengthError(err)) {
          // Reactive compaction: compress and retry once
          const deficit = parseTokenDeficit(err) ?? 2000
          const compactedMessages = await compactMessages(messages, deficit, state.conversationId)
          messages.length = 0
          messages.push(...compactedMessages)
          state.phases['reactiveCompaction'] = { deficit, originalLength: messages.length }

          stream = await gateway.stream('main-chat', {
            messages,
            tools: toolChoice === 'none' ? undefined : tools,
            toolChoice: toolChoice === 'none' ? undefined : toolChoice,
            overrideSystemPrompt: systemPrompt,
          })
        } else if (err instanceof CircuitOpenError) {
          // Queued retry with backoff: 5s, 10s, 20s
          yield { event: 'status', data: { type: 'processing', message: 'Un moment, reconectez...' } }

          const retryDelays = [5_000, 10_000, 20_000]
          let retrySucceeded = false

          for (const delay of retryDelays) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              stream = await gateway.stream('main-chat', {
                messages,
                tools: toolChoice === 'none' ? undefined : tools,
                toolChoice: toolChoice === 'none' ? undefined : toolChoice,
                overrideSystemPrompt: systemPrompt,
              })
              retrySucceeded = true
              break
            } catch (retryErr) {
              if (!(retryErr instanceof CircuitOpenError)) {
                throw retryErr
              }
              // CircuitOpenError — try next delay
            }
          }

          if (!retrySucceeded) {
            const errorId = logError({
              layer: 'orchestrator',
              category: 'circuit_open',
              message: 'All providers unavailable after queued retry',
              context: { conversationId: state.conversationId },
            })
            yield {
              event: 'error',
              data: {
                errorId,
                type: 'service_unavailable',
                message: 'Zeno este temporar indisponibil. Te rugăm să încerci din nou în câteva minute.',
                retryable: true,
              },
            }
            break
          }
        } else {
          throw err
        }
      }

      let roundContent = ''
      let roundToolCalls: ToolCall[] = []

      for await (const chunk of stream!) {
        if (chunk.type === 'content' && chunk.content) {
          roundContent += chunk.content
          yield { event: 'content', data: { text: chunk.content } }
        }
        if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          roundToolCalls = chunk.toolCalls
        }
        if (chunk.type === 'done' && chunk.usage) {
          state.totalInputTokens += chunk.usage.promptTokens
          state.totalOutputTokens += chunk.usage.completionTokens
        }
      }

      // If no tool calls, we have the final response
      if (roundToolCalls.length === 0) {
        finalContent += roundContent
        break
      }

      // Process tool calls
      finalContent += roundContent

      // Add the assistant message with tool calls
      const assistantMsg: Message = {
        role: 'assistant',
        content: roundContent || '',
        toolCalls: roundToolCalls,
      }
      messages.push(assistantMsg)

      // Partition tool calls into execution groups
      const { readOnly, writing, background } = partitionToolCalls(roundToolCalls)

      // Results map to preserve original order for message history
      const resultMap = new Map<string, { pipelineResult: PipelineResult; def: ReturnType<typeof getToolDefinition> }>()

      // --- Phase 0: Fire-and-forget background tools ---
      for (const tc of background) {
        void executeToolWithPipeline(
          tc.name,
          tc.arguments,
          toolContext,
          toolContext.workflowSession
            ? {
                id: toolContext.workflowSession.id,
                currentStepId: toolContext.workflowSession.currentStepId,
                workflowId: toolContext.workflowSession.workflowId,
              }
            : null,
        ).catch((err: unknown) => logError({
          layer: 'orchestrator',
          category: 'background_tool',
          message: 'Background tool execution failed',
          context: { conversationId: state.conversationId, tool: tc.name },
          error: err,
        }))

        resultMap.set(tc.id, {
          pipelineResult: { toolResult: { success: true, message: 'Processing in background.' } },
          def: getToolDefinition(tc.name),
        })
      }

      // --- Phase 1: Execute read-only tools in parallel ---
      if (readOnly.length > 0) {
        for (const tc of readOnly) {
          const def = getToolDefinition(tc.name)
          if (def?.executionMode === 'blocking' && def?.statusMessage) {
            const status = pickStatusMessage(def.statusMessage, state.language, lastStatusMessage)
            if (status) {
              lastStatusMessage = status
              yield { event: 'tool_start', data: { tool: tc.name, status } }
            }
          }
        }

        const parallelResults = await Promise.all(
          readOnly.map(async (tc) => {
            try {
              return await executeToolWithPipeline(
                tc.name,
                tc.arguments,
                toolContext,
                toolContext.workflowSession
                  ? {
                      id: toolContext.workflowSession.id,
                      currentStepId: toolContext.workflowSession.currentStepId,
                      workflowId: toolContext.workflowSession.workflowId,
                    }
                  : null,
              )
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
              return { toolResult: { success: false, error: errMsg } } as PipelineResult
            }
          }),
        )

        for (let i = 0; i < readOnly.length; i++) {
          const tc = readOnly[i]
          const pipelineResult = parallelResults[i]
          const def = getToolDefinition(tc.name)
          resultMap.set(tc.id, { pipelineResult, def })

          if (def?.executionMode === 'blocking') {
            yield {
              event: 'tool_complete',
              data: { tool: tc.name, success: pipelineResult.toolResult.success },
            }
          }
        }
      }

      // --- Phase 2: Execute writing tools sequentially ---
      let transitionOccurred = false

      for (const tc of writing) {
        const def = getToolDefinition(tc.name)
        const isBlocking = def?.executionMode === 'blocking'

        if (isBlocking && def?.statusMessage) {
          const status = pickStatusMessage(def.statusMessage, state.language, lastStatusMessage)
          if (status) {
            lastStatusMessage = status
            yield { event: 'tool_start', data: { tool: tc.name, status } }
          }
        }

        let pipelineResult: PipelineResult
        try {
          pipelineResult = await executeToolWithPipeline(
            tc.name,
            tc.arguments,
            toolContext,
            toolContext.workflowSession
              ? {
                  id: toolContext.workflowSession.id,
                  currentStepId: toolContext.workflowSession.currentStepId,
                  workflowId: toolContext.workflowSession.workflowId,
                }
              : null,
          )
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
          pipelineResult = {
            toolResult: { success: false, error: errMsg },
          }
        }

        resultMap.set(tc.id, { pipelineResult, def })

        if (isBlocking) {
          yield {
            event: 'tool_complete',
            data: { tool: tc.name, success: pipelineResult.toolResult.success },
          }
        }

        if (pipelineResult.transition) {
          transitionOccurred = true
        }
      }

      // --- Emit results in original tool call order ---
      for (const tc of roundToolCalls) {
        const entry = resultMap.get(tc.id)
        if (!entry) continue

        const { pipelineResult } = entry

        if (pipelineResult.toolResult.uiAction) {
          yield {
            event: 'ui_action',
            data: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown>,
          }
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify({
            success: pipelineResult.toolResult.success,
            data: pipelineResult.toolResult.data,
            error: pipelineResult.toolResult.error,
            message: pipelineResult.toolResult.message,
          }),
          toolCallId: tc.id,
        })

        if (pipelineResult.transition) {
          const trParts = [
            `[Workflow Transition]`,
            `Previous step: "${pipelineResult.transition.previousStepCode}"`,
            `New step: "${pipelineResult.transition.newStepName}"`,
          ]
          if (pipelineResult.transition.newStepInstructions) {
            trParts.push(`\nNew step instructions:\n${pipelineResult.transition.newStepInstructions}`)
          }
          if (pipelineResult.transition.newStepAutoTool) {
            trParts.push(`\nYou should now call: ${pipelineResult.transition.newStepAutoTool}`)
          } else {
            trParts.push(`\nThis is an interactive step — follow the instructions above.`)
          }
          messages.push({ role: 'system', content: trParts.join('\n') })
        }
      }

      // Refresh tool context after tool executions (state may have changed)
      if (transitionOccurred) {
        toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
      }

      round++
    }
  }

  state.phases['step7_llm_tools'] = Date.now() - step7Start

  // =============================================
  // STEP 8 — Save assistant message
  // =============================================
  const step8Start = Date.now()

  try {
    const assistantRecord = await prisma.message.create({
      data: {
        conversationId: state.conversationId,
        role: 'assistant',
        content: finalContent,
        tokenCount: state.totalOutputTokens || null,
      },
    })

    await prisma.conversation.update({
      where: { id: state.conversationId },
      data: {
        messageCount: { increment: 1 },
        lastActivityAt: new Date(),
      },
    })
    state.messageCount += 1
    state.savedMessageId = assistantRecord.id
  } catch (err) {
    logError({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Failed to save assistant message',
      context: { conversationId: state.conversationId },
      error: err,
    })
    // Don't yield error — response already streamed to user
  }
  state.phases['step8_save_assistant'] = Date.now() - step8Start

  // =============================================
  // STEP 9 — Background agents (fire-and-forget)
  // =============================================
  const step9Start = Date.now()

  // Profile extractor: detect potential personal info (Romanian and English patterns)
  const hasPersonalInfo = /\b(ani|varsta|vârstă|copil|copii|soț|soție|sot|sotie|lucrez|căsătorit|casatorit|familie|venit|salariu|\d{13})\b/i.test(input.message)
  if (hasPersonalInfo) {
    void (async () => {
      try {
        const response = await gateway.call('profile-extractor', {
          messages: [{ role: 'user' as const, content: input.message }],
        })
        if (response.content) {
          const extracted = JSON.parse(response.content) as Record<string, unknown>
          const current = await prisma.customer.findUnique({
            where: { id: state.customerId },
            select: { extractedProfile: true },
          })
          const currentProfile = (current?.extractedProfile as Record<string, unknown>) ?? {}
          const merged = { ...currentProfile, ...extracted }
          await prisma.customer.update({
            where: { id: state.customerId },
            data: { extractedProfile: merged as unknown as Record<string, string | number | boolean | null> },
          })

          // Write insights to CustomerInsight table
          for (const [key, value] of Object.entries(extracted)) {
            if (value == null) continue
            const category = categorizeInsight(key)
            await prisma.customerInsight.upsert({
              where: {
                customerId_key: {
                  customerId: state.customerId,
                  key,
                },
              },
              update: {
                value: String(value),
                lastConfirmedAt: new Date(),
              },
              create: {
                customerId: state.customerId,
                category,
                key,
                value: String(value),
                confidence: 0.6,
                source: state.conversationId,
              },
            })
          }
        }
      } catch (e) {
        logError({
          layer: 'orchestrator',
          category: 'profile_extractor',
          message: 'Profile extractor failed',
          context: { customerId: state.customerId, conversationId: state.conversationId },
          error: e,
        })
      }
    })()
  }

  // Summarizer: handled by buildSlidingWindow (step 5) — no separate trigger needed

  state.phases['step9_background'] = Date.now() - step9Start

  // =============================================
  // STEP 10 — Turn trace (fire-and-forget)
  // =============================================
  const latencyMs = Date.now() - state.startMs

  // Enrich phases with prompt assembly metadata
  state.phases['promptAssembly'] = {
    sectionSizes: buildResult.sectionSizes,
    gateActive: buildResult.gateActive,
    gateComplexity: gateOutput?.complexity ?? null,
    fastPath: gateSelection === FAST_PATH_GATE,
    includedSections: buildResult.includedSections,
    excludedSections: buildResult.excludedSections,
  }

  void prisma.turnTrace.create({
    data: {
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      phases: JSON.parse(JSON.stringify(state.phases)),
      inputTokens: state.totalInputTokens || null,
      outputTokens: state.totalOutputTokens || null,
      cost: null, // Cost calculation deferred to tracing layer
      latencyMs,
      provider: state.provider,
      model: state.model,
    },
  }).catch((err: unknown) => {
    logError({
      layer: 'orchestrator',
      category: 'turn_trace',
      message: 'TurnTrace write error',
      context: { conversationId: state.conversationId },
      error: err,
    })
  })

  // =============================================
  // DONE
  // =============================================
  yield {
    event: 'done',
    data: {
      messageId: state.savedMessageId,
      conversationId: state.conversationId,
      customerId: state.customerId,
      tokens: {
        input: state.totalInputTokens,
        output: state.totalOutputTokens,
      },
      latencyMs,
    },
  }
}

// ==============================================
// HELPERS
// ==============================================

function categorizeInsight(key: string): 'DEMOGRAPHIC' | 'PREFERENCE' | 'OBJECTION_PATTERN' | 'BUYING_SIGNAL' | 'RISK_FACTOR' {
  const demographics = ['age', 'occupation', 'income', 'education', 'familySize', 'hasSpouse', 'hasChildren', 'minorChildren']
  const buyingSignals = ['urgency', 'motivation', 'readiness', 'interests']
  const riskFactors = ['health', 'smoking', 'hazardous']

  if (demographics.includes(key)) return 'DEMOGRAPHIC'
  if (buyingSignals.includes(key)) return 'BUYING_SIGNAL'
  if (riskFactors.includes(key)) return 'RISK_FACTOR'
  return 'PREFERENCE'
}
