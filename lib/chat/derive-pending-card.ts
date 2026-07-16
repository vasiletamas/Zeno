/**
 * Reload parity (T9/T12, standard §"Reload parity"): uiActions are
 * live-SSE-only client state, so a page reload mid-questionnaire would
 * strand the customer card-less. /chat/[id] calls this server-side to
 * re-derive the pending `show_question` card from the domain snapshot —
 * built by the SAME shared module the live commits use, so the reloaded
 * rendering equals the live one by construction.
 *
 * Derivation order:
 *  1. ACTIVE DNT session with a pending question → the DNT card.
 *     An ACTIVE-but-complete session is awaiting sign_dnt — that
 *     confirmation is turn-scoped (never re-derived), and an application
 *     card here would invite writes the exposure wall still blocks
 *     (write_question_answer is DNT-gated: requires_consent) → null.
 *  2. Else an OPEN application with a next visible question → the
 *     application card (same walk the handlers use: appGroupCodesFor +
 *     getNextQuestion).
 *  3. Else null.
 */
import { prisma } from '@/lib/db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { appGroupCodesFor } from '@/lib/tools/handlers/application-handlers'
import { questionCard, type QuestionCardAction } from '@/lib/tools/handlers/questionnaire-cards'

export async function derivePendingCard(conversationId: string): Promise<QuestionCardAction | null> {
  const snapshot = await loadDomainSnapshot(conversationId)

  if (snapshot.dnt.sessionActive) {
    if (!snapshot.dnt.pendingCode) return null
    // pendingCode comes from the snapshot's session walk (mirrors the
    // handler's sessionNextQuestion order); question codes are unique.
    const question = await prisma.question.findFirst({ where: { code: snapshot.dnt.pendingCode } })
    if (!question) return null
    return (
      questionCard('dnt', question, {
        answered: snapshot.dnt.sessionAnswered,
        total: snapshot.dnt.sessionTotal,
      }) ?? null
    )
  }

  const app = snapshot.application
  if (app && app.status === 'OPEN') {
    // the snapshot type allows null; the column is NOT NULL @default(false)
    const codes = await appGroupCodesFor({ conversationId }, app.addon ?? false)
    const next = await getNextQuestion(codes, { kind: 'application', applicationId: app.id })
    if (next) return questionCard('application', next.question, next.progress) ?? null
  }

  return null
}
