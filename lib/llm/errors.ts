/**
 * LLM Error Classification
 *
 * Classifies provider errors into actionable categories so the gateway
 * can decide whether to retry, failover, or surface the error.
 */

import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'

// ==============================================
// ERROR TYPES
// ==============================================

export type ErrorClass = 'provider_down' | 'transient' | 'validation' | 'unknown'

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly errorClass: ErrorClass,
    public readonly provider: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

// ==============================================
// ERROR CLASSIFICATION
// ==============================================

/**
 * Classify an unknown error into an ErrorClass.
 *
 * Both OpenAI and Anthropic SDK errors expose a `status` property
 * with the HTTP status code, so we check that first.
 */
export function classifyError(error: unknown): ErrorClass {
  // Extract HTTP status if present (both SDKs surface this)
  const status = getStatusCode(error)

  if (status !== undefined) {
    // Auth / billing — provider is effectively down for us
    if (status === 401 || status === 402 || status === 403) return 'provider_down'
    // Rate limit — transient, retry after backoff
    if (status === 429) return 'transient'
    // Bad request — caller's fault, no point retrying
    if (status === 400) return 'validation'
    // Not found — retired model or dead endpoint (P1-8): retrying the SAME
    // configuration can never succeed; the alternate provider can.
    if (status === 404) return 'provider_down'
    // Server errors — transient, retry or failover
    if (status === 500 || status === 502 || status === 503 || status === 504) return 'transient'
  }

  // Connection-level failures — provider unreachable
  const code = getErrorCode(error)
  if (code && /ECONN/i.test(code)) return 'provider_down'

  // Check message for connection keywords as fallback
  const message = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND/i.test(message)) return 'provider_down'

  // Circuit breaker errors
  if (error instanceof CircuitOpenError) return 'provider_down'

  // Timeout errors
  if (error instanceof TimeoutError) return 'transient'

  return 'unknown'
}

// ==============================================
// DECISION HELPERS
// ==============================================

/** Transient errors are safe to retry with backoff. */
export function isRetryable(errorClass: ErrorClass): boolean {
  return errorClass === 'transient'
}

/** Provider-down errors should trigger failover to the alternate provider. */
export function shouldFailover(errorClass: ErrorClass): boolean {
  return errorClass === 'provider_down'
}

// ==============================================
// INTERNAL HELPERS
// ==============================================

function getStatusCode(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as Record<string, unknown>).status === 'number'
  ) {
    return (error as Record<string, unknown>).status as number
  }
  return undefined
}

function getErrorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
  ) {
    return (error as Record<string, unknown>).code as string
  }
  return undefined
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (
    error !== null &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    return (error as Record<string, unknown>).message as string
  }
  return null
}

// ==============================================
// CONTEXT LENGTH OVERFLOW
// ==============================================

const CONTEXT_LENGTH_PATTERNS = [
  /context.length/i,
  /too.long/i,
  /maximum.context/i,
  /token.limit/i,
]

export function isContextLengthError(error: unknown): boolean {
  const status = getStatusCode(error)
  if (status !== 400) return false

  const message = getErrorMessage(error)
  if (!message) return false

  return CONTEXT_LENGTH_PATTERNS.some((p) => p.test(message))
}

export function parseTokenDeficit(error: unknown): number | null {
  const message = getErrorMessage(error)
  if (!message) return null

  // OpenAI format: "maximum context length is 128000 tokens ... resulted in 135000 tokens"
  const openaiMatch = message.match(
    /maximum context length is (\d+).*resulted in (\d+)/i,
  )
  if (openaiMatch) {
    const limit = parseInt(openaiMatch[1], 10)
    const actual = parseInt(openaiMatch[2], 10)
    return actual - limit
  }

  // Anthropic format: "150000 tokens > 128000 maximum"
  const anthropicMatch = message.match(/(\d+)\s*tokens?\s*>\s*(\d+)/i)
  if (anthropicMatch) {
    const actual = parseInt(anthropicMatch[1], 10)
    const limit = parseInt(anthropicMatch[2], 10)
    return actual - limit
  }

  return null
}
