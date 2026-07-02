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

export type ToolKind = 'read' | 'commit' | 'internal'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema for LLM
  executionMode: ExecutionMode
  /**
   * Gateway routing class (A2.2): 'commit' tools mutate funnel state and are
   * executed ONLY through the commit gateway; 'read' tools stay on the plain
   * executor path; 'internal' tools are background subsystems never
   * gateway-routed.
   */
  kind: ToolKind
  /**
   * Gateway-enforced two-step confirmation (#8 step 4). Replaces the old
   * handler-supplied literal-true confirm flags.
   */
  requiresConfirmation?: boolean
  customerVisible: boolean
  statusMessage: { ro: string[]; en: string[] } | null
  alwaysAllowed: boolean
  allowedRoles: UserRole[]
  sideEffects?: boolean     // default true — tools with no side effects can run in parallel
  cacheable?: boolean       // default false — opt-in to result caching
  cacheTtlMs?: number       // default 300_000 (5 minutes) — TTL for cached results
  /**
   * Category of side effect for system-rendered confirmation lines.
   * If set, the tool's handler is expected to populate `ToolResult.confirmation`
   * on success. Read-only tools omit this field.
   * See docs/superpowers/specs/2026-05-20-zeno-tool-mediated-effects-design.md.
   */
  sideEffect?: 'save' | 'lifecycle' | 'consent' | 'quote'
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
  /**
   * Structured confirmation rendered by the system as a customer-facing
   * '✓ Label: Value' line. Only populated on success for side-effecting tools
   * (those with sideEffect: 'save' | 'lifecycle' | 'consent' | 'quote').
   * See docs/superpowers/specs/2026-05-20-zeno-tool-mediated-effects-design.md.
   */
  confirmation?: {
    category: 'save' | 'lifecycle' | 'consent' | 'quote'
    label: string
    value: string
    provenance?: string
    timestamp: string
  }
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
  activeSkillPacks?: string[]
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
