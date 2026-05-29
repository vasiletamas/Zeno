/**
 * Behavioral verification for Pathology 1 (tool-narration / permission-asking).
 *
 * Drives N independent 2-turn conversations through the real orchestrator
 * (live LLM via configured keys), then runs the tool-narration detector on
 * every assistant reply. Turn 2 is the pathology trigger: the customer asks
 * for product specifics, which forces a lookup — the exact spot where Zeno
 * used to say "vrei să verific?" / "nu am reușit să verific".
 *
 * Manual runtime verification (live LLM is non-deterministic), not a CI test.
 * Usage: npx tsx scripts/verify-pathology1.ts [trials]
 */
import 'dotenv/config'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { prisma } from '@/lib/db'
import { detectToolNarration } from '@/lib/chat/tool-narration-detector'

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

const TURN1 = 'Buna, ma intereseaza o asigurare de viata'
const TURN2 =
  'ok si care e treaba cu tratamentul asta in strainatate? explica-mi mai exact ce acopera'

async function trial(n: number): Promise<boolean> {
  const lang = 'ro' as const
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: lang } })
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, language: lang, channel: 'web' },
  })

  await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: TURN1, language: lang }))
  await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: TURN2, language: lang }))

  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  })

  let allClean = true
  msgs.forEach((m, i) => {
    const r = detectToolNarration(m.content, lang)
    if (!r.clean) allClean = false
    const tag = r.clean ? 'CLEAN  ' : 'FLAGGED'
    const detail = r.clean ? '' : ' → ' + r.violations.map((v) => `${v.category}:"${v.matchedPhrase}"`).join(', ')
    console.log(`\n[trial ${n} · assistant turn ${i + 1}] ${tag}${detail}`)
    console.log('   ' + m.content.replace(/\n+/g, ' ⏎ ').slice(0, 420))
  })
  return allClean
}

async function main() {
  const trials = parseInt(process.argv[2] ?? '3', 10)
  let pass = 0
  for (let i = 1; i <= trials; i++) {
    try {
      if (await trial(i)) pass++
    } catch (e) {
      console.error(`trial ${i} error:`, (e as Error).message)
    }
  }
  console.log(`\n==== ${pass}/${trials} trials fully detector-clean ====`)
  await prisma.$disconnect()
  process.exit(pass === trials ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
