/**
 * D4.7 policy-machine sim on the dev DB (MOCK provider).
 *
 * Full pipeline issue→ack→accept→capture → Policy PENDING_SUBMISSION →
 * mark_submitted → activate(AZT-x) with the frozen free-look snapshot →
 * get_policy_info statusCode policy_active → request_cancellation in-window
 * (two-step token) → CANCELLED + every capture REFUNDED → a second policy
 * with the window forced past → rejected(outside_free_look) → negatives:
 * activate without a number, agent-actor operator commit.
 *
 * Prints PASS n/9 and exits non-zero on any failure.
 * Usage: npx tsx scripts/verify-policy-machine.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { getPolicyInfo } from '@/lib/tools/handlers/policy-handlers'
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

async function buildPaid() {
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

  const email = `polmac-${customer.id}@example.com`
  await setDeclaredField(customer.id, 'dateOfBirth', '1990-01-01', 'verify-script')
  await setDeclaredField(customer.id, 'cnp', '1900101080012', 'verify-script')
  await setDeclaredField(customer.id, 'name', 'Ion Mașină', 'verify-script')
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
  const { final } = await commitConfirmed('accept_quote', { paymentOption: 'annual' }, customer.id, conversation.id)
  if (final.outcome !== 'applied') throw new Error(`accept_quote: ${JSON.stringify({ outcome: final.outcome, reason: final.reason })}`)
  const ensure = await commit('ensure_payment_session', {}, customer.id, conversation.id)
  if (ensure.outcome !== 'applied') throw new Error(`ensure_payment_session: ${JSON.stringify({ outcome: ensure.outcome, reason: ensure.reason })}`)
  const payment = await prisma.payment.findFirstOrThrow({ where: { customerId: customer.id, status: 'PENDING' } })
  await settlePaymentEvent({ provider: 'MOCK', eventId: `polmac_${payment.id}`, event: 'payment_succeeded', providerPaymentId: payment.providerPaymentId! })
  const quote = await prisma.quote.findFirstOrThrow({ where: { applicationId: application.id } })
  const policy = await prisma.policy.findFirstOrThrow({ where: { quoteId: quote.id } })
  return { customer, conversation, quote, policy }
}

async function main() {
  await seedDocuments(prisma as Parameters<typeof seedDocuments>[0])
  const fx = await buildPaid()
  const cid = fx.customer.id
  const conv = fx.conversation.id

  // (1) full pipeline → PENDING_SUBMISSION
  check('pipeline: first capture births the Policy in PENDING_SUBMISSION with issuedAt',
    fx.policy.status === 'PENDING_SUBMISSION' && fx.policy.issuedAt !== null,
    JSON.stringify({ status: fx.policy.status }))

  // (2) mark_submitted
  const sub = await commit('mark_submitted', { policyId: fx.policy.id }, cid, conv, 'operator')
  check('mark_submitted: PENDING_SUBMISSION → SUBMITTED (operator)', sub.outcome === 'applied' && (await prisma.policy.findUniqueOrThrow({ where: { id: fx.policy.id } })).status === 'SUBMITTED', JSON.stringify({ outcome: sub.outcome, reason: sub.reason }))

  // (3) activate with frozen free-look snapshot
  const act = await commit('activate_policy', { policyId: fx.policy.id, allianzPolicyNumber: 'AZT-VERIFY' }, cid, conv, 'operator')
  const p = await prisma.policy.findUniqueOrThrow({ where: { id: fx.policy.id }, include: { product: { select: { freeLookDays: true } } } })
  check('activate_policy: ACTIVE + freeLookEndsAt = activatedAt + freeLookDays (frozen snapshot)',
    act.outcome === 'applied' && p.status === 'ACTIVE' && p.allianzPolicyNumber === 'AZT-VERIFY' &&
    p.freeLookEndsAt!.getTime() === p.activatedAt!.getTime() + p.product.freeLookDays * 86_400_000,
    JSON.stringify({ outcome: act.outcome, reason: act.reason, status: p.status }))

  // (4) get_policy_info
  const info = await getPolicyInfo({}, makeCtx(cid, conv))
  check('get_policy_info: statusCode policy_active (engine-gated code, M6)',
    info.success === true && (info.data as { statusCode: string }).statusCode === 'policy_active',
    JSON.stringify(info.data))

  // (5+6) request_cancellation in-window → CANCELLED + refunds
  const { first: rcAsk, final: rc } = await commitConfirmed('request_cancellation', {}, cid, conv)
  const afterCancel = await prisma.policy.findUniqueOrThrow({ where: { id: fx.policy.id } })
  check('request_cancellation in-window: two-step token → terminal CANCELLED',
    rcAsk.outcome === 'requires_confirmation' && rc.outcome === 'applied' && (rc.effects ?? []).includes('terminal') && afterCancel.status === 'CANCELLED',
    JSON.stringify({ ask: rcAsk.outcome, res: rc.outcome, reason: rc.reason }))
  const refunded = await prisma.payment.count({ where: { customerId: cid, status: 'REFUNDED' } })
  check('refund execution: every captured payment REFUNDED', refunded >= 1, JSON.stringify({ refunded }))

  // (7) outside window → rejected(outside_free_look)
  const fx2 = await buildPaid()
  await commit('mark_submitted', { policyId: fx2.policy.id }, fx2.customer.id, fx2.conversation.id, 'operator')
  await commit('activate_policy', { policyId: fx2.policy.id, allianzPolicyNumber: 'AZT-LATE' }, fx2.customer.id, fx2.conversation.id, 'operator')
  await prisma.policy.update({ where: { id: fx2.policy.id }, data: { freeLookEndsAt: new Date(Date.now() - 86_400_000) } })
  const late = await commit('request_cancellation', {}, fx2.customer.id, fx2.conversation.id)
  check('outside window: rejected(outside_free_look), policy stays ACTIVE',
    late.outcome === 'rejected' && late.reason === 'outside_free_look' && (await prisma.policy.findUniqueOrThrow({ where: { id: fx2.policy.id } })).status === 'ACTIVE',
    JSON.stringify({ outcome: late.outcome, reason: late.reason }))

  // (8) negative: activate without the Allianz number
  const fx3 = await buildPaid()
  await commit('mark_submitted', { policyId: fx3.policy.id }, fx3.customer.id, fx3.conversation.id, 'operator')
  const noNumber = await commit('activate_policy', { policyId: fx3.policy.id }, fx3.customer.id, fx3.conversation.id, 'operator')
  check('negative: activate without allianzPolicyNumber rejected (validation)',
    noNumber.outcome === 'rejected' && noNumber.reason === 'invalid_args',
    JSON.stringify({ outcome: noNumber.outcome, reason: noNumber.reason }))

  // (9) negative: agent actor on an operator commit
  const agent = await commit('mark_submitted', { policyId: fx3.policy.id }, fx3.customer.id, fx3.conversation.id, 'agent')
  check('negative: agent actor rejected actor_not_permitted (the agent owns NOTHING)',
    agent.outcome === 'rejected' && agent.reason === 'actor_not_permitted',
    JSON.stringify({ outcome: agent.outcome, reason: agent.reason }))

  console.log(`\n==== policy machine: PASS ${passes}/9${failures ? ` — ${failures} FAILURE(S)` : ' ===='}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
