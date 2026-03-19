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
  StreamChunk,
  LLMToolDefinition,
} from '@/lib/llm/providers/types'
import { getToolDefinition, getToolsForLLM } from '@/lib/tools/registry'
import { executeToolWithPipeline } from '@/lib/tools/pipeline'
import { buildToolContext } from './context-builder'
import { createSSEStream, pickStatusMessage, type SSEEvent } from './stream-handler'
import type { ToolContext, PipelineResult } from '@/lib/tools/types'

// ==============================================
// CONSTANTS
// ==============================================

const MAX_TOOL_ROUNDS = 5
const SLIDING_WINDOW_SIZE = 20
const REASONING_GATE_MESSAGES = 3

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
  savedMessageId: string | null
  totalInputTokens: number
  totalOutputTokens: number
  provider: string | null
  model: string | null
  startMs: number
  phases: Record<string, number>
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

  if (!state.customerId) {
    const customer = await prisma.customer.create({
      data: { isAnonymous: true, language: state.language },
    })
    state.customerId = customer.id
  }

  if (!state.conversationId) {
    const conversation = await prisma.conversation.create({
      data: {
        customerId: state.customerId,
        language: state.language,
        channel: 'web',
      },
    })
    state.conversationId = conversation.id
  }

  // Load conversation state
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: state.conversationId },
    include: {
      product: { select: { id: true } },
      workflowSession: {
        include: {
          currentStep: {
            select: {
              id: true,
              code: true,
              agentInstructions: true,
              allowedTools: true,
              autoTool: true,
            },
          },
        },
      },
    },
  })

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
  state.phases['step1_resolve'] = Date.now() - step1Start

  // =============================================
  // STEP 2 — Save user message
  // =============================================
  const step2Start = Date.now()

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
  state.phases['step2_save_user'] = Date.now() - step2Start

  // =============================================
  // STEP 3 — Reasoning gate (skip for synthetic tool calls)
  // =============================================
  const step3Start = Date.now()

  let gateResult: {
    complexity: string
    briefing: string
    requiredSections: string[]
    toolGuidance: string
  } = {
    complexity: 'moderate',
    briefing: '',
    requiredSections: [],
    toolGuidance: '',
  }

  if (!input.syntheticToolCall) {
    try {
      // Load recent messages for context
      const recentMsgs = await prisma.message.findMany({
        where: { conversationId: state.conversationId },
        orderBy: { createdAt: 'desc' },
        take: REASONING_GATE_MESSAGES,
        select: { role: true, content: true },
      })

      const recentContext = recentMsgs
        .reverse()
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join('\n')

      const workflowInfo = conversation.workflowSession
        ? `Workflow step: ${conversation.workflowSession.currentStep.code}`
        : 'No active workflow'

      const availableToolNames = getToolsForLLM()
        .map((t) => t.function.name)
        .join(', ')

      const contextPrompt = [
        `Recent conversation:\n${recentContext}`,
        `\nCurrent state: ${workflowInfo}`,
        `Available tools: ${availableToolNames}`,
        `\nUser message: ${input.message}`,
        `\nAnalyze this turn and respond with JSON:`,
        `{"complexity":"simple"|"moderate"|"complex","briefing":"<situational analysis for the main agent>","requiredSections":[],"toolGuidance":"<which tools to consider>"}`,
      ].join('\n')

      const gateResponse = await gateway.call('reasoning-gate', {
        messages: [{ role: 'user', content: contextPrompt }],
      })

      if (gateResponse.content) {
        // Extract JSON from the response (handle markdown code fences)
        const jsonMatch = gateResponse.content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
          gateResult = {
            complexity: typeof parsed.complexity === 'string' ? parsed.complexity : 'moderate',
            briefing: typeof parsed.briefing === 'string' ? parsed.briefing : '',
            requiredSections: Array.isArray(parsed.requiredSections)
              ? (parsed.requiredSections as string[])
              : [],
            toolGuidance: typeof parsed.toolGuidance === 'string' ? parsed.toolGuidance : '',
          }
        }
      }

      // Track usage
      state.totalInputTokens += gateResponse.usage.promptTokens
      state.totalOutputTokens += gateResponse.usage.completionTokens
    } catch (err: unknown) {
      // Reasoning gate failure is non-fatal: use defaults
      console.warn('[Orchestrator] Reasoning gate failed, using defaults:', err)
    }
  }

  state.phases['step3_reasoning_gate'] = Date.now() - step3Start

  // =============================================
  // STEP 4 — Context assembly
  // =============================================
  const step4Start = Date.now()

  const agentConfig = await getAgentConfig('main-chat')
  let systemPrompt = agentConfig.systemPrompt ?? ''

  // Append reasoning gate briefing
  if (gateResult.briefing) {
    systemPrompt += `\n\n=== SITUATIONAL ANALYSIS (${gateResult.complexity}) ===\n${gateResult.briefing}`
  }

  // Append tool guidance
  if (gateResult.toolGuidance) {
    systemPrompt += `\n\nTool guidance: ${gateResult.toolGuidance}`
  }

  // Append workflow step instructions
  if (conversation.workflowSession?.currentStep.agentInstructions) {
    systemPrompt += `\n\n=== CURRENT WORKFLOW STEP ===\n${conversation.workflowSession.currentStep.agentInstructions}`
  }

  state.provider = agentConfig.provider
  state.model = agentConfig.model
  state.phases['step4_context'] = Date.now() - step4Start

  // =============================================
  // STEP 5 — Sliding window
  // =============================================
  const step5Start = Date.now()

  const dbMessages = await prisma.message.findMany({
    where: { conversationId: state.conversationId },
    orderBy: { createdAt: 'asc' },
    take: SLIDING_WINDOW_SIZE,
    select: {
      role: true,
      content: true,
      toolCalls: true,
    },
  })

  // Use the DB ordering to get the latest N messages
  // (we ordered asc, so we need to get the tail if there are more)
  const windowMessages = dbMessages

  state.phases['step5_sliding_window'] = Date.now() - step5Start

  // =============================================
  // STEP 6 — Build messages array
  // =============================================
  const step6Start = Date.now()

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
  ]

  // Add history (excluding the user message we just saved, it goes at the end)
  for (const dbMsg of windowMessages) {
    if (dbMsg.role === 'user' || dbMsg.role === 'assistant') {
      const msg: Message = {
        role: dbMsg.role,
        content: dbMsg.content,
      }
      // Reconstruct toolCalls for assistant messages
      if (dbMsg.role === 'assistant' && dbMsg.toolCalls) {
        msg.toolCalls = dbMsg.toolCalls as unknown as ToolCall[]
      }
      messages.push(msg)
    } else if (dbMsg.role === 'tool') {
      messages.push({
        role: 'tool',
        content: dbMsg.content,
        toolCallId: (dbMsg.toolCalls as unknown as string) ?? undefined,
      })
    }
  }

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

      const stream = await gateway.stream('main-chat', {
        messages,
        tools: toolChoice === 'none' ? undefined : tools,
        toolChoice: toolChoice === 'none' ? undefined : toolChoice,
        overrideSystemPrompt: systemPrompt,
      })

      let roundContent = ''
      let roundToolCalls: ToolCall[] = []

      for await (const chunk of stream) {
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

      let transitionOccurred = false

      for (const tc of roundToolCalls) {
        const def = getToolDefinition(tc.name)
        const isBlocking = def?.executionMode === 'blocking'
        const isBackground = def?.executionMode === 'background'

        if (isBackground) {
          // Fire-and-forget for background tools
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
          ).catch((err: unknown) => console.error('[Orchestrator] Background tool error:', err))

          // Add a placeholder tool result so the LLM loop continues
          messages.push({
            role: 'tool',
            content: JSON.stringify({ success: true, message: 'Processing in background.' }),
            toolCallId: tc.id,
          })
          continue
        }

        // Blocking tool execution
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

        if (isBlocking) {
          yield {
            event: 'tool_complete',
            data: { tool: tc.name, success: pipelineResult.toolResult.success },
          }
        }

        if (pipelineResult.toolResult.uiAction) {
          yield {
            event: 'ui_action',
            data: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown>,
          }
        }

        // Add tool result message
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

        // Handle workflow transitions
        if (pipelineResult.transition) {
          transitionOccurred = true
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
  state.phases['step8_save_assistant'] = Date.now() - step8Start

  // =============================================
  // STEP 9 — Background agents (fire-and-forget)
  // =============================================
  const step9Start = Date.now()

  // Profile extractor: detect potential personal info
  const hasPersonalInfo = /\b(\d{2,}|ani?|years?\s+old|name|nume|v[aâ]rst[aă])\b/i.test(input.message)
  if (hasPersonalInfo) {
    void (async () => {
      try {
        await gateway.call('profile-extractor', {
          messages: [
            {
              role: 'user',
              content: `Extract profile information from this message. Customer ID: ${state.customerId}. Message: "${input.message}"`,
            },
          ],
        })
      } catch (err: unknown) {
        console.error('[Orchestrator] Profile extractor error:', err)
      }
    })()
  }

  // Summarizer: stub check (would create ConversationSummary)
  if (state.messageCount > 20) {
    void (async () => {
      try {
        const existing = await prisma.conversationSummary.findUnique({
          where: { conversationId: state.conversationId },
        })
        if (!existing) {
          // TODO: Implement summarizer agent call in future slice
          console.log(`[Orchestrator] Conversation ${state.conversationId} needs summarization (${state.messageCount} messages)`)
        }
      } catch (err: unknown) {
        console.error('[Orchestrator] Summarizer check error:', err)
      }
    })()
  }

  state.phases['step9_background'] = Date.now() - step9Start

  // =============================================
  // STEP 10 — Turn trace (fire-and-forget)
  // =============================================
  const latencyMs = Date.now() - state.startMs

  void prisma.turnTrace.create({
    data: {
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      phases: state.phases as unknown as Record<string, number>,
      inputTokens: state.totalInputTokens || null,
      outputTokens: state.totalOutputTokens || null,
      cost: null, // Cost calculation deferred to tracing layer
      latencyMs,
      provider: state.provider,
      model: state.model,
    },
  }).catch((err: unknown) => {
    console.error('[Orchestrator] TurnTrace write error:', err)
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
