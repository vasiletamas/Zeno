/**
 * Customer Simulation — Run Orchestrator
 *
 * Orchestrates scripted and freeform simulation runs with a concurrency pool,
 * persists results to SimulationRun, and optionally triggers the self-improvement batch.
 */

import { prisma } from '@/lib/db'
import { logInfo, logError } from '@/lib/errors/logger'
import { driveConversation } from '@/lib/simulation/driver'
import { ALL_PERSONAS, getPersona, DEFAULT_ANSWERS } from '@/lib/simulation/personas'
import { ALL_SCENARIOS } from '@/lib/simulation/scenarios'
import { runDailyBatch } from '@/lib/self-improvement/batch-runner'
import type { SimulationConfig, ConversationResult, RunResult } from '@/lib/simulation/types'

// ==============================================
// SINGLETON GUARD
// ==============================================

let running = false

export function isSimulationRunning(): boolean {
  return running
}

// ==============================================
// CONCURRENCY POOL
// ==============================================

/**
 * Runs tasks with at most `concurrency` tasks in flight simultaneously.
 * Returns results in completion order (not input order).
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = []
  const pool: Set<Promise<void>> = new Set()

  for (const task of tasks) {
    const p: Promise<void> = task().then(result => {
      results.push(result)
      pool.delete(p)
    })
    pool.add(p)

    if (pool.size >= concurrency) {
      await Promise.race(pool)
    }
  }

  // Drain remaining in-flight tasks
  await Promise.all(pool)
  return results
}

// ==============================================
// MAIN ORCHESTRATOR
// ==============================================

export async function runSimulation(config: SimulationConfig): Promise<RunResult> {
  if (running) {
    throw new Error('A simulation run is already in progress')
  }

  running = true
  const startTime = Date.now()
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000'

  // Create the SimulationRun record
  const run = await prisma.simulationRun.create({
    data: {
      trigger: config.trigger,
      status: 'RUNNING',
      config: config as Record<string, unknown>,
      totalScenarios: 0,
      completedCount: 0,
      failedCount: 0,
      errors: [],
    },
  })

  const runId = run.id
  const conversations: ConversationResult[] = []

  try {
    logInfo('simulation.runner', `Starting simulation run ${runId}`, { config })

    // -----------------------------------------------
    // SCRIPTED scenarios — run sequentially
    // -----------------------------------------------
    if (config.runScripted) {
      for (const scenario of ALL_SCENARIOS) {
        const persona = getPersona(scenario.personaSlug) ?? ALL_PERSONAS[0]
        const result = await driveConversation({
          persona,
          scenario,
          runId,
          baseUrl,
          answersMap: DEFAULT_ANSWERS,
        })
        conversations.push(result)
        logInfo('simulation.runner', `Scripted scenario done: ${scenario.slug}`, {
          status: result.status,
        })
      }
    }

    // -----------------------------------------------
    // FREEFORM conversations — run with concurrency pool
    // -----------------------------------------------
    if (config.runFreeform && config.freeformCount > 0) {
      // Determine persona pool (filter by slugs if provided, else all personas)
      const personaPool =
        config.personas && config.personas.length > 0
          ? ALL_PERSONAS.filter(p => config.personas!.includes(p.slug))
          : ALL_PERSONAS

      const effectivePersonaPool = personaPool.length > 0 ? personaPool : ALL_PERSONAS

      // Build task array — round-robin across persona pool
      const tasks = Array.from({ length: config.freeformCount }, (_, i) => {
        const persona = effectivePersonaPool[i % effectivePersonaPool.length]
        return (): Promise<ConversationResult> =>
          driveConversation({
            persona,
            scenario: null,
            runId,
            baseUrl,
            answersMap: DEFAULT_ANSWERS,
          })
      })

      const freeformResults = await runWithConcurrency(tasks, config.concurrency)
      for (const result of freeformResults) {
        conversations.push(result)
        logInfo('simulation.runner', `Freeform conversation done`, {
          personaSlug: result.personaSlug,
          status: result.status,
        })
      }
    }

    // -----------------------------------------------
    // Aggregate results
    // -----------------------------------------------
    const totalScenarios = conversations.length
    const failedConversations = conversations.filter(c => c.status === 'FAILED')
    const completedConversations = conversations.filter(c => c.status !== 'FAILED')
    const failedCount = failedConversations.length
    const completedCount = completedConversations.length
    const errors = failedConversations
      .filter(c => c.error !== null)
      .map(c => c.error as string)

    const overallStatus: RunResult['status'] =
      totalScenarios > 0 && failedCount / totalScenarios > 0.5 ? 'FAILED' : 'COMPLETED'

    const durationMs = Date.now() - startTime

    // Update the SimulationRun record
    await prisma.simulationRun.update({
      where: { id: runId },
      data: {
        status: overallStatus,
        totalScenarios,
        completedCount,
        failedCount,
        errors,
        completedAt: new Date(),
      },
    })

    logInfo('simulation.runner', `Run ${runId} finished`, {
      status: overallStatus,
      totalScenarios,
      completedCount,
      failedCount,
    })

    // -----------------------------------------------
    // Optional: trigger self-improvement batch
    // -----------------------------------------------
    if (config.runBatchAfter) {
      try {
        logInfo('simulation.runner', 'Triggering self-improvement batch after simulation')
        await runDailyBatch()
      } catch (batchErr) {
        logError('simulation.runner', 'Self-improvement batch failed (non-fatal)', batchErr)
      }
    }

    const result: RunResult = {
      runId,
      status: overallStatus,
      totalScenarios,
      completedCount,
      failedCount,
      conversations,
      errors,
      durationMs,
    }

    return result
  } finally {
    running = false
  }
}
