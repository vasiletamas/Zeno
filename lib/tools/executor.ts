/**
 * Tool Executor
 *
 * Single-tool execution: validate -> permission check -> execute handler.
 * Never throws — all errors are caught and returned as ToolResult.
 */

import type { ToolContext, ToolResult, UserRole } from './types'
import { getToolHandler, getToolDefinition } from './registry'
import { validateToolArgs } from './validation'
import { checkPermission } from './permissions'
import { isToolCacheable, getCachedResult, setCachedResult } from './cache'
import { getToolCircuit } from './circuit-state'
import { TimeoutError } from '@/lib/errors/types'
import { logError, logWarn } from '@/lib/errors/logger'
import { eventBus } from '@/lib/events'

// ==============================================
// TIMEOUT UTILITY
// ==============================================

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

/**
 * Execute a single tool by name.
 *
 * @param name     - Registered tool name
 * @param args     - Raw arguments (will be validated)
 * @param context  - Execution context (customer, conversation, etc.)
 * @param userRole - Caller's role for permission check (defaults to CUSTOMER)
 * @param traceId  - Optional trace ID for event bus instrumentation
 * @returns ToolResult — always resolves, never throws
 */
export async function executeTool(
  name: string,
  args: unknown,
  context: ToolContext,
  userRole: UserRole = 'CUSTOMER',
  traceId?: string,
): Promise<ToolResult> {
  // 1. Check tool exists
  const definition = getToolDefinition(name)
  if (!definition) {
    return {
      success: false,
      error: `Unknown tool: "${name}"`,
    }
  }

  const handler = getToolHandler(name)
  if (!handler) {
    return {
      success: false,
      error: `No handler registered for tool: "${name}"`,
    }
  }

  // 2. Validate arguments
  const validation = validateToolArgs(name, args)
  if (!validation.valid) {
    return {
      success: false,
      error: `Validation failed for "${name}": ${validation.errors?.join('; ') ?? 'unknown error'}`,
    }
  }

  // 3. Permission check
  const permission = checkPermission(name, userRole)
  if (!permission.allowed) {
    return {
      success: false,
      error: permission.reason ?? `Permission denied for "${name}".`,
    }
  }

  // 3b. Cache check (before circuit breaker — cache hits don't need circuit)
  if (isToolCacheable(name)) {
    const cached = getCachedResult(name, validation.data ?? {})
    if (cached) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[ToolExecutor] ${name} cache hit`)
      }
      if (traceId) {
        const now = Date.now()
        eventBus.emit({ type: 'tool:start', traceId, toolName: name, args: (validation.data ?? {}) as Record<string, unknown> })
        eventBus.emit({ type: 'tool:end', traceId, toolName: name, durationMs: 0, success: cached.success, cached: true })
      }
      return cached
    }
  }

  // 4. Circuit breaker gate
  const circuit = getToolCircuit(name)
  if (circuit.state === 'open') {
    logWarn({
      layer: 'tool',
      category: 'circuit_open',
      message: `Tool "${name}" circuit is open — rejecting call`,
      context: { toolName: name },
    })
    return {
      success: false,
      error: 'Tool temporarily unavailable. Please try a different approach or try again shortly.',
    }
  }

  // 5. Execute handler with timeout
  const execStart = Date.now()
  if (traceId) {
    eventBus.emit({ type: 'tool:start', traceId, toolName: name, args: (validation.data ?? {}) as Record<string, unknown> })
  }

  try {
    const result = await withTimeout(
      () => handler(validation.data ?? {}, context),
      `tool:${name}`,
    )
    const durationMs = Date.now() - execStart

    circuit.recordSuccess()

    if (traceId) {
      eventBus.emit({ type: 'tool:end', traceId, toolName: name, durationMs, success: result.success, cached: false })
    }

    // Cache successful results for cacheable tools
    if (result.success && isToolCacheable(name)) {
      setCachedResult(name, validation.data ?? {}, result)
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[ToolExecutor] ${name} completed in ${durationMs}ms (success=${result.success})`,
      )
    }

    return result
  } catch (err: unknown) {
    const durationMs = Date.now() - execStart
    circuit.recordFailure(err)

    if (traceId) {
      eventBus.emit({ type: 'tool:end', traceId, toolName: name, durationMs, success: false, cached: false })
    }

    const message = err instanceof Error ? err.message : 'Tool execution failed'
    logError({
      layer: 'tool',
      category: 'executor',
      message: `Tool "${name}" threw during execution`,
      context: { toolName: name },
      error: err,
    })
    return {
      success: false,
      error: message,
    }
  }
}
