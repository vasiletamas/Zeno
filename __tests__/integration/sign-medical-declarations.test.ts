/**
 * sign_medical_declarations (T6.D3 deviation, 2026-07-06) — the batch
 * affirmation of the CONFIRM_ALWAYS medical answers, replacing per-answer
 * confirm cards (sign_dnt precedent). Signature currency is recomputed from
 * the active revision hash, never cleared.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { writeRevision } from '@/lib/engines/answer-store'
import { loadMedicalDeclarationState } from '@/lib/engines/medical-declaration-state'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { resetDb, seedMinimalProtectFixture } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

const BD_CODES = ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT']

let fx: Awaited<ReturnType<typeof seedMinimalProtectFixture>>
beforeEach(async () => {
  await resetDb()
  fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
})

const ctx = () => ({ customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma } as unknown as ToolContext)
const sign = (args: Record<string, unknown> = {}) =>
  executeCommit({ tool: 'sign_medical_declarations', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx() })
const answerAllBd = async () => {
  for (const c of BD_CODES) {
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode[c], value: 'false', source: 'USER_ANSWER' })
  }
}

describe('sign_medical_declarations — batch affirmation of the sensitive medical set', () => {
  it('rejected medical_declarations_incomplete while BD answers are missing', async () => {
    const res = await sign()
    expect(res.outcome).toBe('rejected')
    expect(res.reason).toBe('medical_declarations_incomplete')
  })

  it('two-step: unconfirmed returns requires_confirmation with the declarations preview; the token applies it', async () => {
    await answerAllBd()
    const first = await sign()
    expect(first.outcome).toBe('requires_confirmation')
    expect(first.confirmToken).toBeTruthy()
    const preview = (first.data as { preview: { declarations: { code: string; value: string }[] } }).preview
    expect(preview.declarations.map((d) => d.code).sort()).toEqual([...BD_CODES].sort())

    const second = await sign({ confirmToken: first.confirmToken })
    expect(second.outcome).toBe('applied')
    const rows = await prisma.medicalDeclarationSignature.findMany({ where: { applicationId: fx.applicationId } })
    expect(rows).toHaveLength(1)
    const state = await loadMedicalDeclarationState(prisma, (await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })))
    expect(rows[0].answersHash).toBe(state.currentHash)
    expect(state.signed).toBe(true)
  })

  it('snapshot agreement: signing flips the loader fact; a later revision unsigns (recomputed, never cleared)', async () => {
    await answerAllBd()
    const first = await sign()
    await sign({ confirmToken: first.confirmToken })
    let snap = await loadDomainSnapshot(fx.conversationId)
    expect(snap.application?.medicalDeclarations).toMatchObject({ signed: true })

    // a new revision of one declaration invalidates the signature by hash
    await writeRevision(prisma, { applicationId: fx.applicationId, questionId: fx.questionIdByCode.BD_TRANSPLANT, value: 'false', source: 'USER_ANSWER' })
    snap = await loadDomainSnapshot(fx.conversationId)
    expect(snap.application?.medicalDeclarations).toMatchObject({ signed: false })
    const rows = await prisma.medicalDeclarationSignature.findMany({ where: { applicationId: fx.applicationId } })
    expect(rows).toHaveLength(1) // the old signature row survives (append-only audit)
  })

  it('re-sign after signing: ledger replay (double-submit protection), ONE signature row, tool blocked already_applied', async () => {
    await answerAllBd()
    const first = await sign()
    await sign({ confirmToken: first.confirmToken })
    // idempotency runs BEFORE legality (gateway design, same as sign_dnt):
    // the bare re-call replays the applied commit instead of re-executing.
    const again = await sign()
    expect(again.outcome).toBe('applied')
    expect(await prisma.medicalDeclarationSignature.count({ where: { applicationId: fx.applicationId } })).toBe(1)
    // and the engine no longer exposes the tool — blocked already_applied
    const { deriveAndExpose } = await import('@/lib/engines/derive-and-expose')
    const r = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(r.actions.available).not.toContain('sign_medical_declarations')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'sign_medical_declarations', reason: 'already_applied' }))
  })
})
