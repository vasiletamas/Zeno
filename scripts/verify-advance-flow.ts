/**
 * Behavioral verification for the product-derived advance flow
 * (spec/plan 2026-05-28). Reproduces the stall from conversation
 * cmpp27t1c002ciw0ygr0627xa: customer converges on a product+package, and
 * Zeno used to (a) ask a pointless "confirmi că alegi Protect?" ceremony and
 * (b) stall with a free-floating "câți ani ai?" instead of advancing.
 *
 * After the fix Zeno should, once the customer converges and agrees, DRIVE the
 * sequence open_dnt_session → write_dnt_answer → ... This script drives
 * an opening to convergence, then answers each subsequent question with a
 * VALID value picked from what the agent actually asked (so the questionnaire
 * can progress — a naive "da" fails the enum consent questions).
 *
 * Per trial it checks:
 *   CEREMONY : any assistant turn asks the customer to "confirm the product".
 *   ADVANCED : ≥1 answer saved for a dnt-phase question (or an application /
 *              signed DNT exists) — proves the agent started AND advanced the
 *              questionnaire by calling write_dnt_answer, not just looping.
 *
 * PASS for a trial = ADVANCED && !CEREMONY.
 * Live LLM. Usage: npx tsx scripts/verify-advance-flow.ts [trials=2]
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

// Greeting → category → interest → "tell me more" → CONVERGE → agree to proceed.
const OPENING = [
  'buna',
  'vreau o asigurare de viata',
  'cel mai mult ma intereseaza accesul la tratament in strainatate',
  'da',
  'standard nivelul 1 cred ca e cel mai potrivit',
  'da', // readiness → should trigger open_dnt_session
]
const MAX_FOLLOWUP = 10

const CEREMONY =
  /confirm[iă]?\b[^?]*\b(alegi|alegere|produsul|protect|pachetul)\b[^?]*\?/i

// Pick a VALID answer for whatever the agent just asked.
function pickAnswer(msg: string): string {
  const m = msg.toLowerCase()
  if (/yes_all/.test(m) || /consultan/.test(m)) return 'yes_all' // DNT consent enum
  if (/fum[ăa]tor/.test(m)) return 'nu'
  if (/c[âa]ți ani|ce v[âa]rst[ăa]|v[âa]rsta ta/.test(m)) return '35'
  if (/\bcnp\b/.test(m)) return '1960229410014'
  if (/cu cine loc|gospod[ăa]r/.test(m)) return 'singur'
  if (/venit|salar/.test(m)) return '5000'
  if (/ocupa|profesi|lucrezi/.test(m)) return 'angajat'
  if (/copii/.test(m)) return 'nu'
  if (/educa|studii/.test(m)) return 'superioare'
  if (/de acord|prelucrarea datelor|gdpr/.test(m)) return 'da'
  return 'da'
}

async function lastAssistant(conversationId: string): Promise<string> {
  const m = await prisma.message.findFirst({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  })
  return m?.content ?? ''
}

async function dntAnswerCount(customerId: string): Promise<number> {
  // B2: DNT answers are session-scoped (DntAnswer), customer-owned
  return prisma.dntAnswer.count({
    where: { session: { customerId } },
  })
}

async function trial(n: number): Promise<{ advanced: boolean; ceremony: boolean }> {
  const lang = 'ro' as const
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: lang } })
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, language: lang, channel: 'web' },
  })

  const send = async (msg: string) => {
    try {
      await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: lang }))
    } catch (e) {
      console.error(`  [trial ${n}] turn "${msg.slice(0, 30)}" errored:`, (e as Error).message)
    }
  }

  for (const msg of OPENING) await send(msg)

  // Drive the questionnaire with valid, question-aware answers.
  for (let i = 0; i < MAX_FOLLOWUP; i++) {
    if ((await dntAnswerCount(customer.id)) > 0) break // advanced — goal met
    const ans = pickAnswer(await lastAssistant(conv.id))
    await send(ans)
  }

  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id, role: 'assistant' },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  })
  const dntAnswers = await dntAnswerCount(customer.id)
  const application = await prisma.application.findFirst({ where: { originConversationId: conv.id } })
  const state = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { candidateProductId: true, productId: true },
  })
  const signedDnt = await prisma.dnt.findFirst({ where: { customerId: customer.id } })

  const ceremony = msgs.some((m) => CEREMONY.test(m.content))
  const advanced = dntAnswers > 0 || application != null || signedDnt != null

  console.log(`\n──── trial ${n} ────`)
  msgs.forEach((m, i) => {
    const flag = CEREMONY.test(m.content) ? ' ⚠CEREMONY' : ''
    console.log(`[turn ${i + 1}]${flag} ${m.content.replace(/\n+/g, ' ⏎ ').slice(0, 240)}`)
  })
  console.log(
    `  → candidate=${state?.candidateProductId ? 'set' : 'none'} · committed=${state?.productId ? 'set' : 'none'} · dntAnswers=${dntAnswers} · application=${application ? 'yes' : 'no'} · dntSigned=${signedDnt ? 'yes' : 'no'}`,
  )
  console.log(`  → ADVANCED=${advanced} · CEREMONY=${ceremony} · ${advanced && !ceremony ? 'PASS' : 'FAIL'}`)
  return { advanced, ceremony }
}

async function main() {
  const trials = parseInt(process.argv[2] ?? '2', 10)
  let pass = 0
  for (let i = 1; i <= trials; i++) {
    try {
      const r = await trial(i)
      if (r.advanced && !r.ceremony) pass++
    } catch (e) {
      console.error(`trial ${i} fatal:`, (e as Error).message)
    }
  }
  console.log(
    `\n==== advance-flow: ${pass}/${trials} trials PASS (advanced into DNT, no confirm-product ceremony) ====`,
  )
  await prisma.$disconnect()
  // live handles keep the loop alive - exit explicitly for battery runners
  process.exit(pass === trials ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
