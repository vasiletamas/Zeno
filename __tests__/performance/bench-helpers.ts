/**
 * Benchmark infrastructure for performance tests.
 *
 * Provides:
 *  - collectTimings()      — subscribe to event bus and collect phase timings
 *  - assertPhaseUnder()    — assert a phase completed within a time budget
 *  - assertPhasesParallel()— assert two phases overlapped (ran in parallel)
 *  - createMockProvider()  — LLMProviderInterface with configurable latency/content
 */

import { eventBus } from '@/lib/events'
import type { ZenoEvent } from '@/lib/events'
import type {
  LLMProviderInterface,
  ChatRequest,
  ChatResponse,
  ChatWithToolsRequest,
  ChatWithToolsResponse,
  StreamChunk,
  TokenUsage,
} from '@/lib/llm/providers/types'

// ============================================================
// TYPES
// ============================================================

export type PhaseTimings = { [phase: string]: number }
export type PhaseSpans = { [phase: string]: { startMs: number; endMs: number } }

export interface TimingResult {
  timings: PhaseTimings
  spans: PhaseSpans
}

export interface TimingCollector {
  finish: () => TimingResult
}

// ============================================================
// collectTimings
// ============================================================

/**
 * Subscribe to the event bus for phase:start and phase:end events matching the
 * given traceId. Returns a collector with a finish() method that unsubscribes and
 * returns the accumulated timings and spans.
 */
export function collectTimings(traceId: string): TimingCollector {
  const startTimes: { [phase: string]: number } = {}
  const timings: PhaseTimings = {}
  const spans: PhaseSpans = {}

  const unsubStart = eventBus.on('phase:start', (event: ZenoEvent) => {
    if (event.type !== 'phase:start') return
    if (event.traceId !== traceId) return
    startTimes[event.phase] = event.timestamp
  })

  const unsubEnd = eventBus.on('phase:end', (event: ZenoEvent) => {
    if (event.type !== 'phase:end') return
    if (event.traceId !== traceId) return
    timings[event.phase] = event.durationMs
    const startMs = startTimes[event.phase] ?? 0
    spans[event.phase] = {
      startMs,
      endMs: startMs + event.durationMs,
    }
  })

  return {
    finish(): TimingResult {
      unsubStart()
      unsubEnd()
      return { timings, spans }
    },
  }
}

// ============================================================
// assertPhaseUnder
// ============================================================

/**
 * Assert that the given phase completed within maxMs.
 * Throws a descriptive error if the phase is missing or over budget.
 */
export function assertPhaseUnder(timings: PhaseTimings, phase: string, maxMs: number): void {
  const duration = timings[phase]
  if (duration === undefined) {
    throw new Error(
      `assertPhaseUnder: phase "${phase}" not found in timings. ` +
        `Available phases: ${Object.keys(timings).join(', ') || '(none)'}`
    )
  }
  if (duration > maxMs) {
    throw new Error(
      `assertPhaseUnder: phase "${phase}" took ${duration}ms, exceeded limit of ${maxMs}ms ` +
        `(over by ${duration - maxMs}ms)`
    )
  }
}

// ============================================================
// assertPhasesParallel
// ============================================================

/**
 * Assert that phaseA and phaseB overlapped by at least minOverlapMs.
 * Calculates overlap = max(0, min(endA, endB) - max(startA, startB)).
 * Throws if either span is missing or overlap < minOverlapMs.
 */
export function assertPhasesParallel(
  spans: PhaseSpans,
  phaseA: string,
  phaseB: string,
  minOverlapMs: number
): void {
  const spanA = spans[phaseA]
  const spanB = spans[phaseB]

  if (!spanA) {
    throw new Error(`assertPhasesParallel: span for phase "${phaseA}" not found`)
  }
  if (!spanB) {
    throw new Error(`assertPhasesParallel: span for phase "${phaseB}" not found`)
  }

  const overlapStart = Math.max(spanA.startMs, spanB.startMs)
  const overlapEnd = Math.min(spanA.endMs, spanB.endMs)
  const overlap = Math.max(0, overlapEnd - overlapStart)

  if (overlap < minOverlapMs) {
    throw new Error(
      `assertPhasesParallel: phases "${phaseA}" and "${phaseB}" did not overlap sufficiently. ` +
        `Overlap was ${overlap}ms, required at least ${minOverlapMs}ms. ` +
        `${phaseA}: [${spanA.startMs}–${spanA.endMs}], ${phaseB}: [${spanB.startMs}–${spanB.endMs}]`
    )
  }
}

// ============================================================
// createMockProvider
// ============================================================

export interface MockProviderOptions {
  /** Artificial delay in ms before resolving/yielding (default: 0) */
  latencyMs?: number
  /** Content string returned in responses (default: 'mock response') */
  content?: string
  /** Token usage to report (default: 10/20/30) */
  usage?: TokenUsage
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create a mock LLMProviderInterface with configurable latency, content, and
 * token usage. All four methods are implemented:
 *  - chat / chatWithTools — resolve after latencyMs with the configured response
 *  - chatStream / chatStreamWithTools — yield a content chunk then a done chunk
 */
export function createMockProvider(options: MockProviderOptions = {}): LLMProviderInterface {
  const latencyMs = options.latencyMs ?? 0
  const content = options.content ?? 'mock response'
  const usage: TokenUsage = options.usage ?? {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  }

  const buildResponse = (): ChatResponse => ({
    content,
    finishReason: 'stop',
    usage,
    rawMessage: { role: 'assistant', content },
  })

  return {
    async chat(_request: ChatRequest): Promise<ChatResponse> {
      if (latencyMs > 0) await sleep(latencyMs)
      return buildResponse()
    },

    async chatWithTools(_request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
      if (latencyMs > 0) await sleep(latencyMs)
      return { ...buildResponse(), toolCalls: [] }
    },

    async *chatStream(_request: ChatRequest): AsyncIterable<StreamChunk> {
      if (latencyMs > 0) await sleep(latencyMs)
      yield { type: 'content', content }
      yield { type: 'done', usage }
    },

    async *chatStreamWithTools(_request: ChatWithToolsRequest): AsyncIterable<StreamChunk> {
      if (latencyMs > 0) await sleep(latencyMs)
      yield { type: 'content', content }
      yield { type: 'done', usage }
    },
  }
}
