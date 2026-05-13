/**
 * One-off: trigger the self-improvement batch on whatever's currently in the DB.
 * Used to re-run scoring after backfilling Conversation.status on existing rows.
 */
import 'dotenv/config'
import { runDailyBatch } from '../lib/self-improvement/batch-runner'

async function main(): Promise<void> {
  console.log('Running self-improvement batch...')
  const result = await runDailyBatch()
  console.log('Batch result:', JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error('Batch failed:', err)
  process.exit(1)
})
