import { PrismaClient } from '../../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedProduct } from './seed-product'
import { seedQuestions } from './seed-questions'
import { seedObjections } from './seed-objections'
import { seedWorkflows } from './seed-workflows'
import { seedAgents } from './seed-agents'
import { seedModelCatalog } from './seed-model-catalog'
import { seedUsers } from './seed-users'
import { seedAgentKnowledge } from './seed-agent-knowledge'

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    console.log('Starting seed...')

    await seedProduct(prisma)
    await seedQuestions(prisma)
    await seedObjections(prisma)
    await seedWorkflows(prisma)
    await seedAgents(prisma)
    await seedModelCatalog(prisma)
    await seedAgentKnowledge(prisma)
    await seedUsers(prisma)

    console.log('Seed completed successfully.')
  } catch (error) {
    console.error('Seed failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
