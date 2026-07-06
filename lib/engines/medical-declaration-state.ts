/**
 * ONE loader for the batch medical-declaration state (T6.D3 deviation,
 * 2026-07-06) — consumed by BOTH the snapshot loader (exposure facts for
 * deriveAndExpose) and the sign_medical_declarations handler (preview +
 * signature write). This module is deliberately the only place that decides
 * WHICH answers the customer signs: visible questions with CONFIRM_ALWAYS
 * sensitivity, their ACTIVE revisions. A second implementation would
 * eventually hash a different set and the signature would drift.
 */
import type { PrismaClient, Prisma } from '@/lib/generated/prisma/client'
import { resolveGroupCodes } from './question-groups'
import { computeVisibleSet } from './dependency-graph'
import { loadDependencyGraph } from './dependency-graph-loader'
import { medicalAnswersHash, type SensitiveAnswerRef } from './medical-declarations'

type Db = PrismaClient | Prisma.TransactionClient

export interface MedicalDeclarationState {
  requiredCodes: string[]
  answeredCodes: string[]
  refs: SensitiveAnswerRef[]
  /** hash of the CURRENT active sensitive revisions — what a sign would store */
  currentHash: string
  /** localized question text + active value per answered declaration (the confirm preview) */
  declarations: { code: string; text: { en: string; ro: string }; value: string }[]
  latestSignatureHash: string | null
  signed: boolean
}

export async function loadMedicalDeclarationState(
  db: Db,
  application: { id: string; productId: string; includesAddon: boolean; tierId: string | null; levelId: string | null },
): Promise<MedicalDeclarationState> {
  const groupCodes = (await resolveGroupCodes(application.productId, 'application', db)) ?? []
  const questions = groupCodes.length > 0
    ? await db.question.findMany({ where: { group: { code: { in: groupCodes } } }, select: { code: true, sensitivity: true, text: true } })
    : []
  const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId }, select: { code: true } }) : null
  const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId }, select: { code: true } }) : null
  const answerRows = await db.answer.findMany({
    where: { applicationId: application.id, status: 'ACTIVE' },
    select: { id: true, value: true, question: { select: { code: true } } },
  })
  const active: Record<string, { revisionId: string; value: string }> = {}
  for (const r of answerRows) if (r.question.code) active[r.question.code] = { revisionId: r.id, value: r.value }

  const graph = await loadDependencyGraph(db, application.productId)
  const codes = questions.map((q) => q.code).filter((c): c is string => c !== null)
  const visible = computeVisibleSet(graph, codes, {
    answers: Object.fromEntries(Object.entries(active).map(([c, v]) => [c, v.value])),
    selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon },
  })

  const requiredCodes = questions
    .filter((q) => q.code !== null && visible.has(q.code) && q.sensitivity === 'CONFIRM_ALWAYS')
    .map((q) => q.code as string)
  const answeredCodes = requiredCodes.filter((c) => active[c] !== undefined)
  const refs: SensitiveAnswerRef[] = answeredCodes.map((c) => ({ questionCode: c, revisionId: active[c].revisionId }))
  const currentHash = medicalAnswersHash(refs)
  const latest = await db.medicalDeclarationSignature.findFirst({
    where: { applicationId: application.id },
    orderBy: { signedAt: 'desc' },
    select: { answersHash: true },
  })
  const signed = requiredCodes.length > 0
    && answeredCodes.length === requiredCodes.length
    && latest?.answersHash === currentHash
  const declarations = answeredCodes.map((c) => ({
    code: c,
    text: (questions.find((q) => q.code === c)?.text ?? { en: c, ro: c }) as { en: string; ro: string },
    value: active[c].value,
  }))
  return { requiredCodes, answeredCodes, refs, currentHash, declarations, latestSignatureHash: latest?.answersHash ?? null, signed }
}
