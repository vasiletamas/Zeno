import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSimulation, isSimulationRunning } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'

vi.mock('@/lib/simulation/driver', () => ({
  driveConversation: vi.fn().mockResolvedValue({
    conversationId: 'conv-1',
    personaSlug: 'quick-buyer',
    scenarioType: 'scripted',
    scenarioSlug: 'happy-path',
    status: 'COMPLETED',
    turnCount: 10,
    durationMs: 5000,
    error: null,
    lastTurn: null,
  }),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    simulationRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
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

import { driveConversation } from '@/lib/simulation/driver'
import { prisma } from '@/lib/db'
import { runDailyBatch } from '@/lib/self-improvement/batch-runner'

describe('runSimulation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs scripted-only config', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(6)
    expect(vi.mocked(driveConversation)).toHaveBeenCalledTimes(6)
  })

  it('runs freeform-only config', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 3,
      concurrency: 2,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.status).toBe('COMPLETED')
    expect(result.totalScenarios).toBe(3)
    expect(vi.mocked(driveConversation)).toHaveBeenCalledTimes(3)
  })

  it('creates SimulationRun record', async () => {
    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'admin',
    }

    await runSimulation(config)
    expect(vi.mocked(prisma.simulationRun.create)).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: 'admin',
        status: 'RUNNING',
      }),
    })
  })

  it('triggers batch when runBatchAfter is true', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 1,
      concurrency: 1,
      runBatchAfter: true,
      trigger: 'cli',
    }

    await runSimulation(config)
    expect(vi.mocked(runDailyBatch)).toHaveBeenCalledOnce()
  })

  it('does not trigger batch when runBatchAfter is false', async () => {
    const config: SimulationConfig = {
      runScripted: false,
      runFreeform: true,
      freeformCount: 1,
      concurrency: 1,
      runBatchAfter: false,
      trigger: 'cli',
    }

    await runSimulation(config)
    expect(vi.mocked(runDailyBatch)).not.toHaveBeenCalled()
  })

  it('handles mixed failures gracefully', async () => {
    vi.mocked(driveConversation)
      .mockResolvedValueOnce({
        conversationId: 'c1', personaSlug: 'p1', scenarioType: 'scripted',
        scenarioSlug: 's1', status: 'COMPLETED', turnCount: 5,
        durationMs: 1000, error: null, lastTurn: null,
      })
      .mockResolvedValueOnce({
        conversationId: 'c2', personaSlug: 'p2', scenarioType: 'scripted',
        scenarioSlug: 's2', status: 'FAILED', turnCount: 2,
        durationMs: 500, error: 'API error', lastTurn: null,
      })
      .mockResolvedValue({
        conversationId: 'c3', personaSlug: 'p3', scenarioType: 'scripted',
        scenarioSlug: 's3', status: 'COMPLETED', turnCount: 5,
        durationMs: 1000, error: null, lastTurn: null,
      })

    const config: SimulationConfig = {
      runScripted: true,
      runFreeform: false,
      freeformCount: 0,
      concurrency: 3,
      runBatchAfter: false,
      trigger: 'cli',
    }

    const result = await runSimulation(config)
    expect(result.failedCount).toBe(1)
    expect(result.completedCount).toBe(5)
    expect(result.errors).toHaveLength(1)
  })

  it('isSimulationRunning returns false when idle', () => {
    expect(isSimulationRunning()).toBe(false)
  })
})
