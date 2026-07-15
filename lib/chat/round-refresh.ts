/**
 * Per-round exposure refresh (A3.4, T1.D5): after any APPLIED commit the
 * world changed, so the tool list and the executor wall must be recomputed
 * before the model's next round — a same-turn sign_dnt → set_application
 * chain has to be legal end-to-end. Applied is the trigger (not just
 * advance_phase): cascades change legality without moving the phase.
 */

import type { CommitResult, DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'

export function shouldRefreshExposure(envelopes: Pick<CommitResult, 'outcome' | 'effects'>[]): boolean {
  return envelopes.some((e) => e.outcome === 'applied')
}

export function formatRoundRefreshMessage(state: Pick<DerivedStateV3, 'phase' | 'subphase'>, actions: ExposedActions): string {
  return [
    `[State update] Phase: ${state.phase}${state.subphase ? '/' + state.subphase : ''}`,
    `Available actions: ${actions.available.join(', ')}`,
    actions.blocked.length > 0 ? `Blocked: ${actions.blocked.map((b) => `${b.action} (${b.reason})`).join(', ')}` : '',
  ].filter(Boolean).join('\n')
}
