/**
 * Tool-Specific Types
 *
 * These types are for the tool execution layer only.
 * LLM-facing types (ToolCall, LLMToolDefinition) live in lib/llm/providers/types.ts.
 */

import type { PrismaClient, Prisma } from '@/lib/generated/prisma/client'
import type { CommitActor, CommitResult } from '@/lib/engines/domain-types'

/**
 * The db seam handlers write through (A2.4): the global client by default,
 * or the gateway-injected transaction handle (which lacks $transaction /
 * $executeRawUnsafe — hence the union, not `typeof prisma` alone).
 */
export type DbClient = PrismaClient | Prisma.TransactionClient

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
  /**
   * The gateway's typed consequence envelope (A2.9) — present on every commit
   * result. Serialized VERBATIM to the model; reads never carry one.
   */
  envelope?: CommitResult
  /**
   * Domain effects a COMMIT handler declares (B4: re_rating,
   * cascade_expand, questions_removed, terminal). The gateway merges them
   * into the envelope alongside its own advance_phase delta. The C1
   * consequence planner supersedes handler-declared effects when it lands.
   */
  effects?: CommitResult['effects']
  data?: Record<string, unknown>
  error?: string
  /**
   * Task 1.3 (D8): typed failure contract — set on every failing result by
   * the executor (lib/tools/failure-classification.ts) and serialized to the
   * model, so retry policy never has to be guessed from an error string.
   */
  errorCode?: 'transient' | 'precondition' | 'validation' | 'permanent'
  retryable?: boolean
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
  /**
   * Handler-driven CONDITIONAL confirmation (C1.5, T6.D3/T6.D6): returned
   * when the consequence plan demands confirmation and the request carried
   * no verified token (context.confirmed false). The gateway turns this
   * into a requires_confirmation envelope with a minted confirmToken; the
   * preview (the plan) is what the customer is asked to approve. A handler
   * returning this MUST NOT have written anything yet.
   */
  requiresConfirmation?: { preview: Record<string, unknown> }
  /**
   * D1.4: a SUCCESSFUL apply whose business outcome is a referral (state
   * changed: REFERRED + WorkItem) — the gateway emits outcome 'referred'
   * with this reason instead of 'applied'.
   */
  referred?: { reason: string }
}

export interface ToolContext {
  customerId: string
  conversationId: string
  language: 'en' | 'ro'
  /**
   * Handlers MUST route their writes through this client so a commit can run
   * inside the gateway's transaction (A2.4). buildToolContext sets the global
   * client; the gateway overrides it with the tx handle.
   */
  db: DbClient
  /**
   * Server-resolved commit actor (A2.9): 'gui' on the orchestrator's
   * synthetic-tool-call branch, 'agent' on the LLM tool loop. Recorded on
   * every CommitLedger row. Defaults to 'agent' when absent.
   */
  actor?: CommitActor
  /**
   * The current round's exposure set (A3.2): when present, the executor
   * hard-rejects any tool not in it (escalate_to_human excepted — the floor).
   * The orchestrator refreshes this after every applied commit round.
   */
  exposedTools?: string[]
  /**
   * C1.5 conditional confirmation: true when the request carried a
   * confirmToken the gateway verified against the current state
   * fingerprint. Handlers whose consequence plan demands confirmation
   * proceed only when this is set; otherwise they return
   * ToolResult.requiresConfirmation.
   */
  confirmed?: boolean
  /**
   * C1.5: the gateway-minted commit id — the CommitLedger row of this apply
   * is created with this id, so answer revisions written through the
   * consequence applier carry a real ledger reference in Answer.commitId.
   */
  commitId?: string
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
  /** D2.8: the live money truth for the payment phase — present when an
   *  un-superseded schedule exists (the policy may not exist yet). */
  schedule?: {
    frequency: string
    nextDueAmountMinor: number | null
    paidCount: number
    totalInstallments: number
  }
}

// ==============================================
// PIPELINE RESULT
// ==============================================

export interface PipelineResult {
  toolResult: ToolResult
}
