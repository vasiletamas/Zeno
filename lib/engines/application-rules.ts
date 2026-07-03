/**
 * Application lifecycle rules (B4.2) — PURE; consumed by deriveAndExpose
 * (A1) and the A2 gateway.
 *
 * The status machine is the exact T5.D6 set: COMPLETED and CANCELLED are
 * terminal (cancel ≠ complete), PAUSED unpauses, REFERRED re-enters on
 * underwriter approval (M5) or completes/terminates. The DNT ordering flip
 * (T5.D1) lives HERE as exposure: the questionnaire is writable only under
 * a valid covering DNT — set_application itself has no DNT pre-gate.
 * Selection incompleteness is a generate_quote blocked-reason with the
 * missing facets, never a subphase (#10).
 */

export type AppStatus = 'OPEN' | 'PAUSED' | 'REFERRED' | 'COMPLETED' | 'CANCELLED'

const TRANSITIONS: Record<AppStatus, AppStatus[]> = {
  OPEN: ['PAUSED', 'REFERRED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['OPEN', 'CANCELLED'],
  REFERRED: ['OPEN', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export function canTransition(from: AppStatus, to: AppStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export interface AppExposureInput {
  application: {
    exists: boolean
    status: AppStatus
    tier: string | null
    level: string | null
    addon: boolean | null
    answersComplete: boolean
    /** C1.5: at least one ACTIVE answer revision — something to modify. */
    hasAnswers: boolean
  }
  dntValidForProduct: boolean
}

export interface AppBlocked {
  action: string
  reason: string
  params?: Record<string, unknown>
}

export function applicationExposure(i: AppExposureInput): { available: string[]; blocked: AppBlocked[] } {
  const available: string[] = []
  const blocked: AppBlocked[] = []
  if (!i.application.exists) return { available, blocked }
  if (i.application.status === 'OPEN' || i.application.status === 'PAUSED') available.push('resume_application')
  // C1.5: corrections flow through the consequence planner — exposed on OPEN
  // and PAUSED (the erratum-10 unpause path: fixing the escalated answer is
  // exactly what un-pauses), still behind the T5.D1 DNT gate.
  if ((i.application.status === 'OPEN' || i.application.status === 'PAUSED') && i.application.hasAnswers) {
    if (i.dntValidForProduct) {
      available.push('modify_answer')
    } else {
      blocked.push({ action: 'modify_answer', reason: 'requires_consent', params: { needs: ['valid_dnt'] } })
    }
  }
  if (i.application.status === 'OPEN') {
    available.push('select_coverage', 'cancel_application')
    if (i.dntValidForProduct) {
      available.push('save_application_answer')
    } else {
      blocked.push({ action: 'save_application_answer', reason: 'requires_consent', params: { needs: ['valid_dnt'] } })
    }
    const missing = [!i.application.tier && 'tier', !i.application.level && 'level'].filter(Boolean) as string[]
    if (i.application.answersComplete && missing.length === 0) {
      available.push('generate_quote')
    } else {
      blocked.push({ action: 'generate_quote', reason: missing.length ? 'selection_incomplete' : 'questionnaire_incomplete', params: missing.length ? { missing } : undefined })
    }
  }
  return { available, blocked }
}
