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
import { logError } from '@/lib/errors/logger'

/**
 * Execute a single tool by name.
 *
 * @param name     - Registered tool name
 * @param args     - Raw arguments (will be validated)
 * @param context  - Execution context (customer, conversation, etc.)
 * @param userRole - Caller's role for permission check (defaults to CUSTOMER)
 * @returns ToolResult — always resolves, never throws
 */
export async function executeTool(
  name: string,
  args: unknown,
  context: ToolContext,
  userRole: UserRole = 'CUSTOMER',
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

  // 4. Execute handler
  try {
    const startMs = Date.now()
    const result = await handler(validation.data ?? {}, context)
    const durationMs = Date.now() - startMs

    if (process.env.NODE_ENV !== 'production') {
      console.log(
        `[ToolExecutor] ${name} completed in ${durationMs}ms (success=${result.success})`,
      )
    }

    return result
  } catch (err: unknown) {
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
