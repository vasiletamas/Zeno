/**
 * T24 (P6.1) payment failure/retry recovery sim on the dev DB (MOCK inbox).
 *
 * accept quarterly → fail installment 1 via settlePaymentEvent →
 * Installment FAILED + position recoveryMode 'retried' →
 * ensure_payment_session mints a FRESH attempt (single-open invariant) →
 * settle success → Installment PAID + Policy from first capture →
 * REPLAY both eventIds → no double effect → complete the remaining
 * installments → schedule COMPLETED.
 *
 * Prints PASS n/6 and exits non-zero on any failure.
 * Usage: npx tsx scripts/verify-payment-recovery.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { deriveSchedulePosition } from '@/lib/engines/payment-position'
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

// actor 'gui': scripted fixture values are the CUSTOMER's input (P0-1 guard
// convention shared with verify-payment-ops.ts and the funnel fixtures).
const makeCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: CommitActor = 'agent', confirmToken?: string) =>
  executeCommit({ tool, args, actor, customerId, conversationId, confirmToken, toolContext: makeCtx(customerId, conversationId) })

async function commitConfirmed(tool: string, args: Record<string, unknown>, customerId: string, conversationId: string): Promise<{ first: CommitResult; final: CommitResult }> {
  const first = await commit(tool, args, customerId, conversationId)
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return { first, final: first }
  const final = await commit(tool, args, customerId, conversationId, 'agent', first.confirmToken)
  return { first, final }
}

/** Same fixture pattern as verify-payment-ops.ts: a fully accepted quarterly quote. */
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
    if (d.question.type === 'NUMBER') answer = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown } | string
      answer = typeof first === 'string' ? first : String((first as { value?: unknown }).value ?? 'da')
    }
    const w = await writeDntAnswer({ questionCode: d.question.code, value: answer }, ctx)
    if (!w.success) throw new Error(`write_dnt_answer(${d.question.code}): ${w.error}`)
  }
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  if (!signed.success) throw new Error(`sign_dnt: ${signed.error}`)

  const email = `payrec-${customer.id}@example.com`
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'verify-script')
  await setDeclaredField(customer.id, 'name', 'Ion Recuperare', 'verify-script')
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

async function loadPosition(quoteId: string) {
  const schedule = await prisma.paymentSchedule.findFirstOrThrow({
    where: { quoteId, status: { not: 'SUPERSEDED' } },
    include: { installments: { include: { payments: true }, orderBy: { sequence: 'asc' } } },
  })
  const payments = schedule.installments.flatMap((i) => i.payments)
  return { schedule, position: deriveSchedulePosition({ installments: schedule.installments, payments, now: new Date() }) }
}

async function main() {
  await seedDocuments(prisma as Parameters<typeof seedDocuments>[0])
  const fx = await buildAcceptedQuarterly()
  const cid = fx.customer.id
  const conv = fx.conversation.id

  // (a) open a session for installment 1, then FAIL it through the inbox
  const e1 = await commit('ensure_payment_session', {}, cid, conv)
  if (e1.outcome !== 'applied') throw new Error(`ensure_payment_session #1: ${JSON.stringify({ outcome: e1.outcome, reason: e1.reason })}`)
  const attempt1 = await prisma.payment.findFirstOrThrow({ where: { customerId: cid, status: 'PENDING' } })
  const failEventId = `recovery_fail_${attempt1.id}`
  await settlePaymentEvent({ provider: 'MOCK', eventId: failEventId, event: 'payment_failed', providerPaymentId: attempt1.providerPaymentId!, failureReason: 'card_declined' })
  const after1 = await loadPosition(fx.quote.id)
  const inst1 = after1.schedule.installments.find((i) => i.sequence === 1)
  const failedRow = await prisma.payment.findUniqueOrThrow({ where: { id: attempt1.id } })
  check('failed settlement: Installment 1 FAILED, attempt FAILED, position recoveryMode=retried',
    inst1?.status === 'FAILED' && failedRow.status === 'FAILED' && after1.position.recoveryMode === 'retried',
    JSON.stringify({ installment: inst1?.status, payment: failedRow.status, recoveryMode: after1.position.recoveryMode }))

  // (b) ensure supersedes the failed attempt: fresh Payment row, ONE open
  const e2 = await commit('ensure_payment_session', {}, cid, conv)
  const retry = await prisma.payment.findFirstOrThrow({ where: { customerId: cid, status: 'PENDING' } })
  const openCount = await prisma.payment.count({ where: { customerId: cid, status: 'PENDING' } })
  check('retry ensure: mode=retried, FRESH attempt, single-open invariant holds',
    e2.outcome === 'applied' && (e2.data as { mode?: string })?.mode === 'retried' &&
    retry.id !== attempt1.id && openCount === 1,
    JSON.stringify({ outcome: e2.outcome, mode: (e2.data as { mode?: string })?.mode, openCount, sameRow: retry.id === attempt1.id }))

  // (c) settle the retry successfully → Installment PAID + Policy from first capture
  const successEventId = `recovery_success_${retry.id}`
  await settlePaymentEvent({ provider: 'MOCK', eventId: successEventId, event: 'payment_succeeded', providerPaymentId: retry.providerPaymentId! })
  const after2 = await loadPosition(fx.quote.id)
  const inst1b = after2.schedule.installments.find((i) => i.sequence === 1)
  const policy = await prisma.policy.findFirst({ where: { quoteId: fx.quote.id } })
  check('retry succeeds: Installment 1 PAID, Policy exists from first capture',
    inst1b?.status === 'PAID' && policy !== null && policy.status === 'PENDING_SUBMISSION' && policy.issuedAt !== null,
    JSON.stringify({ installment: inst1b?.status, policy: policy?.status }))

  // (d) replay BOTH eventIds → dispositions 'replay', zero double effects
  const eventsBefore = await prisma.paymentEvent.count()
  const r1 = await settlePaymentEvent({ provider: 'MOCK', eventId: failEventId, event: 'payment_failed', providerPaymentId: attempt1.providerPaymentId! })
  const r2 = await settlePaymentEvent({ provider: 'MOCK', eventId: successEventId, event: 'payment_succeeded', providerPaymentId: retry.providerPaymentId! })
  const eventsAfter = await prisma.paymentEvent.count()
  const after3 = await loadPosition(fx.quote.id)
  const policyCount = await prisma.policy.count({ where: { quoteId: fx.quote.id } })
  check('replay of both eventIds: disposition=replay, installment stays PAID, ONE policy, no new events',
    r1.disposition === 'replay' && r2.disposition === 'replay' && eventsAfter === eventsBefore &&
    after3.schedule.installments.find((i) => i.sequence === 1)?.status === 'PAID' && policyCount === 1,
    JSON.stringify({ r1: r1.disposition, r2: r2.disposition, eventsBefore, eventsAfter, policyCount }))

  // (e) complete the remaining installments → schedule COMPLETED
  for (let seq = 2; seq <= 4; seq++) {
    const e = await commit('ensure_payment_session', {}, cid, conv)
    if (e.outcome !== 'applied') throw new Error(`ensure_payment_session (installment ${seq}): ${JSON.stringify({ outcome: e.outcome, reason: e.reason })}`)
    const p = await prisma.payment.findFirstOrThrow({ where: { customerId: cid, status: 'PENDING' } })
    await settlePaymentEvent({ provider: 'MOCK', eventId: `recovery_complete_${p.id}`, event: 'payment_succeeded', providerPaymentId: p.providerPaymentId! })
  }
  const finalState = await loadPosition(fx.quote.id)
  const finalPolicyCount = await prisma.policy.count({ where: { quoteId: fx.quote.id } })
  check('remaining installments settle: schedule COMPLETED, all 4 PAID, still ONE policy',
    finalState.schedule.status === 'COMPLETED' &&
    finalState.schedule.installments.every((i) => i.status === 'PAID') &&
    finalState.position.settled && finalPolicyCount === 1,
    JSON.stringify({ schedule: finalState.schedule.status, statuses: finalState.schedule.installments.map((i) => i.status), finalPolicyCount }))

  // (f) nothing left to pay
  const e5 = await commit('ensure_payment_session', {}, cid, conv)
  check('settled plan: ensure_payment_session rejected(no_due_installment)',
    e5.outcome === 'rejected' && e5.reason === 'no_due_installment',
    JSON.stringify({ outcome: e5.outcome, reason: e5.reason }))

  console.log(`\n==== payment recovery: PASS ${passes}/6${failures ? ` — ${failures} FAILURE(S)` : ' ===='}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
