/**
 * D1.9 runtime verification of the quote lifecycle on the dev DB.
 *
 * Four legs through the real gateway on a quote-READY application (signed
 * DNT, declared identity, full selection, complete questionnaire):
 *   (a) issue    — generate_quote applies: Quote ISSUED, application frozen
 *                  (T7.D1), decision persisted, generate_quote re-blocked
 *                  application_frozen.
 *   (b) cancel   — cancel_quote two-step (requires_confirmation → token →
 *                  applied + terminal): CAS ISSUED→CANCELLED, pointer
 *                  released, set_application recovery exposed (T13.D2).
 *   (c) referred — a live escalate flag → outcome referred: Application
 *                  REFERRED + WorkItem(REFERRAL) in the same commit (E2).
 *   (d) identity — no DOB/CNP profile facts at quote time (P0-4: invalid
 *                  CNPs reject at write, so the facts are dropped post-sign)
 *                  → requires_identity with needs; nothing priced on a
 *                  guessed age.
 *
 * Prints PASS n/4 and exits non-zero on any failure.
 * Usage: npx tsx scripts/verify-quote-lifecycle.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { writeRevision } from '@/lib/engines/answer-store'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { getDntNextQuestion, writeDntAnswer, openDntSession, signDnt } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'
import type { CommitActor } from '@/lib/engines/domain-types'

let passes = 0
let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (ok) passes++
  else failures++
}

// actor 'gui': the script's scripted values are the CUSTOMER's own input —
// the P0-1 grounding write-guard only polices agent-actor writes (same
// convention as __tests__/helpers/funnel-fixtures.ts fixtureCtx). Gateway
// commits still pass their own req.actor for ledger/confirmation semantics.
const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: CommitActor = 'agent', confirmToken?: string) =>
  executeCommit({ tool, args, actor, customerId, conversationId, confirmToken, toolContext: makeCtx(customerId, conversationId) })

/** Signed DNT + identity + selection + complete questionnaire — the same
 *  fixture path the integration tests use, driven through handlers/gateway. */
async function buildReady(opts: { escalationFlag?: string; withoutDob?: boolean } = {}) {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const application = await prisma.application.create({ data: { customerId: customer.id, productId: product.id, status: 'OPEN' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id, activeApplicationId: application.id } })
  await prisma.application.update({ where: { id: application.id }, data: { originConversationId: conversation.id } })
  const ctx = makeCtx(customer.id, conversation.id)

  // sign the DNT (simple protection). P0-4: checksum-invalid CNP writes now
  // REJECT at write time, so the DNT always carries a valid CNP — the
  // withoutDob leg models missing identity by deleting the mirrored profile
  // facts after signing (same as __tests__/helpers/funnel-fixtures.ts).
  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`open_dnt_session: ${opened.error}`)
  const cnp = '1980418089861'
  const w0 = await writeDntAnswer({ questionCode: 'DNT_LIFE_SUBTYPE', value: 'simple_protection' }, ctx)
  if (!w0.success) throw new Error(`write_dnt_answer(DNT_LIFE_SUBTYPE): ${w0.error}`)
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`get_dnt_next_question: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let answer = 'da'
    if (d.question.code === 'DNT_CNP') answer = cnp
    else if (d.question.type === 'NUMBER') answer = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown } | string
      answer = typeof first === 'string' ? first : String((first as { value?: unknown }).value ?? 'da')
    }
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answer }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${d.question.code}): ${w.error}`)
  }
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`sign_dnt: ${signed.error}`)

  if (!opts.withoutDob) {
    await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
    await setDeclaredField(customer.id, 'cnp', '1980418089861', 'verify-script')
  } else {
    // identity facts underivable at quote time → the decision must demand
    // identity, never price on a guessed age (P0-4 modelling: drop the
    // profile facts the DNT mirror created)
    await prisma.customerProfileField.deleteMany({ where: { customerId: customer.id, field: { in: ['cnp', 'dateOfBirth'] } } })
  }

  // selection through the gateway, one facet per commit (C1.6)
  for (const args of [{ tier: 'standard' }, { level: 'level_1' }]) {
    const r = await commit('select_coverage', args, customer.id, conversation.id)
    if (r.outcome !== 'applied') throw new Error(`select_coverage(${JSON.stringify(args)}): ${JSON.stringify(r)}`)
  }

  // complete the questionnaire (bd_medical hidden — addon off)
  const groupCodes = (await resolveGroupCodes(product.id, 'application')) ?? []
  const questions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: groupCodes.filter((c) => c !== 'bd_medical') } } } })
    : []
  for (const q of questions) {
    await writeRevision(prisma, { applicationId: application.id, questionId: q.id, value: 'true', source: 'USER_ANSWER' })
  }

  if (opts.escalationFlag) {
    await prisma.application.update({
      where: { id: application.id },
      data: { flagsForReview: [{ questionCode: opts.escalationFlag, answer: 'false', reason: 'requires manual underwriting review', action: 'escalate' }] },
    })
  }
  return { customer, application, conversation }
}

async function main() {
  // ── leg (a): issue — ISSUED quote + frozen application ──
  const fx = await buildReady()
  const issued = await commit('generate_quote', {}, fx.customer.id, fx.conversation.id)
  const quote = await prisma.quote.findFirst({ where: { applicationId: fx.application.id } })
  const appAfter = await prisma.application.findUniqueOrThrow({ where: { id: fx.application.id } })
  const postIssue = deriveAndExpose(await loadDomainSnapshot(fx.conversation.id))
  check('issue: generate_quote applies — Quote ISSUED, application frozen (frozenAt + COMPLETED + decision), re-quote blocked application_frozen',
    issued.outcome === 'applied' && quote?.status === 'ISSUED' && quote.paymentFrequency === null &&
    appAfter.frozenAt !== null && appAfter.status === 'COMPLETED' && appAfter.quoteDecision !== null &&
    postIssue.state.application?.frozen === true &&
    postIssue.actions.blocked.find((b) => b.action === 'generate_quote')?.reason === 'application_frozen',
    JSON.stringify({ outcome: issued.outcome, quote: quote?.status, frozenAt: appAfter.frozenAt, block: postIssue.actions.blocked.find((b) => b.action === 'generate_quote') }))

  // ── leg (b): cancel_quote two-step → CANCELLED + terminal + recovery ──
  // P2-8 gate: cancel_quote is exposed only after the CUSTOMER speaks
  // post-issue (the model cannot self-cancel a fresh quote and loop)
  await prisma.message.create({
    data: { conversationId: fx.conversation.id, role: 'user', content: 'E prea scump — anulează oferta, te rog.' },
  })
  const first = await commit('cancel_quote', {}, fx.customer.id, fx.conversation.id)
  const second = first.outcome === 'requires_confirmation' && first.confirmToken
    ? await commit('cancel_quote', {}, fx.customer.id, fx.conversation.id, 'agent', first.confirmToken)
    : first
  const cancelled = await prisma.quote.findUniqueOrThrow({ where: { id: quote!.id } })
  const pointer = (await prisma.conversation.findUniqueOrThrow({ where: { id: fx.conversation.id } })).activeApplicationId
  const postCancel = deriveAndExpose(await loadDomainSnapshot(fx.conversation.id))
  check('cancel: two-step token → applied + terminal, CAS CANCELLED, pointer released, set_application recovery exposed (no cancel_quote)',
    first.outcome === 'requires_confirmation' && !!first.confirmToken &&
    second.outcome === 'applied' && (second.effects ?? []).includes('terminal') &&
    cancelled.status === 'CANCELLED' && pointer === null &&
    postCancel.actions.available.includes('set_application') && !postCancel.actions.available.includes('cancel_quote'),
    JSON.stringify({ first: first.outcome, second: second.outcome, status: cancelled.status, pointer, available: postCancel.actions.available }))

  // ── leg (c): escalate flag → referred + WorkItem ──
  const ref = await buildReady({ escalationFlag: 'HEALTH_DECLARATION_CONFIRM' })
  const referred = await commit('generate_quote', {}, ref.customer.id, ref.conversation.id)
  const refApp = await prisma.application.findUniqueOrThrow({ where: { id: ref.application.id } })
  const workItem = await prisma.workItem.findFirst({ where: { kind: 'REFERRAL', refs: { path: ['applicationId'], equals: ref.application.id } } })
  check('referred: escalate flag → outcome referred(manual_underwriting), Application REFERRED, open REFERRAL WorkItem in the same commit',
    referred.outcome === 'referred' && referred.reason === 'manual_underwriting' &&
    refApp.status === 'REFERRED' && workItem?.status === 'OPEN' &&
    (workItem.refs as { applicationId?: string })?.applicationId === ref.application.id,
    JSON.stringify({ outcome: referred.outcome, reason: referred.reason, app: refApp.status, workItem: workItem?.status }))

  // ── leg (d): no DOB / invalid CNP → requires_identity ──
  const anon = await buildReady({ withoutDob: true })
  const needsId = await commit('generate_quote', {}, anon.customer.id, anon.conversation.id)
  const anonQuotes = await prisma.quote.count({ where: { applicationId: anon.application.id } })
  check('identity: no DOB → requires_identity with needs, no quote row (never price a guessed age)',
    needsId.outcome === 'requires_identity' && Array.isArray(needsId.needs) && needsId.needs.length > 0 && anonQuotes === 0,
    JSON.stringify({ outcome: needsId.outcome, needs: needsId.needs, quotes: anonQuotes }))

  console.log(`\n==== quote lifecycle: PASS ${passes}/4${failures ? ` — ${failures} FAILURE(S)` : ' ===='}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
