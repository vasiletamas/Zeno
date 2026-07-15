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
import { ensurePartialUniqueIndexes } from './partial-indexes'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log('Starting seed...')

    // Partial unique indexes Prisma cannot express — created before the data
    // seeds (idempotent).
    await ensurePartialUniqueIndexes(prisma)

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
