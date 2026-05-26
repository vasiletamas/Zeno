import 'dotenv/config'
import { prisma } from '@/lib/db'

async function main() {
  const convId = process.argv[2]
  if (!convId) { console.error('usage'); process.exit(1) }

  const traces = await prisma.turnTrace.findMany({
    where: { conversationId: convId },
    orderBy: { messageIndex: 'asc' },
  })
  console.log(`traces: ${traces.length}`)
  for (const t of traces) {
    console.log('=== messageIndex', t.messageIndex, 'id', t.id, '===')
    console.log('phases:')
    console.log(JSON.stringify(t.phases, null, 2))
    if (t.anomalies) {
      console.log('anomalies:')
      console.log(JSON.stringify(t.anomalies, null, 2))
    }
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
