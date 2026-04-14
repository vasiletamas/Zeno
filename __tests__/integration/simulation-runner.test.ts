import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSimulation } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'

vi.mock('@/lib/simulation/driver', () => ({
  driveConversation: vi.fn().mockImplementation(async (options: { persona: { slug: string }; scenario: { slug: string } | null }) => ({
    conversationId: `conv-${Math.random().toString(36).slice(2)}`,
    personaSlug: options.persona.slug,
    scenarioType: options.scenario ? 'scripted' : 'freeform',
    scenarioSlug: options.scenario?.slug ?? null,
    status: 'COMPLETED',
    turnCount: 10,
    durationMs: 3000,
    error: null,
    lastTurn: null,
  })),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    simulationRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-integration-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/self-improvement/batch-runner', () => ({
  runDailyBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
}))

vi.mock('@/lib/errors/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

import { runDailyBatch } from '@/lib/self-improvement/batch-runner'
import { driveConversation } from '@/lib/simulation/driver'

describe('simulation runner integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('full run: scripted + freeform + batch trigger', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: true,
      freeformCount: 3,
      concurrency: 2,
      runBatchAfter: true,
      trigger: 'cli',
    }

    const result = await runSimulation(config)

    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(9)  // 6 scripted + 3 freeform
    expect(result.completedCount).toBe(9)
    expect(result.failedCount).toBe(0)
    expect(result.conversations).toHaveLength(9)
    expect(vi.mocked(runDailyBatch)).toHaveBeenCalledOnce()
  })

  it('persona filter works for freeform runs', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 4,
      personas: ['skeptic', 'young-parent'],
      concurrency: 2,
      runBatchAfter: false,
      trigger: 'admin',
    }

    const result = await runSimulation(config)

    expect(result.conversations).toHaveLength(4)
    const slugs = new Set(result.conversations.map(c => c.personaSlug))
    expect(slugs.size).toBeLessThanOrEqual(2)
  })

  it('scripted scenarios use correct personas', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 1,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)

    expect(result.conversations).toHaveLength(6)
    // All scripted conversations should have scenarioType 'scripted'
    expect(result.conversations.every(c => c.scenarioType === 'scripted')).toBe(true)
    // Each should have a scenarioSlug
    expect(result.conversations.every(c => c.scenarioSlug !== null)).toBe(true)
    // driveConversation should have been called with scenario objects (not null)
    for (const call of vi.mocked(driveConversation).mock.calls) {
      expect(call[0].scenario).not.toBeNull()
    }
  })
})
