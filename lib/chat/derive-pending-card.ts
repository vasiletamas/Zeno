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
 *     getNextQuestion); a BD_* next question re-derives the T10 medical
 *     BATCH card, exactly what the live commit emitted.
 *  3. Else null.
 *
 * IDENTITY GATE (2026-07-21, spec §3.2 R2). This module — not the emitting
 * handlers — is where the gate belongs. It re-derives the card from the
 * snapshot on every page load, every turn start and every turn end, with no
 * knowledge of who the customer is. Gate only `select_coverage` (or any other
 * emitter) and the blocked card simply returns by derivation on the very next
 * turn, with the briefing telling the agent to invite a tap on it.
 *
 * A card whose writer the exposure wall refuses is a card the customer cannot
 * act on — the precedent is already here in rule 1, which suppresses the
 * application card while write_question_answer is DNT-gated. R2 extends the
 * same principle from consent to identity.
 */
import { prisma } from '@/lib/db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { appGroupCodesFor } from '@/lib/tools/handlers/application-handlers'
import { medicalBatchCard, questionCard, type MedicalBatchCardAction, type QuestionCardAction } from '@/lib/tools/handlers/questionnaire-cards'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { DomainSnapshot } from '@/lib/engines/domain-types'

/** The writer behind each card family. No writer available → no card. */
function writerAvailable(snapshot: DomainSnapshot, tool: string): boolean {
  return deriveAndExpose(snapshot).actions.available.includes(tool)
}

export async function derivePendingCard(
  conversationId: string,
  /** Injectable snapshot (deriveActiveCards passes its in-hand load so the
   * question card derives from the SAME instant as the other card families
   * and the turn pays for ONE snapshot, not two). Default: load fresh. */
  injectedSnapshot?: DomainSnapshot,
): Promise<QuestionCardAction | MedicalBatchCardAction | null> {
  const snapshot = injectedSnapshot ?? await loadDomainSnapshot(conversationId)

  if (snapshot.dnt.sessionActive) {
    if (!snapshot.dnt.pendingCode) return null
    // R2: an unverified customer cannot write the answer, so must not be shown
    // the question. AC-1 step 4 — during verification the OTP card is the ONLY
    // card on screen, not merely the only interactive one.
    if (!writerAvailable(snapshot, 'write_dnt_answer')) return null
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
    if (next) {
      // R2, same rule as the DNT branch above.
      if (!writerAvailable(snapshot, 'write_question_answer')) return null
      if (next.question.code?.startsWith('BD_')) return medicalBatchCard(prisma, app.id, next.progress)
      return questionCard('application', next.question, next.progress) ?? null
    }
  }

  return null
}
