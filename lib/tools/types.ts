/**
 * Tool-Specific Types
 *
 * These types are for the tool execution layer only.
 * LLM-facing types (ToolCall, LLMToolDefinition) live in lib/llm/providers/types.ts.
 */

// ==============================================
// EXECUTION CLASSIFICATION
// ==============================================

export type ExecutionMode = 'blocking' | 'background'
export type UserRole = 'CUSTOMER' | 'ADMIN' | 'OPERATOR'

// ==============================================
// TOOL DEFINITION
// ==============================================

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema for LLM
  executionMode: ExecutionMode
  customerVisible: boolean
  statusMessage: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean
  allowedRoles: UserRole[]
  sideEffects?: boolean     // default true — tools with no side effects can run in parallel
  cacheable?: boolean       // default false — opt-in to result caching
  cacheTtlMs?: number       // default 300_000 (5 minutes) — TTL for cached results
}

// ==============================================
// HANDLER TYPES
// ==============================================

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult>

export interface ToolResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
  uiAction?: { type: string; payload: Record<string, unknown> }
}

export interface ToolContext {
  customerId: string
  conversationId: string
  language: 'en' | 'ro'
  product?: {
    id: string
    code: string
    name: { en: string; ro: string }
    insuranceType: string
  }
  application?: {
    id: string
    status: string
    currentQuestionIndex: number
  }
  quote?: {
    id: string
    status: string
    premiumAnnual: number
    premiumMonthly: number
  }
  policy?: {
    id: string
    status: string
    premiumMonthly: number
    premiumAnnual: number
    paymentFrequency: string | null
  }
  workflowSession?: {
    id: string
    workflowId: string
    currentStepId: string
    currentStepCode: string
    data: unknown
  }
}

// ==============================================
// PIPELINE RESULT
// ==============================================

export interface PipelineResult {
  toolResult: ToolResult
  transition?: {
    previousStepCode: string
    newStepCode: string
    newStepName: string
    newStepInstructions: string | null
    newStepAutoTool: string | null
  }
  transitionError?: boolean
}
