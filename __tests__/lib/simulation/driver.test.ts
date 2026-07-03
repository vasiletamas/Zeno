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
    conversation: {
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
import { prisma } from '@/lib/db'

const mockSend = vi.mocked(sendSimulationMessage)
const mockConversationUpdate = vi.mocked(prisma.conversation.update)
const mockSimConvUpdate = vi.mocked(prisma.simulationConversation.update)

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

  it('records COMPLETED on SimulationConversation only — Conversation.status is never written (D2, contradiction #11)', async () => {
    // Turn 0 (opening) — agent immediately emits a terminal UI action
    mockSend.mockResolvedValueOnce({
      content: 'Polita emisa!',
      toolsCalled: [],
      uiActions: [{ type: 'show_policy_issued', payload: {} }],
      errors: [], done: { messageId: 'm1' }, rawEvents: [],
    })

    await driveConversation({
      persona: testPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(mockSimConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    )
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it('records ABANDONED on SimulationConversation only on scripted abandon (D2)', async () => {
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

    await driveConversation({
      persona: testPersona,
      scenario,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    expect(mockSimConvUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: 'conv-1' },
        data: expect.objectContaining({ status: 'ABANDONED' }),
      }),
    )
    expect(mockConversationUpdate).not.toHaveBeenCalled()
  })

  it('does NOT touch Conversation.status on FAILED (system error, not customer outcome)', async () => {
    mockSend.mockResolvedValueOnce({
      content: '', toolsCalled: [], uiActions: [],
      errors: ['Service unavailable'], done: null, rawEvents: [],
    })

    await driveConversation({
      persona: testPersona,
      scenario: null,
      runId: 'run-1',
      baseUrl: 'http://localhost:3000',
      answersMap: {},
    })

    // No call to conversation.update with status — system errors shouldn't pollute scoring
    const statusCalls = mockConversationUpdate.mock.calls.filter(
      ([arg]) => (arg as { data?: { status?: unknown } } | undefined)?.data?.status !== undefined,
    )
    expect(statusCalls).toHaveLength(0)
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
