import type { PrismaClient } from '../../lib/generated/prisma/client'

export async function seedSimulatorAgent(prisma: PrismaClient): Promise<void> {
  await prisma.agent.upsert({
    where: { slug: 'customer-simulator' },
    update: {},
    create: {
      slug: 'customer-simulator',
      name: 'Customer Simulator',
      role: 'customer-simulator',
      provider: 'OPENAI',
      model: 'gpt-4o-mini',
      fallbackProvider: null,
      fallbackModel: null,
      temperature: 0.8,
      maxTokens: 512,
      systemPrompt: null,
      constraints: null,
      isActive: true,
    },
  })

  console.log('  ✓ customer-simulator agent seeded')
}
