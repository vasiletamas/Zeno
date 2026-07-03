/**
 * D2.10 end-to-end money sim on the dev DB (MOCK provider).
 *
 * Drives the COUPLED FLIP through the real gateway: issue →
 * acknowledge_disclosures → accept_quote(quarterly, two-step token) →
 * schedule of 4 integer-minor installments summing exactly to
 * round(premiumAnnual*100), Quote ACCEPTED with acceptance evidence, ZERO
 * Policy rows, Conversation ACTIVE → initiate_payment on the first due
 * installment → settlePaymentEvent(success) delivered TWICE with the same
 * eventId → exactly ONE Policy in PENDING_SUBMISSION with issuedAt,
 * installment 1 PAID, schedule ACTIVE, duplicate disposition 'replay'.
 *
 * Prints PASS n/8 and exits non-zero on any failure.
 * Usage: npx tsx scripts/verify-coupled-flip.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { settlePaymentEvent } from '@/lib/payments/settlement'
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

/** Accept-ready fixture: signed DNT, full KYC + verified channel, complete
 *  questionnaire, selection, ISSUED quote. */
async function buildAcceptReady() {
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
    if (d.question.code === 'DNT_CNP') answer = '1900101080012' // checksum-valid, matches DOB below
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

  // full KYC + a consumed challenge → verified_channel (T4-R6 accept gate)
  const email = `flip-${customer.id}@example.com`
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'verify-script')
  await setDeclaredField(customer.id, 'name', 'Ion Verificat', 'verify-script')
  await setDeclaredField(customer.id, 'email', email, 'verify-script')
  await setDeclaredField(customer.id, 'phone', '+40712345678', 'verify-script')
  await prisma.verificationChallenge.create({
    data: { customerId: customer.id, channel: 'email', target: email, codeHash: 'verify-script', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
  })
  // initiate_payment's #1 row demands a VALIDATED id_card (B3, erratum 4b)
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
  return { customer, application, conversation }
}

async function main() {
  // test runs truncate the Document table on this DB — ensure the protect
  // disclosure docs exist so the T7.D2 gate actually engages (idempotent)
  await seedDocuments(prisma as Parameters<typeof seedDocuments>[0])
  const fx = await buildAcceptReady()
  const cid = fx.customer.id
  const conv = fx.conversation.id

  // (1) issue
  const issued = await commit('generate_quote', {}, cid, conv)
  const quote = await prisma.quote.findFirstOrThrow({ where: { applicationId: fx.application.id } })
  check('issue: generate_quote applies — Quote ISSUED', issued.outcome === 'applied' && quote.status === 'ISSUED', JSON.stringify({ outcome: issued.outcome, reason: issued.reason }))

  // (2) disclosures
  const ack = await commit('acknowledge_disclosures', {}, cid, conv)
  const ackRows = await prisma.disclosureAck.count({ where: { quoteId: quote.id } })
  check('disclosures: acknowledge_disclosures applies with version+language-bound rows', ack.outcome === 'applied' && ackRows === 2, JSON.stringify({ outcome: ack.outcome, reason: ack.reason, ackRows }))

  // (3) accept two-step with quarterly election
  const { first, final } = await commitConfirmed('accept_quote', { paymentOption: 'quarterly' }, cid, conv)
  const accepted = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })
  check('accept: two-step token → ACCEPTED with acceptance evidence (quarterly + acceptedAt)',
    first.outcome === 'requires_confirmation' && final.outcome === 'applied' && accepted.status === 'ACCEPTED' && accepted.paymentFrequency === 'quarterly' && accepted.acceptedAt !== null,
    JSON.stringify({ first: first.outcome, final: final.outcome, reason: final.reason, status: accepted.status }))

  // (4) schedule: 4 integer installments summing exactly
  const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: quote.id }, include: { installments: { orderBy: { sequence: 'asc' } } } })
  const sum = schedule.installments.reduce((s, i) => s + i.amountMinor, 0)
  check('schedule: 4 installments in integer bani summing EXACTLY to round(premiumAnnual*100)',
    schedule.status === 'PENDING_FIRST_CAPTURE' && schedule.installments.length === 4 && sum === Math.round(accepted.premiumAnnual * 100),
    JSON.stringify({ status: schedule.status, n: schedule.installments.length, sum, expected: Math.round(accepted.premiumAnnual * 100) }))

  // (5) THE FLIP: no Policy at accept; conversation stays ACTIVE
  const policiesAtAccept = await prisma.policy.count({ where: { quoteId: quote.id } })
  const convRow = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } })
  check('flip: ZERO Policy rows at accept; Conversation ACTIVE (contradictions #5/#11)',
    policiesAtAccept === 0 && convRow.status === 'ACTIVE',
    JSON.stringify({ policies: policiesAtAccept, conv: convRow.status }))

  // (6) initiate_payment on the first due installment (gateway legality live)
  const pay = await commit('initiate_payment', {}, cid, conv)
  const payment = await prisma.payment.findFirst({ where: { customerId: cid } })
  check('initiate_payment: PENDING Payment on installment 1 with the installment amount',
    pay.outcome === 'applied' && payment !== null && payment.installmentId === schedule.installments[0].id && payment.amountMinor === schedule.installments[0].amountMinor,
    JSON.stringify({ outcome: pay.outcome, reason: pay.reason, data: pay.data, amountMinor: payment?.amountMinor }))
  if (!payment?.providerPaymentId) {
    console.log(`\n==== coupled flip: aborted at initiate_payment — PASS ${passes}/8 ====`)
    process.exit(1)
  }

  // (7) settlement delivered TWICE with the same eventId → one Policy
  const eventId = `verify_flip_${payment.id}`
  const s1 = await settlePaymentEvent({ provider: 'MOCK', eventId, event: 'payment_succeeded', providerPaymentId: payment.providerPaymentId })
  const s2 = await settlePaymentEvent({ provider: 'MOCK', eventId, event: 'payment_succeeded', providerPaymentId: payment.providerPaymentId })
  const policies = await prisma.policy.findMany({ where: { quoteId: quote.id } })
  check('settlement: duplicate delivery settles exactly once — ONE Policy PENDING_SUBMISSION with issuedAt (contradiction #5)',
    s1.disposition === 'applied' && s2.disposition === 'replay' && policies.length === 1 && policies[0].status === 'PENDING_SUBMISSION' && policies[0].issuedAt !== null,
    JSON.stringify({ s1: s1.disposition, s2: s2.disposition, policies: policies.length, status: policies[0]?.status }))

  // (8) installment PAID, schedule ACTIVE
  const instAfter = await prisma.installment.findUniqueOrThrow({ where: { id: schedule.installments[0].id } })
  const schedAfter = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: schedule.id } })
  check('money truth: installment 1 PAID, schedule ACTIVE (3 of 4 remain)',
    instAfter.status === 'PAID' && schedAfter.status === 'ACTIVE',
    JSON.stringify({ installment: instAfter.status, schedule: schedAfter.status }))

  console.log(`\n==== coupled flip: PASS ${passes}/8${failures ? ` — ${failures} FAILURE(S)` : ' ===='}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
