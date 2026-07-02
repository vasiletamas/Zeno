import type { DebugTurn } from '@/lib/debug/reducer'
import { deriveStateDebugRows } from '@/lib/debug/state-rows'

/**
 * Renders the DerivedStateV3 snapshot for the turn (phase/subphase, next best
 * action, selection, consents, DNT, application progress + missing, quote).
 * The data is carried on the `debug:gate` event's `derivedState` field — the
 * gate phase is where deriveAndExpose() runs.
 */
export function StateSection({ gate }: { gate: DebugTurn['gate'] }) {
  if (!gate) return <p className="text-xs text-gray-500">No state data yet.</p>

  const rows = deriveStateDebugRows(gate.derivedState)

  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-gray-500">{r.label}</dt>
            <dd className="whitespace-pre-wrap break-words">{r.value}</dd>
          </div>
        ))}
        <dt className="text-gray-500">durationMs</dt>
        <dd>{gate.durationMs}</dd>
      </dl>
    </div>
  )
}
