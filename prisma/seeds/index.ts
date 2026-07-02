import { PrismaClient } from '../../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedProduct } from './seed-product'
import { seedQuestions } from './seed-questions'
import { seedObjections } from './seed-objections'
import { seedAgents } from './seed-agents'
import { seedModelCatalog } from './seed-model-catalog'
import { seedUsers } from './seed-users'
import { seedAgentKnowledge } from './seed-agent-knowledge'
import { seedSimulatorAgent } from './seed-simulator-agent'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log('Starting seed...')

    // B2: at most one ACTIVE DntSession per customer. Prisma cannot express a
    // partial unique index and this repo bootstraps via `db push` (no
    // migrations), so the constraint lives here, idempotently.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "DntSession_one_active_per_customer" ON "DntSession"("customerId") WHERE "status" = 'ACTIVE'`,
    )

    await seedProduct(prisma)
    await seedQuestions(prisma)
    await seedObjections(prisma)
    await seedAgents(prisma)
    await seedModelCatalog(prisma)
    await seedAgentKnowledge(prisma)
    await seedUsers(prisma)
    await seedSimulatorAgent(prisma)

    console.log('Seed completed successfully.')
  } catch (error) {
    console.error('Seed failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
