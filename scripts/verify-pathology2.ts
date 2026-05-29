/**
 * Behavioral reproduction / verification for Pathology 2 (deflection loop).
 *
 * Drives the exact loop-inducing sequence from conversation cmpmmpew7:
 * greeting → "vreau viață" → "ce e cu tratamentul?" → "da" → "da" → "da".
 * The bug: in response to a bare "da" (an affirmation to an offer to
 * explain), Zeno asks ANOTHER topic-choice question instead of delivering
 * substance.
 *
 * For each assistant turn it classifies:
 *   - DEFLECT  : ends by offering/choosing WHAT to explain (the loop)
 *   - SUBSTANCE: contains concrete product facts (figures / coverage terms)
 *
 * A healthy turn after "da" should be SUBSTANCE, not DEFLECT.
 * Manual runtime verification (live LLM), run before and after the fix.
 * Usage: npx tsx scripts/verify-pathology2.ts [trials]
 */
import 'dotenv/config'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { prisma } from '@/lib/db'

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}

const SCRIPT = [
  'buna',
  'vreau o asigurare de viata',
  'ok si care e treaba cu tratamentul asta in strainatate?',
  'da',
  'da',
  'da',
]

// Concrete product substance OR a concrete forward step = the turn ADVANCED.
const ADVANCE = [
  /\d[\d.\s]*(eur|ron|lei)/i,
  /\b(180|2\.000\.000|100|50\.000|60)\b/,
  /(spitalizare|repatriere|invaliditate|chestionar medical|perioad[ăa] de a[șs]teptare|a doua opinie)/i,
  // forward step toward an offer
  /(pachet|nivel(ul)?|ofert[ăa]|standard|optim|s[ăa] pornim|s[ăa]-ți preg[ăa]tesc|cererea de asigurare)/i,
]

/**
 * STALL = the turn ends in a question but delivers no new value or forward
 * step (a pure clarifying/discovery question). After the customer has
 * affirmed interest, a stall is the residual Pathology-2 behavior: the agent
 * interrogates instead of advancing.
 */
function classify(text: string): 'ADVANCE' | 'STALL' | 'OTHER' {
  const hasAdvance = ADVANCE.some((r) => r.test(text))
  const endsWithQuestion = /\?\s*$/.test(text.trim())
  if (hasAdvance) return 'ADVANCE'
  if (endsWithQuestion) return 'STALL'
  return 'OTHER'
}

async function trial(n: number): Promise<{ deflectAfterDa: number }> {
  const lang = 'ro' as const
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: lang } })
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, language: lang, channel: 'web' },
  })
  for (const msg of SCRIPT) {
    await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: lang }))
  }
  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  })
  let stallAfterDa = 0
  msgs.forEach((m, i) => {
    const cls = classify(m.content)
    // assistant turns index 3,4,5 are the replies to the three bare "da"s
    const isDaReply = i >= 3
    if (isDaReply && cls === 'STALL') stallAfterDa++
    console.log(`\n[trial ${n} · turn ${i + 1}${isDaReply ? ' (after "da")' : ''}] ${cls}`)
    console.log('   ' + m.content.replace(/\n+/g, ' ⏎ ').slice(0, 320))
  })
  return { stallAfterDa }
}

async function main() {
  const trials = parseInt(process.argv[2] ?? '2', 10)
  let totalStall = 0
  for (let i = 1; i <= trials; i++) {
    try {
      const r = await trial(i)
      totalStall += r.stallAfterDa
    } catch (e) {
      console.error(`trial ${i} error:`, (e as Error).message)
    }
  }
  console.log(`\n==== stalls-after-"da" across ${trials} trials: ${totalStall} (lower = better; advances instead of interrogating) ====`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
