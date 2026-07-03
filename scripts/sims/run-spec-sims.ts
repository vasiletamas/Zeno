/**
 * Scripted live-sim generator with n-of-m policy (F1.9, T12.D4).
 *
 *   npx tsx scripts/sims/run-spec-sims.ts [trials=3] [passThreshold=2] [--record] [--only <key>]
 *
 * Per scenario: N trials, each a fresh customer+conversation driven through
 * handleChatTurn (live LLM, real dev DB) — the fixed opening script, then
 * question-aware answers (pickAnswer regex, verify-advance-flow lineage).
 * The trial's ConversationExport is loaded via the SAME loader the export
 * route uses and the scenario's asserts run over it. Trial PASS = all
 * asserts green. Scenario PASS = >= passThreshold of trials (n-of-m).
 * Every export lands in artifacts/sims/<key>-<trial>.json; with --record the
 * first PASSING export is copied to __tests__/fixtures/exports/<key>.export.json.
 * Exit 1 iff any scenario misses its n-of-m.
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { prisma } from '@/lib/db'
import { loadConversationExport } from '@/lib/debug/load-export'
import type { ConversationExport } from '@/lib/debug/conversation-export'
import {
  assertNoNarrationViolations, assertNoPhaseRegression, assertNoPremiumBeforeQuote,
  assertToolOrder, assertToolNeverCalled, toolCallsByTurn,
} from '@/lib/testing/conversation-assertions'
import { SPEC_SIM_SCENARIOS, type SpecSimScenario } from './spec-scenarios'

const ROOT = process.cwd()
const SIMS_DIR = path.join(ROOT, 'artifacts/sims')
const FIXTURES_DIR = path.join(ROOT, '__tests__/fixtures/exports')

// ---- assertion dispatch table ----------------------------------------------
const ASSERTS: Record<string, (e: ConversationExport) => void> = {
  noNarrationViolations: assertNoNarrationViolations,
  noPhaseRegression: (e) => assertNoPhaseRegression(e),
  noPremiumBeforeQuote: assertNoPremiumBeforeQuote,
  dntOrder: (e) => assertToolOrder(e, ['open_dnt_session', 'write_dnt_answer', 'sign_dnt']),
  noCardData: (e) => {
    for (const t of e.turns) for (const c of t.toolCalls) {
      if (/card_number|cvv|pan\b/i.test(JSON.stringify(c.args))) {
        throw new Error(`card data in tool args: ${c.name}`)
      }
    }
  },
  noFunnelAfterRefusal: (e) => {
    assertToolNeverCalled(e, 'generate_quote')
    const signs = toolCallsByTurn(e).flat().filter((n) => n === 'sign_dnt').length
    if (signs > 1) throw new Error(`sign_dnt re-attempted after refusal (${signs} calls)`)
  },
}

// ---- question-aware answer picking (verify-advance-flow lineage) -----------
function pickAnswer(msg: string, policy: SpecSimScenario['answerPolicy']): string {
  const m = msg.toLowerCase()
  if (policy === 'refuse-consent' && /(gdpr|consimț|de acord|prelucrarea datelor|semn[ăa]m|semnezi)/.test(m)) {
    return 'nu, nu sunt de acord cu prelucrarea datelor'
  }
  if (/yes_all/.test(m) || /consultan/.test(m)) return 'yes_all'
  if (/fum[ăa]tor/.test(m)) return 'nu'
  if (/c[âa]ți ani|ce v[âa]rst[ăa]|v[âa]rsta ta/.test(m)) return '35'
  if (/\bcnp\b/.test(m)) return '1960229410014'
  if (/cu cine loc|gospod[ăa]r/.test(m)) return 'singur'
  if (/venit|salar/.test(m)) return '5000'
  if (/ocupa|profesi|lucrezi/.test(m)) return 'angajat'
  if (/copii/.test(m)) return 'nu'
  if (/educa|studii/.test(m)) return 'superioare'
  if (/de acord|prelucrarea datelor|gdpr|semn/.test(m)) return 'da'
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

/** Scenario-specific early-exit: the goal state has been reached. */
async function goalReached(key: string, customerId: string, conversationId: string): Promise<boolean> {
  if (key === 'happy-path') {
    return (await prisma.dnt.count({ where: { customerId } })) > 0
  }
  if (key === 'dnt-refusal') {
    // any sign_dnt attempt has been ledgered (refused or otherwise)
    return (await prisma.commitLedger.count({ where: { conversationId, tool: 'sign_dnt' } })) > 0
  }
  if (key === 'quote-decline') {
    return (await prisma.commitLedger.count({ where: { conversationId, tool: 'generate_quote', outcome: 'applied' } })) > 0
  }
  return false
}

async function runTrial(sc: SpecSimScenario, trial: number): Promise<{ pass: boolean; export: ConversationExport | null; failures: string[] }> {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, language: 'ro', channel: 'web' },
  })
  let turns = 0
  const send = async (msg: string) => {
    turns++
    try {
      await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: 'ro' }))
    } catch (e) {
      console.error(`    [${sc.key}#${trial}] turn "${msg.slice(0, 30)}" errored:`, (e as Error).message)
    }
  }

  for (const msg of sc.opening) await send(msg)
  while (turns < sc.maxTurns && !(await goalReached(sc.key, customer.id, conv.id))) {
    await send(pickAnswer(await lastAssistant(conv.id), sc.answerPolicy))
  }
  if (sc.key === 'quote-decline' && (await goalReached(sc.key, customer.id, conv.id))) {
    await send('nu, mulțumesc, nu vreau să accept oferta acum')
  }

  // persistTurnDebug is fire-and-forget — wait for the last turn's row.
  for (let i = 0; i < 20; i++) {
    if ((await prisma.turnDebug.count({ where: { conversationId: conv.id } })) >= turns) break
    await new Promise((r) => setTimeout(r, 500))
  }

  const bundle = await loadConversationExport(conv.id)
  if (!bundle) return { pass: false, export: null, failures: ['export failed to load'] }

  const failures: string[] = []
  for (const name of sc.asserts) {
    const fn = ASSERTS[name]
    if (!fn) { failures.push(`unknown assert: ${name}`); continue }
    try {
      fn(bundle)
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`)
    }
  }
  return { pass: failures.length === 0, export: bundle, failures }
}

async function main() {
  const args = process.argv.slice(2)
  const record = args.includes('--record')
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
  const nums = args.filter((a) => /^\d+$/.test(a)).map(Number)
  const trials = nums[0] ?? 3
  const passThreshold = nums[1] ?? 2

  fs.mkdirSync(SIMS_DIR, { recursive: true })
  if (record) fs.mkdirSync(FIXTURES_DIR, { recursive: true })

  const scenarios = SPEC_SIM_SCENARIOS.filter((s) => !only || s.key === only)
  let anyFailed = false
  for (const sc of scenarios) {
    console.log(`\n==== scenario ${sc.key} (${trials} trials, pass >= ${passThreshold}) ====`)
    let passes = 0
    let recorded = false
    for (let t = 1; t <= trials; t++) {
      const r = await runTrial(sc, t)
      if (r.export) {
        fs.writeFileSync(path.join(SIMS_DIR, `${sc.key}-${t}.json`), JSON.stringify(r.export, null, 2))
      }
      console.log(`  trial ${t}: ${r.pass ? 'PASS' : `FAIL (${r.failures.join(' | ')})`}`)
      if (r.pass) {
        passes++
        if (record && !recorded && r.export) {
          fs.writeFileSync(path.join(FIXTURES_DIR, `${sc.key}.export.json`), JSON.stringify(r.export, null, 2))
          recorded = true
          console.log(`  recorded -> __tests__/fixtures/exports/${sc.key}.export.json`)
        }
      }
    }
    const ok = passes >= passThreshold
    console.log(`  => ${sc.key}: ${passes}/${trials} ${ok ? 'PASS (n-of-m met)' : 'FAIL (below threshold)'}`)
    if (!ok) anyFailed = true
  }
  await prisma.$disconnect()
  process.exit(anyFailed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
