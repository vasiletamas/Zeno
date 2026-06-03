/**
 * Tool Pipeline
 *
 * Thin wrapper around the tool executor. This is the top-level entry point
 * for tool calls during a conversation turn — it just executes the tool and
 * returns a PipelineResult, with uniform error handling.
 *
 * The legacy workflow gate + step-transition machinery has been retired:
 * `WorkflowSession` records are never created in the current (phase-derived)
 * architecture, so the gate/transition branches were dead. The
 * `_workflowSession` parameter is kept only so the existing call sites in the
 * orchestrator don't need editing.
 */

import type { ToolContext, PipelineResult } from './types'
import { executeTool } from './executor'
import { logError } from '@/lib/errors/logger'

// ==============================================
// PIPELINE
// ==============================================

/**
 * Execute a tool and return its result.
 *
 * @param name             - Tool name
 * @param args             - Raw arguments
 * @param context          - Tool context
 * @param _workflowSession - Unused (always null in the current architecture); kept for call-site compatibility
 * @param traceId          - Optional trace ID for event bus instrumentation
 * @returns PipelineResult — tool result
 */
export async function executeToolWithPipeline(
  name: string,
  args: unknown,
  context: ToolContext,
  _workflowSession?: unknown | null,
  traceId?: string,
): Promise<PipelineResult> {
  try {
    const toolResult = await executeTool(name, args, context, 'CUSTOMER', traceId)
    return { toolResult }
  } catch (err: unknown) {
    logError({
      layer: 'tool',
      category: 'execution_error',
      message: `Tool execution failed: "${name}"`,
      context: { toolName: name },
      error: err,
    })
    return { toolResult: { success: false, error: 'Tool execution failed.' } }
  }
}
