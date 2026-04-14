import { describe, it, expect, vi, beforeEach } from 'vitest'
import { driveConversation } from '@/lib/simulation/driver'
import type { Persona, ScriptedScenario } from '@/lib/simulation/types'

vi.mock('@/lib/simulation/sse-client', () => ({
  createSimulationConversation: vi.fn().mockResolvedValue({ customerId: 'cust-1', conversationId: 'conv-1' }),
  setSimulationChannel: vi.fn().mockResolvedValue(undefined),
  sendSimulationMessage: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    simulationConversation: {
      create: vi.fn().mockResolvedValue({ id: 'sc-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Da, sunt interesat' } }],
        }),
      },
    }
  },
}))

import { sendSimulationMessage } from '@/lib/simulation/sse-client'

const mockSend = vi.mocked(sendSimulationMessage)

const testPersona: Persona = {
  slug: 'test-persona',
  name: 'Test User',
  age: 35,
  language: 'ro',
  occupation: 'Tester',
  familySize: 2,
  hasChildren: false,
  incomeLevel: 'medium',
  motivations: ['testing'],
  personality: 'Direct, gives short answers.',
  objectionTypes: [],
  maxTurns: 5,
  expectedOutcome: 'purchase',
}

describe('driveConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs a scripted scenario to completion on terminal UI action', async () => {
    const scenario: ScriptedScenario = {
      slug: 'test-scenario',
      name: 'Test Scenario',
      personaSlug: 'test-persona',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'message', text: 'Buna ziua' } },
      ],
    }

    // Turn 0 (opening)
    mockSend.mockResolvedValueOnce({
      content: 'Buna! Cu ce te pot ajuta?',
      toolsCalled: [], uiActions: [], errors: [],
      done: { messageId: 'm1' }, rawEvents: [],
    })
    // Turn 1 (scripted step response)
    mockSend.mockResolvedValueOnce({
      content: 'Perfect!',
      toolsCalled: [],
      uiActions: [{ type: 'show_payment_success', payload: {} }],
      errors: [], done: { messageId: 'm2' }, rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.conversationId).toBe('conv-1')
    expect(result.turnCount).toBeGreaterThan(0)
  })

  it('stops on abandon response', async () => {
    const scenario: ScriptedScenario = {
      slug: 'abandon-test',
      name: 'Abandon Test',
      personaSlug: 'test-persona',
      steps: [
        { trigger: { type: 'turn', number: 1 }, response: { type: 'abandon' } },
      ],
    }

    mockSend.mockResolvedValueOnce({
      content: 'Buna!', toolsCalled: [], uiActions: [],
      errors: [], done: { messageId: 'm1' }, rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('ABANDONED')
  })

  it('records error when SSE returns errors', async () => {
    mockSend.mockResolvedValueOnce({
      content: '', toolsCalled: [], uiActions: [],
      errors: ['Service unavailable'], done: null, rawEvents: [],
    })

    const result = await driveConversation({
      persona: testPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('Service unavailable')
  })

  it('respects maxTurns limit', async () => {
    const limitedPersona = { ...testPersona, maxTurns: 2 }

    mockSend.mockResolvedValue({
      content: 'response', toolsCalled: [], uiActions: [],
      errors: [], done: { messageId: 'm1' }, rawEvents: [],
    })

    const result = await driveConversation({
      persona: limitedPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(result.turnCount).toBeLessThanOrEqual(2)
  })
})
