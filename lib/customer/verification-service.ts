/**
 * VerificationChallenge service (B3.4) — ONE challenge primitive, two
 * presentations: the same row backs the in-chat OTP code and the magic
 * link, so the two verification paths cannot diverge (T4-R5). Confirming
 * (either way) consumes the row once and flips the channel field to
 * verified provenance; verifiedChannels derivation reads CONSUMED rows —
 * re-issuing invalidates prior challenges by expiring them, never by
 * marking them consumed.
 */
import { createHash, randomInt, randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { appBaseUrl } from '@/lib/app-url'
import { getEmailProvider } from '@/lib/email'
import { setVerifiedField } from '@/lib/customer/profile-service'
import { claimAndMerge } from '@/lib/customer/claim-merge'
import type { EmailProvider } from '@/lib/email/types'
import type { VerificationChallenge, Prisma } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

const CHALLENGE_TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export type ConfirmResult =
  | { ok: true; channel: 'email' | 'sms'; target: string; conversationId: string | null; challengeId: string; customerId: string }
  | { ok: false; reason: 'no_active_challenge' | 'code_mismatch' | 'attempts_exhausted' | 'expired_or_consumed'; attemptsRemaining?: number }

/**
 * P0-1: ONE normalization for every verification-target write and lookup —
 * ownership matching must never depend on letter case or spacing. Applied at
 * issue time (stored targets are normalized) and defensively at claim time.
 */
export const normalizeVerificationTarget = (channel: 'email' | 'sms', target: string): string =>
  channel === 'email' ? target.trim().toLowerCase() : target.replace(/[\s-]/g, '')

/**
 * One mask for every surface that speaks a verification target (the OTP
 * handler's envelope, the situational briefing) — raw targets never reach
 * the model or the transcript.
 */
export const maskVerificationTarget = (channel: 'email' | 'sms', target: string): string => {
  if (channel === 'email') {
    const [user, domain] = target.split('@')
    return `${user.slice(0, 1)}***@${domain ?? ''}`
  }
  return `***${target.slice(-3)}`
}

/**
 * Callers embedding the link in their own message (e.g. the post-payment
 * confirmation email) pass a no-op provider to suppress the standalone
 * send, and a longer ttlMs — the challenge itself is unchanged.
 */
export async function issueChallenge(
  customerId: string,
  channel: 'email' | 'sms',
  rawTarget: string,
  conversationId: string | null,
  db: Db = prisma,
  provider: EmailProvider = getEmailProvider(),
  ttlMs: number = CHALLENGE_TTL_MS,
): Promise<{ challengeId: string; code: string; linkToken: string }> {
  // stored targets are normalized so consumed rows are a canonical
  // ownership registry (P0-1) — lookups never fight letter case.
  const target = normalizeVerificationTarget(channel, rawTarget)
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const linkToken = randomUUID()

  // invalidate prior unconsumed challenges by EXPIRING them — consumedAt is
  // reserved for real confirmations (verifiedChannels reads consumption).
  await db.verificationChallenge.updateMany({
    where: { customerId, consumedAt: null },
    data: { expiresAt: new Date(0) },
  })

  const row = await db.verificationChallenge.create({
    data: {
      customerId, channel, target,
      codeHash: sha256(code),
      linkToken,
      conversationId,
      expiresAt: new Date(Date.now() + ttlMs),
      attemptsRemaining: MAX_ATTEMPTS,
    },
  })

  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } })
  const locale = customer.language === 'en' ? 'en' : 'ro'
  const link = `${appBaseUrl()}/api/auth/verify?token=${linkToken}`
  // one message, both presentations: the code for in-chat entry, the link
  // for one-click verification — same challenge either way.
  const subject = locale === 'ro' ? `Codul tău de verificare: ${code}` : `Your verification code: ${code}`
  const html = locale === 'ro'
    ? `<p>Codul tău de verificare este <strong>${code}</strong> (valabil 10 minute).</p><p>Sau apasă direct: <a href="${link}">confirmă adresa</a>.</p>`
    : `<p>Your verification code is <strong>${code}</strong> (valid 10 minutes).</p><p>Or click: <a href="${link}">confirm this address</a>.</p>`
  if (channel === 'email') {
    await provider.send({ to: target, subject, html })
  } else {
    // SMS provider lands with its block; until then the email provider is the
    // only transport — sms targets get no message but the challenge stands.
  }

  return { challengeId: row.id, code, linkToken }
}

/** Shared consumption path — OTP and link confirm through the SAME steps. */
async function completeChannelVerification(challenge: VerificationChallenge, db: Db): Promise<ConfirmResult> {
  await db.verificationChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } })
  await setVerifiedField(
    challenge.customerId,
    challenge.channel === 'email' ? 'email' : 'phone',
    challenge.target,
    'channel_verification',
    challenge.id,
    db as Parameters<typeof setVerifiedField>[5],
  )
  return { ok: true, channel: challenge.channel, target: challenge.target, conversationId: challenge.conversationId, challengeId: challenge.id, customerId: challenge.customerId }
}

export async function confirmByCode(customerId: string, code: string, db: Db = prisma): Promise<ConfirmResult> {
  const challenge = await db.verificationChallenge.findFirst({
    where: { customerId, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) return { ok: false, reason: 'no_active_challenge' }
  if (challenge.attemptsRemaining <= 0) return { ok: false, reason: 'attempts_exhausted', attemptsRemaining: 0 }
  if (challenge.codeHash !== sha256(code)) {
    await db.verificationChallenge.update({ where: { id: challenge.id }, data: { attemptsRemaining: challenge.attemptsRemaining - 1 } })
    return { ok: false, reason: 'code_mismatch', attemptsRemaining: challenge.attemptsRemaining - 1 }
  }
  return completeChannelVerification(challenge, db)
}

export async function confirmByLinkToken(linkToken: string, db: Db = prisma): Promise<ConfirmResult> {
  const challenge = await db.verificationChallenge.findUnique({ where: { linkToken } })
  if (!challenge || challenge.consumedAt !== null || challenge.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired_or_consumed' }
  }
  return completeChannelVerification(challenge, db)
}

/**
 * Verified claim (T4.D4), shared by the OTP commit and the magic-link route
 * so the two paths cannot diverge.
 *
 * P0-1: OWNERSHIP is proven only by CONSUMED verification evidence — the
 * canonical owner is another customer who ALSO verified this exact channel +
 * normalized target (a consumed VerificationChallenge). A merely DECLARED
 * Customer.email/phone mirror can NEVER be the owner — otherwise an attacker
 * who pre-declares the victim's address would absorb the victim's records the
 * moment the victim verifies. When no verified owner exists, the just-proven
 * shell TAKES the mirror: any customer still holding it only declared it, so
 * it is cleared from them and set on the verifier.
 *
 * Inside a gateway commit pass the tx client (claimAndMerge otherwise opens
 * its own transaction).
 */
export async function applyVerifiedClaim(
  r: Extract<ConfirmResult, { ok: true }>,
  db: Db = prisma,
): Promise<{ customerId: string; merged: boolean }> {
  const target = normalizeVerificationTarget(r.channel, r.target)
  const mirrorField = r.channel === 'email' ? 'email' : 'phone'

  const run = async (tx: Parameters<typeof claimAndMerge>[2] & Db): Promise<{ customerId: string; merged: boolean }> => {
    // The canonical owner is the EARLIEST customer (INCLUDING the verifier)
    // holding CONSUMED evidence for this exact channel + normalized target,
    // restricted to non-tombstoned customers — verified ownership, never a
    // mirror. Including self is the deterministic tie-break that stops two
    // concurrent verifiers from each treating the other as owner and merging
    // into each other.
    const proofs = await tx.verificationChallenge.findMany({
      where: { channel: r.channel, target, consumedAt: { not: null }, customer: { mergedIntoId: null } },
      orderBy: [{ consumedAt: 'asc' }, { createdAt: 'asc' }],
      select: { customerId: true },
    })
    const ownerId = proofs.length ? proofs[0].customerId : r.customerId
    if (ownerId !== r.customerId) {
      await claimAndMerge(r.customerId, ownerId, tx)
      return { customerId: ownerId, merged: true }
    }
    // The verifier IS the canonical owner. Release the mirror from any
    // customer that only DECLARED it (they never proved control) and set it on
    // the verifier so the @unique mirror is held by the party that owns it.
    const declaredHolders = await tx.customer.findMany({
      where: { [mirrorField]: target, id: { not: r.customerId }, mergedIntoId: null },
      select: { id: true },
    })
    for (const h of declaredHolders) {
      await tx.customer.update({ where: { id: h.id }, data: { [mirrorField]: null } })
    }
    await tx.customer.update({ where: { id: r.customerId }, data: { [mirrorField]: target } })
    return { customerId: r.customerId, merged: false }
  }

  if (db === prisma) return prisma.$transaction((tx) => run(tx as Parameters<typeof claimAndMerge>[2] & Db))
  return run(db as Parameters<typeof claimAndMerge>[2] & Db)
}

/** Channels this customer has verified — consumed challenges only. */
export async function verifiedChannelsFor(customerId: string, db: Db = prisma): Promise<('email' | 'sms')[]> {
  const rows = await db.verificationChallenge.findMany({
    where: { customerId, consumedAt: { not: null } },
    select: { channel: true },
    distinct: ['channel'],
  })
  return rows.map((r) => r.channel)
}
