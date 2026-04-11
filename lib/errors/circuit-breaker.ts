import { CircuitOpenError } from './types'
import { logWarn, logError } from './logger'

export interface CircuitBreakerOptions {
  name: string
  failureThreshold: number
  resetTimeoutMs: number
  monitorWindowMs: number
}

type CircuitState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private readonly name: string
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly monitorWindowMs: number

  private _state: CircuitState = 'closed'
  private failures: number[] = []
  private openedAt: number | null = null

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name
    this.failureThreshold = options.failureThreshold
    this.resetTimeoutMs = options.resetTimeoutMs
    this.monitorWindowMs = options.monitorWindowMs
  }

  get state(): CircuitState {
    if (this._state === 'open' && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this._state = 'half-open'
        logWarn({
          layer: 'gateway',
          category: 'circuit_open',
          message: `Circuit "${this.name}" transitioned to half-open`,
          context: { circuit: this.name },
        })
      }
    }
    return this._state
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state
    if (currentState === 'open') {
      throw new CircuitOpenError(this.name)
    }
    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (err) {
      this.onFailure()
      throw err
    }
  }

  recordSuccess(): void {
    this.onSuccess()
  }

  recordFailure(error: unknown): void {
    this.onFailure()
  }

  reset(): void {
    this._state = 'closed'
    this.failures = []
    this.openedAt = null
  }

  private onSuccess(): void {
    if (this._state === 'half-open') {
      this._state = 'closed'
      this.failures = []
      this.openedAt = null
      logWarn({
        layer: 'gateway',
        category: 'circuit_open',
        message: `Circuit "${this.name}" closed — probe succeeded`,
        context: { circuit: this.name },
      })
    }
    this.failures = []
  }

  private onFailure(): void {
    const now = Date.now()
    if (this._state === 'half-open') {
      this.tripOpen(now)
      return
    }
    this.failures = this.failures.filter((t) => now - t < this.monitorWindowMs)
    this.failures.push(now)
    if (this.failures.length >= this.failureThreshold) {
      this.tripOpen(now)
    }
  }

  private tripOpen(now: number): void {
    this._state = 'open'
    this.openedAt = now
    logError({
      layer: 'gateway',
      category: 'circuit_open',
      message: `Circuit "${this.name}" opened — ${this.failureThreshold} failures in ${this.monitorWindowMs}ms`,
      context: { circuit: this.name, failures: this.failures.length },
    })
  }
}
