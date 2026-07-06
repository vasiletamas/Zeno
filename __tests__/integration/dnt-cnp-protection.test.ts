/**
 * P0-3: the raw CNP must never persist in DntAnswer.value — the encrypted
 * profile store (AES-GCM envelope, schema.prisma rule at the
 * CustomerProfileField model) is the only carrier. The DNT regulatory
 * record keeps the masked form; the erasure executor scrubs legacy raw
 * rows in signed sessions (unsigned sessions are deleted outright).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { openDntSession, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import { getIdentityFacts } from '@/lib/customer/profile-service'
import { maskCnp } from '@/lib/security/encryption'
import { executeErasure, ERASED_MARKER } from '@/lib/gdpr/erasure'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

const CNP = '1960229410015'

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
})

const ctx = () => ({ customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

describe('P0-3 CNP protection', () => {
  it('write_dnt_answer persists the MASKED CNP; the real value lives only in the encrypted profile store', async () => {
    await openDntSession({}, ctx())
    const r = await writeDntAnswer({ questionCode: 'DNT_CNP', value: CNP }, ctx())
    expect(r.success).toBe(true)

    const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_CNP' }, select: { id: true } })
    const row = await prisma.dntAnswer.findFirstOrThrow({ where: { questionId: q.id } })
    expect(row.value).toBe(maskCnp(CNP))
    expect(row.value).not.toContain(CNP.slice(4, 10)) // the middle digits never persist

    // the profile mirror still carries the REAL value (decrypted on the internal path)
    const facts = await getIdentityFacts(fx.customerId)
    expect(facts.fields.cnp?.value).toBe(CNP)
  })

  it('erasure scrubs legacy RAW CNP rows in SIGNED sessions (the signed record survives, the CNP does not)', async () => {
    await signDntWithFacts(fx, { DNT_CNP: CNP })
    // simulate a pre-fix legacy row: raw plaintext in the signed session
    const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_CNP' }, select: { id: true } })
    await prisma.dntAnswer.updateMany({ where: { questionId: q.id }, data: { value: CNP } })

    await executeErasure(fx.customerId, 'test')

    const row = await prisma.dntAnswer.findFirst({ where: { questionId: q.id } })
    expect(row).not.toBeNull() // the signed session's record survives
    expect(row!.value).toBe(ERASED_MARKER)
    // and the profile store is gone (existing behavior)
    expect(await prisma.customerProfileField.count({ where: { customerId: fx.customerId } })).toBe(0)
  })
})
