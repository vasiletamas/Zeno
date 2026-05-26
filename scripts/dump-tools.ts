import 'dotenv/config'
import { prisma } from '@/lib/db'

async function main() {
  const convId = process.argv[2]
  if (!convId) {
    console.error('usage: tsx scripts/dump-tools.ts <conversationId>')
    process.exit(1)
  }

  const conv = await prisma.conversation.findUnique({
    where: { id: convId },
    select: {
      candidateProductId: true,
      candidateConfidence: true,
      productId: true,
      mode: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, toolCalls: true, toolResults: true, createdAt: true },
      },
    },
  })

  if (!conv) {
    console.error('not found')
    process.exit(1)
  }

  console.log(
    'candidate:', conv.candidateProductId,
    '· conf:', conv.candidateConfidence,
    '· product:', conv.productId,
    '· mode:', conv.mode,
  )
  console.log('')

  conv.messages.forEach((m, i) => {
    console.log(`--- [${i}] ${m.role} ---`)
    if (m.content) {
      const c = m.content.slice(0, 250).replace(/\n+/g, ' / ')
      console.log('content:', c)
    }
    if (m.toolCalls) {
      console.log('toolCalls:')
      console.log(JSON.stringify(m.toolCalls, null, 2))
    }
    if (m.toolResults) {
      console.log('toolResults:')
      console.log(JSON.stringify(m.toolResults, null, 2))
    }
  })

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
