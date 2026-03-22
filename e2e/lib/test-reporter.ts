/**
 * Test Reporter for E2E Scenarios
 *
 * Outputs scenario results to the console with color coding.
 * Designed for terminal output during test runs.
 */

import { TurnTracker } from './turn-tracker'

// ==============================================
// COLOR HELPERS
// ==============================================

const supportsColor =
  typeof process !== 'undefined' &&
  process.stdout?.isTTY === true

function green(text: string): string {
  return supportsColor ? `\x1b[32m${text}\x1b[0m` : text
}

function red(text: string): string {
  return supportsColor ? `\x1b[31m${text}\x1b[0m` : text
}

function dim(text: string): string {
  return supportsColor ? `\x1b[2m${text}\x1b[0m` : text
}

function bold(text: string): string {
  return supportsColor ? `\x1b[1m${text}\x1b[0m` : text
}

// ==============================================
// FORMAT HELPERS
// ==============================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}m${seconds}s`
}

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Print a scenario result to the console.
 *
 * Example output:
 *   [PASS] Happy Path — Full Sale
 *     Turns: 28 | Tools: save_answer, generate_quote, process_payment | Duration: 45.2s
 *
 *   [FAIL] BD Rejection
 *     Turns: 15 | Tools: save_answer | Duration: 22.1s
 *     Detail: Application.includesAddon expected false, got true
 */
export function reportScenario(
  name: string,
  tracker: TurnTracker,
  passed: boolean,
  details?: string,
): void {
  const summary = tracker.getSummary()
  const status = passed ? green('[PASS]') : red('[FAIL]')
  const toolList =
    summary.toolsUsed.length > 0
      ? summary.toolsUsed.join(', ')
      : 'none'

  console.log('')
  console.log(`  ${status} ${bold(name)}`)
  console.log(
    `    ${dim('Turns:')} ${summary.totalTurns} ${dim('|')} ${dim('Tools:')} ${toolList} ${dim('|')} ${dim('Duration:')} ${formatDuration(summary.durationMs)}`,
  )

  if (!passed && details) {
    console.log(`    ${red('Detail:')} ${details}`)
  }

  const errors = tracker.getErrors()
  if (errors.length > 0) {
    console.log(`    ${red('Errors:')} ${errors.join('; ')}`)
  }

  console.log('')
}
