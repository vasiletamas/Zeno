/**
 * CLI: npm run simulate
 *
 * Runs the customer simulation against the local (or configured) app.
 */

import { runSimulation } from '../lib/simulation/runner'
import type { SimulationConfig } from '../lib/simulation/types'
import { DEFAULT_CONFIG } from '../lib/simulation/types'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const config: SimulationConfig = { ...DEFAULT_CONFIG }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--scripted-only':
        config.runScripted = true
        config.runFreeform = false
        break
      case '--freeform-only':
        config.runScripted = false
        config.runFreeform = true
        break
      case '--count':
        config.freeformCount = parseInt(args[++i], 10)
        break
      case '--persona':
        config.personas = args[++i].split(',')
        break
      case '--run-batch':
        config.runBatchAfter = true
        break
      case '--no-batch':
        config.runBatchAfter = false
        break
      case '--concurrency':
        config.concurrency = parseInt(args[++i], 10)
        break
    }
  }

  config.trigger = 'cli'

  console.log('\nStarting Customer Simulation')
  console.log(`  Scripted: ${config.runScripted ? 'yes' : 'no'}`)
  console.log(`  Freeform: ${config.runFreeform ? `yes (${config.freeformCount})` : 'no'}`)
  console.log(`  Concurrency: ${config.concurrency}`)
  console.log(`  Batch after: ${config.runBatchAfter ? 'yes' : 'no'}`)
  console.log('')

  const result = await runSimulation(config)

  console.log('\n--- Simulation Results ---')
  console.log(`  Status:    ${result.status}`)
  console.log(`  Total:     ${result.totalScenarios}`)
  console.log(`  Completed: ${result.completedCount}`)
  console.log(`  Failed:    ${result.failedCount}`)
  console.log(`  Duration:  ${(result.durationMs / 1000).toFixed(1)}s`)
  console.log('')

  if (result.conversations.length > 0) {
    console.log('Conversations:')
    for (const c of result.conversations) {
      const name = (c.scenarioSlug ?? c.personaSlug).padEnd(30)
      const type = c.scenarioType.padEnd(8)
      const status = c.status.padEnd(9)
      const turns = String(c.turnCount).padStart(3)
      const time = `${(c.durationMs / 1000).toFixed(1)}s`.padStart(7)
      console.log(`  ${name} ${type} ${status} ${turns} turns ${time}`)
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:')
    for (const err of result.errors) {
      console.log(`  - ${err}`)
    }
  }

  process.exit(result.failedCount > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal simulation error:', err)
  process.exit(1)
})
