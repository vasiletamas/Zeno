/**
 * The reauth gate (T26) — ONE home, two callers.
 *
 * Extracted from app/api/session/route.ts on 2026-07-21 when the conversation
 * page gained the same duty (spec §3.1). Two copies of "is this customer an
 * account holder?" is exactly the drift that leaves one door locked and the
 * other open — and the door that stayed open was the one holding the data.
 */
import { prisma } from '@/lib/db'
import { maskVerificationTarget } from '@/lib/customer/verification-service'

/**
 * Resolve a customer id through the merge pointer (B3.5). A customer who
 * verifies an email already held by another record is merged, and either
 * record may be the one on the cookie or on the conversation. Callers that
 * skip this lock merged customers out of their own data (AC-6).
 *
 * Returns null when the id is absent or names no customer.
 */
export async function canonicalCustomerId(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, mergedIntoId: true } })
  if (!customer) return null
  return customer.mergedIntoId ?? customer.id
}

/**
 * The account-holder test: a linked User AND a consumed email challenge. Such
 * a session is never handed silently to whoever holds the cookie — it must be
 * re-proven.
 *
 * Returns the masked address to challenge, or null when this customer is
 * anonymous (nothing to prove, and nothing sensitive behind it — AC-4).
 *
 * `customerId` MUST already be canonical.
 */
export async function accountChallengeTarget(customerId: string): Promise<{ maskedEmail: string } | null> {
  const user = await prisma.user.findUnique({ where: { customerId }, select: { id: true } })
  if (!user) return null
  const proven = await prisma.verificationChallenge.findFirst({
    where: { customerId, channel: 'email', consumedAt: { not: null } },
    orderBy: { consumedAt: 'desc' },
    select: { target: true },
  })
  if (!proven) return null
  return { maskedEmail: maskVerificationTarget('email', proven.target) }
}
