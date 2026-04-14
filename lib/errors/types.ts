// lib/errors/types.ts

// ==============================================
// ERROR SEVERITY & LAYER
// ==============================================

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'fatal'
export type ErrorLayer = 'provider' | 'gateway' | 'orchestrator' | 'tool' | 'api' | 'self-improvement' | 'simulation'

// ==============================================
// CUSTOM ERROR CLASSES
// ==============================================

/**
 * Thrown when a circuit breaker is open and rejects a call.
 */
export class CircuitOpenError extends Error {
  readonly circuitName: string

  constructor(circuitName: string) {
    super(`Circuit breaker "${circuitName}" is open — call rejected`)
    this.name = 'CircuitOpenError'
    this.circuitName = circuitName
  }
}

/**
 * Thrown when an operation exceeds its deadline.
 */
export class TimeoutError extends Error {
  readonly timeoutMs: number
  readonly operation: string

  constructor(operation: string, timeoutMs: number) {
    super(`Operation "${operation}" timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}
