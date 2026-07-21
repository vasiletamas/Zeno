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
import { buildPrompt, detectFirstTurn, type GateSelection, type PromptSections } from './prompt-builder'
import { accumulateTurnUsage } from './turn-usage'
import { buildTurnMessages } from './build-turn-messages'
import { getRequiredSectionsFor, formatDerivedBriefing, includeDiscoveryConduct } from './phase-sections-map'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose, engineVersion } from '@/lib/engines/derive-and-expose'
import type { DeriveAndExposeResult, Phase, AppSubphase } from '@/lib/engines/domain-types'
import { buildSlidingWindow, updateSummaryIfStale } from './sliding-window'
import { loadAllSections, loadStateGrounding, loadCustomerInsights, loadCapabilityManifest, loadDntContext, loadPaymentContext, loadPolicyContext, loadQuestionnaireContextForState, getLastInjectedProductContentVersions, type StateGroundingInput, type RawCustomerInsight } from './context-loaders'
import { buildTurnTools, DEGRADED_FLOOR } from './turn-tools'
import { shouldRefreshExposure, buildRefreshArtifacts } from './round-refresh'
import { seedSyntheticLoopMessages, extractAutoChain } from './synthetic-turn'
import { evaluateTurnInvariants, recommendedActionsFromBriefing } from '@/lib/monitors/turn-invariants'
import { loadTurnContext, reactivateIfArchived, type TurnContext } from './turn-context'
import { inferCandidate, hasAnyCategoryKeyword } from './candidate-inference'
import { resolveAgent } from './agent-resolver'
import { executeComplianceCheck, shouldRunComplianceCheck, COMPLIANCE_RELEVANT_BY_PHASE, type ComplianceCheckResult } from './compliance-checker'
import { trackChatStarted } from '@/lib/analytics/events'
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'
import { compactMessages } from '@/lib/chat/compaction'
import { isContextLengthError, parseTokenDeficit } from '@/lib/llm/errors'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'
import { extractAndPersistInsights } from '@/lib/insights/extractor'
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'
import { eventBus, initObservability, getTurnCost, getTurnAnomalies, getTurnToolHistory, recordTurnAnomaly } from '@/lib/events'
import { validateSideEffectClaims } from './side-effect-validator'
import { detectFalseUnavailabilityClaim } from './outbound-guard'
import { detectToolNarration, type ToolNarrationResult } from './tool-narration-detector'
import { debugYield, isDev, buildIdentityPayload, buildLegalityPayload, recordDebugEvent, type DebugEvent, type DebugGatePayload } from './debug'
import { serializeToolResultForModel } from './tool-result-serializer'
import { persistTurnDebug } from './turn-debug-persistence'
import { deriveActiveCards, type ActiveCard } from './derive-active-cards'

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
  /**
   * Task 5.1 (D9): the 0-based index of the USER message that started this
   * turn — the value TurnDebug/TurnTrace persist. messageCount keeps
   * incrementing with each save (user, assistant), so persisting IT at
   * turn end sat +2 off the message array and misattributed every turn.
   */
  userMessageIndex: number
  productId: string | null
  savedMessageId: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  llmCalls: number
  cacheHitCalls: number
  provider: string | null
  model: string | null
  startMs: number
  traceId: string
  phases: Record<string, unknown>
  conversationMode: string
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
    userMessageIndex: 0,
    productId: null,
    savedMessageId: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    llmCalls: 0,
    cacheHitCalls: 0,
    provider: null,
    model: null,
    startMs: Date.now(),
    traceId: crypto.randomUUID(),
    phases: {},
    conversationMode: 'SALES',
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

  // P1-12: a mid-pipeline crash used to abort this generator SILENTLY — the
  // user message was saved, no reply came, and NO TurnDebug row existed
  // (13 minutes of recorded dead air with zero diagnostics). Every fatal
  // error now records the abort, persists the debug events collected so far
  // (AWAITED — the turn is over anyway), and hands the GUI a structured,
  // retryable error. The pipeline body below is unchanged.
  try {
    yield* pipeline()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const errorId = logFatal({
      layer: 'orchestrator',
      category: 'turn_aborted',
      message: 'Turn aborted mid-pipeline',
      context: { conversationId: state.conversationId, traceId: state.traceId },
      error: err,
    })
    recordTurnAnomaly(state.traceId, { type: 'error_pattern', severity: 'critical', message: `turn_aborted: ${message}`, metadata: { errorId } })
    recordDebugEvent(state, {
      event: 'debug:turn_end',
      data: {
        traceId: state.traceId,
        phases: state.phases,
        totalInputTokens: state.totalInputTokens,
        totalOutputTokens: state.totalOutputTokens,
        cost: getTurnCost(state.traceId),
        latencyMs: Date.now() - state.startMs,
        anomalies: getTurnAnomalies(state.traceId),
      },
    })
    eventBus.emit({
      type: 'turn:end',
      traceId: state.traceId,
      conversationId: state.conversationId,
      cost: getTurnCost(state.traceId),
      latencyMs: Date.now() - state.startMs,
      anomalies: getTurnAnomalies(state.traceId),
    })
    if (state.conversationId) {
      await persistTurnDebug({
        conversationId: state.conversationId,
        messageIndex: state.messageCount,
        traceId: state.traceId,
        events: state.debugEvents,
      })
    }
    yield {
      event: 'error',
      data: { errorId, type: 'internal', message: 'Service temporarily unavailable', retryable: true, traceId: state.traceId },
    }
  }
  return

  // eslint-disable-next-line no-inner-declarations -- hoisted so the guard
  // above wraps the entire unchanged pipeline without re-indenting it
  async function* pipeline(): AsyncGenerator<SSEEvent> {

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
  // B0 dropped the extractedProfile divergence store; interest hints with it.
  const interests: string[] | null = null
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
            candidateSetAt: new Date(),
          },
        })
        turnCtx.conversation.candidateProductId = guess.productId
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
          productId: turnCtx.conversation.productId,
          product: turnCtx.conversation.product,
          candidateProductId: turnCtx.conversation.candidateProductId,
          candidateSetAt: turnCtx.conversation.candidateSetAt,
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

  // D2.9 (contradiction #11): no terminal-conversation guard — a
  // conversation is a channel; a turn on an ARCHIVED one reactivates it.
  await reactivateIfArchived(state.conversationId)

  // Guard: must have content
  if (!input.message && !input.syntheticToolCall) {
    throw new Error('Either message or syntheticToolCall is required')
  }

  state.messageCount = turnCtx.conversation.messageCount
  // messageCount BEFORE this turn's saves = the new user message's 0-based index
  state.userMessageIndex = turnCtx.conversation.messageCount
  state.productId = turnCtx.conversation.productId
  state.conversationMode = turnCtx.conversation.mode ?? 'SALES'
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
    snapshot: unknown
  }> => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'reasoning_gate', timestamp: Date.now() })
    const start = Date.now()
    let exposure: DeriveAndExposeResult | null = null
    let gateSelection: GateSelection
    let gateDebug: Omit<DebugGatePayload, 'traceId'>
    let snapshot: unknown = null
    try {
      const snap = await loadDomainSnapshot(state.conversationId)
      snapshot = snap
      exposure = deriveAndExpose(snap)
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
    return { exposure, gateSelection, gateDebug, snapshot }
  })()

  // --- contextPromise: Step 4 — Context assembly (without situationalBriefing, patched after gate) ---
  const contextPromise = (async () => {
    eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'context', timestamp: Date.now() })
    const ctxPhaseStart = Date.now()

    const agentSlug = resolveAgent(state.conversationMode)
    const agentConfig = await getAgentConfig(agentSlug)

    let sections: Awaited<ReturnType<typeof loadAllSections>>
    try {
      // Build StateGroundingInput from turnCtx — feeds the "=== CURRENT SYSTEM STATE ==="
      // section so the agent has explicit ✓/✗ facts about the current world.
      // See docs/superpowers/specs/2026-05-20-zeno-state-grounding-design.md.
      const stateGroundingInput: StateGroundingInput = {
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
        agentConfig: { systemPrompt: agentConfig.systemPrompt, constraints: agentConfig.constraints, promptSections: agentConfig.promptSections },
        // capabilityManifest is patched after the gate resolves (A3.1 erratum
        // 3): exposure does not exist yet — context assembly deliberately
        // runs in parallel with the gate.
        allowedTools: [],
        productId: state.productId,
        conversationId: state.conversationId,
        customerId: state.customerId,
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
        firstTurnRules: agentConfig.promptSections?.firstTurnRules ?? null,
        discoveryConduct: agentConfig.promptSections?.discoveryConduct ?? null,
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
        questionnaireContext: null,
        productContext: null,
        catalogOverview: null,
        dntContext: null,
        paymentContext: null,
        policyContext: null,
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

  // F2.2 (T14.D2): the per-turn legality snapshot — deriveAndExpose INPUT
  // (redacted) + OUTPUT + version stamps. contentVersions reflect the last
  // productContext load (fresh for this turn when a product is in focus).
  if (exposure && gateResult.snapshot) {
    yield* recordAndYield({
      event: 'debug:legality',
      data: buildLegalityPayload({
        traceId: state.traceId,
        point: 'turn_start',
        contentVersions: getLastInjectedProductContentVersions(),
        snapshot: gateResult.snapshot,
        state: exposure.state,
        actions: exposure.actions,
      }),
    })
  }

  // Card-state SSOT (spec 2026-07-20 §5): the ON-SCREEN CARDS block needs the
  // TURN-START card set — a genuinely different instant from the turn-end set
  // the `cards_state` SSE event carries, so this second derivation is by
  // design. Derived ONCE here and reused by the debug event below. Same
  // failure posture as everywhere else on this path: never break a turn.
  let briefedCards: ActiveCard[] = []
  if (exposure) {
    try {
      briefedCards = await deriveActiveCards(state.conversationId)
    } catch (err) {
      logError({ layer: 'orchestrator', category: 'cards_state', message: 'deriveActiveCards failed for the briefing; continuing without the ON-SCREEN CARDS block', context: { conversationId: state.conversationId }, error: err })
    }
  }

  // Patch situationalBriefing from the derived state (phase/subphase + next best action)
  sections.situationalBriefing = exposure ? formatDerivedBriefing(exposure.state, exposure.actions, briefedCards) : null

  // Offline evidence for the T11 amendment (a briefing-listed card is legally
  // referenceable — lib/diagnostics/checks-cards.ts). Always recorded, even
  // when empty: absence of the event and an empty set must stay distinguishable
  // for turns that ran before this landed.
  recordDebugEvent(state, {
    event: 'debug:cards_briefed',
    data: { traceId: state.traceId, cards: briefedCards.map((c) => ({ key: c.key, status: c.status })) },
  })

  // Patch capabilityManifest from the exposure set (A3.1 erratum 3 — same
  // patch-after-gate pattern as the briefing, keeping gate ∥ context intact).
  sections.capabilityManifest = loadCapabilityManifest(exposure?.actions.available ?? [...DEGRADED_FLOOR])

  // Per-(phase,subphase) sections rendered from the derived state (A4.2).
  sections.dntContext = exposure ? loadDntContext(exposure.state) : null
  sections.paymentContext = exposure ? loadPaymentContext(exposure.state) : null
  sections.policyContext = exposure ? loadPolicyContext(exposure.state) : null

  // Task 1.2 (D2): questionnaireContext keys on the derived (phase, subphase)
  // — loadAllSections cannot know the step (it runs parallel to the gate), so
  // the orchestrator patches it here; a loader failure degrades to no section,
  // never a dead turn.
  if (exposure) {
    try {
      sections.questionnaireContext = await loadQuestionnaireContextForState(
        exposure.state, state.conversationId, state.customerId, state.language,
      )
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'db_error',
        message: 'questionnaireContext load failed; continuing without the section',
        context: { conversationId: state.conversationId },
        error: err,
      })
      sections.questionnaireContext = null
    }
  }

  // E1: scope the split identity sections (same content-nullness gating as
  // dntContext above). First-turn rules ship only on the opening exchange;
  // discovery conduct only where products are presented/priced. On exposure
  // failure the phase falls back to DISCOVERY (conservative — conduct stays).
  if (!detectFirstTurn(state.messageCount)) sections.firstTurnRules = null
  if (!includeDiscoveryConduct(exposure?.state.phase ?? 'DISCOVERY')) sections.discoveryConduct = null

  // Pack subsystem deleted (A5.2, M12): gating is owned by the legality
  // engine, prompt content by the sections map.
  const mergedSections: PromptSections = sections

  // --- Conditional compliance check ---
  // Compliance is triggered deterministically by the pinned derived Phase via
  // the typed COMPLIANCE_RELEVANT_BY_PHASE record (exhaustive over Phase), not
  // by the LLM gate's complianceRelevant flag or any second phase vocabulary.
  const complianceRelevant = exposure
    ? COMPLIANCE_RELEVANT_BY_PHASE[exposure.state.phase]
    : false
  // Task 5.2 (D10) cadence: the judge runs at (phase, subphase) TRANSITIONS,
  // not per turn — a stable QUESTIONNAIRE stretch pays zero judge latency.
  // The previous turn's derived state comes from its TurnDebug row; a missing
  // row (first turn, racing persist) fails open toward checking.
  let complianceDue = complianceRelevant
  if (exposure && complianceRelevant) {
    try {
      const prevRow = await prisma.turnDebug.findFirst({
        where: { conversationId: state.conversationId },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      })
      const prevLegality = (prevRow?.payload as { legality?: { point: string; state: { phase: Phase; subphase: AppSubphase | null } }[] } | null)?.legality?.find((l) => l.point === 'turn_start')
      complianceDue = shouldRunComplianceCheck(
        prevLegality ? { phase: prevLegality.state.phase, subphase: prevLegality.state.subphase ?? null } : null,
        { phase: exposure.state.phase, subphase: exposure.state.subphase },
      )
    } catch { /* fail open toward checking */ }
  }
  if (exposure && complianceRelevant && complianceDue) {
    // Use recent messages from turnCtx instead of querying DB again
    const complianceMessages: Message[] = turnCtx.recentMessages
      .slice(-10)
      .map((m) => ({ role: m.role as Message['role'], content: m.content }))

    try {
      const complianceResult = await executeComplianceCheck({
        messages: complianceMessages,
        customerProfile: null,
        phase: exposure.state.phase,
        language: state.language,
        // Task 5.2 (D10): ground the judge in the ledger-verified facts
        recordedFacts: {
          gdprProcessing: exposure.state.consents.gdprProcessing,
          aiDisclosure: exposure.state.consents.aiDisclosure,
          dntSigned: exposure.state.dnt.signed && exposure.state.dnt.valid,
          dntValidUntil: exposure.state.dnt.validUntil,
        },
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
      stablePrefixChars: buildResult.stablePrefix?.length ?? 0,
      dynamicSuffixChars: buildResult.dynamicSuffix?.length ?? 0,
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

  // D1 (F3): dynamic per-turn state rides the final user message, BEHIND the
  // history, so provider prefix caching covers system + summary + history.
  // The persisted user Message row keeps the raw customer text.
  const messages: Message[] = buildTurnMessages({
    stablePrefix: buildResult.stablePrefix || null,
    dynamicSuffix: buildResult.dynamicSuffix || null,
    summaryPrefix,
    windowMessages,
    userMessage: input.message,
  })

  state.phases['step6_build_messages'] = Date.now() - step6Start
  eventBus.emit({ type: 'phase:end', traceId: state.traceId, phase: 'build_messages', durationMs: Date.now() - step6Start })

  // =============================================
  // STEP 7 — Main LLM call + tool loop
  // =============================================
  eventBus.emit({ type: 'phase:start', traceId: state.traceId, phase: 'llm_tools', timestamp: Date.now() })
  const step7Start = Date.now()

  let toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
  // Server-resolved commit actor (A2.9): every LLM tool-loop call is the
  // agent's; the synthetic branch below overrides per-call with 'gui'.
  toolContext.actor = 'agent'
  // Executor exposure wall (A3.2): same set as the LLM tool list; on derive
  // failure both fall back to the ONE degraded floor (erratum 4).
  toolContext.exposedTools = exposure?.actions.available ?? [...DEGRADED_FLOOR]
  // The per-turn tool list IS the exposure set (A3.1). On derive failure the
  // model gets the explicit degraded floor — reads + escape hatch.
  let tools: LLMToolDefinition[] = exposure ? buildTurnTools(exposure.actions) : getToolsForLLM([...DEGRADED_FLOOR])
  let finalContent = ''
  // F2.4: per-turn facts for the runtime invariant monitors
  const turnEnvelopes: import('@/lib/engines/domain-types').CommitResult[] = []
  const turnWritingResults: { tool: string; hasEnvelope: boolean }[] = []
  const turnExecutorRejections: { tool: string; reason: string }[] = []
  let lastStatusMessage: string | undefined
  // T16: one-shot outbound self-repair — once a false-unavailability draft
  // has been rejected and retried, the guard stands down for the turn (a
  // second offending draft streams as-is; better a wrong claim than an
  // infinite loop, and the offline stale_gate_claim ratchet still nets it).
  let repairAttempted = false

  // Post-commit exposure refresh (A3.4, T1.D5), shared by the mid-loop
  // rounds and the T13 pre-round-0 synthetic refresh: re-derive, rebuild the
  // tool list + the executor wall, push the [State update] system message
  // and emit one post_commit legality entry per APPLIED envelope, joined to
  // its ledger row by the stamped ledgerId (erratum 2).
  async function* refreshAfterAppliedCommits(
    envelopes: import('@/lib/engines/domain-types').CommitResult[],
    atRound: number,
  ): AsyncGenerator<SSEEvent> {
    if (!shouldRefreshExposure(envelopes)) return
    try {
      const refreshSnap = await loadDomainSnapshot(state.conversationId)
      const refreshed = deriveAndExpose(refreshSnap)
      const artifacts = buildRefreshArtifacts(refreshed)
      tools = artifacts.tools
      toolContext = await buildToolContext(state.customerId, state.conversationId, state.language)
      toolContext.actor = 'agent'
      toolContext.exposedTools = artifacts.exposedTools
      messages.push(artifacts.stateUpdateMessage)
      for (const env of envelopes.filter((e) => e.outcome === 'applied')) {
        yield* recordAndYield({
          event: 'debug:legality',
          data: buildLegalityPayload({
            traceId: state.traceId,
            point: 'post_commit',
            round: atRound,
            commitLedgerId: env.ledgerId,
            contentVersions: getLastInjectedProductContentVersions(),
            snapshot: refreshSnap,
            state: refreshed.state,
            actions: refreshed.actions,
          }),
        })
      }
    } catch (err: unknown) {
      logWarn({ layer: 'orchestrator', category: 'derive_state', message: 'post-round re-derivation failed — keeping previous exposure', context: { conversationId: state.conversationId }, error: err })
    }
  }

  // T13: GUI action turns run the STANDARD tool loop. The synthetic
  // execution below consumes round 0's budget, then falls through into the
  // shared rounds from round 1 — the old path narrated over a TOOL-LESS
  // stream call, so the model structurally could not chain (conv
  // cmrm3fgku00056g0y4eb2hsme messageIndex 58: "the quote can be generated
  // now" followed by "calcularea nu poate fi finalizată" with zero
  // generate_quote attempts).
  let round = 0

  // GUI tool execution (T13, shared with the T8 _autoChain hop): status +
  // debug events, pipeline execution with the server-resolved 'gui' actor,
  // result/ui_action/confirm_required emission — exactly the synthetic-path
  // contract, returned so the caller can seed the loop and refresh.
  // T19: the agent-path _autoChain hop reuses this runner with actor 'agent'
  // — the hop rides the SAME actor as the commit that declared it (a
  // deterministic consequence of the submission, whichever surface it came
  // through), at the round it fired in.
  async function* runGuiToolCall(
    tc: ToolCall,
    actor: import('@/lib/engines/domain-types').CommitActor = 'gui',
    atRound = 0,
  ): AsyncGenerator<SSEEvent, PipelineResult> {
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
        round: atRound,
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
      // Server-resolved actor — never the model (A2.9): 'gui' for the
      // customer's click and its chained hop, 'agent' for the T19 agent-path
      // hop. The _autoChain hop rides the same actor as its commit: it is a
      // deterministic consequence of that submission, gateway-legality-
      // checked like any commit.
      { ...toolContext, actor },
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

    // Gateway parity (A3.5/M4): a requires_confirmation envelope becomes a
    // confirm_required ui_action carrying the token, so the GUI renders the
    // confirm dialog that round-trips the SAME commit + token the agent would.
    if (pipelineResult.toolResult.envelope?.outcome === 'requires_confirmation') {
      // D2.5: the confirm token is bound to the MATERIAL args hash, so the
      // original args (minus any stale token) ride the card and return with
      // the confirm click — e.g. accept_quote's paymentOption.
      const { confirmToken: _staleToken, ...materialArgs } = (tc.arguments ?? {}) as Record<string, unknown>
      yield {
        event: 'ui_action',
        data: {
          type: 'confirm_required',
          payload: {
            tool: tc.name,
            confirmToken: pipelineResult.toolResult.envelope.confirmToken,
            args: materialArgs,
            preview: pipelineResult.toolResult.envelope.data,
          },
        },
      }
    }

    return pipelineResult
  }

  if (input.syntheticToolCall) {
    // ----- Synthetic tool call path -----
    const tc = input.syntheticToolCall
    const pipelineResult = yield* runGuiToolCall(tc)

    // T13: seed the standard loop with the synthetic assistant+tool
    // exchange — exactly the shape an LLM-initiated round would have pushed.
    messages.push(...seedSyntheticLoopMessages(tc, pipelineResult.toolResult))

    // T13: an applied GUI commit gets the SAME post-commit refresh the loop
    // runs mid-loop, injected BEFORE the model's first round so it sees the
    // post-commit world (fresh tools + executor wall + [State update]).
    // requires_confirmation / rejected results refresh nothing — the
    // turn-start exposure stands (the tool stays exposed, as on the agent
    // path) and the envelope's _instruction already forbids re-calling it.
    const syntheticEnvelope = pipelineResult.toolResult.envelope
    if (syntheticEnvelope) {
      yield* refreshAfterAppliedCommits([syntheticEnvelope], 0)
    }

    // T8 (design 2026-07-15 §3.4): _autoChain single hop — an APPLIED gui
    // commit may declare its ONE deterministic follow-up (contact submit →
    // start_channel_verification, OTP confirm → request_document_upload).
    // Executed AFTER the refresh so the executor's exposure wall reflects
    // the post-commit world; failures surface as a normal tool result
    // (executeToolWithPipeline never throws). Cap: EXACTLY ONE hop — the
    // chained result's own _autoChain is deliberately ignored; chains of
    // judgment stay with the model inside the tool loop below.
    const chain = extractAutoChain(pipelineResult.toolResult)
    if (chain) {
      const chainTc: ToolCall = { id: `${tc.id}_auto`, name: chain.tool, arguments: chain.args }
      const chainResult = yield* runGuiToolCall(chainTc)
      messages.push(...seedSyntheticLoopMessages(chainTc, chainResult.toolResult))
      const chainEnvelope = chainResult.toolResult.envelope
      if (chainEnvelope) {
        yield* refreshAfterAppliedCommits([chainEnvelope], 0)
      }
    }

    // The synthetic execution consumed one round's worth of work — the LLM
    // gets MAX_TOOL_ROUNDS - 1 tool-bearing rounds instead of a tool-less
    // narration call.
    round = 1
  }

  // ----- Standard tool loop (T13: shared — a chat turn starts at round 0,
  // a GUI action turn continues from round 1 with the seeded messages) -----
  {
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
      // T16 outbound guard: a round's content events are BUFFERED until we
      // know whether the round carries tool calls. A tool round flushes the
      // moment its tool_calls chunk arrives (providers emit text blocks
      // before tool_use blocks, so the hold is one block boundary); the
      // FINAL narration round — the only round the customer actually reads —
      // holds its text until the draft clears the guard below. Accepted
      // latency tradeoff: the final reply arrives as a burst after the
      // stream completes instead of token-by-token — the price of never
      // showing a false "I can't" about an action that is available right
      // now. After the one-shot repair the guard stands down and content
      // streams live again.
      const bufferedContent: SSEEvent[] = []

      for await (const chunk of stream!) {
        if (chunk.type === 'content' && chunk.content) {
          roundContent += chunk.content
          const ev: SSEEvent = { event: 'content', data: { text: chunk.content } }
          if (repairAttempted || roundToolCalls.length > 0) {
            yield ev
          } else {
            bufferedContent.push(ev)
          }
        }
        if (chunk.type === 'tool_calls' && chunk.toolCalls) {
          roundToolCalls = chunk.toolCalls
          // Tool round — stream live from here on; release the held prefix.
          for (const buffered of bufferedContent.splice(0)) yield buffered
        }
        if (chunk.type === 'done' && chunk.usage) {
          accumulateTurnUsage(state, chunk.usage)
        }
      }

      // If no tool calls, we have the final response
      if (roundToolCalls.length === 0) {
        // T16: deterministic outbound contradiction guard. A draft claiming
        // an AVAILABLE funnel action is impossible never reaches the
        // customer: discard it, record the anomaly (recordTurnAnomaly →
        // turn:end / TurnTrace / TurnDebug, same channel as the F2.4
        // invariant monitors) and re-invoke the model ONCE with a correction
        // — tools stay enabled so it can simply perform the action.
        const falseClaim = repairAttempted
          ? null
          : detectFalseUnavailabilityClaim(roundContent, toolContext.exposedTools ?? [], state.language)
        if (falseClaim) {
          repairAttempted = true
          bufferedContent.length = 0 // the draft is discarded, never streamed
          recordTurnAnomaly(state.traceId, {
            type: 'behavioral',
            severity: 'warning',
            message: 'self_repair_triggered',
            metadata: { action: falseClaim.action, claim: falseClaim.claim },
          })
          messages.push({
            role: 'system',
            content: `[Correction] Your draft falsely claimed "${falseClaim.claim}" — but ${falseClaim.action} IS available right now. Rewrite your reply: either perform the action by calling the tool, or tell the customer it is happening. Never claim it is impossible.`,
          })
          continue // same round index — the repair replaces the rejected draft
        }
        // Clean draft (or repair already spent): flush the buffered events
        // in order, byte-identical to what live streaming would have sent.
        for (const buffered of bufferedContent.splice(0)) yield buffered
        finalContent += roundContent
        break
      }

      // Process tool calls
      // (defensive: a stream that ended tool_calls-last has already flushed)
      for (const buffered of bufferedContent.splice(0)) yield buffered
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

        // Gateway parity (A3.5/M4): LLM-initiated commits emit the SAME
        // confirm_required card as GUI-initiated ones. Previously only the
        // synthetic path did, so chat-initiated sign_dnt deadlocked — the
        // model told the customer to confirm a card that never rendered
        // (2026-07-06 sign_dnt 80-turn loop).
        if (pipelineResult.toolResult.envelope?.outcome === 'requires_confirmation') {
          const { confirmToken: _staleToken, ...materialArgs } = (tc.arguments ?? {}) as Record<string, unknown>
          yield {
            event: 'ui_action',
            data: {
              type: 'confirm_required',
              payload: {
                tool: tc.name,
                confirmToken: pipelineResult.toolResult.envelope.confirmToken,
                args: materialArgs,
                preview: pipelineResult.toolResult.envelope.data,
              },
            },
          }
        }

        messages.push({
          role: 'tool',
          content: serializeToolResultForModel(pipelineResult.toolResult),
          toolCallId: tc.id,
        })

      }

      // Re-derive exposure after every applied commit round (A3.4, T1.D5):
      // the tool list, the executor wall, and a compact state message all
      // refresh so a same-turn commit chain stays legal end-to-end.
      const roundEnvelopes = roundToolCalls
        .map((tc) => resultMap.get(tc.id)?.pipelineResult.toolResult.envelope)
        .filter((e): e is NonNullable<typeof e> => e !== undefined)
      turnEnvelopes.push(...roundEnvelopes)
      for (const tc of roundToolCalls) {
        const entry = resultMap.get(tc.id)
        if (!entry) continue
        if (getToolDefinition(tc.name)?.kind === 'commit') {
          turnWritingResults.push({ tool: tc.name, hasEnvelope: entry.pipelineResult.toolResult.envelope !== undefined })
        }
        const env = entry.pipelineResult.toolResult.envelope
        if (env?.outcome === 'rejected' && env.reason === 'not_exposed') {
          turnExecutorRejections.push({ tool: tc.name, reason: 'not_exposed' })
        }
      }
      // F2.2: the shared refresh emits one post_commit legality entry per
      // APPLIED envelope this round; state/actions are the post-round
      // recompute.
      yield* refreshAfterAppliedCommits(roundEnvelopes, round)

      // T19: _autoChain on the AGENT path — the consent travels with the
      // submission regardless of actor (T8 wired the hop for gui/synthetic
      // commits only; an email typed in prose authorizes the send exactly
      // like a card submit). Same contract as the synthetic hop: only an
      // APPLIED commit chains, the hop executes AFTER the round refresh so
      // the executor wall reflects the post-commit world, and the cap is
      // EXACTLY ONE hop per declaring commit — the chained result's own
      // _autoChain is ignored (only the model's round calls are scanned).
      for (const tc of writing) {
        const entry = resultMap.get(tc.id)
        if (!entry) continue
        const chain = extractAutoChain(entry.pipelineResult.toolResult)
        if (!chain) continue
        const chainTc: ToolCall = { id: `${tc.id}_auto`, name: chain.tool, arguments: chain.args }
        const chainResult = yield* runGuiToolCall(chainTc, 'agent', round)
        messages.push(...seedSyntheticLoopMessages(chainTc, chainResult.toolResult))
        const chainEnvelope = chainResult.toolResult.envelope
        if (chainEnvelope) {
          yield* refreshAfterAppliedCommits([chainEnvelope], round)
        }
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
    conversationMode: state.conversationMode,
    complianceResult: state.complianceResult,
  }

  // F2.4 (T14.D3): mechanical invariant monitors — findings become turn
  // anomalies, flowing into TurnTrace, the turn:end event, TurnDebug and
  // the drawer badge below.
  try {
    const findings = evaluateTurnInvariants({
      briefingRecommendedActions: recommendedActionsFromBriefing(exposure?.state.nextBestAction),
      availableActions: exposure?.actions.available ?? [],
      executorRejections: turnExecutorRejections,
      writingToolResults: turnWritingResults,
      ledgerDispositions: turnEnvelopes.map((e) => e.disposition).filter((d): d is 'fresh' | 'replay' => d !== undefined),
      confirmTokenReissues: turnEnvelopes.filter((e) => e.outcome === 'requires_confirmation').length,
    })
    for (const f of findings) {
      recordTurnAnomaly(state.traceId, { type: 'behavioral', severity: f.severity, message: f.code, metadata: f.detail })
    }
  } catch (err) {
    logWarn({ layer: 'orchestrator', category: 'invariant_monitor', message: 'invariant evaluation failed', context: { conversationId: state.conversationId }, error: err })
  }

  void prisma.turnTrace.create({
    data: {
      conversationId: state.conversationId,
      messageIndex: state.userMessageIndex,
      phases: JSON.parse(JSON.stringify(state.phases)),
      inputTokens: state.totalInputTokens || null,
      outputTokens: state.totalOutputTokens || null,
      // A1: null (not 0) when no LLM call ran, so pre-A1 and no-call rows
      // read the same to the aggregators.
      cacheReadTokens: state.llmCalls > 0 ? state.totalCacheReadTokens : null,
      cacheWriteTokens: state.llmCalls > 0 ? state.totalCacheWriteTokens : null,
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
      totalCacheReadTokens: state.totalCacheReadTokens,
      totalCacheWriteTokens: state.totalCacheWriteTokens,
      llmCalls: state.llmCalls,
      cacheHitCalls: state.cacheHitCalls,
      toolDefChars: JSON.stringify(tools ?? []).length,
    },
  })

  // Persist the full debug record for this turn. Always-on (no debug gate),
  // fire-and-forget, errors swallowed inside persistTurnDebug.
  void persistTurnDebug({
    conversationId: state.conversationId,
    messageIndex: state.userMessageIndex,
    traceId: state.traceId,
    events: state.debugEvents,
  })

  // Card-state SSOT (spec 2026-07-20 §2): the turn's authoritative card
  // set — the client reconciles rendered cards against it; absence of a
  // key means resolved/superseded. Same failure posture as turn-debug
  // persistence: never break the turn.
  try {
    const cards = await deriveActiveCards(state.conversationId)
    yield { event: 'cards_state', data: { cards } }
  } catch (err) {
    logError({ layer: 'orchestrator', category: 'cards_state', message: 'deriveActiveCards failed at turn end', context: { conversationId: state.conversationId }, error: err })
  }

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
  } // end pipeline() (P1-12 guard wrapper)
}

// ==============================================
// HELPERS
// ==============================================

