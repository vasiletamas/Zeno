import { describe, it, expect } from 'vitest'
import type {
  Persona,
  ScenarioStep,
  ScriptedScenario,
  SimulationConfig,
  ConversationResult,
  RunResult,
} from '@/lib/simulation/types'
import { DEFAULT_CONFIG } from '@/lib/simulation/types'

describe('simulation types', () => {
  it('Persona interface accepts a valid persona', () => {
    const persona: Persona = {
      slug: 'young-parent',
      name: 'Maria Popescu',
      age: 32,
      language: 'ro',
      occupation: 'Contabil',
      familySize: 4,
      hasChildren: true,
      incomeLevel: 'medium',
      motivations: ['protect family'],
      personality: 'warm, budget-conscious',
      objectionTypes: ['price_base'],
      maxTurns: 30,
      expectedOutcome: 'purchase',
    }
    expect(persona.slug).toBe('young-parent')
  })

  it('ScriptedScenario interface accepts steps with all trigger types', () => {
    const scenario: ScriptedScenario = {
      slug: 'happy-path',
      name: 'Happy Path',
      personaSlug: 'quick-buyer',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna!' } },
        { trigger: { type: 'ui_action', actionType: 'show_question' }, response: { type: 'message', text: 'Da' } },
        { trigger: { type: 'contains', text: 'pret' }, response: { type: 'abandon' } },
      ],
    }
    expect(scenario.steps).toHaveLength(3)
  })

  it('SimulationConfig has sensible defaults', () => {
    expect(DEFAULT_CONFIG.runScripted).toBe(true)
    expect(DEFAULT_CONFIG.runFreeform).toBe(true)
    expect(DEFAULT_CONFIG.freeformCount).toBe(10)
    expect(DEFAULT_CONFIG.concurrency).toBe(3)
    expect(DEFAULT_CONFIG.runBatchAfter).toBe(true)
    expect(DEFAULT_CONFIG.trigger).toBe('cli')
  })

  it('RunResult tracks completion stats', () => {
    const result: RunResult = {
      runId: 'test-id',
      status: 'COMPLETED',
      totalScenarios: 16,
      completedCount: 14,
      failedCount: 2,
      conversations: [],
      errors: [],
      durationMs: 60000,
    }
    expect(result.completedCount + result.failedCount).toBe(16)
  })
})
