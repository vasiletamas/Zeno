/**
 * Card-state SSOT (spec 2026-07-20) runtime verification on the dev DB.
 *
 * Replays the four card defects recorded in conv cmrrhruba0001g40yh3am7peo
 * through the REAL tool path (executeTool → gateway → handlers) and asserts
 * the post-fix behaviour:
 *   turn 6/10 — a non-ladder save (declaredAge) demanded contact  → no card
 *   turn 12   — a replayed collect re-delivered its stale card    → stripped
 *   turn 8    — collect + OTP emitted two competing input cards   → OTP owns
 *   (reload)  — the card set is DERIVED, expiry is a status       → 4 shapes
 * then runs the diagnostics catalog over the staged conversations: the four
 * checks that fired on the incident must find NOTHING. Each staged turn is
 * persisted as a TurnDebug row carrying the real tool results, so the checks
 * are genuinely armed (they read e.turns[].toolCalls[].result.uiAction).
 *
 * Prints ok/FAIL per case, exits 1 on any FAIL, and deletes every row it
 * created so repeated runs stay green.
 *
 * Usage: npx tsx scripts/verify-card-state.ts
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { executeTool } from '@/lib/tools/executor'
import { REPLAY_NOTICE } from '@/lib/tools/gateway'
import { extractAutoChain } from '@/lib/chat/synthetic-turn'
import { deriveActiveCards } from '@/lib/chat/derive-active-cards'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { loadConversationExport } from '@/lib/debug/load-export'
import { runDiagnostics } from '@/lib/diagnostics'
import type { DebugTurn, DebugTurnToolCall } from '@/lib/debug/reducer'
import type { ToolContext, ToolResult } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} — ${name}${!ok && detail !== undefined ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`)
  if (!ok) failures++
}

// actor 'gui': the card submit IS first-party customer input, so the P0-1
// grounding guard stands down (same idiom as verify-dnt-flow.ts and
// __tests__/integration/collect-ladder-gate.test.ts) — without it every
// scripted value is rejected as ungrounded in a conversation with no prose.
const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

const created: { customerIds: string[]; conversationIds: string[] } = { customerIds: [], conversationIds: [] }

async function makeConversation() {
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })
  created.customerIds.push(customer.id)
  created.conversationIds.push(conversation.id)
  return { customerId: customer.id, conversationId: conversation.id }
}

/** A live pending challenge suppresses the email auto-chain (T19). */
async function seedPendingChallenge(customerId: string, conversationId: string, target: string) {
  await prisma.verificationChallenge.create({
    data: {
      customerId, channel: 'email', target, codeHash: 'verify-card-state',
      linkToken: randomUUID(), conversationId,
      expiresAt: new Date(Date.now() + 600_000), attemptsRemaining: 5,
    },
  })
}

/** OPEN application bound to the conversation, optionally with an ISSUED
 * quote — the two facts Ruling 2 makes the email/phone cards due on. */
async function seedApplication(customerId: string, conversationId: string, opts: { issuedQuote?: boolean } = {}) {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const application = await prisma.application.create({
    data: { customerId, productId: product.id, status: 'OPEN' },
  })
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { productId: product.id, activeApplicationId: application.id },
  })
  if (opts.issuedQuote) {
    await prisma.quote.create({
      data: {
        applicationId: application.id, productId: product.id, customerId,
        premiumAnnual: 190, premiumMonthly: 15.83, coverages: {},
        status: 'ISSUED', validUntil: new Date(Date.now() + 30 * 86400e3),
      },
    })
  }
  return application.id
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Persist one turn the way lib/chat/turn-debug-persistence.ts does, carrying
 * the REAL ToolResults. `endedAt` is stamped after the calls so the
 * turnLedgerWindow floor/ceil invariant holds (a turn's own ledger rows land
 * before its endedAt) and stale_card_replayed is actually armed.
 */
async function recordTurn(
  conversationId: string,
  messageIndex: number,
  userMessage: string,
  startedAt: number,
  calls: { name: string; args: Record<string, unknown>; result: ToolResult }[],
) {
  const traceId = randomUUID()
  const toolCalls: DebugTurnToolCall[] = calls.map((c, i) => ({
    round: 0,
    toolCallId: `${traceId}-${i}`,
    name: c.name,
    args: c.args,
    partition: 'writing',
    result: {
      success: c.result.success,
      durationMs: 0,
      cached: false,
      data: c.result.data,
      error: c.result.error,
      uiAction: c.result.uiAction as Record<string, unknown> | undefined,
      confirmation: c.result.confirmation,
    },
  }))
  const payload: DebugTurn = {
    traceId, conversationId, messageIndex, userMessage, language: 'ro',
    startedAt, toolCalls, endedAt: Date.now(),
  }
  await prisma.turnDebug.create({
    data: { conversationId, messageIndex, traceId, payload: JSON.parse(JSON.stringify(payload)) },
  })
  // ms-granularity guard: the next turn's window floor is this endedAt and
  // the filter is strictly `at > floor`.
  await sleep(5)
}

const CARD_CHECK_IDS = ['unsolicited_contact_card', 'stale_card_replayed', 'card_for_committed_fact', 'competing_input_cards']

async function cardFindings(conversationId: string) {
  const e = await loadConversationExport(conversationId)
  if (!e) throw new Error(`loadConversationExport returned null for ${conversationId}`)
  return runDiagnostics(e).filter((f) => CARD_CHECK_IDS.includes(f.checkId))
}

// ─────────────────────────────────────────────
// Case 1 (turns 6/10): a non-ladder save emits no card
// ─────────────────────────────────────────────
async function caseNonLadderSave() {
  const { customerId, conversationId } = await makeConversation()
  const startedAt = Date.now()
  const args = { field: 'declaredAge', value: '40' }
  const r = await executeTool('collect_customer_field', args, ctx(customerId, conversationId))
  check('turn 6/10 — collect(declaredAge) applies with NO card and message "declaredAge saved."',
    r.success === true && r.uiAction === undefined && r.message === 'declaredAge saved.',
    { success: r.success, uiAction: r.uiAction, message: r.message, error: r.error })
  await recordTurn(conversationId, 0, 'am 40 de ani', startedAt, [{ name: 'collect_customer_field', args, result: r }])
  return conversationId
}

// ─────────────────────────────────────────────
// Case 2 (turn 12): a replay strips presentation
// ─────────────────────────────────────────────
async function caseReplayStripsPresentation() {
  const { customerId, conversationId } = await makeConversation()
  const email = `card-state-${Date.now()}@example.com`
  await seedPendingChallenge(customerId, conversationId, email) // suppress the auto-chain
  await seedApplication(customerId, conversationId, { issuedQuote: true }) // phone becomes due

  // fresh apply: the ladder advances and the phone card rides the result —
  // this is the envelope turn 12 later replayed verbatim.
  const t1 = Date.now()
  const emailArgs = { field: 'email', value: email }
  const fresh = await executeTool('collect_customer_field', emailArgs, ctx(customerId, conversationId))
  check('turn 12 setup — fresh collect(email) carries the phone card',
    fresh.success === true && (fresh.uiAction as { type?: string } | undefined)?.type === 'show_data_field',
    { uiAction: fresh.uiAction, error: fresh.error })
  await recordTurn(conversationId, 0, email, t1, [{ name: 'collect_customer_field', args: emailArgs, result: fresh }])

  // identical args again → replay: facts verbatim, presentation stripped.
  const t2 = Date.now()
  const replay = await executeTool('collect_customer_field', emailArgs, ctx(customerId, conversationId))
  const data = (replay.data ?? {}) as Record<string, unknown>
  check('turn 12 — replayed collect: disposition "replay", _uiAction dropped, _message = REPLAY_NOTICE',
    replay.envelope?.disposition === 'replay' && data._uiAction === undefined &&
    data._message === REPLAY_NOTICE && replay.uiAction === undefined,
    { disposition: replay.envelope?.disposition, _uiAction: data._uiAction, _message: data._message })
  await recordTurn(conversationId, 1, email, t2, [{ name: 'collect_customer_field', args: emailArgs, result: replay }])

  // ladder tail: phone applies with no successor card — this also puts an
  // applied field:phone row in the ledger, arming card_for_committed_fact.
  const t3 = Date.now()
  const phoneArgs = { field: 'phone', value: '+40712345678' }
  const phone = await executeTool('collect_customer_field', phoneArgs, ctx(customerId, conversationId))
  check('turn 12 tail — collect(phone) applies with NO successor card',
    phone.success === true && phone.uiAction === undefined,
    { success: phone.success, uiAction: phone.uiAction, error: phone.error })
  await recordTurn(conversationId, 2, '0712345678', t3, [{ name: 'collect_customer_field', args: phoneArgs, result: phone }])
  return conversationId
}

// ─────────────────────────────────────────────
// Case 3 (turn 8): the OTP card owns the auto-chain turn
// ─────────────────────────────────────────────
async function caseAutoChainOtpOwnsTurn() {
  const { customerId, conversationId } = await makeConversation()
  // no verified email channel + no live pending challenge → the chain fires;
  // the issued quote makes phone due, so a pre-fix build would emit BOTH.
  await seedApplication(customerId, conversationId, { issuedQuote: true })
  const email = `card-state-chain-${Date.now()}@example.com`

  const startedAt = Date.now()
  const emailArgs = { field: 'email', value: email }
  const collect = await executeTool('collect_customer_field', emailArgs, ctx(customerId, conversationId))
  const chain = extractAutoChain(collect)
  check('turn 8 — collect(email) declares the start_channel_verification chain and carries NO data-field card',
    collect.success === true && chain?.tool === 'start_channel_verification' && collect.uiAction === undefined,
    { chain, uiAction: collect.uiAction, error: collect.error })

  const calls: { name: string; args: Record<string, unknown>; result: ToolResult }[] =
    [{ name: 'collect_customer_field', args: emailArgs, result: collect }]
  if (chain) {
    const hop = await executeTool(chain.tool, chain.args, ctx(customerId, conversationId))
    check('turn 8 — the chain hop emits the OTP card: exactly ONE input card in the turn',
      hop.success === true && (hop.uiAction as { type?: string } | undefined)?.type === 'show_otp_entry',
      { uiAction: hop.uiAction, error: hop.error })
    calls.push({ name: chain.tool, args: chain.args, result: hop })
  }
  await recordTurn(conversationId, 0, email, startedAt, calls)
  return conversationId
}

// ─────────────────────────────────────────────
// Case 4: the derived card set (deriveActiveCards)
// ─────────────────────────────────────────────
async function caseDerivedCardSet() {
  const { customerId, conversationId } = await makeConversation()
  const has = (cards: { key: string; status: string }[], key: string, status: string) =>
    cards.some((c) => c.key === key && c.status === status)

  const applicationId = await seedApplication(customerId, conversationId)
  const afterApp = await deriveActiveCards(conversationId)
  check('derived — OPEN application → data_field:email active',
    has(afterApp, 'data_field:email', 'active'), afterApp.map((c) => `${c.key}:${c.status}`))

  await setDeclaredField(customerId, 'email', 'derived@example.com', 'verify-card-state')
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  await prisma.quote.create({
    data: {
      applicationId, productId: product.id, customerId,
      premiumAnnual: 190, premiumMonthly: 15.83, coverages: {},
      status: 'ISSUED', validUntil: new Date(Date.now() + 30 * 86400e3),
    },
  })
  const afterQuote = await deriveActiveCards(conversationId)
  check('derived — declared email + ISSUED quote → data_field:phone active, email resolved (absent)',
    has(afterQuote, 'data_field:phone', 'active') && !afterQuote.some((c) => c.key === 'data_field:email'),
    afterQuote.map((c) => `${c.key}:${c.status}`))

  await prisma.profileFieldDeferral.create({ data: { customerId, field: 'phone' } })
  const afterDeferral = await deriveActiveCards(conversationId)
  check('derived — ProfileFieldDeferral(phone) → data_field:phone flips to deferred',
    has(afterDeferral, 'data_field:phone', 'deferred'), afterDeferral.map((c) => `${c.key}:${c.status}`))

  await prisma.verificationChallenge.create({
    data: {
      customerId, channel: 'email', target: 'derived@example.com', codeHash: 'verify-card-state',
      linkToken: randomUUID(), conversationId,
      expiresAt: new Date(Date.now() - 1_000), attemptsRemaining: 5,
    },
  })
  const afterExpiry = await deriveActiveCards(conversationId)
  check('derived — unconsumed EXPIRED challenge → otp:email present with status expired (never absent)',
    has(afterExpiry, 'otp:email', 'expired'), afterExpiry.map((c) => `${c.key}:${c.status}`))
}

async function cleanup() {
  const { customerIds, conversationIds } = created
  if (customerIds.length === 0) return
  await prisma.conversation.updateMany({ where: { id: { in: conversationIds } }, data: { activeApplicationId: null } })
  await prisma.turnDebug.deleteMany({ where: { conversationId: { in: conversationIds } } })
  await prisma.turnTrace.deleteMany({ where: { conversationId: { in: conversationIds } } })
  await prisma.commitLedger.deleteMany({ where: { conversationId: { in: conversationIds } } })
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } })
  await prisma.quote.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.application.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.verificationChallenge.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.profileFieldDeferral.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customerProfileField.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.customerInsight.deleteMany({ where: { customerId: { in: customerIds } } })
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } })
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
}

async function main() {
  const staged: { label: string; conversationId: string }[] = [
    { label: 'turn 6/10', conversationId: await caseNonLadderSave() },
    { label: 'turn 12', conversationId: await caseReplayStripsPresentation() },
    { label: 'turn 8', conversationId: await caseAutoChainOtpOwnsTurn() },
  ]
  await caseDerivedCardSet()

  // Case 5: the four checks that fired on the incident conversation must find
  // nothing on the staged replays of the same shapes.
  for (const { label, conversationId } of staged) {
    const findings = await cardFindings(conversationId)
    check(`diagnostics — ${label} conversation: zero card findings (${CARD_CHECK_IDS.join(', ')})`,
      findings.length === 0, findings.map((f) => `${f.checkId}@${f.turn}`))
  }

  console.log(failures === 0 ? '\n==== card-state: all cases ok ====' : `\n==== card-state: ${failures} FAIL ====`)
}

main()
  .then(async () => {
    await cleanup()
    await prisma.$disconnect()
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch(async (e) => {
    console.error(e)
    await cleanup().catch((ce) => console.error('cleanup failed:', ce))
    await prisma.$disconnect()
    process.exit(1)
  })
