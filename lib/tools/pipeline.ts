/**
 * Tool Pipeline
 *
 * Workflow gate + tool execution + transition evaluation.
 * This is the top-level entry point for tool calls during a conversation turn.
 *
 * Flow:
 *  1. Workflow gate: check if the tool is allowed at the current step (or always-allowed)
 *  2. Execute the tool via executor.ts
 *  3. On success: evaluate step transitions against tool result
 *  4. If transition matches: update WorkflowSession.currentStepId, load new step
 *  5. Return PipelineResult with tool result + optional transition info
 */

import type { ToolContext, ToolResult, PipelineResult } from './types'
import { isAlwaysAllowed, getToolDefinition } from './registry'
import { executeTool } from './executor'
import { prisma } from '@/lib/db'
import { logError, logWarn } from '@/lib/errors/logger'

// ==============================================
// WORKFLOW SESSION TYPE (minimal, for pipeline input)
// ==============================================

interface WorkflowSessionInput {
  id: string
  currentStepId: string
  workflowId: string
}

// ==============================================
// PIPELINE
// ==============================================

/**
 * Execute a tool within the workflow pipeline.
 *
 * @param name             - Tool name
 * @param args             - Raw arguments
 * @param context          - Tool context
 * @param workflowSession  - Active workflow session (null if no workflow)
 * @param traceId          - Optional trace ID for event bus instrumentation
 * @returns PipelineResult — tool result + optional transition
 */
export async function executeToolWithPipeline(
  name: string,
  args: unknown,
  context: ToolContext,
  workflowSession?: WorkflowSessionInput | null,
  traceId?: string,
): Promise<PipelineResult> {
  // -----------------------------------------------
  // 1. Workflow gate
  // -----------------------------------------------
  if (workflowSession && !isAlwaysAllowed(name)) {
    const gateResult = await checkWorkflowGate(name, workflowSession.currentStepId)
    if (!gateResult.allowed) {
      return {
        toolResult: {
          success: false,
          error: gateResult.reason ?? `Tool "${name}" is not allowed at the current workflow step.`,
          message: gateResult.reason ?? undefined,
        },
      }
    }
  }

  // -----------------------------------------------
  // 2. Execute tool
  // -----------------------------------------------
  const toolResult = await executeTool(name, args, context, 'CUSTOMER', traceId)

  // -----------------------------------------------
  // 3. Evaluate transitions (only on success + active workflow)
  // -----------------------------------------------
  if (!toolResult.success || !workflowSession) {
    return { toolResult }
  }

  try {
    const transition = await evaluateTransitions(
      workflowSession,
      name,
      toolResult,
    )
    return { toolResult, transition: transition ?? undefined }
  } catch (err: unknown) {
    // Transition evaluation errors must not fail the tool result
    logError({
      layer: 'tool',
      category: 'transition_error',
      message: `Transition evaluation failed after tool "${name}"`,
      context: { toolName: name },
      error: err,
    })
    return { toolResult, transitionError: true }
  }
}

// ==============================================
// WORKFLOW GATE
// ==============================================

interface GateResult {
  allowed: boolean
  reason?: string
}

/**
 * Check if a tool is in the current step's allowedTools list.
 */
async function checkWorkflowGate(
  toolName: string,
  currentStepId: string,
): Promise<GateResult> {
  try {
    const step = await prisma.workflowStep.findUnique({
      where: { id: currentStepId },
      select: { allowedTools: true, code: true },
    })

    if (!step) {
      return { allowed: false, reason: 'Current workflow step not found.' }
    }

    if (step.allowedTools.length === 0) {
      // Empty allowedTools = all tools are allowed at this step
      return { allowed: true }
    }

    if (step.allowedTools.includes(toolName)) {
      return { allowed: true }
    }

    return {
      allowed: false,
      reason: `Tool "${toolName}" is not allowed at step "${step.code}". Allowed: ${step.allowedTools.join(', ')}.`,
    }
  } catch (err: unknown) {
    logError({
      layer: 'tool',
      category: 'db_error',
      message: `Workflow gate check failed for tool "${toolName}"`,
      context: { toolName, currentStepId },
      error: err,
    })
    // On DB error, deny access — fail closed for security
    return { allowed: false }
  }
}

// ==============================================
// TRANSITION EVALUATION
// ==============================================

/**
 * Query StepTransition records for the current step, check conditions
 * against the tool name and result, and advance the workflow if matched.
 */
async function evaluateTransitions(
  session: WorkflowSessionInput,
  toolName: string,
  toolResult: ToolResult,
): Promise<PipelineResult['transition'] | null> {
  // Load transitions from the current step, ordered by priority
  const transitions = await prisma.stepTransition.findMany({
    where: { fromStepId: session.currentStepId },
    include: { toStep: true },
    orderBy: { priority: 'desc' },
  })

  if (transitions.length === 0) return null

  // Derive condition value from the tool name + result
  const conditionValue = deriveConditionValue(toolName, toolResult)
  if (!conditionValue) return null

  // Find the first matching transition
  const matched = transitions.find((t) => {
    if (t.conditionType === 'tool_success' && t.conditionValue === toolName) {
      return true
    }
    if (t.conditionType === 'tool_result' && t.conditionValue === conditionValue) {
      return true
    }
    if (t.conditionType === 'condition' && t.conditionValue === conditionValue) {
      return true
    }
    return false
  })

  if (!matched) return null

  // Load current step info for the "previous" side
  const previousStep = await prisma.workflowStep.findUnique({
    where: { id: session.currentStepId },
    select: { code: true },
  })

  // Advance the session to the new step
  await prisma.workflowSession.update({
    where: { id: session.id },
    data: { currentStepId: matched.toStepId },
  })

  const newStep = matched.toStep

  return {
    previousStepCode: previousStep?.code ?? 'unknown',
    newStepCode: newStep.code,
    newStepName: newStep.name,
    newStepInstructions: newStep.agentInstructions,
    newStepAutoTool: newStep.autoTool,
  }
}

// ==============================================
// CONDITION DERIVATION
// ==============================================

/**
 * Map a tool name + result to a condition value string that can be matched
 * against StepTransition.conditionValue entries in the database.
 */
function deriveConditionValue(
  toolName: string,
  toolResult: ToolResult,
): string | null {
  if (!toolResult.success) return null

  const data = toolResult.data ?? {}

  switch (toolName) {
    case 'save_dnt_answer':
      return data.isComplete ? 'dnt_questions_complete' : null
    case 'sign_dnt':
      return data.signed ? 'dnt_signed' : null
    case 'start_application':
    case 'resume_application':
      return data.applicationId ? 'application_started' : null
    case 'save_application_answer':
      return data.isComplete ? 'application_complete' : null
    case 'generate_quote':
      return data.quoteId ? 'quote_generated' : null
    case 'accept_quote':
      return data.policyId ? 'policy_issued' : null
    case 'check_bd_eligibility':
      return data.eligible ? 'bd_eligible' : 'bd_not_eligible'
    case 'set_conversation_product':
      return data.productId ? 'product_selected' : null
    default:
      // Generic: tool completed successfully
      return `${toolName}_success`
  }
}
