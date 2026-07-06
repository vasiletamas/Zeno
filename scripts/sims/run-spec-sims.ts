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
  // Task 2.2 (D1): the card shows the options — the agent must never
  // enumerate them in prose ("Opțiuni:" lists).
  noDntOptionEnumeration: (e) => {
    for (const m of e.messages) {
      if (m.role === 'assistant' && /op[țt]iuni\s*:/i.test(m.content)) {
        throw new Error(`agent enumerated options in prose: "${m.content.slice(0, 100)}"`)
      }
    }
  },
}

/** Task 2.2 (D1): a DNT question card captured from a show_question ui_action. */
interface DntCard { code: string; type: string; options: { value: string }[] | null }

/** Drain the SSE stream, collecting confirm_required ui_actions (F5.5 gap:
 * the GUI confirm card is a CUSTOMER click, so the sim must replay it —
 * without this the funnel deadlocks at sign_dnt/accept_quote forever) and
 * DNT question cards (Task 2.2: the cards-mode persona taps, never types). */
async function drain(stream: ReadableStream<Uint8Array>): Promise<{ confirms: { tool: string; confirmToken: string; args: Record<string, unknown> }[]; dntCards: DntCard[] }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const confirms: { tool: string; confirmToken: string; args: Record<string, unknown> }[] = []
  const dntCards: DntCard[] = []
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
        const data = JSON.parse(dataLine) as { type?: string; payload?: { tool?: string; confirmToken?: string; args?: Record<string, unknown>; groupType?: string; question?: { code?: string | null; type?: string; options?: { value: string }[] | null } } }
        if (data.type === 'confirm_required' && data.payload?.tool && data.payload.confirmToken) {
          confirms.push({ tool: data.payload.tool, confirmToken: data.payload.confirmToken, args: data.payload.args ?? {} })
        }
        if (data.type === 'show_question' && data.payload?.groupType === 'dnt' && data.payload.question?.code) {
          dntCards.push({ code: data.payload.question.code, type: data.payload.question.type ?? 'DROPDOWN', options: data.payload.question.options ?? null })
        }
      } catch { /* non-JSON data lines are not ours */ }
    }
  }
  return { confirms, dntCards }
}

/**
 * Task 2.2 (D1): the cards-mode persona's tap — exact option VALUES per
 * question code (never labels, never free text), OPEN_ENDED get typed text.
 */
const DNT_CARD_ANSWERS: Record<string, string> = {
  DNT_CONSULTATION_CONSENT: 'yes_all',
  DNT_MARKETING_CONSENT: 'no',
  DNT_ELECTRONIC_COMMUNICATION: 'yes',
  DNT_CNP: '1960229410015',
  DNT_INCOME_SOURCE: 'salary_pension',
  DNT_OCCUPATION: 'employee',
  DNT_FAMILY_SIZE: '2',
  DNT_MINOR_CHILDREN: '0',
  DNT_EDUCATION: 'university',
  DNT_LIFE_SUBTYPE: 'simple_protection',
  DNT_LIFE_NEEDS_PRIORITY: 'protejarea familiei daca patesc ceva',
  DNT_LIFE_FAMILY_INCOME: '2000_5000',
  DNT_LIFE_MONTHLY_EXPENSES: '3000 lei',
  DNT_LIFE_INSURANCE_VALIDITY: '5_9_years',
  DNT_LIFE_ACCIDENT_COVERAGE: 'yes',
  DNT_LIFE_ILLNESS_COVERAGE: 'yes',
  DNT_LIFE_SEVERE_CONDITIONS: 'no',
  DNT_LIFE_INVALIDITY_COVERAGE: 'yes',
  DNT_LIFE_INDEXATION: 'no',
  DNT_LIFE_PAYMENT_FREQUENCY: 'annual',
  DNT_LIFE_BUDGET: '100 lei pe luna',
  DNT_SUSTAINABILITY_IMPORTANCE: 'not_necessary',
  DNT_SUSTAINABILITY_PREFERENCE: 'no_preference',
}
function pickCardAnswer(card: DntCard): string {
  return DNT_CARD_ANSWERS[card.code] ?? card.options?.[0]?.value ?? 'da'
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
  if (key === 'happy-path' || key === 'verification-typed-code') {
    // F5.5: the full funnel — the trial ends when the first successful
    // payment has issued the Policy (PENDING_SUBMISSION, contradiction #5)
    return (await prisma.policy.count({ where: { customerId } })) > 0
  }
  if (key === 'dnt-refusal') {
    // any sign_dnt attempt has been ledgered (refused or otherwise)
    return (await prisma.commitLedger.count({ where: { conversationId, tool: 'sign_dnt' } })) > 0
  }
  if (key === 'dnt-card-flow' || key === 'dnt-typed-flow') {
    // Task 2.2/2.3 (D1): the DNT is signed — the card (or typed-fallback)
    // path carried it end-to-end
    return (await prisma.dnt.count({ where: { customerId } })) > 0
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
 *
 * Task 4.2 (D7): the link click is HONEST — it drives the real
 * /api/auth/verify route (same consumption + verified-claim path the
 * customer's email client hits), never flips consumedAt directly. With
 * typedCodeVerification the email hook is disabled entirely: the persona
 * types the code and the AGENT must confirm it.
 */
async function worldHooks(customerId: string, conversationId: string, opts: { typedCodeVerification?: boolean } = {}): Promise<void> {
  if (!opts.typedCodeVerification) {
    const challenge = await prisma.verificationChallenge.findFirst({
      where: { customerId, consumedAt: null, expiresAt: { gt: new Date() } },
    })
    if (challenge) {
      const { GET } = await import('@/app/api/auth/verify/route')
      const { NextRequest } = await import('next/server')
      const res = await GET(new NextRequest(`http://localhost:3001/api/auth/verify?token=${challenge.linkToken}`))
      const location = res.headers.get('location') ?? ''
      if (location.includes('error=')) {
        console.warn(`    [worldHooks] link click failed: ${location}`)
      }
    }
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

/**
 * Task 4.2 (D7): typed-code scenario checks — the AGENT confirmed the code
 * the persona typed (outcome applied proves the digits matched the hash),
 * the challenge is consumed, and accept_quote's identity gate opened
 * (accept_quote applied ⟹ it was exposed).
 */
async function typedCodeDbChecks(customerId: string, conversationId: string): Promise<string[]> {
  const failures: string[] = []
  const consumed = await prisma.verificationChallenge.findFirst({ where: { customerId, consumedAt: { not: null } } })
  if (!consumed) failures.push('no consumed verification challenge')
  const confirmRow = await prisma.commitLedger.findFirst({
    where: { conversationId, tool: 'confirm_channel_verification', outcome: 'applied', actor: 'agent' },
  })
  if (!confirmRow) failures.push('confirm_channel_verification never applied by actor=agent (the typed-code path was not exercised)')
  return failures
}

/**
 * Task 2.2 (D1): cards-mode checks — EVERY DNT answer landed through the
 * gui actor (the card), zero through the agent (no transcription), and the
 * session was signed.
 */
async function dntCardFlowDbChecks(customerId: string, conversationId: string): Promise<string[]> {
  const failures: string[] = []
  const agentWrites = await prisma.commitLedger.count({ where: { conversationId, tool: 'write_dnt_answer', actor: 'agent' } })
  if (agentWrites > 0) failures.push(`${agentWrites} write_dnt_answer call(s) from actor=agent — the card should collect`)
  const dnt = await prisma.dnt.findFirst({ where: { customerId } })
  if (!dnt) { failures.push('DNT never signed'); return failures }
  const answerCount = await prisma.dntAnswer.count({ where: { sessionId: dnt.sourceSessionId } })
  const guiWrites = await prisma.commitLedger.count({ where: { conversationId, tool: 'write_dnt_answer', actor: 'gui', outcome: 'applied' } })
  if (guiWrites < answerCount) failures.push(`only ${guiWrites}/${answerCount} DNT answers landed via actor=gui`)
  return failures
}

/**
 * Task 2.3 (D1): typed-fallback parity — the persona TYPED every answer
 * (agent transcribes through write_dnt_answer), and the signed facts are
 * IDENTICAL to what the card path would have posted (same answer table).
 */
async function dntTypedFlowDbChecks(customerId: string, conversationId: string): Promise<string[]> {
  const failures: string[] = []
  const dnt = await prisma.dnt.findFirst({ where: { customerId } })
  if (!dnt) { failures.push('DNT never signed'); return failures }
  const guiWrites = await prisma.commitLedger.count({ where: { conversationId, tool: 'write_dnt_answer', actor: 'gui' } })
  if (guiWrites > 0) failures.push(`${guiWrites} gui write(s) — the typed variant must exercise the AGENT transcription path`)
  const answers = await prisma.dntAnswer.findMany({
    where: { sessionId: dnt.sourceSessionId },
    include: { question: { select: { code: true } } },
  })
  if (answers.length === 0) failures.push('no DNT answers recorded')
  for (const a of answers) {
    const code = a.question.code
    if (!code) continue
    const expected = DNT_CARD_ANSWERS[code]
    // Task 5.4: the CNP is an AES envelope at rest on BOTH paths — compare
    // the decrypted fact, not the ciphertext (random IV per write).
    const stored = code === 'DNT_CNP' ? (await import('@/lib/security/encryption')).decryptEnvelopeTolerant(a.value) : a.value
    if (expected !== undefined && stored !== expected) {
      failures.push(`fact divergence at ${code}: typed path stored "${stored}", card path stores "${expected}"`)
    }
  }
  return failures
}

async function runTrial(sc: SpecSimScenario, trial: number): Promise<{ pass: boolean; export: ConversationExport | null; failures: string[] }> {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({
    data: { customerId: customer.id, language: 'ro', channel: 'web' },
  })
  let turns = 0
  // Each trial is an INDEPENDENT customer: a shared mailbox would claim-and-
  // merge later trials into the first verified one, and the merged-in policy
  // walls the funnel at POLICY phase (repeat purchase is out of scope —
  // snapshot policy is customer-scoped by design, D4.4). The merge path
  // itself is covered by the claim-merge integration ring. Digits-only
  // suffix: a cuid in the local-part gets mined by the model and passed as
  // a productId (2026-07-06 battery).
  const personaEmail = `ion.sim+${Date.now()}@example.com`
  // Task 2.2 (D1): the latest unanswered DNT card on screen (cards mode taps it).
  let pendingDntCard: DntCard | null = null
  const send = async (msg: string, syntheticToolCall?: { id: string; name: string; arguments: Record<string, unknown> }) => {
    turns++
    try {
      const first = await drain(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: msg, language: 'ro', ...(syntheticToolCall ? { syntheticToolCall } : {}) }))
      if (first.dntCards.length > 0) pendingDntCard = first.dntCards[first.dntCards.length - 1]
      // Replay each confirm card as the customer's click (same commit + token
      // the GUI round-trips via the action adapter). A refuse-consent persona
      // never taps the signing card — auto-clicking it would consent on the
      // customer's behalf and legitimize a post-refusal sign_dnt.
      for (const c of first.confirms) {
        if (sc.answerPolicy === 'refuse-consent' && c.tool === 'sign_dnt') continue
        turns++
        const replay = await drain(handleChatTurn({
          conversationId: conv.id,
          customerId: customer.id,
          message: `[Action: confirm ${c.tool}]`,
          language: 'ro',
          syntheticToolCall: { id: `sim_confirm_${turns}`, name: c.tool, arguments: { ...c.args, confirmToken: c.confirmToken } },
        }))
        if (replay.dntCards.length > 0) pendingDntCard = replay.dntCards[replay.dntCards.length - 1]
      }
    } catch (e) {
      console.error(`    [${sc.key}#${trial}] turn "${msg.slice(0, 30)}" errored:`, (e as Error).message)
    }
  }

  /**
   * Task 2.3 (D1): typed-fallback parity — the card is on screen but a
   * flaky-UI persona TYPES the answer instead of tapping. The pending card
   * names the question; the persona types the same answer the card path
   * would post, so both paths converge to identical dnt.facts. Cleared once
   * the card's question has an answer (or the session closed).
   */
  const typedCardAnswer = async (): Promise<string | null> => {
    if (!pendingDntCard || sc.dnt === 'cards') return null
    const session = await prisma.dntSession.findFirst({ where: { customerId: customer.id, status: 'ACTIVE' }, select: { id: true } })
    if (!session) { pendingDntCard = null; return null }
    const q = await prisma.question.findFirst({ where: { code: pendingDntCard.code }, select: { id: true } })
    if (!q || (await prisma.dntAnswer.count({ where: { sessionId: session.id, questionId: q.id } })) > 0) {
      pendingDntCard = null
      return null
    }
    return pickCardAnswer(pendingDntCard)
  }

  const hookOpts = { typedCodeVerification: sc.verification === 'typed' }
  /** Task 4.2 (D7): the live unconsumed code from the mock-email seam — the
   * persona types it instead of the world hook clicking the link. */
  const currentCode = async (): Promise<string | null> => {
    if (sc.verification !== 'typed') return null
    const challenge = await prisma.verificationChallenge.findFirst({
      where: { customerId: customer.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!challenge) return null
    const { lastMockEmailTo } = await import('@/lib/email/providers/mock')
    return lastMockEmailTo(challenge.target)?.code ?? null
  }

  for (const msg of sc.opening) await send(msg)
  while (turns < sc.maxTurns && !(await goalReached(sc.key, customer.id, conv.id))) {
    if (sc.fullFunnel) await worldHooks(customer.id, conv.id, hookOpts)
    // Task 2.2 (D1) cards mode: an unanswered DNT card on screen gets TAPPED
    // — the same synthetic gui-actor commit the real card click posts.
    if (sc.dnt === 'cards' && pendingDntCard !== null) {
      const card: DntCard = pendingDntCard
      pendingDntCard = null
      await send(`[Action: answer_dnt ${card.code}]`, { id: `sim_card_${turns}`, name: 'write_dnt_answer', arguments: { questionCode: card.code, value: pickCardAnswer(card) } })
      continue
    }
    // Task 2.3: typed personas answer the PENDING CARD's question (the
    // agent no longer enumerates options in prose, so the card is the
    // question's one visible source).
    const typed = await typedCardAnswer()
    await send(typed ?? pickAnswer(await lastAssistant(conv.id), sc.answerPolicy, await currentCode(), sc.verification ?? 'link', personaEmail))
  }
  if (sc.fullFunnel) await worldHooks(customer.id, conv.id, hookOpts)
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
  if (sc.verification === 'typed') failures.push(...await typedCodeDbChecks(customer.id, conv.id))
  if (sc.dnt === 'cards') failures.push(...await dntCardFlowDbChecks(customer.id, conv.id))
  if (sc.key === 'dnt-typed-flow') failures.push(...await dntTypedFlowDbChecks(customer.id, conv.id))
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
