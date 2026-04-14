/**
 * Customer Simulation — Shared Types
 */

// ==============================================
// PARSED TURN (matches e2e/lib/sse-parser.ts)
// ==============================================

export interface ParsedTurn {
  content: string
  toolsCalled: string[]
  uiActions: { type: string; payload: Record<string, unknown> }[]
  errors: string[]
  done: Record<string, unknown> | null
  rawEvents: { event: string; data: unknown }[]
}

// ==============================================
// PERSONA
// ==============================================

export interface Persona {
  slug: string
  name: string
  age: number
  language: 'ro' | 'en'
  occupation: string
  familySize: number
  hasChildren: boolean
  incomeLevel: 'low' | 'medium' | 'high'
  motivations: string[]
  personality: string
  objectionTypes: string[]
  maxTurns: number
  expectedOutcome: 'purchase' | 'abandon' | 'escalate'
}

// ==============================================
// SCRIPTED SCENARIOS
// ==============================================

export interface ScenarioStep {
  trigger:
    | { type: 'turn'; number: number }
    | { type: 'ui_action'; actionType: string }
    | { type: 'contains'; text: string }
  response:
    | { type: 'message'; text: string }
    | { type: 'action'; action: { type: string; payload: Record<string, unknown> } }
    | { type: 'abandon' }
}

export interface ScriptedScenario {
  slug: string
  name: string
  personaSlug: string
  steps: ScenarioStep[]
}

// ==============================================
// CONFIGURATION
// ==============================================

export interface SimulationConfig {
  runScripted: boolean
  runFreeform: boolean
  freeformCount: number
  personas?: string[]
  concurrency: number
  runBatchAfter: boolean
  trigger: 'cli' | 'admin' | 'scheduled'
}

export const DEFAULT_CONFIG: SimulationConfig = {
  runScripted: true,
  runFreeform: true,
  freeformCount: 10,
  concurrency: 3,
  runBatchAfter: true,
  trigger: 'cli',
}

// ==============================================
// RESULTS
// ==============================================

export interface ConversationResult {
  conversationId: string
  personaSlug: string
  scenarioType: 'scripted' | 'freeform'
  scenarioSlug: string | null
  status: 'COMPLETED' | 'FAILED' | 'ABANDONED'
  turnCount: number
  durationMs: number
  error: string | null
  lastTurn: ParsedTurn | null
}

export interface RunResult {
  runId: string
  status: 'COMPLETED' | 'FAILED'
  totalScenarios: number
  completedCount: number
  failedCount: number
  conversations: ConversationResult[]
  errors: string[]
  durationMs: number
}
