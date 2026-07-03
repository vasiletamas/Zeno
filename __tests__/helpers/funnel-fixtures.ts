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

export async function buildReadyApplication(options: { escalationFlag?: string; withoutDob?: boolean } = {}) {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  // withoutDob = the personas scenario: a pattern-valid but checksum-INVALID
  // CNP in the DNT (the mirror skips it) and no declared dob → the decision
  // must demand identity, never price on a guessed age.
  await signDntWithFacts(fx, {
    DNT_LIFE_SUBTYPE: 'simple_protection',
    ...(options.withoutDob ? { DNT_CNP: '1111111111111' } : {}),
  })
  if (!options.withoutDob) {
    await setDeclaredField(fx.customerId, 'dateOfBirth', '1990-01-01', 'fixture')
    // checksum-valid AND consistent with the declared DOB (identity tier
    // derivation cross-checks cnpMatchesDob — D2.5); carries the residency fact
    await setDeclaredField(fx.customerId, 'cnp', '1900101080012', 'fixture')
  }
  // complete the application questionnaire directly (the commit under test
  // is generate_quote, not the answer path)
  const groupCodes = (await resolveGroupCodes((await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })).productId, 'application')) ?? []
  const questions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: groupCodes.filter((c) => c !== 'bd_medical') } } } })
    : []
  for (const q of questions) {
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: q.id, value: 'true', source: 'USER_ANSWER' })
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

export const fixtureCtx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

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
  if (!options.withoutVerifiedChannel) {
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
