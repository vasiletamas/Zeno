/**
 * P0-2: pre-sign DNT collection proceeds on the Art. 6(1)(b) pre-contractual
 * basis — which only holds while the request is live. Stale unsigned draft
 * sessions (no activity inside the retention window) are DELETED by the
 * cleanup job; signed DNTs are retain_mandated and untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { cleanupUnsignedDntSessions, UNSIGNED_DNT_RETENTION_DAYS } from '@/lib/gdpr/retention-cleanup'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-06T12:00:00Z')
const OLD = new Date(NOW.getTime() - (UNSIGNED_DNT_RETENTION_DAYS + 5) * DAY)
const FRESH = new Date(NOW.getTime() - 1 * DAY)

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
})

async function makeUnsignedSession(startedAt: Date, answeredAt?: Date) {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const session = await prisma.dntSession.create({
    data: { customerId: fx.customerId, productId: product.id, type: 'NEW', status: 'ACTIVE', startedAt },
  })
  if (answeredAt) {
    const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_FAMILY_SIZE' }, select: { id: true } })
    await prisma.dntAnswer.create({ data: { sessionId: session.id, questionId: q.id, value: '2', answeredAt } })
  }
  return session
}

describe('cleanupUnsignedDntSessions (P0-2)', () => {
  it('deletes stale unsigned sessions with their answers', async () => {
    const stale = await makeUnsignedSession(OLD, OLD)
    const report = await cleanupUnsignedDntSessions(NOW)
    expect(report.sessionsDeleted).toBe(1)
    expect(report.answersDeleted).toBe(1)
    expect(await prisma.dntSession.findUnique({ where: { id: stale.id } })).toBeNull()
  })

  it('keeps unsigned sessions with recent activity (an old start with a fresh answer is alive)', async () => {
    const alive = await makeUnsignedSession(OLD, FRESH)
    const report = await cleanupUnsignedDntSessions(NOW)
    expect(report.sessionsDeleted).toBe(0)
    expect(await prisma.dntSession.findUnique({ where: { id: alive.id } })).not.toBeNull()
  })

  it('never touches SIGNED sessions (retain_mandated), no matter the age', async () => {
    await signDntWithFacts(fx, {})
    await prisma.dntSession.updateMany({ where: { customerId: fx.customerId }, data: { startedAt: OLD } })
    await prisma.dntAnswer.updateMany({ data: { answeredAt: OLD } })
    const report = await cleanupUnsignedDntSessions(NOW)
    expect(report.sessionsDeleted).toBe(0)
    expect(await prisma.dntSession.count({ where: { customerId: fx.customerId } })).toBe(1)
  })
})
