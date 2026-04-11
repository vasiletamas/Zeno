/**
 * Seed: Agent Knowledge — Bootstrap from ObjectionStrategy
 *
 * Converts existing objection strategies into AgentKnowledge rows
 * so loadAgentKnowledge has data from day one.
 */

import { PrismaClient } from '../../lib/generated/prisma/client'

export async function seedAgentKnowledge(prisma: PrismaClient) {
  console.log('  Seeding agent knowledge from objection strategies...')

  const strategies = await prisma.objectionStrategy.findMany({
    where: { isActive: true },
    select: {
      type: true,
      title: true,
      strategy: true,
      productId: true,
    },
  })

  let count = 0
  for (const s of strategies) {
    await prisma.agentKnowledge.upsert({
      where: {
        id: `bootstrap-${s.productId}-${s.type}`,
      },
      update: {
        content: s.strategy,
        isActive: true,
      },
      create: {
        id: `bootstrap-${s.productId}-${s.type}`,
        category: 'OBJECTION_RESPONSE',
        trigger: `${s.type}_objection`,
        content: `[${s.title}] ${s.strategy}`,
        successRate: 0,
        sampleSize: 0,
        productId: s.productId,
        isActive: true,
      },
    })
    count++
  }

  console.log(`    ${count} agent knowledge entries bootstrapped.`)
}
