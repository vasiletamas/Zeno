/**
 * Legality panel (F2.6, T14.D4): the per-turn deriveAndExpose verdicts —
 * available actions as green chips, blocked as red chips with their reason
 * codes, engine + content versions in the footer. One block per legality
 * snapshot (turn_start, then one post_commit per applied envelope).
 */

import type { DebugTurn } from '@/lib/debug/reducer'

interface Props {
  legality: DebugTurn['legality']
}

export function LegalitySection({ legality }: Props) {
  if (!legality || legality.length === 0) {
    return <p className="text-xs text-gray-500">No legality snapshots for this turn.</p>
  }

  return (
    <div className="space-y-3 text-xs font-mono">
      {legality.map((entry, i) => (
        <div key={i} className="space-y-1">
          <p className="text-[10px] font-semibold text-gray-600">
            {entry.point}
            {entry.commitLedgerId && (
              <span className="ml-1 font-normal text-gray-400">
                ledger={entry.commitLedgerId}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-1">
            {entry.actions.available.map((a) => (
              <span key={a} className="rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-800">
                {a}
              </span>
            ))}
            {entry.actions.blocked.map((b) => (
              <span
                key={b.action}
                title={b.reason}
                className="rounded bg-red-100 px-1 py-0.5 text-[10px] text-red-700"
              >
                {b.action} · {b.reason}
              </span>
            ))}
            {entry.actions.available.length === 0 && entry.actions.blocked.length === 0 && (
              <span className="text-[10px] text-gray-400">no actions</span>
            )}
          </div>
        </div>
      ))}
      <p className="border-t border-black/5 pt-1 text-[10px] text-gray-400">
        engine {legality[0].engineVersion}
        {legality[0].contentVersions.length > 0 && (
          <> · content {legality[0].contentVersions.join(', ')}</>
        )}
      </p>
    </div>
  )
}
