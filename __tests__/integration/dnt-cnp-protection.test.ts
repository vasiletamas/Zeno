/**
 * P0-3 legacy scrub: T28 removed DNT_CNP from the questionnaire (the CNP is
 * never asked by mouth — it arrives document-grade via ID extraction), but
 * LEGACY databases still hold DNT_CNP rows in SIGNED sessions. The erasure
 * executor must keep scrubbing them: the signed record survives, the CNP
 * does not. The question row is created manually here to model a legacy DB —
 * the seed no longer produces it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeErasure, ERASED_MARKER } from '@/lib/gdpr/erasure'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'

const CNP = '1960229410015'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
})

describe('P0-3 CNP protection (legacy rows)', () => {
  it('the seed carries NO DNT_CNP question — the CNP is never asked by mouth (T28)', async () => {
    expect(await prisma.question.count({ where: { code: 'DNT_CNP' } })).toBe(0)
  })

  it('erasure scrubs legacy RAW CNP rows in SIGNED sessions (the signed record survives, the CNP does not)', async () => {
    await signDntWithFacts(fx, {})
    // model a legacy DB: a DNT_CNP question row + a raw plaintext answer in
    // the signed session (pre-T28 databases hold exactly this shape)
    const group = await prisma.questionGroup.findFirstOrThrow({ where: { code: 'dnt_general' } })
    const legacyQ = await prisma.question.create({
      data: { groupId: group.id, code: 'DNT_CNP', text: { en: 'legacy CNP', ro: 'CNP legacy' }, type: 'OPEN_ENDED', orderIndex: 99 },
    })
    const session = await prisma.dntSession.findFirstOrThrow({ where: { customerId: fx.customerId, status: 'SIGNED' } })
    await prisma.dntAnswer.create({ data: { sessionId: session.id, questionId: legacyQ.id, value: CNP } })

    await executeErasure(fx.customerId, 'test')

    const row = await prisma.dntAnswer.findFirst({ where: { questionId: legacyQ.id } })
    expect(row).not.toBeNull() // the signed session's record survives
    expect(row!.value).toBe(ERASED_MARKER)
    // and the profile store is gone (existing behavior)
    expect(await prisma.customerProfileField.count({ where: { customerId: fx.customerId } })).toBe(0)
  })
})
