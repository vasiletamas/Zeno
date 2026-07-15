/**
 * Batch medical-declaration signature (T6.D3 deviation, ratified 2026-07-06)
 * — pure, no DB.
 *
 * CONFIRM_ALWAYS questions no longer confirm per answer; the customer's ONE
 * explicit affirmation is the sign_medical_declarations commit over the whole
 * set (the sign_dnt precedent). Signature currency is RECOMPUTED, never
 * cleared: the stored hash binds the active sensitive (questionCode,
 * revisionId) pairs at sign time, so any later revision — direct modify or
 * cascade invalidation — changes the recomputed hash and the questionnaire
 * counts as unsigned again. Consumed by deriveAndExpose (exposure + the
 * generate_quote medical_declarations_unsigned gate) and the
 * sign_medical_declarations handler — one hash, two call sites, no drift.
 */
import { createHash } from 'node:crypto'

export interface SensitiveAnswerRef { questionCode: string; revisionId: string }

export function medicalAnswersHash(refs: SensitiveAnswerRef[]): string {
  const canonical = [...refs]
    .sort((a, b) => a.questionCode.localeCompare(b.questionCode))
    .map((r) => `${r.questionCode}:${r.revisionId}`)
    .join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

/** Snapshot slice — requiredCodes = VISIBLE questions with CONFIRM_ALWAYS
 * sensitivity; signed = latest signature hash === recomputed current hash. */
export interface MedicalDeclarationFacts { requiredCodes: string[]; answeredCodes: string[]; signed: boolean }

export function medicalDeclarationsExposure(
  f: MedicalDeclarationFacts | undefined,
): { exposed: boolean; blockedReason: 'medical_declarations_incomplete' | 'already_signed' | null } {
  if (!f || f.requiredCodes.length === 0) return { exposed: false, blockedReason: null }
  if (f.signed) return { exposed: false, blockedReason: 'already_signed' }
  if (f.requiredCodes.some((c) => !f.answeredCodes.includes(c))) {
    return { exposed: false, blockedReason: 'medical_declarations_incomplete' }
  }
  return { exposed: true, blockedReason: null }
}

/** generate_quote is illegal while sensitive answers exist unsigned. */
export function medicalDeclarationsBlockQuote(f: MedicalDeclarationFacts | undefined): boolean {
  return !!f && f.requiredCodes.length > 0 && !f.signed
}
