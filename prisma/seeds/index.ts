import { PrismaClient } from '../../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedProduct } from './seed-product'
import { seedProductContent } from './seed-product-content'
import { seedQuestions } from './seed-questions'
import { seedObjections } from './seed-objections'
import { seedAgents } from './seed-agents'
import { seedModelCatalog } from './seed-model-catalog'
import { seedUsers } from './seed-users'
import { seedAgentKnowledge } from './seed-agent-knowledge'
import { seedSimulatorAgent } from './seed-simulator-agent'
import { seedDependencyEdges } from './seed-dependency-edges'
import { seedDocuments } from './seed-documents'

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

    // B4.1: at most one live application per (customer, product) — same
    // partial-unique mechanism, same bootstrap home.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Application_one_open_per_product" ON "Application"("customerId", "productId") WHERE "status" IN ('OPEN','PAUSED','REFERRED')`,
    )

    // C1.4: answers are append-only revisions; at most one ACTIVE revision
    // per (question, application).
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "answer_active_unique" ON "Answer"("questionId", "applicationId") WHERE "status" = 'ACTIVE'`,
    )

    // E1.1 (erratum 1): product-level ProductContent rows carry addonId NULL,
    // which Postgres treats as distinct in the schema's composite unique —
    // this partial index closes the duplicate-row hole for them (the
    // composite covers addon-scoped rows).
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ProductContent_product_level_unique" ON "ProductContent"("productId", "field", "locale", "version") WHERE "addonId" IS NULL`,
    )

    await seedProduct(prisma)
    await seedProductContent(prisma)
    await seedQuestions(prisma)
    await seedDependencyEdges(prisma)
    await seedDocuments(prisma)
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
