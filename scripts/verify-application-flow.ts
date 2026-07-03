/**
 * B4.7 runtime verification for the application lifecycle on the dev DB.
 *
 * Drives the ratified flow through the gateway: candidate →
 * set_application WITHOUT a DNT (T5.D1) → questionnaire blocked
 * requires_consent(valid_dnt) → DNT via the B2 surface → answers →
 * select_coverage → quote → re-select under the quote (application_frozen,
 * D1) → cancel_quote with confirmation (terminal, pointer released) →
 * re-apply with prefill-as-proposals. Prints PASS/FAIL per leg; exits
 * non-zero on failure.
 *
 * Usage: npx tsx scripts/verify-application-flow.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { getDntNextQuestion, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import { getLastApplicationInfo, appGroupCodesFor } from '@/lib/tools/handlers/application-handlers'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { setDeclaredField } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'
import type { CommitActor } from '@/lib/engines/domain-types'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: CommitActor = 'agent', confirmToken?: string) =>
  executeCommit({ tool, args, actor, customerId, conversationId, confirmToken, toolContext: makeCtx(customerId, conversationId) })

async function answerAllDnt(ctx: ToolContext): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`get_dnt_next_question failed: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let answer = 'da'
    if (d.question.code === 'DNT_CNP') answer = '1980418089861'
    else if (d.question.type === 'NUMBER') answer = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown; label?: unknown } | string
      answer = typeof first === 'string' ? first : String(first.value ?? first.label ?? 'da')
    }
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answer }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${d.question.code}) failed: ${w.error}`)
  }
}

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, candidateProductId: product.id } })
  const ctx = makeCtx(customer.id, conv.id)

  // leg 1: set_application WITHOUT a DNT (T5.D1)
  const opened = await commit('set_application', {}, customer.id, conv.id)
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: customer.id } })
  check('set_application applies with NO DNT; product frozen; pointer bound',
    opened.outcome === 'applied' && app.status === 'OPEN' && app.productId === product.id,
    JSON.stringify(opened))

  // leg 2: questionnaire is DNT-gated in exposure
  const exposed = deriveAndExpose(await loadDomainSnapshot(conv.id))
  const saveBlock = exposed.actions.blocked.find((b) => b.action === 'write_question_answer')
  check('write_question_answer blocked requires_consent(valid_dnt) pre-DNT',
    !exposed.actions.available.includes('write_question_answer') && saveBlock?.reason === 'requires_consent',
    JSON.stringify(saveBlock))

  // leg 3: DNT via the B2 surface, then the questionnaire opens
  const dntOpen = await commit('open_dnt_session', {}, customer.id, conv.id, 'gui')
  if (dntOpen.outcome !== 'applied') throw new Error(`open_dnt_session: ${JSON.stringify(dntOpen)}`)
  await answerAllDnt(ctx)
  const consent = { gdpr: true, aiDisclosure: true }
  const sign1 = await commit('sign_dnt', { consent }, customer.id, conv.id, 'gui')
  const sign2 = sign1.outcome === 'requires_confirmation' && sign1.confirmToken
    ? await commit('sign_dnt', { consent }, customer.id, conv.id, 'gui', sign1.confirmToken)
    : sign1
  const afterDnt = deriveAndExpose(await loadDomainSnapshot(conv.id))
  check('after DNT sign the questionnaire is writable',
    sign2.outcome === 'applied' && afterDnt.actions.available.includes('write_question_answer'),
    JSON.stringify({ sign: sign2.outcome }))

  // leg 4: answer the questionnaire through the gateway, driven by the
  // engine's own next-question (the ordering truth the handler uses)
  let answered = 0
  for (let i = 0; i < 20; i++) {
    const codes = await appGroupCodesFor({ conversationId: conv.id }, false)
    const next = await getNextQuestion(codes, { kind: 'application', applicationId: app.id })
    if (!next) break
    const q = next.question
    const first = Array.isArray(q.options) ? (q.options[0] as { value?: string } | undefined) : undefined
    const value = first?.value ?? 'true'
    const r = await commit('write_question_answer', { answer: value }, customer.id, conv.id)
    if (r.outcome !== 'applied') throw new Error(`save(${q.code}): ${JSON.stringify(r)}`)
    answered++
  }
  // identity gate: generate_quote needs declared cnp-or-dob (#1)
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
  const complete = deriveAndExpose(await loadDomainSnapshot(conv.id))
  check(`questionnaire complete via gateway (${answered} answers); selection_incomplete blocks generate_quote (#10)`,
    complete.state.application?.missingCodes.length === 0 &&
    complete.actions.blocked.find((b) => b.action === 'generate_quote')?.reason === 'selection_incomplete',
    JSON.stringify({ missing: complete.state.application?.missingCodes, blocked: complete.actions.blocked.find((b) => b.action === 'generate_quote') }))

  // leg 5: select_coverage (sole writer, ONE facet per commit — C1.6) then quote
  const multi = await commit('select_coverage', { tier: 'standard', level: 'level_1' }, customer.id, conv.id, 'gui')
  const selTier = await commit('select_coverage', { tier: 'standard' }, customer.id, conv.id, 'gui')
  const selLevel = await commit('select_coverage', { level: 'level_1' }, customer.id, conv.id, 'gui')
  const quote = await commit('generate_quote', {}, customer.id, conv.id)
  check('select_coverage: multi-facet rejected (one_facet_per_commit); sequential facets apply (no Answer rows) and generate_quote issues',
    multi.outcome === 'rejected' && multi.reason === 'one_facet_per_commit' &&
    selTier.outcome === 'applied' && selLevel.outcome === 'applied' && quote.outcome === 'applied' &&
    (await prisma.answer.count({ where: { applicationId: app.id, question: { code: { in: ['PACKAGE_CHOICE', 'PREMIUM_LEVEL', 'BD_ADDON_INTEREST'] } } } })) === 0,
    JSON.stringify({ multi: multi.outcome, selTier: selTier.outcome, selLevel: selLevel.outcome, quote: quote.outcome }))

  // leg 6 (D1.7, T7.D1): re-selection under the quote is engine-illegal —
  // application_frozen, quote untouched (the immutable priced artifact)
  const resel = await commit('select_coverage', { level: 'level_2' }, customer.id, conv.id, 'gui')
  const stillIssued = await prisma.quote.findFirstOrThrow({ where: { applicationId: app.id } })
  check('re-selection under the quote is rejected application_frozen; quote stays ISSUED (D1)',
    resel.outcome === 'rejected' && resel.reason === 'application_frozen' && stillIssued.status === 'ISSUED',
    JSON.stringify({ outcome: resel.outcome, reason: resel.reason, quote: stillIssued.status }))

  // leg 7 (D1.5, T13.D2): the recovery path is cancel_QUOTE — two-step token,
  // terminal CAS CANCELLED, pointer released; the frozen COMPLETED
  // application stays as the audit record of what was priced
  const c1 = await commit('cancel_quote', {}, customer.id, conv.id)
  const c2 = c1.outcome === 'requires_confirmation' && c1.confirmToken
    ? await commit('cancel_quote', {}, customer.id, conv.id, 'agent', c1.confirmToken)
    : c1
  const cancelledQuote = await prisma.quote.findFirstOrThrow({ where: { applicationId: app.id } })
  const pointer = (await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).activeApplicationId
  check('cancel_quote: confirmation round-trip → terminal, quote CANCELLED, pointer released',
    c1.outcome === 'requires_confirmation' && c2.outcome === 'applied' && c2.effects.includes('terminal') &&
    cancelledQuote.status === 'CANCELLED' && pointer === null,
    JSON.stringify({ first: c1.outcome, second: c2.outcome, quote: cancelledQuote.status, pointer }))

  // leg 8: re-apply — the pointer is free and the COMPLETED history exists;
  // prior answers surface as proposals
  const reopened = await commit('set_application', {}, customer.id, conv.id)
  const info = await getLastApplicationInfo({}, ctx)
  const proposals = (info.data as { proposals: Array<{ questionCode: string }> }).proposals
  check('re-apply opens a fresh application; prior answers ride back as PROPOSALS only',
    reopened.outcome === 'applied' && proposals.length > 0 &&
    (await prisma.answer.count({ where: { application: { customerId: customer.id, status: 'OPEN' } } })) === 0,
    JSON.stringify({ reopened: reopened.outcome, proposals: proposals.length }))

  console.log(failures === 0 ? '\n==== application-flow: all invariants PASS ====' : `\n==== application-flow: ${failures} FAIL ====`)
  await prisma.$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
