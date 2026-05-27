/**
 * Behavioral reproduction / verification for Pathology 3 (blind forced choice).
 *
 * Drives the conversation to the point where the agent needs the customer to
 * choose a package variant (Standard vs Optim) or level (I/II/III), then
 * checks whether the agent PRESENTS the options and how they differ in the
 * same message (informed choice) or just asks "which one?" with nothing to
 * choose on (blind choice — the bug from cmpmmpew7 turn 27 → 28).
 *
 * Manual runtime verification (live LLM), run before and after the fix.
 * Usage: npx tsx scripts/verify-pathology3.ts [trials]
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
  'ce acopera mai exact?',
  'ok suna bine, am 40 de ani si vreau sa vad o oferta concreta',
  'da',
  'da',
]

// The turn offers a choice between named options.
function offersChoice(text: string): boolean {
  const t = text.toLowerCase()
  const variant = t.includes('standard') && t.includes('optim')
  const level = /\bnivel/.test(t) && /\b(i{1,3}|1|2|3)\b/.test(t)
  const asks = /\?/.test(text)
  return (variant || level) && asks
}

// The same turn also explains how the options differ (so the customer can choose).
function isInformed(text: string): boolean {
  const diff = /(diferen[țt]|se deosebesc|spre deosebire|mai simpl|mai mare|mai mult|mai ridicat|în plus|accident|invaliditate|spitalizare|chirurgical)/i.test(text)
  const figures = (text.match(/\d[\d.]*\s*(ron|eur|lei)/gi) ?? []).length >= 2
  return diff || figures
}

async function trial(n: number): Promise<{ blind: number; informed: number }> {
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
  let blind = 0
  let informed = 0
  msgs.forEach((m, i) => {
    if (!offersChoice(m.content)) return
    const ok = isInformed(m.content)
    if (ok) informed++
    else blind++
    console.log(`\n[trial ${n} · turn ${i + 1}] OFFERS CHOICE → ${ok ? 'INFORMED ✓' : 'BLIND ✗'}`)
    console.log('   ' + m.content.replace(/\n+/g, ' ⏎ ').slice(0, 360))
  })
  return { blind, informed }
}

async function main() {
  const trials = parseInt(process.argv[2] ?? '3', 10)
  let totalBlind = 0
  let totalInformed = 0
  for (let i = 1; i <= trials; i++) {
    try {
      const r = await trial(i)
      totalBlind += r.blind
      totalInformed += r.informed
    } catch (e) {
      console.error(`trial ${i} error:`, (e as Error).message)
    }
  }
  console.log(`\n==== across ${trials} trials: BLIND choices=${totalBlind} (want 0), INFORMED choices=${totalInformed} ====`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
