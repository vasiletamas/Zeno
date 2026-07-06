/**
 * Change-answer live sim (acceptance scenario, 2026-07-06).
 *
 *   npx tsx scripts/sims/run-change-answer-sim.ts
 *
 * Drives a fresh customer through the DISCOVERY-opened DNT flow, lets the
 * question-aware policy answer the first few questions, then interjects a
 * mid-flow CHANGE REQUEST for the already answered marketing question
 * (requesting the OPPOSITE of the recorded value) and keeps going until
 * sign_dnt is attempted.
 *
 * Evidence checks (DB, not narration — T14.D6 evidence rule):
 *   1. the DntAnswer row for DNT_MARKETING_CONSENT flips to the opposite
 *      value after the change request (write-or-change semantics, B2.5);
 *   2. the session still reaches a sign_dnt attempt (no deadlock after edit).
 *
 * Helper functions mirror scripts/sims/run-spec-sims.ts (not exported there —
 * importing it would execute its main()).
 */
import 'dotenv/config'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { prisma } from '@/lib/db'

const MAX_TURNS = 40
const CHANGE_AFTER_ANSWERS = 4 // marketing (question #2) is answered by then

function pickAnswer(msg: string): string {
  const m = msg.toLowerCase()
  if (/yes_all/.test(m) || /consultan/.test(m)) return 'yes_all'
  if (/marketing/.test(m)) return 'nu'
  if (/electronic|coresponden/.test(m)) return 'da'
  if (/fum[ăa]tor/.test(m)) return 'nu'
  if (/c[âa]ți ani|ce v[âa]rst[ăa]|v[âa]rsta ta/.test(m)) return '35'
  if (/\bcnp\b/.test(m)) return '1960229410015' // checksum-valid
  if (/cu cine loc|gospod[ăa]r/.test(m)) return 'singur'
  if (/sursa|provin/.test(m)) return 'din salariu'
  if (/2000_5000|interval/.test(m)) return 'intre 2000 si 5000'
  if (/venit|salar/.test(m)) return '5000'
  if (/ocupa|profesi|lucrezi/.test(m)) return 'sunt angajat cu carte de munca (employee)'
  if (/copii|dependen/.test(m)) return '0'
  // AFTER the minors check — that question text also contains "membrii".
  if (/membri|famili/.test(m)) return '2'
  if (/tip de protec|protec[țt]ie simpl/.test(m)) return 'simple_protection'
  if (/educa|studii/.test(m)) return 'studii universitare (university)'
  if (/email/.test(m)) return 'ion.sim@example.com'
  return 'da'
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}

async function lastAssistant(conversationId: string): Promise<string> {
  const m = await prisma.message.findFirst({
    where: { conversationId, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  })
  return m?.content ?? ''
}

async function marketingAnswer(customerId: string): Promise<string | null> {
  const row = await prisma.dntAnswer.findFirst({
    where: { session: { customerId }, question: { code: 'DNT_MARKETING_CONSENT' } },
    orderBy: { answeredAt: 'desc' },
  })
  return row?.value ?? null
}

async function main() {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })
  console.log(`conversationId: ${conv.id}`)
  console.log(`customerId: ${customer.id}`)

  let turns = 0
  const send = async (msg: string) => {
    turns++
    console.log(`>> [${turns}] ${msg}`)
    try {
      await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: 'ro' }))
    } catch (e) {
      console.error(`   turn errored: ${(e as Error).message}`)
    }
    console.log(`<< ${(await lastAssistant(conv.id)).slice(0, 220).replace(/\n/g, ' ')}`)
  }

  for (const msg of ['buna', 'vreau o asigurare de viata', 'da, hai sa facem cererea']) await send(msg)

  let changed = false
  let valueBeforeChange: string | null = null
  let valueAfterChange: string | null = null
  while (turns < MAX_TURNS) {
    const answersSoFar = await prisma.dntAnswer.count({ where: { session: { customerId: customer.id } } })
    const signAttempted = (await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'sign_dnt' } })) > 0
    if (signAttempted) break
    if (!changed && answersSoFar >= CHANGE_AFTER_ANSWERS) {
      valueBeforeChange = await marketingAnswer(customer.id)
      // Request the OPPOSITE of whatever is recorded, so the flip is always observable.
      const wantYes = valueBeforeChange !== 'yes'
      await send(
        wantYes
          ? 'stai putin, cred ca am gresit mai devreme la intrebarea despre informatii de marketing — as vrea totusi sa primesc informatii utile despre asigurari, deci schimba raspunsul in DA te rog'
          : 'stai putin, cred ca am gresit mai devreme la intrebarea despre informatii de marketing — nu vreau de fapt sa primesc informatii, deci schimba raspunsul in NU te rog',
      )
      valueAfterChange = await marketingAnswer(customer.id)
      changed = true
      continue
    }
    await send(pickAnswer(await lastAssistant(conv.id)))
  }

  // persistTurnDebug is fire-and-forget — wait for the last turn's row.
  for (let i = 0; i < 20; i++) {
    if ((await prisma.turnDebug.count({ where: { conversationId: conv.id } })) >= turns) break
    await new Promise((r) => setTimeout(r, 500))
  }

  const finalValue = await marketingAnswer(customer.id)
  const signAttempted = (await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'sign_dnt' } })) > 0
  console.log('--- evidence ---')
  console.log(`marketing answer before change request: ${valueBeforeChange}`)
  console.log(`marketing answer after change request:  ${valueAfterChange}`)
  console.log(`marketing answer at end:                ${finalValue}`)
  console.log(`sign_dnt attempted: ${signAttempted}`)
  const changeApplied = (valueBeforeChange !== null && valueAfterChange !== null && valueBeforeChange !== valueAfterChange)
    || (valueBeforeChange !== null && finalValue !== null && valueBeforeChange !== finalValue)
  console.log(`RESULT: ${changeApplied && signAttempted ? 'PASS' : 'FAIL'} (changeApplied=${changeApplied}, signAttempted=${signAttempted})`)
  await prisma.$disconnect()
  process.exit(changeApplied && signAttempted ? 0 : 1)
}

main()
