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
import type { ToolContext, PipelineResult, ToolResult } from '@/lib/tools/types'
import { buildPrompt, type GateSelection, type PromptSections } from './prompt-builder'
import { getRequiredSectionsFor, formatDerivedBriefing } from './phase-sections-map'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose, engineVersion } from '@/lib/engines/derive-and-expose'
import type { DeriveAndExposeResult } from '@/lib/engines/domain-types'
import { buildSlidingWindow, updateSummaryIfStale } from './sliding-window'
import { loadAllSections, loadStateGrounding, loadCustomerInsights, type WorkflowSessionData, type StateGroundingInput, type RawCustomerInsight } from './context-loaders'
import { withDefaultDiscoveryTools } from './default-tools'
import { loadTurnContext, type TurnContext } from './turn-context'
import { getConversationPhase } from './phase'
import { inferCandidate, hasAnyCategoryKeyword } from './candidate-inference'
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
import { eventBus, initObservability, getTurnCost, getTurnAnomalies, getTurnToolHistory } from '@/lib/events'
import { validateSideEffectClaims } from './side-effect-validator'
import { detectToolNarration, type ToolNarrationResult } from './tool-narration-detector'
import { applyABTestVariant } from '@/lib/self-improvement/ab-test-assigner'
import { debugYield, isDev, buildIdentityPayload, recordDebugEvent, type DebugEvent, type DebugGatePayload } from './debug'
import { serializeToolResultForModel } from './tool-result-serializer'
import { persistTurnDebug } from './turn-debug-persistence'

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
  debugEvents: DebugEvent[]
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
    debugEvents: [],
  }

  // Records every debug event for DB persistence (always), then yields it to
  // the live SSE stream only when the debug gate is open. Single chokepoint so
  // the two concerns never drift apart.
  function* recordAndYield(event: DebugEvent): Generator<SSEEvent> {
    recordDebugEvent(state, event)
    yield* debugYield(isDev(), debugEnabled, event)
  }

  eventBus.emit({
    type: 'turn:start',
    traceId: state.traceId,
    conversationId: state.conversationId,
    messageIndex: state.messageCount,
    timestamp: state.startMs,
  })

  yield* recordAndYield({
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

  // Auto-infer the candidate product whenever the current message reveals
  // a category that maps unambiguously to one catalog product, AND no
  // candidate is set yet AND no product is committed. Runs every turn until
  // a candidate exists — greeting-then-intent ("buna ziua" → "vreau viața")
  // is a common pattern, so we cannot gate on first-turn only.
  //
  // Cost: a cheap regex pre-check runs every turn; the catalog DB query
  // only runs on turns whose message contains a category keyword.
  // Best-effort: a failure here must not break the turn.
  // See docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
  const interests = (turnCtx.customer.extractedProfile as { interests?: string[] } | null)?.interests ?? null
  if (
    turnCtx.conversation.candidateProductId === null &&
    turnCtx.conversation.productId === null &&
    hasAnyCategoryKeyword(input.message, interests)
  ) {
    try {
      const catalog = await prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, insuranceType: true },
      })
      const guess = inferCandidate(input.message, interests, catalog)
      if (guess) {
        await prisma.conversation.update({
          where: { id: state.conversationId },
          data: {
            candidateProductId: guess.productId,
            candidateConfidence: guess.confidence,
            candidateSetAt: new Date(),
          },
        })
        turnCtx.conversation.candidateProductId = guess.productId
        turnCtx.conversation.candidateConfidence = guess.confidence
        turnCtx.conversation.candidateSetAt = new Date()
      }
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'candidate_inference',
        message: 'Auto-candidate-assignment failed, continuing without candidate',
        context: { conversationId: state.conversationId, customerId: state.customerId },
        error: err,
      })
    }
  }

  // Pre-fetch raw insights every turn so the persisted debug record's identity
  // card is complete even when the live debug stream is off, and so the same
  // rows thread into loadAllSections (no second query). The SSE yield inside
  // recordAndYield is still gated. A failure here must never break the turn —
  // log and continue with no preloaded insights.
  let preloadedInsights: RawCustomerInsight[] | undefined
  try {
    preloadedInsights = await loadCustomerInsights(state.customerId)
    yield* recordAndYield({
      event: 'debug:identity',
      data: buildIdentityPayload({
        traceId: state.traceId,
        conversationId: state.conversationId,
        messageIndex: state.messageCount,
        customerId: state.customerId,
        customer: turnCtx.customer,
        conversation: {
          mode: turnCtx.conversation.mode,
          productId: turnCtx.conversation.productId,
          product: turnCtx.conversation.product,
          candidateProductId: turnCtx.conversation.candidateProductId,
          candidateConfidence: turnCtx.conversation.candidateConfidence,
          candidateSetAt: turnCtx.conversation.candidateSetAt,
          application: turnCtx.conversation.application,
        },
        insights: preloadedInsights,
        now: new Date(),
      }),
    })
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'debug',
      message: 'Failed to build/record debug:identity event',
      context: { conversationId: state.conversationId, customerId: state.customerId },
      error: err,
    })
    preloadedInsights = undefined
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

  // Determine allowed tools for this step (hoisted for use in gate + skill pack scoping).
  // DEFAULT_DISCOVERY_TOOLS are merged in as a baseline so the agent always has
  // catalog tools during the pre-workflow discovery phase. See
  // docs/superpowers/specs/2026-05-20-zeno-discovery-toolset-design.md.
  const stepAllowedTools = withDefaultDiscoveryTools(
    turnCtx.conversation.workflowSession?.currentStep.allowedTools ?? [],
  )

  // --- gatePromise: Step 3 — Deterministic state derivation (replaces the
  // reasoning-gate LLM pre-pass). loadDomainSnapshot() is a cheap DB read (no
  // LLM) and deriveAndExpose() is pure, so this always runs; the (phase,
  // subphase) it returns drives section selection + the situational briefing.
  // The event phase label stays 'reasoning_gate' so existing observability/
  // perf tests keep their span name.
  const gatePromise = (async (): Promise<{
    exposure: DeriveAndExposeResult | null
    gateSelection: GateSelection
    gateDebug: Omit<DebugGatePayload, 'traceId'>
  }> => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'reasoning_gate', timestamp: Date.now() })
    const start = Date.now()
    let exposure: DeriveAndExposeResult | null = null
    let gateSelection: GateSelection
    let gateDebug: Omit<DebugGatePayload, 'traceId'>
    try {
      exposure = deriveAndExpose(await loadDomainSnapshot(state.conversationId))
      gateSelection = { requiredSections: getRequiredSectionsFor(exposure.state.phase, exposure.state.subphase), excludedSections: [], confidence: 1 }
      state.phases['reasoningGate'] = { durationMs: Date.now() - start, derivedPhase: exposure.state.phase }
      gateDebug = { skipped: false, derivedPhase: exposure.state.phase, derivedState: exposure.state, actions: exposure.actions, engineVersion, durationMs: Date.now() - start }
    } catch (err: unknown) {
      logWarn({ layer: 'orchestrator', category: 'derive_state', message: 'deriveAndExpose failed, using DISCOVERY sections', context: { conversationId: state.conversationId }, error: err })
      gateSelection = { requiredSections: getRequiredSectionsFor('DISCOVERY', null), excludedSections: [], confidence: 1 }
      state.phases['reasoningGate'] = { durationMs: Date.now() - start, error: true }
      gateDebug = { skipped: false, error: true, derivedState: null, engineVersion, durationMs: Date.now() - start }
    }
    state.phases['step3_reasoning_gate'] = Date.now() - start
    eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'reasoning_gate', durationMs: Date.now() - start })
    return { exposure, gateSelection, gateDebug }
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

      // Build StateGroundingInput from turnCtx — feeds the "=== CURRENT SYSTEM STATE ==="
      // section so the agent has explicit ✓/✗ facts about the current world.
      // See docs/superpowers/specs/2026-05-20-zeno-state-grounding-design.md.
      const stateGroundingInput: StateGroundingInput = {
        workflowSession: turnCtx.conversation.workflowSession
          ? {
              currentStep: {
                code: turnCtx.conversation.workflowSession.currentStep.code,
                name: turnCtx.conversation.workflowSession.currentStep.name,
              },
              status: 'ACTIVE',
            }
          : null,
        application: turnCtx.conversation.application
          ? {
              id: 'application',
              status: turnCtx.conversation.application.status,
              currentQuestionIndex: turnCtx.conversation.application.currentQuestionIndex,
              totalQuestions: turnCtx.conversation.application.totalQuestions,
            }
          : null,
        product: turnCtx.conversation.product
          ? { code: turnCtx.conversation.product.code, name: turnCtx.conversation.product.name }
          : null,
        customer: {
          gdprConsentAt: turnCtx.customer.gdprConsentAt,
          gdprConsentScope: turnCtx.customer.gdprConsentScope,
          aiDisclosureAcknowledgedAt: turnCtx.customer.aiDisclosureAcknowledgedAt,
        },
      }

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
        stateGroundingInput,
        preloadedInsights,
      })
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'db_error',
        message: 'Context assembly failed, using minimal context',
        context: { conversationId: state.conversationId },
        error: err,
      })
      // Minimal fallback — identity, constraints, and state grounding only
      // (state grounding is alwaysInclude: true, so it must be present even on fallback)
      const fallbackStateGroundingInput: StateGroundingInput = {
        workflowSession: turnCtx.conversation.workflowSession
          ? {
              currentStep: {
                code: turnCtx.conversation.workflowSession.currentStep.code,
                name: turnCtx.conversation.workflowSession.currentStep.name,
              },
              status: 'ACTIVE',
            }
          : null,
        application: turnCtx.conversation.application
          ? {
              id: 'application',
              status: turnCtx.conversation.application.status,
              currentQuestionIndex: turnCtx.conversation.application.currentQuestionIndex,
              totalQuestions: turnCtx.conversation.application.totalQuestions,
            }
          : null,
        product: turnCtx.conversation.product
          ? { code: turnCtx.conversation.product.code, name: turnCtx.conversation.product.name }
          : null,
        customer: {
          gdprConsentAt: turnCtx.customer.gdprConsentAt,
          gdprConsentScope: turnCtx.customer.gdprConsentScope,
          aiDisclosureAcknowledgedAt: turnCtx.customer.aiDisclosureAcknowledgedAt,
        },
      }
      sections = {
        agentIdentity: agentConfig.systemPrompt,
        capabilityManifest: null,
        constraints: agentConfig.constraints,
        stateGrounding: loadStateGrounding(fallbackStateGroundingInput),
        complianceGuidance: null,
        situationalBriefing: null,
        customerMemory: null,
        agentKnowledge: null,
        customerContext: null,
        coachingBriefing: null,
        domainGuidance: null,
        workflowInstructions: null,
        questionnaireContext: null,
        productContext: null,
        catalogOverview: null,
      }
    }

    state.phases['step4_context'] = Date.now() - ctxPhaseStart
    eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'context', durationMs: Date.now() - ctxPhaseStart })

    return { agentSlug, agentConfig, sections }
  })()

  // --- Await both in parallel ---
  const [gateResult, contextResult] = await Promise.all([gatePromise, contextPromise])

  const { exposure, gateSelection } = gateResult
  const { agentSlug, agentConfig, sections } = contextResult

  yield* recordAndYield({
    event: 'debug:gate',
    data: { ...gateResult.gateDebug, traceId: state.traceId },
  })

  // Patch situationalBriefing from the derived state (phase/subphase + next best action)
  sections.situationalBriefing = exposure ? formatDerivedBriefing(exposure.state, exposure.actions) : null

  // --- Skill pack loading and merging ---
  // Gate-driven skill-pack recommendations are gone; workflow/pack-driven packs
  // still flow through the existing activation path below.
  const recommendedSlugs: string[] = []
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

  // --- Conditional compliance check ---
  // Compliance is now triggered deterministically by the derived phase rather
  // than by the LLM gate's complianceRelevant flag.
  // Transitional trigger on the pinned Phase vocabulary (old CONSENT/
  // QUESTIONNAIRE map to APPLICATION subphases, old CLOSING to PAYMENT/POLICY);
  // A1.6 replaces this list with the typed COMPLIANCE_RELEVANT_BY_PHASE record.
  const complianceRelevant = exposure
    ? ['APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'].includes(exposure.state.phase)
    : false
  if (complianceRelevant) {
    // Use recent messages from turnCtx instead of querying DB again
    const complianceMessages: Message[] = turnCtx.recentMessages
      .slice(-10)
      .map((m) => ({ role: m.role as Message['role'], content: m.content }))

    try {
      const complianceResult = await executeComplianceCheck({
        messages: complianceMessages,
        workflowStepCode: state.workflowStepCode,
        customerProfile: null,
        phase: getConversationPhase(turnCtx.conversation),
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

  yield* recordAndYield({
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
  toolContext.activeSkillPacks = state.activeSkillPacks
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

    yield* recordAndYield({
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

    yield* recordAndYield({
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
        confirmation: pipelineResult.toolResult.confirmation,
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
      content: serializeToolResultForModel(pipelineResult.toolResult),
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
        yield* recordAndYield({
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

        yield* recordAndYield({
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
          yield* recordAndYield({
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

          yield* recordAndYield({
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
              confirmation: pipelineResult.toolResult.confirmation,
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

        yield* recordAndYield({
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

        yield* recordAndYield({
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
            confirmation: pipelineResult.toolResult.confirmation,
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
          content: serializeToolResultForModel(pipelineResult.toolResult),
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
        toolContext.activeSkillPacks = state.activeSkillPacks
      }

      round++
    }
  }

  state.phases['step7_llm_tools'] = Date.now() - step7Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'llm_tools', durationMs: Date.now() - step7Start })

  // =============================================
  // STEP 7b — Side-effect claim validation (subsystem C)
  // =============================================
  // Make sure the assistant's prose doesn't claim side effects it didn't
  // actually perform via tools. Validator uses the tool history accumulated
  // by the anomaly subscriber to know which side-effect categories succeeded.
  try {
    const history = getTurnToolHistory(state.traceId)
    const toolCallsThisTurn = history.map((h, i) => ({
      id: `t${i}`,
      name: h.name,
      arguments: {} as Record<string, unknown>,
    })) as unknown as import('@/lib/llm/providers/types').ToolCall[]
    const toolResultsThisTurn = history.map((h) => ({ success: h.success })) as ToolResult[]
    const validation = validateSideEffectClaims(
      finalContent,
      toolCallsThisTurn,
      toolResultsThisTurn,
      state.language,
    )
    if (!validation.valid) {
      eventBus.emit({
        type: 'side_effect:invalid',
        traceId: state.traceId,
        conversationId: state.conversationId,
        violations: validation.violations,
      })
    }
  } catch (err) {
    // Validator failures are never fatal — log and continue.
    logWarn({
      layer: 'orchestrator',
      category: 'side_effect_validator',
      message: 'Side-effect validator threw',
      context: { conversationId: state.conversationId },
      error: err,
    })
  }

  // =============================================
  // STEP 7c — Tool-narration detection (Pathology 1 guard)
  // =============================================
  // The assistant must never narrate its tool use or ask the customer for
  // permission to perform a lookup (see "TOOL USE IS INVISIBLE" in the main
  // prompt). Detect leakage, emit an observability event when found, and
  // surface the result every turn in the debug pane. Never fatal.
  let toolNarration: ToolNarrationResult = { clean: true, violations: [] }
  try {
    toolNarration = detectToolNarration(finalContent, state.language)
    if (!toolNarration.clean) {
      eventBus.emit({
        type: 'tool_narration:detected',
        traceId: state.traceId,
        conversationId: state.conversationId,
        violations: toolNarration.violations,
      })
    }
  } catch (err) {
    logWarn({
      layer: 'orchestrator',
      category: 'tool_narration_detector',
      message: 'Tool-narration detector threw',
      context: { conversationId: state.conversationId },
      error: err,
    })
  }

  yield* debugYield(isDev(), debugEnabled, {
    event: 'debug:tool_narration',
    data: {
      traceId: state.traceId,
      clean: toolNarration.clean,
      violations: toolNarration.violations,
    },
  })

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
    derivedPhase: exposure?.state.phase ?? null,
    fastPath: false,
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

  yield* recordAndYield({
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

  // Persist the full debug record for this turn. Always-on (no debug gate),
  // fire-and-forget, errors swallowed inside persistTurnDebug.
  void persistTurnDebug({
    conversationId: state.conversationId,
    messageIndex: state.messageCount,
    traceId: state.traceId,
    events: state.debugEvents,
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

