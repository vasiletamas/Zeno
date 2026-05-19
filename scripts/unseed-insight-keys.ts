/**
 * Emergency rollback: NULL out Question.insightKey on every row.
 * Run with: npx tsx scripts/unseed-insight-keys.ts
 */
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const result = await prisma.question.updateMany({
    where: { insightKey: { not: null } },
    data: { insightKey: null },
  })
  console.log(`Cleared insightKey on ${result.count} questions.`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
