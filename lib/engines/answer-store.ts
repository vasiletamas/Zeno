/**
 * Single-writer answer store (C1.4, T6.D5): the ONLY module allowed to write
 * prisma.answer. Answers are append-only revisions — a re-answer SUPERSEDES
 * the previous ACTIVE row, a cascade INVALIDATES it with causality
 * (causedByKey + invalidatedReason), and nothing is ever destroyed. The DB
 * enforces "at most one ACTIVE per (questionId, applicationId)" via the
 * partial unique index "answer_active_unique" (seed bootstrap).
 */
import type { PrismaClient, Prisma } from '@/lib/generated/prisma/client'
import type { AnswerSource } from '@/lib/generated/prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export interface WriteRevisionInput {
  applicationId: string
  questionId: string
  value: string
  source: AnswerSource
  commitId?: string
}

export interface InvalidateActiveInput {
  applicationId: string
  questionId: string
  causedByKey: string
  reason: string
  commitId?: string
}

/** Active answers for an application as code → value. */
export async function getActiveAnswers(db: Db, applicationId: string): Promise<Record<string, string>> {
  const rows = await db.answer.findMany({
    where: { applicationId, status: 'ACTIVE' },
    include: { question: { select: { code: true } } },
  })
  return Object.fromEntries(rows.map(r => [r.question.code, r.value]))
}

/** Supersede the current ACTIVE revision (if any), then append a fresh ACTIVE one. */
export async function writeRevision(db: Db, input: WriteRevisionInput) {
  const { applicationId, questionId, value, source, commitId } = input
  await db.answer.updateMany({
    where: { applicationId, questionId, status: 'ACTIVE' },
    data: { status: 'SUPERSEDED' },
  })
  return db.answer.create({
    data: { applicationId, questionId, value, source, status: 'ACTIVE', commitId: commitId ?? null },
  })
}

/** Mark the ACTIVE revision INVALIDATED, recording what caused it and why. */
export async function invalidateActive(db: Db, input: InvalidateActiveInput) {
  const { applicationId, questionId, causedByKey, reason, commitId } = input
  return db.answer.updateMany({
    where: { applicationId, questionId, status: 'ACTIVE' },
    data: {
      status: 'INVALIDATED',
      causedByKey,
      invalidatedReason: reason,
      ...(commitId ? { commitId } : {}),
    },
  })
}
