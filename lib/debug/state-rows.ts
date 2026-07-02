/**
 * Pure helper: turn a derived-state snapshot into labeled display rows for the
 * debug drawer's "State" panel. Tested directly; the panel component is a thin
 * render of these rows.
 *
 * TRANSITIONAL (A1.5): accepts BOTH the new DerivedStateV3 (deriveAndExpose,
 * carried on debug:gate since A1.5) and the legacy DerivedState shape still
 * present in historical TurnDebug payloads. A1.7 retires the legacy branch
 * together with lib/chat/derive-state.ts.
 */

import type { DerivedState } from '@/lib/chat/derive-state'
import type { DerivedStateV3 } from '@/lib/engines/domain-types'

export interface StateDebugRow {
  label: string
  value: string
}

const DASH = '—'

function isV3(state: DerivedState | DerivedStateV3): state is DerivedStateV3 {
  return 'subphase' in state
}

function v3Rows(state: DerivedStateV3): StateDebugRow[] {
  const rows: StateDebugRow[] = []
  rows.push({ label: 'phase', value: `${state.phase}${state.subphase ? '/' + state.subphase : ''}` })
  rows.push({ label: 'next action', value: state.nextBestAction })
  rows.push({ label: 'product', value: state.product?.code ?? DASH })

  const tier = state.selection.tier ?? DASH
  const level = state.selection.level ?? DASH
  const addon = state.selection.addon === null ? DASH : state.selection.addon ? 'yes' : 'no'
  rows.push({ label: 'selection', value: `tier ${tier} · level ${level} · addon ${addon}` })

  rows.push({
    label: 'consents',
    value: `GDPR ${state.consents.gdprProcessing ? '✓' : '✗'} · AI ${state.consents.aiDisclosure ? '✓' : '✗'}`,
  })

  rows.push({
    label: 'DNT',
    value: state.dnt.signed
      ? `signed${state.dnt.validUntil ? ` (until ${state.dnt.validUntil})` : ''}`
      : 'not signed',
  })

  if (state.application) {
    rows.push({
      label: 'application',
      value: `${state.application.status ?? '?'} · ${state.application.answeredCount}/${state.application.requiredCount} answered`,
    })
    rows.push({
      label: 'missing',
      value: state.application.missingCodes.length > 0 ? state.application.missingCodes.join(', ') : 'none',
    })
  } else {
    rows.push({ label: 'application', value: 'not started' })
  }

  rows.push({ label: 'quote', value: state.quote ? `${state.quote.premiumAnnual ?? DASH}` : 'none' })

  return rows
}

export function deriveStateDebugRows(
  state: DerivedState | DerivedStateV3 | null | undefined,
): StateDebugRow[] {
  if (!state) return [{ label: 'state', value: 'unavailable' }]
  if (isV3(state)) return v3Rows(state)

  const rows: StateDebugRow[] = []
  rows.push({ label: 'phase', value: state.phase })
  rows.push({ label: 'next action', value: state.nextBestAction })
  rows.push({ label: 'product', value: state.product?.code ?? DASH })

  const tier = state.selection.tier ?? DASH
  const level = state.selection.level ?? DASH
  const addon = state.selection.addon === null ? DASH : state.selection.addon ? 'yes' : 'no'
  rows.push({ label: 'selection', value: `tier ${tier} · level ${level} · addon ${addon}` })

  rows.push({
    label: 'consents',
    value: `GDPR ${state.consents.gdpr ? '✓' : '✗'} · AI ${state.consents.aiDisclosure ? '✓' : '✗'}`,
  })

  rows.push({
    label: 'DNT',
    value: state.dnt.signed
      ? `signed${state.dnt.validUntil ? ` (until ${state.dnt.validUntil})` : ''}`
      : 'not signed',
  })

  if (state.application.exists) {
    rows.push({
      label: 'application',
      value: `${state.application.status ?? '?'} · ${state.application.answered}/${state.application.required} answered`,
    })
    rows.push({
      label: 'missing',
      value: state.application.missing.length > 0 ? state.application.missing.join(', ') : 'none',
    })
  } else {
    rows.push({ label: 'application', value: 'not started' })
  }

  rows.push({ label: 'quote', value: state.quote ? `${state.quote.premiumAnnual ?? DASH}` : 'none' })

  return rows
}
