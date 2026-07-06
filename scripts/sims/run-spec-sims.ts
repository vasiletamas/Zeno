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
import { pickAnswer } from './answer-policy'

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

/** Drain the SSE stream, collecting confirm_required ui_actions (F5.5 gap:
 * the GUI confirm card is a CUSTOMER click, so the sim must replay it —
 * without this the funnel deadlocks at sign_dnt/accept_quote forever). */
async function drain(stream: ReadableStream<Uint8Array>): Promise<{ confirms: { tool: string; confirmToken: string; args: Record<string, unknown> }[] }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const confirms: { tool: string; confirmToken: string; args: Record<string, unknown> }[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const eventLine = raw.match(/^event: (.+)$/m)?.[1]
      const dataLine = raw.match(/^data: (.+)$/m)?.[1]
      if (eventLine !== 'ui_action' || !dataLine) continue
      try {
        const data = JSON.parse(dataLine) as { type?: string; payload?: { tool?: string; confirmToken?: string; args?: Record<string, unknown> } }
        if (data.type === 'confirm_required' && data.payload?.tool && data.payload.confirmToken) {
          confirms.push({ tool: data.payload.tool, confirmToken: data.payload.confirmToken, args: data.payload.args ?? {} })
        }
      } catch { /* non-JSON data lines are not ours */ }
    }
  }
  return { confirms }
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
    // F5.5: the full funnel — the trial ends when the first successful
    // payment has issued the Policy (PENDING_SUBMISSION, contradiction #5)
    return (await prisma.policy.count({ where: { customerId } })) > 0
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

/**
 * F5.5 world hooks — everything around the chat the customer/world does
 * outside Zeno's tools: the email client (clicking the B3 magic link = a
 * consumed challenge, which IS channel verification per B3.4), the GUI
 * document upload + operator validation, and the payment provider settling
 * the session the agent opened. The CHAT side stays entirely agent-driven.
 */
async function worldHooks(customerId: string, conversationId: string): Promise<void> {
  const challenge = await prisma.verificationChallenge.findFirst({
    where: { customerId, consumedAt: null },
  })
  if (challenge) {
    await prisma.verificationChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
  }
  // The customer uploads the ID when the agent ASKS for it (the upload card
  // = a request_document_upload commit — run cmr9cq7e5 asked pre-accept and
  // deadlocked on the accepted-only condition), or once the quote is
  // accepted (the pre-payment document requirement).
  const uploadRequested = await prisma.commitLedger.count({
    where: { conversationId, tool: 'request_document_upload', outcome: 'applied' },
  })
  const accepted = await prisma.quote.count({
    where: { status: 'ACCEPTED', application: { originConversationId: conversationId } },
  })
  if (uploadRequested > 0 || accepted > 0) {
    const doc = await prisma.customerDocument.findFirst({ where: { customerId, kind: 'id_card' } })
    if (!doc) {
      await prisma.customerDocument.create({
        data: { customerId, kind: 'id_card', status: 'validated', encryptedData: Buffer.from('sim-upload'), dataIv: 'iv', dataTag: 'tag' },
      })
    }
  }
  const pending = await prisma.payment.findFirst({ where: { customerId, status: 'PENDING', providerPaymentId: { not: null } } })
  if (pending?.providerPaymentId) {
    const { settlePaymentEvent } = await import('@/lib/payments/settlement')
    await settlePaymentEvent({ provider: 'MOCK', eventId: `sim_${pending.providerPaymentId}`, event: 'payment_succeeded', providerPaymentId: pending.providerPaymentId })
  }
}

/** F5.5 step 1 DB checks — evidence, not narration. */
async function fullFunnelDbChecks(customerId: string, conversationId: string): Promise<string[]> {
  const failures: string[] = []
  const app = await prisma.application.findFirst({ where: { originConversationId: conversationId } })
  if (app?.status !== 'COMPLETED') failures.push(`application status ${app?.status ?? 'missing'} != COMPLETED`)
  const quote = app ? await prisma.quote.findFirst({ where: { applicationId: app.id } }) : null
  if (quote?.status !== 'ACCEPTED') failures.push(`quote status ${quote?.status ?? 'missing'} != ACCEPTED`)
  const schedule = quote ? await prisma.paymentSchedule.findFirst({ where: { quoteId: quote.id }, include: { installments: { orderBy: { sequence: 'asc' } } } }) : null
  if (schedule?.installments[0]?.status !== 'PAID') failures.push(`first installment ${schedule?.installments[0]?.status ?? 'missing'} != PAID`)
  const policy = await prisma.policy.findFirst({ where: { customerId } })
  if (policy?.status !== 'PENDING_SUBMISSION') failures.push(`policy ${policy?.status ?? 'missing'} != PENDING_SUBMISSION`)
  const acceptRow = await prisma.commitLedger.findFirst({ where: { conversationId, tool: 'accept_quote', outcome: 'applied' } })
  if (!acceptRow?.effects.includes('advance_phase')) failures.push('accept_quote ledger row missing advance_phase effect')
  // T6.D3 deviation: the addon path collects BD answers — they must be
  // batch-signed exactly once before the quote existed at all.
  if (app && (await prisma.medicalDeclarationSignature.count({ where: { applicationId: app.id } })) === 0) {
    failures.push('no MedicalDeclarationSignature row (batch sign never happened)')
  }
  return failures
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
      const { confirms } = await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: 'ro' }))
      // Replay each confirm card as the customer's click (same commit + token
      // the GUI round-trips via the action adapter).
      for (const c of confirms) {
        turns++
        await drain(handleChatTurn({
          conversationId: conv.id,
          customerId: customer.id,
          message: `[Action: confirm ${c.tool}]`,
          language: 'ro',
          syntheticToolCall: { id: `sim_confirm_${turns}`, name: c.tool, arguments: { ...c.args, confirmToken: c.confirmToken } },
        }))
      }
    } catch (e) {
      console.error(`    [${sc.key}#${trial}] turn "${msg.slice(0, 30)}" errored:`, (e as Error).message)
    }
  }

  for (const msg of sc.opening) await send(msg)
  while (turns < sc.maxTurns && !(await goalReached(sc.key, customer.id, conv.id))) {
    if (sc.fullFunnel) await worldHooks(customer.id, conv.id)
    await send(pickAnswer(await lastAssistant(conv.id), sc.answerPolicy))
  }
  if (sc.fullFunnel) await worldHooks(customer.id, conv.id)
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
  if (sc.fullFunnel) failures.push(...await fullFunnelDbChecks(customer.id, conv.id))
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
  // exit BEFORE $disconnect — live handles (event-bus timers) can wedge the
  // disconnect and the verdicts are already flushed; the process dying is
  // the disconnect
  process.exit(anyFailed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
