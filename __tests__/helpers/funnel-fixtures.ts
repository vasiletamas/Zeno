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
    await setDeclaredField(fx.customerId, 'cnp', '1980418089861', 'fixture') // checksum-valid; residency fact
  }
  // complete the application questionnaire directly (the commit under test
  // is generate_quote, not the answer path)
  const groupCodes = (await resolveGroupCodes((await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })).productId, 'application')) ?? []
  const questions = groupCodes.length > 0
    ? await prisma.question.findMany({ where: { group: { code: { in: groupCodes.filter((c) => c !== 'bd_medical') } } } })
    : []
  for (const q of questions) {
    const value = q.code === 'PAYMENT_FREQUENCY' ? 'annual' : 'true'
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: q.id, value, source: 'USER_ANSWER' })
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
