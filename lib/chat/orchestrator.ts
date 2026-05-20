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
import { buildPrompt, detectFastPath, FAST_PATH_GATE, type GateSelection, type PromptSections } from './prompt-builder'
import { executeReasoningGate, formatGateBriefing, type ReasoningGateInput, type ReasoningGateOutput } from './reasoning-gate'
import { buildSlidingWindow, updateSummaryIfStale } from './sliding-window'
import { loadAllSections, type WorkflowSessionData } from './context-loaders'
import { withDefaultDiscoveryTools } from './default-tools'
import { loadTurnContext, type TurnContext } from './turn-context'
import { resolveAgent } from './agent-resolver'
import { getActiveSkillPacks, mergeSkillPackSections, computeAllowedTools } from '@/lib/skills/skill-pack-loader'
import { executeComplianceCheck, type ComplianceCheckResult } from './compliance-checker'
import { trackChatStarted } from '@/lib/analytics/events'
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'
import { compactMessages } from '@/lib/chat/compaction'
import { isContextLengthError, parseTokenDeficit } from '@/lib/llm/errors'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'
import { extractAndPersistInsights } from '@/lib/insights/extractor'
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'
import { eventBus, initObservability, getTurnCost, getTurnAnomalies } from '@/lib/events'
import { applyABTestVariant } from '@/lib/self-improvement/ab-test-assigner'
import { debugYield, isDev } from './debug'

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
  debugEnabled?: boolean
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
  traceId: string
  phases: Record<string, unknown>
  conversationMode: string
  activeSkillPacks: string[]
  complianceResult: ComplianceCheckResult | null
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
  initObservability()

  const debugEnabled = input.debugEnabled === true

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
    traceId: crypto.randomUUID(),
    phases: {},
    conversationMode: 'SALES',
    activeSkillPacks: [],
    complianceResult: null,
  }

  eventBus.emit({
    type: 'turn:start',
    traceId: state.traceId,
    conversationId: state.conversationId,
    messageIndex: state.messageCount,
    timestamp: state.startMs,
  })

  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:turn_start',
    data: {
      traceId: state.traceId,
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      userMessage: input.message,
      language: state.language,
    },
  })

  // =============================================
  // STEP 1 — Resolve conversation
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'resolve', timestamp: Date.now() })
  const step1Start = Date.now()

  const resolveConversation = async (): Promise<TurnContext> => {
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

    return loadTurnContext(state.conversationId, state.customerId)
  }

  let turnCtx: TurnContext
  try {
    turnCtx = await resolveConversation()
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
  if (turnCtx.conversation.status === 'COMPLETED' || turnCtx.conversation.status === 'ABANDONED') {
    throw new Error(`Conversation ${state.conversationId} is ${turnCtx.conversation.status}`)
  }

  // Guard: must have content
  if (!input.message && !input.syntheticToolCall) {
    throw new Error('Either message or syntheticToolCall is required')
  }

  state.messageCount = turnCtx.conversation.messageCount
  state.productId = turnCtx.conversation.productId
  state.workflowSessionId = turnCtx.conversation.workflowSession?.id ?? null
  state.workflowStepCode = turnCtx.conversation.workflowSession?.currentStep.code ?? null
  state.conversationMode = turnCtx.conversation.mode ?? 'SALES'
  state.activeSkillPacks = turnCtx.conversation.activeSkillPacks ?? []
  state.phases['step1_resolve'] = Date.now() - step1Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'resolve', durationMs: Date.now() - step1Start })

  // =============================================
  // STEP 2 — Save user message
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'save_user', timestamp: Date.now() })
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
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'save_user', durationMs: Date.now() - step2Start })

  // =============================================
  // STEPS 3+4 — Reasoning gate + Context assembly (parallel)
  // =============================================

  // Determine if fast path applies
  const hasActiveQuestionnaire = !!(state.workflowStepCode &&
    (['dnt_questionnaire', 'application_fill'].includes(state.workflowStepCode) ||
      state.workflowStepCode.includes('bd')))

  // Determine allowed tools for this step (hoisted for use in gate + skill pack scoping).
  // DEFAULT_DISCOVERY_TOOLS are merged in as a baseline so the agent always has
  // catalog tools during the pre-workflow discovery phase. See
  // docs/superpowers/specs/2026-05-20-zeno-discovery-toolset-design.md.
  const stepAllowedTools = withDefaultDiscoveryTools(
    turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? [],
  )

  // --- gatePromise: Step 3 — Reasoning gate ---
  const gatePromise = (async (): Promise<{
    gateOutput: ReasoningGateOutput | null
    gateSelection: GateSelection
    gateDebug: {
      skipped: boolean
      reason?: 'fast_path' | 'synthetic'
      input?: ReasoningGateInput
      output?: ReasoningGateOutput
      durationMs: number
    }
  }> => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'reasoning_gate', timestamp: Date.now() })
    const gatePhaseStart = Date.now()

    let gateOutput: ReasoningGateOutput | null = null
    let gateSelection: GateSelection
    let gateDebug: {
      skipped: boolean
      reason?: 'fast_path' | 'synthetic'
      input?: ReasoningGateInput
      output?: ReasoningGateOutput
      durationMs: number
    }

    if (detectFastPath(input.message, hasActiveQuestionnaire) && !input.syntheticToolCall) {
      // Fast path: skip reasoning gate
      gateSelection = FAST_PATH_GATE
      state.phases['reasoningGate'] = { skipped: true, fastPath: true, durationMs: 0 }
      gateDebug = {
        skipped: true,
        reason: 'fast_path',
        durationMs: 0,
      }
    } else if (input.syntheticToolCall) {
      // Synthetic tool call: skip gate
      gateSelection = { requiredSections: [], excludedSections: [], confidence: 0 }
      state.phases['reasoningGate'] = { skipped: true, syntheticAction: true, durationMs: 0 }
      gateDebug = {
        skipped: true,
        reason: 'synthetic',
        durationMs: 0,
      }
    } else {
      // Full reasoning gate — read from turnCtx instead of querying DB
      const gateStart = Date.now()
      let gateInput: ReasoningGateInput | undefined

      try {
        // Recent messages from turnCtx (already chronological)
        const last3Messages = turnCtx.recentMessages
          .slice(-3)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 300) }))

        // Customer profile from turnCtx
        const extractedProfile = turnCtx.customer.extractedProfile
        const customerAge = turnCtx.customer.dateOfBirth
          ? Math.floor((Date.now() - turnCtx.customer.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
          : null

        // Application from turnCtx
        const application = turnCtx.conversation.application

        // Skill packs from turnCtx
        const allSkillPacks = turnCtx.activeSkillPacks

        // Available tools: filter by workflow step's allowed tools if applicable
        const gateStepTools = turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? []
        const availableToolDefs = getToolsForLLM(gateStepTools.length > 0 ? gateStepTools : undefined)
        const availableToolNames = availableToolDefs.map((t) => t.function.name)

        // Current questionnaire question text (for gate context)
        const currentQuestionText: string | null = null
        // We'll leave this null since loading questionnaire context is handled in context assembly

        gateInput = {
          lastUserMessage: input.message,
          last3Messages,
          hasActiveQuestionnaire,
          currentQuestionText,
          workflowStepCode: state.workflowStepCode,
          availableTools: availableToolNames,
          customerProfile: {
            name: turnCtx.customer.name ?? null,
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
            selectedProduct: turnCtx.conversation.product?.id ?? null,
            dntProgress: null, // Simplified: DNT progress tracked via questionnaire
            applicationProgress: application
              ? `${application.currentQuestionIndex}/${application.totalQuestions} (${application.status})`
              : null,
            hasQuote: !!application?.quote,
            quoteValue: application?.quote?.premiumAnnual ?? null,
            hasPolicy: !!application?.quote?.policy,
          },
          currentMode: state.conversationMode,
          availableSkillPacks: allSkillPacks,
          activeSkillPacks: state.activeSkillPacks,
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

      gateDebug = {
        skipped: false,
        input: gateInput,
        output: gateOutput ?? undefined,
        durationMs: Date.now() - gateStart,
      }
    }

    state.phases['step3_reasoning_gate'] = Date.now() - gatePhaseStart
    eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs: Date.now() - gatePhaseStart })

    return { gateOutput, gateSelection, gateDebug }
  })()

  // --- contextPromise: Step 4 — Context assembly (without situationalBriefing, patched after gate) ---
  const contextPromise = (async () => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'context', timestamp: Date.now() })
    const ctxPhaseStart = Date.now()

    const agentSlug = resolveAgent(state.conversationMode)
    const agentConfig = await getAgentConfig(agentSlug)

    let sections: Awaited<ReturnType<typeof loadAllSections>>
    try {
      // Build WorkflowSessionData from turnCtx
      const workflowSessionData: WorkflowSessionData | null = turnCtx.conversation.workflowSession
        ? {
            currentStepCode: turnCtx.conversation.workflowSession.currentStep.code,
            currentStepName: turnCtx.conversation.workflowSession.currentStep.name,
            agentInstructions: turnCtx.conversation.workflowSession.currentStep.agentInstructions,
            allowedTools: turnCtx.conversation.workflowSession.currentStep.allowedTools,
            data: turnCtx.conversation.workflowSession.data,
          }
        : null

      sections = await loadAllSections({
        agentConfig: { systemPrompt: agentConfig.systemPrompt, constraints: agentConfig.constraints },
        allowedTools: stepAllowedTools,
        productId: state.productId,
        conversationId: state.conversationId,
        customerId: state.customerId,
        workflowSession: workflowSessionData,
        workflowStepCode: state.workflowStepCode,
        situationalBriefing: null, // patched after gate completes
        language: state.language,
        prefetchedCustomer: turnCtx.customer,
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
        complianceGuidance: null,
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

    state.phases['step4_context'] = Date.now() - ctxPhaseStart
    eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'context', durationMs: Date.now() - ctxPhaseStart })

    return { agentSlug, agentConfig, sections }
  })()

  // --- Await both in parallel ---
  const [gateResult, contextResult] = await Promise.all([gatePromise, contextPromise])

  const { gateOutput, gateSelection } = gateResult
  const { agentSlug, agentConfig, sections } = contextResult

  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:gate',
    data: { ...gateResult.gateDebug, traceId: state.traceId },
  })

  // Patch situationalBriefing from gate output
  const situationalBriefing = gateOutput ? formatGateBriefing(gateOutput) : null
  sections.situationalBriefing = situationalBriefing

  // --- Skill pack loading and merging ---
  const recommendedSlugs = gateOutput?.recommendedSkillPacks ?? []
  const activePacks = recommendedSlugs.length > 0
    ? await getActiveSkillPacks(recommendedSlugs)
    : []

  state.activeSkillPacks = activePacks.map((p) => p.slug)

  if (state.activeSkillPacks.length > 0) {
    eventBus.emit({
      type: 'skillpack:activated',
      traceId: state.traceId,
      slugs: state.activeSkillPacks,
      conversationId: state.conversationId,
    })
  }

  // A/B test variant assignment — may swap skill pack slugs
  let effectivePacks = activePacks
  if (state.activeSkillPacks.length > 0) {
    const originalSlugs = state.activeSkillPacks
    state.activeSkillPacks = await applyABTestVariant(
      state.activeSkillPacks,
      state.conversationId,
    )
    // Reload packs if A/B test swapped any slugs
    const slugsChanged = originalSlugs.length !== state.activeSkillPacks.length ||
      originalSlugs.some((s, i) => s !== state.activeSkillPacks[i])
    if (slugsChanged) {
      effectivePacks = await getActiveSkillPacks(state.activeSkillPacks)
    }
  }

  // Merge skill pack sections into base sections
  const mergedSections: PromptSections = effectivePacks.length > 0
    ? mergeSkillPackSections(sections as unknown as Record<string, string | null>, effectivePacks) as unknown as PromptSections
    : sections

  // --- Mode transition from gate output ---
  if (
    gateOutput?.modeTransition &&
    gateOutput.confidence > 0.7 &&
    gateOutput.modeTransition !== state.conversationMode
  ) {
    const previousMode = state.conversationMode
    state.conversationMode = gateOutput.modeTransition
    await prisma.conversation.update({
      where: { id: state.conversationId },
      data: { mode: gateOutput.modeTransition },
    })
    eventBus.emit({
      type: 'mode:transition',
      traceId: state.traceId,
      from: previousMode,
      to: state.conversationMode,
      conversationId: state.conversationId,
    })
  }

  // --- Conditional compliance check ---
  if (gateOutput?.complianceRelevant) {
    // Use recent messages from turnCtx instead of querying DB again
    const complianceMessages: Message[] = turnCtx.recentMessages
      .slice(-10)
      .map((m) => ({ role: m.role as Message['role'], content: m.content }))

    try {
      const complianceResult = await executeComplianceCheck({
        messages: complianceMessages,
        workflowStepCode: state.workflowStepCode,
        customerProfile: null,
      })
      state.complianceResult = complianceResult
      if (!complianceResult.passed && complianceResult.gaps.length > 0) {
        const guidanceText = [
          '[COMPLIANCE GUIDANCE - Address before responding]',
          'The following compliance gaps were detected:',
          ...complianceResult.gaps.map((g) => `- ${g}`),
          '',
          'Suggested actions:',
          ...complianceResult.suggestions.map((s) => `- ${s}`),
        ].join('\n')
        mergedSections.complianceGuidance = guidanceText
      }
    } catch {
      state.complianceResult = { passed: true, gaps: [], suggestions: [] }
    }
  }

  if (state.complianceResult) {
    eventBus.emit({
      type: 'compliance:result',
      traceId: state.traceId,
      passed: state.complianceResult.passed,
      gaps: state.complianceResult.gaps ?? [],
      conversationId: state.conversationId,
    })
  }

  state.provider = agentConfig.provider
  state.model = agentConfig.model

  // Build prompt — needed for token budget calculation
  const buildResult = buildPrompt(mergedSections, gateSelection)
  const { prompt: systemPrompt } = buildResult

  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:prompt',
    data: {
      sections: mergedSections,
      sectionSizes: buildResult.sectionSizes,
      includedSections: buildResult.includedSections,
      excludedSections: buildResult.excludedSections,
      gateActive: buildResult.gateActive,
      stablePrefix: buildResult.stablePrefix ?? null,
      dynamicSuffix: buildResult.dynamicSuffix ?? null,
      totalChars: (buildResult.stablePrefix?.length ?? 0) + (buildResult.dynamicSuffix?.length ?? 0),
      traceId: state.traceId,
    },
  })

  // =============================================
  // STEP 4b — Calculate token budget
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'token_budget', timestamp: Date.now() })
  const step4bStart = Date.now()
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

  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'token_budget', durationMs: Date.now() - step4bStart })

  // =============================================
  // STEP 5 — Sliding window
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'sliding_window', timestamp: Date.now() })
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
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'sliding_window', durationMs: Date.now() - step5Start })

  // =============================================
  // STEP 6 — Build messages array
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'build_messages', timestamp: Date.now() })
  const step6Start = Date.now()

  const messages: Message[] = []
  if (buildResult.stablePrefix) {
    messages.push({ role: 'system' as const, content: buildResult.stablePrefix, cacheHint: { breakpoint: 'ephemeral' } })
  }
  if (buildResult.dynamicSuffix) {
    messages.push({ role: 'system' as const, content: buildResult.dynamicSuffix })
  }
  if (summaryPrefix) {
    messages.push({
      role: 'system' as const,
      content: `[Previous conversation summary]\n${summaryPrefix}\n[End of summary — recent messages follow]`,
    })
  }
  messages.push(...windowMessages)
  messages.push({ role: 'user' as const, content: input.message })

  state.phases['step6_build_messages'] = Date.now() - step6Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'build_messages', durationMs: Date.now() - step6Start })

  // =============================================
  // STEP 7 — Main LLM call + tool loop
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'llm_tools', timestamp: Date.now() })
  const step7Start = Date.now()

  let toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
  const effectiveTools = effectivePacks.length > 0
    ? computeAllowedTools(stepAllowedTools, effectivePacks)
    : stepAllowedTools
  const tools: LLMToolDefinition[] = getToolsForLLM(effectiveTools.length > 0 ? effectiveTools : undefined)
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

    yield* debugYield(isDev(), debugEnabled, {
      event: 'debug:tool_call',
      data: {
        round: 0,
        toolCallId: tc.id,
        name: tc.name,
        args: tc.arguments,
        partition: def?.executionMode === 'background'
          ? 'background'
          : def?.sideEffects === false
            ? 'readOnly'
            : 'writing',
        traceId: state.traceId,
      },
    })

    const synthStart = Date.now()

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
      state.traceId,
    )

    yield* debugYield(isDev(), debugEnabled, {
      event: 'debug:tool_result',
      data: {
        toolCallId: tc.id,
        success: pipelineResult.toolResult.success,
        durationMs: Date.now() - synthStart,
        cached: false,
        data: pipelineResult.toolResult.data,
        error: pipelineResult.toolResult.error,
        uiAction: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown> | undefined,
        transition: pipelineResult.transition as unknown as Record<string, unknown> | undefined,
        traceId: state.traceId,
      },
    })

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
    const responseStream = await gateway.stream(agentSlug, {
      messages,
      traceId: state.traceId,
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
        stream = await gateway.stream(agentSlug, {
          messages,
          tools: toolChoice === 'none' ? undefined : tools,
          toolChoice: toolChoice === 'none' ? undefined : toolChoice,
          traceId: state.traceId,
        })
      } catch (err) {
        if (round === 0 && isContextLengthError(err)) {
          // Reactive compaction: compress and retry once
          const deficit = parseTokenDeficit(err) ?? 2000
          const compactedMessages = await compactMessages(messages, deficit, state.conversationId)
          messages.length = 0
          messages.push(...compactedMessages)
          state.phases['reactiveCompaction'] = { deficit, originalLength: messages.length }

          stream = await gateway.stream(agentSlug, {
            messages,
            tools: toolChoice === 'none' ? undefined : tools,
            toolChoice: toolChoice === 'none' ? undefined : toolChoice,
            traceId: state.traceId,
          })
        } else if (err instanceof CircuitOpenError) {
          // Queued retry with backoff: 5s, 10s, 20s
          yield { event: 'status', data: { type: 'processing', message: 'Un moment, reconectez...' } }

          const retryDelays = [5_000, 10_000, 20_000]
          let retrySucceeded = false

          for (const delay of retryDelays) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              stream = await gateway.stream(agentSlug, {
                messages,
                tools: toolChoice === 'none' ? undefined : tools,
                toolChoice: toolChoice === 'none' ? undefined : toolChoice,
                traceId: state.traceId,
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
        yield* debugYield(isDev(), debugEnabled, {
          event: 'debug:tool_call',
          data: {
            round,
            toolCallId: tc.id,
            name: tc.name,
            args: tc.arguments,
            partition: 'background',
            traceId: state.traceId,
          },
        })

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
          state.traceId,
        ).catch((err: unknown) => logError({
          layer: 'orchestrator',
          category: 'background_tool',
          message: 'Background tool execution failed',
          context: { conversationId: state.conversationId, tool: tc.name },
          error: err,
        }))

        yield* debugYield(isDev(), debugEnabled, {
          event: 'debug:tool_result',
          data: {
            toolCallId: tc.id,
            success: true,
            durationMs: 0,
            cached: false,
            data: { backgroundFireAndForget: true },
            traceId: state.traceId,
          },
        })

        resultMap.set(tc.id, {
          pipelineResult: { toolResult: { success: true, message: 'Processing in background.' } },
          def: getToolDefinition(tc.name),
        })
      }

      // --- Phase 1: Execute read-only tools in parallel ---
      if (readOnly.length > 0) {
        for (const tc of readOnly) {
          yield* debugYield(isDev(), debugEnabled, {
            event: 'debug:tool_call',
            data: {
              round,
              toolCallId: tc.id,
              name: tc.name,
              args: tc.arguments,
              partition: 'readOnly',
              traceId: state.traceId,
            },
          })
        }

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
                state.traceId,
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

          yield* debugYield(isDev(), debugEnabled, {
            event: 'debug:tool_result',
            data: {
              toolCallId: tc.id,
              success: pipelineResult.toolResult.success,
              durationMs: 0,
              cached: false,
              data: pipelineResult.toolResult.data,
              error: pipelineResult.toolResult.error,
              uiAction: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown> | undefined,
              transition: pipelineResult.transition as unknown as Record<string, unknown> | undefined,
              traceId: state.traceId,
            },
          })

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

        yield* debugYield(isDev(), debugEnabled, {
          event: 'debug:tool_call',
          data: {
            round,
            toolCallId: tc.id,
            name: tc.name,
            args: tc.arguments,
            partition: 'writing',
            traceId: state.traceId,
          },
        })

        const writeStart = Date.now()

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
            state.traceId,
          )
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Tool execution failed'
          pipelineResult = {
            toolResult: { success: false, error: errMsg },
          }
        }

        resultMap.set(tc.id, { pipelineResult, def })

        yield* debugYield(isDev(), debugEnabled, {
          event: 'debug:tool_result',
          data: {
            toolCallId: tc.id,
            success: pipelineResult.toolResult.success,
            durationMs: Date.now() - writeStart,
            cached: false,
            data: pipelineResult.toolResult.data,
            error: pipelineResult.toolResult.error,
            uiAction: pipelineResult.toolResult.uiAction as unknown as Record<string, unknown> | undefined,
            transition: pipelineResult.transition as unknown as Record<string, unknown> | undefined,
            traceId: state.traceId,
          },
        })

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
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'llm_tools', durationMs: Date.now() - step7Start })

  // =============================================
  // STEP 8 — Save assistant message
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'save_assistant', timestamp: Date.now() })
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
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'save_assistant', durationMs: Date.now() - step8Start })

  // =============================================
  // STEP 9 — Background agents (fire-and-forget)
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'background', timestamp: Date.now() })
  const step9Start = Date.now()

  // Profile extractor: closed-vocabulary insight extraction (fire-and-forget)
  void extractAndPersistInsights({
    message: input.message,
    customerId: state.customerId,
    conversationId: state.conversationId,
    productId: state.productId,
    mode: state.conversationMode,
    traceId: state.traceId,
  }).catch((err: unknown) =>
    logError({
      layer: 'orchestrator',
      category: 'extract_insights',
      message: 'extractAndPersistInsights threw',
      context: { customerId: state.customerId, conversationId: state.conversationId },
      error: err,
    }),
  )

  // Proactive summary refresh: keep summary warm for next turn
  void updateSummaryIfStale(state.conversationId, state.messageCount).catch((err: unknown) =>
    logWarn({
      layer: 'orchestrator',
      category: 'summary',
      message: 'Proactive summary refresh failed',
      context: { conversationId: state.conversationId },
      error: err,
    }),
  )

  state.phases['step9_background'] = Date.now() - step9Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'background', durationMs: Date.now() - step9Start })

  // Persist active skill packs on conversation
  await prisma.conversation.update({
    where: { id: state.conversationId },
    data: { activeSkillPacks: state.activeSkillPacks },
  })

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

  // Agent extensibility trace metadata
  state.phases['agentExtensibility'] = {
    activeSkillPacks: state.activeSkillPacks,
    conversationMode: state.conversationMode,
    complianceResult: state.complianceResult,
  }

  void prisma.turnTrace.create({
    data: {
      conversationId: state.conversationId,
      messageIndex: state.messageCount,
      phases: JSON.parse(JSON.stringify(state.phases)),
      inputTokens: state.totalInputTokens || null,
      outputTokens: state.totalOutputTokens || null,
      cost: getTurnCost(state.traceId),
      latencyMs,
      provider: state.provider,
      model: state.model,
      anomalies: getTurnAnomalies(state.traceId).length > 0
        ? JSON.parse(JSON.stringify(getTurnAnomalies(state.traceId)))
        : undefined,
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

  eventBus.emit({
    type: 'turn:end',
    traceId: state.traceId,
    conversationId: state.conversationId,
    cost: getTurnCost(state.traceId),
    latencyMs,
    anomalies: getTurnAnomalies(state.traceId),
  })

  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:turn_end',
    data: {
      traceId: state.traceId,
      phases: state.phases,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
      cost: getTurnCost(state.traceId),
      latencyMs,
      anomalies: getTurnAnomalies(state.traceId),
    },
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

