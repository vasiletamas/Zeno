/**
 * Consent Verification
 *
 * Checks that required GDPR / DNT consents exist before quote generation.
 * B2.6: consent answers come from the signed Dnt's source-session DntAnswers;
 * validity comes from the customer-scoped Dnt aggregate.
 */

import { prisma } from '@/lib/db'
import { hasValidDnt } from '@/lib/customer/dnt-lookup'

const REQUIRED_CONSENT_CODES = [
  'DNT_CONSULTATION_CONSENT',
  'DNT_ELECTRONIC_COMMUNICATION',
  'DNT_MARKETING_CONSENT',
] as const

export async function verifyConsents(conversationId: string): Promise<{
  valid: boolean
  missing: string[]
}> {
  const missing: string[] = []

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerId: true },
  })

  // 1. Check that answers exist for each required consent question code in
  // the signed Dnt's source session (B2: DntAnswer store)
  const signedDnt = conv
    ? await prisma.dnt.findFirst({
        where: { customerId: conv.customerId, status: 'ACTIVE' },
        orderBy: { signedAt: 'desc' },
        include: { sourceSession: { include: { answers: { include: { question: { select: { code: true } } } } } } },
      })
    : null
  const answeredCodes = new Set(
    (signedDnt?.sourceSession.answers ?? []).map((a) => a.question.code).filter((c): c is string => c !== null),
  )
  for (const code of REQUIRED_CONSENT_CODES) {
    if (!answeredCodes.has(code)) missing.push(code)
  }

  // 2. Check the DNT is signed and still valid (customer-scoped aggregate)
  const dntValid = conv ? await hasValidDnt(conv.customerId, 'LIFE', prisma) : false
  if (!dntValid) {
    missing.push('DNT_SIGNATURE')
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
