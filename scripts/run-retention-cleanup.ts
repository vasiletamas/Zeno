/**
 * P0-2 retention cleanup runner — deletes abandoned unsigned DNT drafts
 * whose Art. 6(1)(b) pre-contractual basis has lapsed (see
 * lib/gdpr/retention-cleanup.ts). Run daily from ops cron:
 *
 *   npx tsx scripts/run-retention-cleanup.ts
 */
import 'dotenv/config'
import { cleanupUnsignedDntSessions } from '@/lib/gdpr/retention-cleanup'

async function main() {
  const report = await cleanupUnsignedDntSessions()
  console.log(`retention-cleanup: ${report.sessionsDeleted} unsigned DNT session(s) + ${report.answersDeleted} answer row(s) deleted (inactive since ${report.cutoff})`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
