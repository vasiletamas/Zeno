/**
 * Consent Verification
 *
 * Checks that required GDPR / DNT consents exist before quote generation.
 * Verifies answer records for consent questions and DNT signing metadata.
 */

import { prisma } from '@/lib/db'

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

  // 2. Check WorkflowSession.data has dntSignedAt
  const session = await prisma.workflowSession.findUnique({
    where: { conversationId },
  })

  if (!session) {
    missing.push('DNT_SIGNATURE')
  } else {
    const sessionData = session.data as Record<string, unknown> | null
    if (!sessionData?.dntSignedAt) {
      missing.push('DNT_SIGNATURE')
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  }
}
