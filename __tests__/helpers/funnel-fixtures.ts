/**
 * D1 funnel fixtures: a quote-READY application — signed DNT (consents
 * granted at signing), complete questionnaire, full selection, declared
 * identity — plus the referral/identity variants the generate_quote
 * decision tests need.
 */
import { prisma } from '@/lib/db'
import { setDeclaredField } from '@/lib/customer/profile-service'
import { writeRevision } from '@/lib/engines/answer-store'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { executeCommit } from '@/lib/tools/gateway'
import { seedDocuments } from '@/prisma/seeds/seed-documents'
import { seedMinimalProtectFixture, signDntWithFacts } from './test-db'
import type { ToolContext } from '@/lib/tools/types'

export async function buildReadyApplication(options: { escalationFlag?: string; withoutDob?: boolean; addon?: boolean } = {}) {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: options.addon ?? false })
  await signDntWithFacts(fx, {
    DNT_LIFE_SUBTYPE: 'simple_protection',
  })
  if (!options.withoutDob) {
    await setDeclaredField(fx.customerId, 'dateOfBirth', '1990-01-01', 'fixture')
    // checksum-valid AND consistent with the declared DOB (identity tier
    // derivation cross-checks cnpMatchesDob — D2.5); carries the residency fact
    await setDeclaredField(fx.customerId, 'cnp', '1900101080012', 'fixture')
  } else {
    // withoutDob = the personas scenario: identity facts underivable at quote
    // time → the decision must demand identity, never price on a guessed age.
    // P0-4 (2026-07-06) retired the old mechanism (a checksum-invalid CNP
    // tolerated into the DNT — such writes now reject), so model the state
    // directly: drop the profile facts the DNT mirror created.
    await prisma.customerProfileField.deleteMany({ where: { customerId: fx.customerId, field: { in: ['cnp', 'dateOfBirth'] } } })
  }
  // complete the application questionnaire directly (the commit under test
  // is generate_quote, not the answer path). With the addon ON the visible
  // set includes bd_medical: those answer 'false' (raw store writes fire no
  // consequence plans, so the addon stays selected AND stays addon-eligible).
  const groupCodes = (await resolveGroupCodes((await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })).productId, 'application')) ?? []
  const includeBd = options.addon ?? false
  const questions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: includeBd ? groupCodes : groupCodes.filter((c) => c !== 'bd_medical') } } } })
    : []
  for (const q of questions) {
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: q.id, value: q.code?.startsWith('BD_') ? 'false' : 'true', source: 'USER_ANSWER' })
  }
  if (includeBd) {
    // the batch medical signature gates generate_quote (T6.D3) — sign it
    // through the real gateway; actor 'gui' applies without the confirm step
    const signedMed = await executeCommit({ tool: 'sign_medical_declarations', args: {}, actor: 'gui', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    if (signedMed.outcome !== 'applied') throw new Error(`buildReadyApplication: sign_medical_declarations ${signedMed.outcome} (${signedMed.reason})`)
  }
  if (options.escalationFlag) {
    // the C1 pause → customer-resumed path leaves the derived escalate flag
    // live on an OPEN app — the referral criterion at quote time (erratum 9)
    await prisma.application.update({
      where: { id: fx.applicationId },
      data: { flagsForReview: [{ questionCode: options.escalationFlag, answer: 'false', reason: 'requires manual underwriting review', action: 'escalate' }] },
    })
  }
  return fx
}

// actor 'gui': fixture values are the CUSTOMER's scripted input — the P0-1
// write-guard only polices agent-actor writes.
export const fixtureCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

/**
 * buildIssuedQuote + everything accept_quote's legality demands (D2.5,
 * erratum-8 fixture spec): protect disclosure docs seeded and ACKED through
 * the real acknowledge_disclosures commit, full KYC declared (name/email/
 * phone on top of buildReadyApplication's dob+cnp) and a CONSUMED email
 * VerificationChallenge so the derived tier is verified_channel. Options
 * peel one gate off at a time for the blocked-path tests. Returns
 * { customerId, conversationId, applicationId, quoteId }.
 */
export async function buildAcceptReadyQuote(options: { withoutDisclosureAck?: boolean; withoutVerifiedChannel?: boolean } = {}) {
  const fx = await buildIssuedQuote()
  await seedDocuments(prisma) // idempotent — IPID/TERMS v1 ro+en
  await setDeclaredField(fx.customerId, 'name', 'Ion Fixture', 'fixture')
  const email = `fx-${fx.customerId}@example.com`
  await setDeclaredField(fx.customerId, 'email', email, 'fixture')
  await setDeclaredField(fx.customerId, 'phone', '+40712345678', 'fixture')
  if (options.withoutVerifiedChannel) {
    // 2026-07-21: createCustomer() now proves a channel by DEFAULT (R2 — the
    // DNT/questionnaire commits upstream of this fixture require one). So
    // "without a verified channel" can no longer mean "skip the create"; it
    // must actively remove what the upstream fixture provided, or this option
    // silently stops peeling off the gate it names.
    await prisma.verificationChallenge.deleteMany({ where: { customerId: fx.customerId } })
  } else {
    // a CONSUMED challenge is what makes a channel verified (B3.4)
    await prisma.verificationChallenge.create({
      data: { customerId: fx.customerId, channel: 'email', target: email, codeHash: 'fixture', expiresAt: new Date(Date.now() + 600_000), consumedAt: new Date() },
    })
  }
  if (!options.withoutDisclosureAck) {
    const ack = await executeCommit({ tool: 'acknowledge_disclosures', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    if (ack.outcome !== 'applied') throw new Error(`buildAcceptReadyQuote: acknowledge_disclosures ${ack.outcome} (${ack.reason})`)
  }
  return fx
}

/**
 * buildAcceptReadyQuote + a real gateway accept_quote (two-step) at the
 * given frequency, plus one PENDING Payment on installment 1 (D2.6,
 * erratum-8 fixture spec). Returns { ...fx, quoteId, scheduleId,
 * installmentId, paymentId, providerPaymentId,
 * createPendingPaymentForInstallment(sequence) } — the helper mints a fresh
 * PENDING Payment (unique mock providerPaymentId) for any later installment.
 */
export async function buildPendingInstallmentPayment(options: { frequency: 'annual' | 'semi_annual' | 'quarterly' }) {
  const fx = await buildAcceptReadyQuote()
  const accept = (args: Record<string, unknown>) =>
    executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  const ask = await accept({ paymentOption: options.frequency })
  if (ask.outcome !== 'requires_confirmation') throw new Error(`buildPendingInstallmentPayment: accept ask ${ask.outcome} (${ask.reason})`)
  const res = await accept({ paymentOption: options.frequency, confirmToken: ask.confirmToken })
  if (res.outcome !== 'applied') throw new Error(`buildPendingInstallmentPayment: accept ${res.outcome} (${res.reason})`)
  const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: fx.quoteId }, include: { installments: { orderBy: { sequence: 'asc' } } } })
  const createPendingPaymentForInstallment = async (sequence: number) => {
    const inst = schedule.installments.find((i) => i.sequence === sequence)
    if (!inst) throw new Error(`no installment with sequence ${sequence}`)
    const providerPaymentId = `mock_pay_${crypto.randomUUID()}`
    const payment = await prisma.payment.create({
      data: { installmentId: inst.id, customerId: fx.customerId, amountMinor: inst.amountMinor, provider: 'MOCK', providerPaymentId, status: 'PENDING' },
    })
    return { paymentId: payment.id, providerPaymentId, installmentId: inst.id }
  }
  const first = await createPendingPaymentForInstallment(1)
  return { ...fx, scheduleId: schedule.id, ...first, createPendingPaymentForInstallment }
}

/**
 * buildAcceptReadyQuote + a real gateway accept_quote at the given frequency
 * — schedule exists, NO Policy row (D2.8/D3, erratum-8/5 fixture spec).
 * Options: settle marks every installment PAID + the schedule COMPLETED;
 * settleFirstInstallment settles ONLY installment 1 through the real
 * settlement inbox (Policy is born, schedule ACTIVE). Returns { ...fx,
 * quoteId, scheduleId, firstInstallmentId, firstInstallmentAmountMinor }.
 */
export async function buildAcceptedQuoteWithSchedule(options: { frequency: 'annual' | 'semi_annual' | 'quarterly'; settle?: boolean; settleFirstInstallment?: boolean }) {
  const fx = await buildAcceptReadyQuote()
  const accept = (args: Record<string, unknown>) =>
    executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  const ask = await accept({ paymentOption: options.frequency })
  if (ask.outcome !== 'requires_confirmation') throw new Error(`buildAcceptedQuoteWithSchedule: accept ask ${ask.outcome} (${ask.reason})`)
  const res = await accept({ paymentOption: options.frequency, confirmToken: ask.confirmToken })
  if (res.outcome !== 'applied') throw new Error(`buildAcceptedQuoteWithSchedule: accept ${res.outcome} (${res.reason})`)
  // ensure_payment_session's #1 row demands a VALIDATED id_card (B3/D3.3)
  await prisma.customerDocument.create({
    data: { customerId: fx.customerId, kind: 'id_card', status: 'validated', encryptedData: Buffer.from('fixture'), dataIv: 'iv', dataTag: 'tag' },
  })
  const schedule = await prisma.paymentSchedule.findFirstOrThrow({ where: { quoteId: fx.quoteId }, include: { installments: { orderBy: { sequence: 'asc' } } } })
  if (options.settle) {
    await prisma.installment.updateMany({ where: { scheduleId: schedule.id }, data: { status: 'PAID', paidAt: new Date() } })
    await prisma.paymentSchedule.update({ where: { id: schedule.id }, data: { status: 'COMPLETED' } })
  }
  if (options.settleFirstInstallment) {
    const { settlePaymentEvent } = await import('@/lib/payments/settlement')
    const providerPaymentId = `mock_pay_${crypto.randomUUID()}`
    await prisma.payment.create({
      data: { installmentId: schedule.installments[0].id, customerId: fx.customerId, amountMinor: schedule.installments[0].amountMinor, provider: 'MOCK', providerPaymentId, status: 'PENDING' },
    })
    await settlePaymentEvent({ provider: 'MOCK', eventId: `fixture_${providerPaymentId}`, event: 'payment_succeeded', providerPaymentId })
  }
  return {
    ...fx,
    scheduleId: schedule.id,
    firstInstallmentId: schedule.installments[0].id,
    firstInstallmentAmountMinor: schedule.installments[0].amountMinor,
  }
}

/**
 * The full D2 money path (D4.2, erratum-5 fixture spec):
 * buildAcceptedQuoteWithSchedule(annual) + ensure_payment_session + a real
 * settlement-inbox capture → Policy in PENDING_SUBMISSION with issuedAt
 * stamped by settlement. Returns { ...fx, quoteId, scheduleId, policyId,
 * issuedAt }.
 */
export async function buildPaidPolicy() {
  const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual' })
  const ensure = await executeCommit({ tool: 'ensure_payment_session', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  if (ensure.outcome !== 'applied') throw new Error(`buildPaidPolicy: ensure_payment_session ${ensure.outcome} (${ensure.reason})`)
  const payment = await prisma.payment.findFirstOrThrow({ where: { customerId: fx.customerId, status: 'PENDING' } })
  const { settlePaymentEvent } = await import('@/lib/payments/settlement')
  await settlePaymentEvent({ provider: 'MOCK', eventId: `fixture_paid_${payment.id}`, event: 'payment_succeeded', providerPaymentId: payment.providerPaymentId! })
  const policy = await prisma.policy.findFirstOrThrow({ where: { quoteId: fx.quoteId } })
  return { ...fx, policyId: policy.id, issuedAt: policy.issuedAt! }
}

/**
 * buildPaidPolicy + mark_submitted + activate_policy('AZT-123') as operator
 * commits (D4.4/D4.5, erratum-5 fixture spec). stopAt stops the pipeline
 * early. Returns { ...fx, policyId, issuedAt }.
 */
export async function buildActivatedPolicy(options: { stopAt?: 'PENDING_SUBMISSION' | 'SUBMITTED' } = {}) {
  const fx = await buildPaidPolicy()
  const op = (tool: string, args: Record<string, unknown>) =>
    executeCommit({ tool, args, actor: 'operator', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  if (options.stopAt === 'PENDING_SUBMISSION') return fx
  const sub = await op('mark_submitted', { policyId: fx.policyId })
  if (sub.outcome !== 'applied') throw new Error(`buildActivatedPolicy: mark_submitted ${sub.outcome} (${sub.reason})`)
  if (options.stopAt === 'SUBMITTED') return fx
  const act = await op('activate_policy', { policyId: fx.policyId, allianzPolicyNumber: 'AZT-123' })
  if (act.outcome !== 'applied') throw new Error(`buildActivatedPolicy: activate_policy ${act.outcome} (${act.reason})`)
  return fx
}

/**
 * An operator-authenticated NextRequest for admin route tests (D4.3,
 * erratum-5 fixture spec): JSON body + a signToken({ role: 'OPERATOR' })
 * JWT riding the auth cookie — the definite pattern, no conditionals.
 */
export async function operatorRequest(body: Record<string, unknown>) {
  const { NextRequest } = await import('next/server')
  const { signToken, COOKIE_NAME } = await import('@/lib/auth/jwt')
  const token = await signToken({ userId: 'op-fixture', role: 'OPERATOR', email: 'operator@zeno.ro' }, '1h')
  return new NextRequest('http://localhost/api/admin/policies/x/status', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { cookie: `${COOKIE_NAME}=${token}`, 'content-type': 'application/json' },
  })
}

/** buildReadyApplication + a real gateway generate_quote → ISSUED quote. */
export async function buildIssuedQuote(options: { validUntil?: Date } = {}) {
  const fx = await buildReadyApplication()
  const res = await executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
  if (res.outcome !== 'applied') throw new Error(`buildIssuedQuote: generate_quote ${res.outcome} (${res.reason})`)
  const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
  if (options.validUntil) {
    await prisma.quote.update({ where: { id: quote.id }, data: { validUntil: options.validUntil } })
  }
  return { ...fx, quoteId: quote.id }
}
