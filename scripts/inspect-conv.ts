import { config } from 'dotenv'
config()
import { prisma } from '@/lib/db'

async function main() {
const convId = process.argv[2]
if (!convId) {
  console.error('usage: tsx scripts/inspect-conv.ts <conversationId>')
  process.exit(1)
}

const conv = await prisma.conversation.findUnique({
  where: { id: convId },
  include: {
    messages: { orderBy: { createdAt: 'asc' }, select: { role: true, content: true } },
    product: { select: { name: true, code: true } },
  },
})

if (!conv) {
  console.error('conversation not found')
  process.exit(1)
}

console.log('')
console.log(`MESSAGES (${conv.messages.length}):`)
conv.messages.forEach((m, i) => {
  const tag = m.role === 'user' ? '👤' : '🤖'
  const content = m.content.slice(0, 600).replace(/\n+/g, ' ⏎ ')
  console.log(`[${i}] ${tag} ${content}${m.content.length > 600 ? ' …' : ''}`)
})

await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
