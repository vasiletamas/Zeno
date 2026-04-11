# Error Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-tier error recovery system so no user ever sees a broken chat — every failure either recovers silently or surfaces a clean error message.

**Architecture:** Layered error boundaries at Provider → Gateway → Orchestrator → API. Circuit breakers prevent hammering broken providers/tools. Structured JSON logging replaces all console.error/warn calls. Queued retry on total provider outage gives ~35 seconds of recovery time.

**Tech Stack:** TypeScript, Vitest, Next.js API routes, nanoid (new dependency)

**Spec:** `docs/superpowers/specs/2026-04-11-error-recovery-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `lib/errors/types.ts` | CircuitOpenError, TimeoutError, severity/layer/category type definitions |
| `lib/errors/logger.ts` | Structured JSON error logger (logError, logWarn, logFatal) |
| `lib/errors/circuit-breaker.ts` | Generic circuit breaker with 3 states |
| `__tests__/lib/errors/logger.test.ts` | Logger unit tests |
| `__tests__/lib/errors/circuit-breaker.test.ts` | Circuit breaker unit tests |
| `__tests__/lib/errors/gateway-hardening.test.ts` | Gateway retry/failover tests |
| `__tests__/lib/tools/executor-hardening.test.ts` | Tool circuit breaker and timeout tests |

### Modified Files
| File | Changes |
|------|---------|
| `lib/llm/errors.ts` | Add CircuitOpenError, TimeoutError to classification |
| `lib/llm/providers/registry.ts` | Adaptive backoff, jitter, retry-after, circuit breaker, streaming recovery |
| `lib/tools/executor.ts` | Per-tool circuit breaker, 15s timeout |
| `lib/tools/pipeline.ts` | Gate security fix, transition error flag, structured logging |
| `lib/tools/types.ts` | Add transitionError to PipelineResult |
| `lib/chat/orchestrator.ts` | Error boundaries on all steps, queued retry, 90s timeout |
| `lib/chat/stream-handler.ts` | Add 'status' to SSEEvent type |
| `app/api/chat/route.ts` | Error catch, timeout, concurrency guard, error SSE format |
| 9 files with console.error/warn | Replace with structured logger calls |

---

## Task 1: Install nanoid + Error Types

**Files:**
- Create: `lib/errors/types.ts`

- [ ] **Step 1: Install nanoid**

Run: `npm install nanoid`
Expected: Added to package.json dependencies

- [ ] **Step 2: Create error types**

```typescript
// lib/errors/types.ts

// ==============================================
// ERROR SEVERITY & LAYER
// ==============================================

export type ErrorSeverity = 'warn' | 'error' | 'fatal'
export type ErrorLayer = 'provider' | 'gateway' | 'orchestrator' | 'tool' | 'api'

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
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add lib/errors/types.ts package.json package-lock.json
git commit -m "feat: add error types — CircuitOpenError, TimeoutError"
```

---

## Task 2: Structured Error Logger

**Files:**
- Create: `lib/errors/logger.ts`
- Create: `__tests__/lib/errors/logger.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/errors/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'

describe('Structured Logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('logError outputs valid JSON with all required fields', () => {
    const errorId = logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Provider returned 503',
      context: { provider: 'openai', attempt: 2 },
    })

    expect(errorId).toBeTruthy()
    expect(consoleErrorSpy).toHaveBeenCalledOnce()

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.errorId).toBe(errorId)
    expect(output.severity).toBe('error')
    expect(output.layer).toBe('gateway')
    expect(output.category).toBe('transient')
    expect(output.message).toBe('Provider returned 503')
    expect(output.context.provider).toBe('openai')
    expect(output.timestamp).toBeDefined()
  })

  it('logWarn sets severity to warn', () => {
    logWarn({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Step 4 context assembly failed, using fallback',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.severity).toBe('warn')
  })

  it('logFatal sets severity to fatal', () => {
    logFatal({
      layer: 'api',
      category: 'internal',
      message: 'Unhandled exception in API route',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.severity).toBe('fatal')
  })

  it('extracts stack trace from Error objects', () => {
    const err = new Error('something broke')
    logError({
      layer: 'tool',
      category: 'tool_failure',
      message: 'Tool execution failed',
      error: err,
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.stack).toContain('something broke')
  })

  it('handles non-Error error values gracefully', () => {
    logError({
      layer: 'provider',
      category: 'unknown',
      message: 'Weird error',
      error: 'just a string',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.stack).toBeUndefined()
  })

  it('generates unique error IDs', () => {
    const id1 = logError({ layer: 'gateway', category: 'transient', message: 'err1' })
    const id2 = logError({ layer: 'gateway', category: 'transient', message: 'err2' })
    expect(id1).not.toBe(id2)
  })

  it('defaults context to empty object when not provided', () => {
    logError({ layer: 'tool', category: 'timeout', message: 'timed out' })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.context).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/errors/logger.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/errors/logger.ts
import { nanoid } from 'nanoid'
import type { ErrorSeverity, ErrorLayer } from './types'

// ==============================================
// TYPES
// ==============================================

export interface ErrorEntry {
  errorId: string
  severity: ErrorSeverity
  layer: ErrorLayer
  category: string
  context: Record<string, unknown>
  message: string
  timestamp: string
  stack?: string
}

export interface ErrorInput {
  layer: ErrorLayer
  category: string
  message: string
  context?: Record<string, unknown>
  error?: unknown
}

// ==============================================
// CORE LOGGING
// ==============================================

function emitLog(severity: ErrorSeverity, input: ErrorInput): string {
  const errorId = nanoid(12)

  const entry: ErrorEntry = {
    errorId,
    severity,
    layer: input.layer,
    category: input.category,
    context: input.context ?? {},
    message: input.message,
    timestamp: new Date().toISOString(),
  }

  if (input.error instanceof Error) {
    entry.stack = input.error.stack
  }

  console.error(JSON.stringify(entry))

  return errorId
}

// ==============================================
// PUBLIC API
// ==============================================

export function logError(input: ErrorInput): string {
  return emitLog('error', input)
}

export function logWarn(input: ErrorInput): string {
  return emitLog('warn', input)
}

export function logFatal(input: ErrorInput): string {
  return emitLog('fatal', input)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/errors/logger.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/errors/logger.ts __tests__/lib/errors/logger.test.ts
git commit -m "feat: add structured JSON error logger"
```

---

## Task 3: Circuit Breaker

**Files:**
- Create: `lib/errors/circuit-breaker.ts`
- Create: `__tests__/lib/errors/circuit-breaker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/errors/circuit-breaker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker } from '@/lib/errors/circuit-breaker'
import { CircuitOpenError } from '@/lib/errors/types'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in closed state', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    expect(cb.state).toBe('closed')
  })

  it('executes function normally when closed', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    const result = await cb.execute(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it('opens after failureThreshold failures', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    }

    expect(cb.state).toBe('open')
  })

  it('rejects immediately with CircuitOpenError when open', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')

    await expect(cb.execute(() => Promise.resolve(1))).rejects.toThrow(CircuitOpenError)
  })

  it('transitions to half-open after resetTimeout', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')

    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')
  })

  it('closes on success in half-open state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')

    await cb.execute(() => Promise.resolve('ok'))
    expect(cb.state).toBe('closed')
  })

  it('re-opens on failure in half-open state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')

    await cb.execute(() => Promise.reject(new Error('still broken'))).catch(() => {})
    expect(cb.state).toBe('open')
  })

  it('does not open if failures are outside monitorWindow', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 2000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})

    // Wait for monitor window to expire
    vi.advanceTimersByTime(2001)

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})

    // Only 1 failure in current window, not 3
    expect(cb.state).toBe('closed')
  })

  it('reset() returns to closed state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')

    cb.reset()
    expect(cb.state).toBe('closed')
  })

  it('recordSuccess clears failure count', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})

    cb.recordSuccess()

    // After a success, one more failure should not trip the breaker
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('closed')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/errors/circuit-breaker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// lib/errors/circuit-breaker.ts
import { CircuitOpenError } from './types'
import { logWarn, logError } from './logger'

// ==============================================
// TYPES
// ==============================================

export interface CircuitBreakerOptions {
  name: string
  failureThreshold: number
  resetTimeoutMs: number
  monitorWindowMs: number
}

type CircuitState = 'closed' | 'open' | 'half-open'

// ==============================================
// CIRCUIT BREAKER
// ==============================================

export class CircuitBreaker {
  private readonly name: string
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly monitorWindowMs: number

  private _state: CircuitState = 'closed'
  private failures: number[] = [] // timestamps of recent failures
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

  // ==============================================
  // PRIVATE
  // ==============================================

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
    // In closed state, clear failure history on success
    this.failures = []
  }

  private onFailure(): void {
    const now = Date.now()

    if (this._state === 'half-open') {
      this.tripOpen(now)
      return
    }

    // Prune failures outside monitor window
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/errors/circuit-breaker.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/errors/circuit-breaker.ts __tests__/lib/errors/circuit-breaker.test.ts
git commit -m "feat: add circuit breaker with 3-state transitions"
```

---

## Task 4: Update Error Classification

**Files:**
- Modify: `lib/llm/errors.ts`

- [ ] **Step 1: Add CircuitOpenError and TimeoutError to classification**

Add at the end of the `classifyError` function (before the default return), add detection for the new error types. Also import them:

Add import at top of `lib/llm/errors.ts`:

```typescript
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'
```

In the `classifyError` function, add before the final `return 'unknown'`:

```typescript
  // Circuit breaker errors
  if (error instanceof CircuitOpenError) return 'provider_down'

  // Timeout errors
  if (error instanceof TimeoutError) return 'transient'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 3: Run existing error tests**

Run: `npx vitest run __tests__/lib/llm/errors.test.ts`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add lib/llm/errors.ts
git commit -m "feat: classify CircuitOpenError and TimeoutError in error system"
```

---

## Task 5: Gateway Hardening

**Files:**
- Modify: `lib/llm/providers/registry.ts`
- Create: `__tests__/lib/errors/gateway-hardening.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/errors/gateway-hardening.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateBackoff } from '@/lib/llm/providers/registry'

describe('calculateBackoff', () => {
  it('returns exponential delay with base 500ms', () => {
    const delay = calculateBackoff(0)
    // 500 * 2^0 = 500, plus jitter 0-500 → range [500, 1000]
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1000)
  })

  it('doubles delay for each attempt', () => {
    // Attempt 1: 500 * 2^1 = 1000 + jitter → [1000, 1500]
    const delay = calculateBackoff(1)
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it('caps delay at 10 seconds', () => {
    const delay = calculateBackoff(10) // 500 * 2^10 = 512000 → capped at 10000
    expect(delay).toBeLessThanOrEqual(10500) // 10000 + 500 jitter max
  })

  it('uses retryAfter when provided', () => {
    const delay = calculateBackoff(0, 5000)
    expect(delay).toBe(5000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/errors/gateway-hardening.test.ts`
Expected: FAIL — `calculateBackoff` not exported

- [ ] **Step 3: Read and update registry.ts**

Read `lib/llm/providers/registry.ts` fully. Then make these changes:

Add imports at the top:

```typescript
import { CircuitBreaker } from '@/lib/errors/circuit-breaker'
import { CircuitOpenError } from '@/lib/errors/types'
import { logError, logWarn } from '@/lib/errors/logger'
```

Add module-level circuit breakers after the provider map:

```typescript
// Circuit breakers — one per provider
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
```

Add the exported backoff calculation function:

```typescript
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 10_000
const MAX_JITTER_MS = 500

export function calculateBackoff(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs

  const exponential = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
  const jitter = Math.floor(Math.random() * MAX_JITTER_MS)
  return exponential + jitter
}
```

Update `executeWithRetries` to use adaptive backoff instead of fixed delays:
- Replace the fixed `delays` parameter with the `calculateBackoff` function
- Add retry-after header parsing from 429 errors
- Wrap calls with the provider circuit breaker

Update `callWithFailover` to check circuit state before attempting each provider:
- If primary circuit is open, skip straight to fallback
- If both circuits are open, throw `CircuitOpenError`
- Replace `console.warn` with `logWarn`

For streaming: add a try/catch wrapper in the gateway's `stream()` method that catches mid-stream errors and yields `{ type: 'error', content: 'Stream interrupted' }` instead of throwing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/errors/gateway-hardening.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Run all tests for regressions**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/llm/providers/registry.ts __tests__/lib/errors/gateway-hardening.test.ts
git commit -m "feat: gateway hardening — adaptive backoff, circuit breaker, streaming recovery"
```

---

## Task 6: Tool Execution Hardening

**Files:**
- Modify: `lib/tools/executor.ts`
- Create: `__tests__/lib/tools/executor-hardening.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/tools/executor-hardening.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '@/lib/tools/executor'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves if operation completes within timeout', async () => {
    const result = await withTimeout(
      () => Promise.resolve('done'),
      'test-op',
      1000,
    )
    expect(result).toBe('done')
  })

  it('rejects with TimeoutError if operation exceeds timeout', async () => {
    const { TimeoutError } = await import('@/lib/errors/types')

    const slow = () => new Promise((resolve) => setTimeout(resolve, 5000))
    const promise = withTimeout(slow, 'slow-op', 1000)

    vi.advanceTimersByTime(1001)

    await expect(promise).rejects.toThrow(TimeoutError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/tools/executor-hardening.test.ts`
Expected: FAIL — `withTimeout` not exported

- [ ] **Step 3: Update executor.ts**

Read `lib/tools/executor.ts` fully. Then make these changes:

Add imports:

```typescript
import { CircuitBreaker } from '@/lib/errors/circuit-breaker'
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'
import { logError, logWarn } from '@/lib/errors/logger'
```

Add module-level tool circuit breakers:

```typescript
const toolCircuits = new Map<string, CircuitBreaker>()

function getToolCircuit(name: string): CircuitBreaker {
  let cb = toolCircuits.get(name)
  if (!cb) {
    cb = new CircuitBreaker({
      name: `tool:${name}`,
      failureThreshold: 3,
      resetTimeoutMs: 20_000,
      monitorWindowMs: 30_000,
    })
    toolCircuits.set(name, cb)
  }
  return cb
}
```

Add the timeout utility (exported for testing):

```typescript
const TOOL_TIMEOUT_MS = 15_000

export async function withTimeout<T>(
  fn: () => Promise<T>,
  operation: string,
  timeoutMs: number = TOOL_TIMEOUT_MS,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs),
    ),
  ])
}
```

In the `executeTool` function, wrap the handler call:
- Check circuit breaker before execution
- If circuit is open → return `{ success: false, error: "Tool temporarily unavailable. Please try a different approach or try again shortly." }`
- Wrap handler with `withTimeout`
- On success → `recordSuccess()` on circuit
- On failure → `recordFailure()` on circuit
- Replace `console.error` with `logError`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/tools/executor-hardening.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Run all tests for regressions**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/tools/executor.ts __tests__/lib/tools/executor-hardening.test.ts
git commit -m "feat: tool executor hardening — per-tool circuit breaker, 15s timeout"
```

---

## Task 7: Pipeline Hardening

**Files:**
- Modify: `lib/tools/pipeline.ts`
- Modify: `lib/tools/types.ts`

- [ ] **Step 1: Add transitionError to PipelineResult**

In `lib/tools/types.ts`, add to the `PipelineResult` interface:

```typescript
export interface PipelineResult {
  toolResult: ToolResult
  transition?: {
    previousStepCode: string
    newStepCode: string
    newStepName: string
    newStepInstructions: string | null
    newStepAutoTool: string | null
  }
  transitionError?: boolean  // true if transition evaluation failed
}
```

- [ ] **Step 2: Update pipeline.ts**

Read `lib/tools/pipeline.ts` fully. Make these changes:

Add import:

```typescript
import { logError, logWarn } from '@/lib/errors/logger'
```

In `checkWorkflowGate`:
- Change the DB error catch block from `return { allowed: true }` to `return { allowed: false }`
- Replace `console.error` with `logError({ layer: 'tool', category: 'db_error', message: '...', context: { toolName, currentStepId }, error: err })`

In `evaluateTransitions`:
- Replace `console.error` with `logError({ layer: 'tool', category: 'transition_error', ... })`
- Set `transitionError: true` on the returned PipelineResult

In `executeToolWithPipeline`:
- Replace any `console.error` with `logError`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/tools/pipeline.ts lib/tools/types.ts
git commit -m "feat: pipeline hardening — gate security fix, transition error tracking, structured logging"
```

---

## Task 8: SSE Event Type Update

**Files:**
- Modify: `lib/chat/stream-handler.ts`

- [ ] **Step 1: Add 'status' to SSEEvent type**

In `lib/chat/stream-handler.ts`, update the SSEEvent interface to include the `'status'` event type needed for the queued retry status messages:

```typescript
export interface SSEEvent {
  event: 'content' | 'tool_start' | 'tool_complete' | 'ui_action' | 'error' | 'done' | 'status'
  data: Record<string, unknown>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add lib/chat/stream-handler.ts
git commit -m "feat: add 'status' event type to SSE handler"
```

---

## Task 9: Orchestrator Hardening

**Files:**
- Modify: `lib/chat/orchestrator.ts`

- [ ] **Step 1: Add imports**

Add to the top of `lib/chat/orchestrator.ts`:

```typescript
import { logError, logWarn, logFatal } from '@/lib/errors/logger'
import { CircuitOpenError, TimeoutError } from '@/lib/errors/types'
```

- [ ] **Step 2: Add pipeline timeout utility**

Add after the constants section:

```typescript
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
```

- [ ] **Step 3: Add error boundaries to Steps 1 and 2**

Wrap Steps 1 and 2 in try/catch. On DB error:
- Log with `logFatal({ layer: 'orchestrator', category: 'db_error', message: '...', context: { conversationId, customerId }, error: err })`
- Yield `{ event: 'error', data: { errorId, type: 'internal', message: 'Service temporarily unavailable', retryable: true } }`
- Return early from generator

- [ ] **Step 4: Add error boundaries to Steps 4 and 5**

Wrap Step 4 (context assembly) in try/catch. On failure:
- Log with `logWarn({ layer: 'orchestrator', category: 'db_error', ... })`
- Fall back to minimal sections: only `agentIdentity` and `constraints` from `agentConfig`

Wrap Step 5 (sliding window) in try/catch. On failure:
- Log with `logWarn`
- Fall back to empty window (just the user's message)

- [ ] **Step 5: Add queued retry to Step 7**

In the standard chat path, wrap the `gateway.stream` call. When `CircuitOpenError` is caught:
1. Emit `{ event: 'status', data: { type: 'processing', message: 'Un moment, reconectez...' } }`
2. Retry with backoff: 5s, 10s, 20s
3. If any retry succeeds, continue with the stream
4. If all retries fail, yield `{ event: 'error', data: { errorId, type: 'service_unavailable', message: 'Zeno este temporar indisponibil. Te rugam sa incerci din nou in cateva minute.', retryable: true } }`

- [ ] **Step 6: Add error boundary to Step 8**

Wrap Step 8 (save assistant message) in try/catch. On DB error:
- Log with `logError`
- Don't yield error to user — the response was already streamed

- [ ] **Step 7: Replace console.error in Steps 9 and 10**

Replace all `console.error` calls in background agent and turn trace sections with `logError` / `logWarn` calls with proper context.

- [ ] **Step 8: Wrap entire generator with timeout**

Add a top-level timeout race around the entire `chatTurnGenerator`. If 90 seconds elapse:
- Yield `{ event: 'error', data: { errorId, type: 'timeout', message: 'Request timed out', retryable: true } }`

- [ ] **Step 9: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add lib/chat/orchestrator.ts
git commit -m "feat: orchestrator hardening — error boundaries, queued retry, 90s timeout"
```

---

## Task 10: API Route Hardening

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Add imports**

```typescript
import { logError, logFatal } from '@/lib/errors/logger'
```

- [ ] **Step 2: Add per-conversation concurrency guard**

Add at module level:

```typescript
const inFlightRequests = new Map<string, number>()
const MAX_CONCURRENT_PER_CONVERSATION = 3
```

At the start of the POST handler, before processing:

```typescript
  const conversationId = parsed.data.conversationId
  if (conversationId) {
    const current = inFlightRequests.get(conversationId) ?? 0
    if (current >= MAX_CONCURRENT_PER_CONVERSATION) {
      return Response.json(
        { error: 'Too many concurrent requests for this conversation' },
        { status: 429 },
      )
    }
    inFlightRequests.set(conversationId, current + 1)
  }
```

In the finally block (or after the response is created), decrement:

```typescript
  if (conversationId) {
    const current = inFlightRequests.get(conversationId) ?? 1
    if (current <= 1) {
      inFlightRequests.delete(conversationId)
    } else {
      inFlightRequests.set(conversationId, current - 1)
    }
  }
```

- [ ] **Step 3: Wrap handleChatTurn with error catch**

Wrap the `handleChatTurn()` call in try/catch:

```typescript
  let stream: ReadableStream<Uint8Array>
  try {
    stream = handleChatTurn({ ... })
  } catch (err) {
    const errorId = logFatal({
      layer: 'api',
      category: 'internal',
      message: 'handleChatTurn threw synchronously',
      context: { conversationId },
      error: err,
    })
    return Response.json(
      { error: 'Internal server error', errorId },
      { status: 500 },
    )
  }
```

- [ ] **Step 4: Replace console.error with structured logger**

Replace the existing `console.error` in the catch block with `logError` or `logFatal` as appropriate.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: API route hardening — concurrency guard, error catch, structured logging"
```

---

## Task 11: Replace console.error/warn Across Codebase

**Files:**
- Modify: `lib/chat/reasoning-gate.ts`
- Modify: `lib/payments/post-payment.ts`
- Modify: `lib/tools/handlers/payment-handlers.ts`
- Modify: `lib/llm/providers/anthropic.ts`
- Modify: `lib/llm/providers/openai.ts`
- Modify: `lib/llm/gateway.ts` (if any remain)

- [ ] **Step 1: Search for remaining console.error/warn**

Run: `grep -rn "console\.\(error\|warn\)" lib/ app/ --include="*.ts" | grep -v node_modules | grep -v __tests__`

This shows all remaining instances. For each one:

- [ ] **Step 2: Replace each occurrence**

For each file with `console.error` or `console.warn`:
- Add `import { logError, logWarn } from '@/lib/errors/logger'`
- Replace `console.error(...)` with `logError({ layer, category, message, context, error })`
- Replace `console.warn(...)` with `logWarn({ layer, category, message, context })`

Use these layer assignments:
- `lib/llm/providers/*` → `layer: 'provider'`
- `lib/llm/gateway.ts` → `layer: 'gateway'`
- `lib/chat/*` → `layer: 'orchestrator'`
- `lib/tools/*` → `layer: 'tool'`
- `lib/payments/*` → `layer: 'tool'`
- `app/api/*` → `layer: 'api'`

- [ ] **Step 3: Verify no console.error/warn remain in lib/**

Run: `grep -rn "console\.\(error\|warn\)" lib/ --include="*.ts" | grep -v node_modules | grep -v __tests__`
Expected: No output (all replaced)

Note: `app/` may still have some in webhook routes and client components — those are acceptable (they're API boundaries that will be addressed when those routes get their own error handling).

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace all console.error/warn with structured logger"
```

---

## Task 12: Integration Smoke Test

**Files:**
- None (manual verification)

- [ ] **Step 1: Ensure database is running**

Run: `docker compose up -d`

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (old + new)

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Start dev server**

Run: `npm run dev`
Expected: Server starts without errors

- [ ] **Step 5: Send a test chat message**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}' \
  --no-buffer
```

Expected: SSE stream with content events, done event with errorId-free response. Check server logs for structured JSON error entries (if any warnings occurred).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete error recovery system — circuit breakers, structured logging, graceful degradation"
```

---

## Dependency Order

```
Task 1 (Error Types) ──────────────────┐
Task 2 (Structured Logger) ────────────┤
Task 3 (Circuit Breaker) ──────────────┤ depends on 1, 2
Task 4 (Error Classification) ─────────┤ depends on 1
Task 5 (Gateway Hardening) ────────────┤ depends on 2, 3, 4
Task 6 (Tool Executor Hardening) ──────┤ depends on 2, 3
Task 7 (Pipeline Hardening) ───────────┤ depends on 2
Task 8 (SSE Event Type) ──────────────┤ independent
Task 9 (Orchestrator Hardening) ───────┤ depends on 2, 5, 8
Task 10 (API Route Hardening) ─────────┤ depends on 2
Task 11 (Replace console.error/warn) ──┤ depends on 2
Task 12 (Integration Smoke) ───────────┘ depends on all
```

Tasks 1 and 2 are fully independent. Task 8 is independent. Tasks 7, 10, 11 only depend on Task 2.
