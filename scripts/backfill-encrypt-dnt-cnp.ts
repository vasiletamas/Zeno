/**
 * One-off backfill (Task 5.4, D11): encrypt plaintext CNPs in
 * DntAnswer.value into the AES envelope. Idempotent — envelopes ('{…')
 * are skipped; only bare 13-digit values are rewritten.
 *
 *   npx tsx scripts/backfill-encrypt-dnt-cnp.ts [--dry-run]
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { encryptEnvelope } from '@/lib/security/encryption'

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const cnpQuestions = await prisma.question.findMany({ where: { code: 'DNT_CNP' }, select: { id: true } })
  const rows = await prisma.dntAnswer.findMany({
    where: { questionId: { in: cnpQuestions.map((q) => q.id) } },
    select: { id: true, value: true },
  })
  let updated = 0
  let skipped = 0
  for (const row of rows) {
    if (!/^\d{13}$/.test(row.value)) { skipped++; continue }
    if (!dryRun) {
      await prisma.dntAnswer.update({ where: { id: row.id }, data: { value: encryptEnvelope(row.value) } })
    }
    updated++
  }
  console.log(`${dryRun ? '[dry-run] would encrypt' : 'encrypted'} ${updated} row(s); ${skipped} already enveloped/non-plaintext`)
  await prisma.$disconnect()
}

main().catch((err) => { console.error(err); process.exit(1) })
