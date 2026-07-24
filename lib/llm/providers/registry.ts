/**
 * Provider Registry + Failover
 *
 * Singleton management of LLM providers and resilient call execution
 * with retry + cross-provider failover.
 */

import type { LLMProviderInterface } from './types'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { MoonshotProvider } from './moonshot'
import { LLMError, classifyError, isRetryable, shouldFailover } from '@/lib/llm/errors'
import { CircuitBreaker } from '@/lib/errors/circuit-breaker'
import { CircuitOpenError } from '@/lib/errors/types'
import { logWarn } from '@/lib/errors/logger'
import { eventBus } from '@/lib/events/event-bus'

// ==============================================
// PROVIDER REGISTRY
// ==============================================

const providers = new Map<string, LLMProviderInterface>()

/**
 * Get a provider by name. Returns a singleton instance.
 * Supported names: 'OPENAI', 'ANTHROPIC', 'MOONSHOT' (matching Prisma
 * LLMProvider enum). MOONSHOT serves the Kimi model family via Moonshot AI's
 * OpenAI-compatible API.
 */
export function getProvider(name: string): LLMProviderInterface {
  const key = name.toUpperCase()

  const existing = providers.get(key)
  if (existing) return existing

  let provider: LLMProviderInterface
  switch (key) {
    case 'OPENAI':
      provider = new OpenAIProvider()
      break
    case 'ANTHROPIC':
      provider = new AnthropicProvider()
      break
    case 'MOONSHOT':
      provider = new MoonshotProvider()
      break
    default:
      throw new Error(
        `Unknown LLM provider: ${name}. Available: OPENAI, ANTHROPIC, MOONSHOT`,
      )
  }

  providers.set(key, provider)
  return provider
}

// ==============================================
// CIRCUIT BREAKERS (per provider)
// ==============================================

const providerCircuits = new Map<string, CircuitBreaker>()

function getProviderCircuit(name: string): CircuitBreaker {
  let cb = providerCircuits.get(name)
  if (!cb) {
    cb = new CircuitBreaker({
      name: `provider:${name}`,
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      monitorWindowMs: 60_000,
    })
    providerCircuits.set(name, cb)
  }
  return cb
}

// ==============================================
// ADAPTIVE BACKOFF
// ==============================================

const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 10_000
const MAX_JITTER_MS = 500

export function calculateBackoff(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs
  const exponential = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
  const jitter = Math.floor(Math.random() * MAX_JITTER_MS)
  return exponential + jitter
}

// ==============================================
// FAILOVER
// ==============================================

interface ProviderTarget {
  provider: LLMProviderInterface
  model: string
}

/**
 * Execute an LLM call with retry + cross-provider failover.
 *
 * 1. Try fn(primary.provider, primary.model)
 * 2. On transient error: retry up to 2 times with backoff (1s, 3s)
 * 3. On provider_down error with fallback: try fn(fallback.provider, fallback.model)
 * 4. If all fail: throw LLMError with original cause
 */
export async function callWithFailover<T>(
  primary: ProviderTarget,
  fallback: ProviderTarget | null,
  fn: (provider: LLMProviderInterface, model: string) => Promise<T>,
  // P1-10: turn correlation for the real retry/failover events — optional so
  // non-turn callers (jobs, scripts) stay source-compatible
  signals?: { traceId?: string | null },
): Promise<T> {
  const traceId = signals?.traceId ?? null
  let lastError: unknown
  const primaryName = primary.model.split('/')[0] ?? primary.model
  const primaryCircuit = getProviderCircuit(primaryName)

  // Skip primary entirely if its circuit is open
  if (primaryCircuit.state !== 'open') {
    try {
      return await primaryCircuit.execute(() =>
        executeWithRetries(
          () => fn(primary.provider, primary.model),
          2, // maxRetries
          (attempt, delayMs, errorClass) => eventBus.emit({ type: 'llm:call:retry', traceId, provider: primaryName, model: primary.model, attempt, delayMs, errorClass }),
        ),
      )
    } catch (err) {
      lastError = err
      const errorClass = classifyError(err)

      // If should failover and we have a fallback, try it
      if (shouldFailover(errorClass) && fallback) {
        eventBus.emit({ type: 'llm:failover', traceId, fromModel: primary.model, toModel: fallback.model, errorClass })
        logWarn({
          layer: 'gateway',
          category: 'failover',
          message: `Primary provider down, failing over to fallback`,
          context: { fallbackModel: fallback.model },
        })
      } else if (!fallback) {
        throw new LLMError(
          `All LLM providers failed`,
          errorClass,
          'registry',
          undefined,
          lastError,
        )
      } else {
        throw err
      }
    }
  } else {
    if (fallback) {
      eventBus.emit({ type: 'llm:failover', traceId, fromModel: primary.model, toModel: fallback.model, errorClass: 'circuit_open' })
    }
    logWarn({
      layer: 'gateway',
      category: 'circuit_open',
      message: `Primary provider circuit open, skipping to fallback`,
      context: { provider: primaryName },
    })
  }

  // Attempt fallback
  if (fallback) {
    const fallbackName = fallback.model.split('/')[0] ?? fallback.model
    const fallbackCircuit = getProviderCircuit(fallbackName)

    if (fallbackCircuit.state === 'open') {
      throw new CircuitOpenError('all-providers')
    }

    try {
      return await fallbackCircuit.execute(() =>
        fn(fallback.provider, fallback.model),
      )
    } catch (fallbackErr) {
      lastError = fallbackErr
    }
  }

  // All attempts exhausted
  throw new LLMError(
    `All LLM providers failed`,
    classifyError(lastError),
    'registry',
    undefined,
    lastError,
  )
}

// ==============================================
// INTERNAL: RETRY WITH BACKOFF
// ==============================================

async function executeWithRetries<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  // P1-10: the ONLY place a real LLM retry is known — report it upward
  onRetry?: (attempt: number, delayMs: number, errorClass: string) => void,
): Promise<T> {
  let lastError: unknown

  // First attempt (not a retry)
  try {
    return await fn()
  } catch (err) {
    lastError = err
    const errorClass = classifyError(err)

    // Only retry transient errors
    if (!isRetryable(errorClass)) throw err
  }

  // Retry attempts
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const retryAfterMs = extractRetryAfter(lastError)
    const delay = calculateBackoff(attempt, retryAfterMs)

    onRetry?.(attempt + 1, delay, classifyError(lastError))
    logWarn({
      layer: 'gateway',
      category: 'retry',
      message: `Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
      context: { attempt, delay, retryAfterMs },
    })

    await sleep(delay)

    try {
      return await fn()
    } catch (err) {
      lastError = err
      const errorClass = classifyError(err)

      // Stop retrying if not transient
      if (!isRetryable(errorClass)) throw err
    }
  }

  // Retries exhausted
  throw lastError
}

/**
 * Try to extract a retry-after value (in ms) from an error's headers.
 * Both OpenAI and Anthropic SDK errors may include headers on the error object.
 */
function extractRetryAfter(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined

  const err = error as Record<string, unknown>

  // Check for headers object (OpenAI/Anthropic SDK errors)
  const headers = err.headers
  if (headers && typeof headers === 'object') {
    const h = headers as Record<string, unknown>
    const retryAfter = h['retry-after']
    if (typeof retryAfter === 'string') {
      const seconds = parseFloat(retryAfter)
      if (!isNaN(seconds)) return Math.ceil(seconds * 1000)
    }
    if (typeof retryAfter === 'number') {
      return Math.ceil(retryAfter * 1000)
    }
  }

  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
