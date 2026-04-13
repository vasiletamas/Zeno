/**
 * Batch Runner — orchestrates the 4-agent self-improvement pipeline.
 *
 * Scorer → Analyzer → Proposer → Tracker
 *
 * Each agent is wrapped in try/catch. If an agent fails,
 * subsequent agents do not run, but prior results are preserved.
 */

import { logError, logInfo } from '@/lib/errors/logger'
import { scoreConversations } from './scorer'
import { analyzeScores } from './analyzer'
import { generateProposals } from './proposer'
import { trackAdoptedProposals } from './tracker'
import type { BatchResult } from './types'

let isRunning = false

export async function runDailyBatch(): Promise<BatchResult> {
  if (isRunning) {
    return {
      startedAt: new Date(),
      completedAt: new Date(),
      status: 'FAILED',
      scored: 0,
      analysisComplete: false,
      proposalsGenerated: 0,
      regressionsDetected: 0,
      error: 'Batch is already running',
    }
  }

  isRunning = true
  const startedAt = new Date()
  const result: BatchResult = {
    startedAt,
    completedAt: startedAt,
    status: 'SUCCESS',
    scored: 0,
    analysisComplete: false,
    proposalsGenerated: 0,
    regressionsDetected: 0,
  }

  try {
    // 1. Scorer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting scorer...' })
    result.scored = await scoreConversations()

    // 2. Analyzer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting analyzer...' })
    const analysis = await analyzeScores()
    result.analysisComplete = true

    // 3. Proposer
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting proposer...' })
    result.proposalsGenerated = await generateProposals(analysis)

    // 4. Tracker
    logInfo({ layer: 'self-improvement', category: 'batch', message: 'Starting tracker...' })
    result.regressionsDetected = await trackAdoptedProposals()

    result.status = 'SUCCESS'
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    result.error = errorMsg
    result.status = result.scored > 0 ? 'PARTIAL' : 'FAILED'

    logError({
      layer: 'self-improvement',
      category: 'batch',
      message: `Batch ${result.status}: ${errorMsg}`,
      error: err,
    })
  } finally {
    result.completedAt = new Date()
    isRunning = false

    logInfo({
      layer: 'self-improvement',
      category: 'batch',
      message: `Batch completed: ${result.status} — scored=${result.scored}, proposals=${result.proposalsGenerated}, regressions=${result.regressionsDetected}`,
    })
  }

  return result
}

export function isBatchRunning(): boolean {
  return isRunning
}
