/**
 * P0-2 retention cleanup (2026-07-06) — the executable half of the
 * dnt_unsigned_sessions policy row.
 *
 * LEGAL BASIS (documented per the ratified P0-2 option 2): pre-sign DNT
 * collection — CNP, income, occupation, family, education — proceeds under
 * GDPR Art. 6(1)(b): processing necessary for steps AT THE DATA SUBJECT'S
 * REQUEST prior to entering a contract (the customer asked for an insurance
 * recommendation; the demands-and-needs analysis IS that step). Explicit
 * gdpr_processing consent for continued processing is captured at sign_dnt
 * (the consent-labelled card CTA is the grant — B1.5).
 *
 * That basis only holds while the request is LIVE: an unsigned draft with no
 * activity inside the retention window is an abandoned request, and keeping
 * its personal data outlives the basis. This job deletes such drafts
 * (answers first, sessions second). Signed DNTs are retain_mandated (IDD
 * record) and never touched.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'

type Db = typeof prisma | Prisma.TransactionClient

/** Days of inactivity after which an unsigned draft is an abandoned request.
 * legalReviewPending (M3.4): confirm the exact window with compliance. */
export const UNSIGNED_DNT_RETENTION_DAYS = 30

export interface RetentionCleanupReport {
  cutoff: string
  sessionsDeleted: number
  answersDeleted: number
}

export async function cleanupUnsignedDntSessions(now: Date = new Date(), db: Db = prisma): Promise<RetentionCleanupReport> {
  const cutoff = new Date(now.getTime() - UNSIGNED_DNT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  // stale = unsigned AND started before the cutoff AND no answer activity
  // since the cutoff (an old start with a fresh answer is a live request)
  const stale = await db.dntSession.findMany({
    where: {
      dnt: { is: null },
      startedAt: { lt: cutoff },
      answers: { none: { answeredAt: { gte: cutoff } } },
    },
    select: { id: true },
  })
  if (stale.length === 0) return { cutoff: cutoff.toISOString(), sessionsDeleted: 0, answersDeleted: 0 }
  const ids = stale.map((s) => s.id)
  const answers = await db.dntAnswer.deleteMany({ where: { sessionId: { in: ids } } })
  const sessions = await db.dntSession.deleteMany({ where: { id: { in: ids } } })
  return { cutoff: cutoff.toISOString(), sessionsDeleted: sessions.count, answersDeleted: answers.count }
}
