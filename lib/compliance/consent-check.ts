/**
 * Consent Verification
 *
 * Checks that required GDPR / DNT consents exist before quote generation.
 * Verifies answer records for consent questions and DNT signing metadata.
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

  // 1. Check that answers exist for each required consent question code
  for (const code of REQUIRED_CONSENT_CODES) {
    const question = await prisma.question.findFirst({
      where: { code },
    })

    if (!question) {
      // Question doesn't exist in DB — treat as missing
      missing.push(code)
      continue
    }

    const answer = await prisma.answer.findUnique({
      where: {
        questionId_conversationId: {
          questionId: question.id,
          conversationId,
        },
      },
    })

    if (!answer) {
      missing.push(code)
    }
  }

  // 2. Check the DNT is signed and still valid: legacy conversation stamps
  // short-circuit until B2.6 drops them; the Dnt aggregate is forward truth.
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { customerId: true, dntSignedAt: true, dntValidUntil: true },
  })
  const legacyStampValid = !!conv?.dntSignedAt && (!conv.dntValidUntil || conv.dntValidUntil > new Date())
  const dntValid = legacyStampValid || (conv ? await hasValidDnt(conv.customerId, 'LIFE', prisma) : false)
  if (!dntValid) {
    missing.push('DNT_SIGNATURE')
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
