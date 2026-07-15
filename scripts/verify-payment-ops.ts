/**
 * D3.6 payment-operations sim on the dev DB (MOCK provider).
 *
 * accept quarterly → get_payment_status shows 4 pending → two
 * ensure_payment_session calls → exactly ONE PENDING Payment (single-open-
 * attempt) → change_payment_option to annual (two-step token) → superseded
 * chain intact + status read follows it (1 installment) → settle the first
 * capture → Policy exists → change_payment_option now
 * rejected(schedule_already_captured) → ensure_payment_session
 * rejected(no_due_installment).
 *
 * Prints PASS n/7 and exits non-zero on any failure.
 * Usage: npx tsx scripts/verify-payment-ops.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { getPaymentStatus } from '@/lib/tools/handlers/payment-handlers'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { writeRevision } from '@/lib/engines/answer-store'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { getDntNextQuestion, writeDntAnswer, openDntSession, signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { seedDocuments } from '@/prisma/seeds/seed-documents'
import type { ToolContext } from '@/lib/tools/types'
import type { CommitActor, CommitResult } from '@/lib/engines/domain-types'

let passes = 0
let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (ok) passes++
  else failures++
}

const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: CommitActor = 'agent', confirmToken?: string) =>
  executeCommit({ tool, args, actor, customerId, conversationId, confirmToken, toolContext: makeCtx(customerId, conversationId) })

async function commitConfirmed(tool: string, args: Record<string, unknown>, customerId: string, conversationId: string): Promise<{ first: CommitResult; final: CommitResult }> {
  const first = await commit(tool, args, customerId, conversationId)
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return { first, final: first }
  const final = await commit(tool, args, customerId, conversationId, 'agent', first.confirmToken)
  return { first, final }
}

async function buildAcceptedQuarterly() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const application = await prisma.application.create({ data: { customerId: customer.id, productId: product.id, status: 'OPEN' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id, activeApplicationId: application.id } })
  await prisma.application.update({ where: { id: application.id }, data: { originConversationId: conversation.id } })
  const ctx = makeCtx(customer.id, conversation.id)

  const opened = await openDntSession({}, ctx)
  if (!opened.success) throw new Error(`open_dnt_session: ${opened.error}`)
  const w0 = await writeDntAnswer({ questionCode: 'DNT_LIFE_SUBTYPE', value: 'simple_protection' }, ctx)
  if (!w0.success) throw new Error(`write_dnt_answer: ${w0.error}`)
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx)
    if (!n.success) throw new Error(`get_dnt_next_question: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let answer = 'da'
    if (d.question.code === 'DNT_CNP') answer = '1900101080012'
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

  const email = `payops-${customer.id}@example.com`
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'verify-script')
  await setDeclaredField(customer.id, 'name', 'Ion Plată', 'verify-script')
  await setDeclaredField(customer.id, 'email', email, 'verify-script')
  await setDeclaredField(customer.id, 'phone', '+40712345678', 'verify-script')
  await prisma.verificationChallenge.create({
    data: { customerId: customer.id, channel: 'email', target: email, codeHash: 'verify-script', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  await prisma.customerDocument.create({
    data: { customerId: customer.id, kind: 'id_card', status: 'validated', encryptedData: Buffer.from('verify-script'), dataIv: 'iv', dataTag: 'tag' },
  })

  for (const args of [{ tier: 'standard' }, { level: 'level_1' }]) {
    const r = await commit('select_coverage', args, customer.id, conversation.id)
    if (r.outcome !== 'applied') throw new Error(`select_coverage: ${JSON.stringify(r)}`)
  }
  const groupCodes = (await resolveGroupCodes(product.id, 'application')) ?? []
  const questions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: groupCodes.filter((c) => c !== 'bd_medical') } } } })
    : []
  for (const q of questions) {
    await writeRevision(prisma, { applicationId: application.id, questionId: q.id, value: 'true', source: 'USER_ANSWER' })
  }
  const issued = await commit('generate_quote', {}, customer.id, conversation.id)
  if (issued.outcome !== 'applied') throw new Error(`generate_quote: ${JSON.stringify({ outcome: issued.outcome, reason: issued.reason })}`)
  const ack = await commit('acknowledge_disclosures', {}, customer.id, conversation.id)
  if (ack.outcome !== 'applied') throw new Error(`acknowledge_disclosures: ${ack.outcome}`)
  const { final } = await commitConfirmed('accept_quote', { paymentOption: 'quarterly' }, customer.id, conversation.id)
  if (final.outcome !== 'applied') throw new Error(`accept_quote: ${JSON.stringify({ outcome: final.outcome, reason: final.reason })}`)
  const quote = await prisma.quote.findFirstOrThrow({ where: { applicationId: application.id } })
  return { customer, application, conversation, quote }
}

async function main() {
  await seedDocuments(prisma as Parameters<typeof seedDocuments>[0])
  const fx = await buildAcceptedQuarterly()
  const cid = fx.customer.id
  const conv = fx.conversation.id
  const ctx = makeCtx(cid, conv)

  // (1) status: 4 pending installments
  const s1 = await getPaymentStatus({}, ctx)
  const d1 = s1.data as { frequency: string; installments: { status: string }[] }
  check('status: quarterly plan with 4 pending installments', s1.success === true && d1.frequency === 'quarterly' && d1.installments.length === 4 && d1.installments.every((i) => i.status === 'PENDING'), JSON.stringify(d1))

  // (2) ensure twice → one PENDING payment
  const e1 = await commit('ensure_payment_session', {}, cid, conv)
  const e2 = await commit('ensure_payment_session', {}, cid, conv, 'gui')
  const pendingCount = await prisma.payment.count({ where: { customerId: cid, status: 'PENDING' } })
  check('ensure twice: started then resumed, exactly ONE capturable PENDING payment',
    e1.outcome === 'applied' && (e1.data as { mode: string }).mode === 'started' &&
    e2.outcome === 'applied' && (e2.data as { mode: string }).mode === 'resumed' && pendingCount === 1,
    JSON.stringify({ e1: { outcome: e1.outcome, reason: e1.reason, mode: (e1.data as { mode?: string })?.mode }, e2: { outcome: e2.outcome, reason: e2.reason, mode: (e2.data as { mode?: string })?.mode }, pendingCount }))

  // (3) change to annual (token two-step) → superseded chain
  const { first: cAsk, final: cRes } = await commitConfirmed('change_payment_option', { paymentOption: 'annual' }, cid, conv)
  const cData = cRes.data as { oldScheduleId: string; newScheduleId: string }
  const oldS = cRes.outcome === 'applied' ? await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: cData.oldScheduleId } }) : null
  check('change_payment_option: two-step re-rate quarterly → annual, superseded chain intact',
    cAsk.outcome === 'requires_confirmation' && cRes.outcome === 'applied' && (cRes.effects ?? []).includes('re_rating') &&
    oldS?.status === 'SUPERSEDED' && oldS.supersededById === cData.newScheduleId,
    JSON.stringify({ ask: cAsk.outcome, res: cRes.outcome, reason: cRes.reason }))

  // (4) status follows the chain: 1 installment, annual
  const s2 = await getPaymentStatus({}, ctx)
  const d2 = s2.data as { frequency: string; installments: unknown[] }
  check('status follows the supersession chain: annual, 1 installment', d2.frequency === 'annual' && d2.installments.length === 1, JSON.stringify(d2))

  // (5) settle the first capture → Policy exists
  const e3 = await commit('ensure_payment_session', {}, cid, conv)
  const pay = await prisma.payment.findFirstOrThrow({ where: { customerId: cid, status: 'PENDING' } })
  await settlePaymentEvent({ provider: 'MOCK', eventId: `payops_${pay.id}`, event: 'payment_succeeded', providerPaymentId: pay.providerPaymentId! })
  const policy = await prisma.policy.findFirst({ where: { quoteId: fx.quote.id } })
  check('first capture settles: Policy exists in PENDING_SUBMISSION',
    e3.outcome === 'applied' && policy !== null && policy.status === 'PENDING_SUBMISSION' && policy.issuedAt !== null,
    JSON.stringify({ e3: e3.outcome, policy: policy?.status }))

  // (6) change now rejected(schedule_already_captured)
  const cAfter = await commit('change_payment_option', { paymentOption: 'quarterly' }, cid, conv)
  check('post-capture change rejected(schedule_already_captured)',
    cAfter.outcome === 'rejected' && cAfter.reason === 'schedule_already_captured',
    JSON.stringify({ outcome: cAfter.outcome, reason: cAfter.reason }))

  // (7) ensure now rejected(no_due_installment) — annual plan settled
  const e4 = await commit('ensure_payment_session', {}, cid, conv)
  check('settled plan: ensure_payment_session rejected(no_due_installment)',
    e4.outcome === 'rejected' && e4.reason === 'no_due_installment',
    JSON.stringify({ outcome: e4.outcome, reason: e4.reason }))

  console.log(`\n==== payment ops: PASS ${passes}/7${failures ? ` — ${failures} FAILURE(S)` : ' ===='}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
