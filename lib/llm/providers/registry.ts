/**
 * Provider Registry + Failover
 *
 * Singleton management of LLM providers and resilient call execution
 * with retry + cross-provider failover.
 */

import type { LLMProviderInterface } from './types'
import { OpenAIProvider } from './openai'
import { AnthropicProvider } from './anthropic'
import { LLMError, classifyError, isRetryable, shouldFailover } from '@/lib/llm/errors'
import { logWarn } from '@/lib/errors/logger'

// ==============================================
// PROVIDER REGISTRY
// ==============================================

const providers = new Map<string, LLMProviderInterface>()

/**
 * Get a provider by name. Returns a singleton instance.
 * Supported names: 'OPENAI', 'ANTHROPIC' (matching Prisma LLMProvider enum).
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
    default:
      throw new Error(
        `Unknown LLM provider: ${name}. Available: OPENAI, ANTHROPIC`,
      )
  }

  providers.set(key, provider)
  return provider
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
): Promise<T> {
  let lastError: unknown

  // Attempt primary with retries
  try {
    return await executeWithRetries(
      () => fn(primary.provider, primary.model),
      2,         // maxRetries
      [1000, 3000], // backoff delays
    )
  } catch (err) {
    lastError = err
    const errorClass = classifyError(err)

    // If should failover and we have a fallback, try it
    if (shouldFailover(errorClass) && fallback) {
      logWarn({
        layer: 'gateway',
        category: 'failover',
        message: `Primary provider down, failing over to fallback`,
        context: { fallbackModel: fallback.model },
      })
      try {
        return await fn(fallback.provider, fallback.model)
      } catch (fallbackErr) {
        lastError = fallbackErr
      }
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
  delays: number[],
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
    const delay = delays[attempt] ?? delays[delays.length - 1]
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
