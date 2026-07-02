/**
 * Pure helper: turn a DerivedStateV3 snapshot (deriveAndExpose output, carried
 * on the `debug:gate` event since A1.5) into labeled display rows for the
 * debug drawer's "State" panel. Tested directly; the panel component is a thin
 * render of these rows. Values are rendered as raw strings (no enum mapping),
 * so historical payloads with unknown phase strings still display verbatim.
 */

import type { DerivedStateV3 } from '@/lib/engines/domain-types'

export interface StateDebugRow {
  label: string
  value: string
}

const DASH = '—'

export function deriveStateDebugRows(
  state: DerivedStateV3 | null | undefined,
): StateDebugRow[] {
  if (!state) return [{ label: 'state', value: 'unavailable' }]

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
