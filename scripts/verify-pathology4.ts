/**
 * Behavioral verification for Pathology 4 (empty-category handling).
 *
 * Replays the real failure from conversation cmpnuciac0000p80yho4cl5dq:
 * customer asks for a category we don't sell (home), then another we don't
 * sell (health). The bug: Zeno offered "health, auto, travel" as available
 * alternatives (sourced from the enum, not the catalog) and never pivoted to
 * the one product it has (Protect/life).
 *
 * Asserts, on the responses to the unavailable-category requests:
 *   - pivots to the real product (mentions Protect / "viață")
 *   - does NOT offer a menu of categories we don't sell (health/auto/travel)
 *
 * Manual runtime verification (live LLM). Usage: npx tsx scripts/verify-pathology4.ts [trials]
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

const SCRIPT = ['buna', 'vreau o asigurare pentru casa', 'ai asigurare de sanatate ?']

// Categories we do NOT sell — Zeno must never present these as available.
const FAKE = [/s[ăa]n[ăa]tate/i, /\bauto\b/i, /c[ăa]l[ăa]torie/i]
const PIVOT = /protect|via[țt]ă/i

async function trial(n: number): Promise<{ ok: boolean }> {
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
  // Responses to the two unavailable-category asks are assistant turns 2 and 3.
  let ok = true
  msgs.forEach((m, i) => {
    if (i < 1) return // skip the greeting reply
    const fakeCount = FAKE.filter((r) => r.test(m.content)).length
    const pivots = PIVOT.test(m.content)
    const bad = fakeCount >= 2 || !pivots
    if (bad) ok = false
    console.log(`\n[trial ${n} · turn ${i + 1}] pivots-to-Protect=${pivots ? '✓' : '✗'}  fake-categories=${fakeCount} ${bad ? '✗ BAD' : '✓'}`)
    console.log('   ' + m.content.replace(/\n+/g, ' ⏎ ').slice(0, 340))
  })
  return { ok }
}

async function main() {
  const trials = parseInt(process.argv[2] ?? '3', 10)
  let pass = 0
  for (let i = 1; i <= trials; i++) {
    try {
      if ((await trial(i)).ok) pass++
    } catch (e) {
      console.error(`trial ${i} error:`, (e as Error).message)
    }
  }
  console.log(`\n==== ${pass}/${trials} trials clean (pivots to Protect, no invented categories) ====`)
  await prisma.$disconnect()
  // live handles keep the loop alive - exit explicitly for battery runners
  process.exit(pass === trials ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
