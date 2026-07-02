import { config } from 'dotenv'
config()
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const id = process.argv[2]
  if (!id) { console.error('usage: tsx scripts/inspect-candidate.ts <conversationId>'); process.exit(1) }
  const c = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      messageCount: true,
      productId: true,
      candidateProductId: true,
      candidateAddonIds: true,
      candidateSetAt: true,
    },
  })
  console.log(JSON.stringify(c, null, 2))
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
