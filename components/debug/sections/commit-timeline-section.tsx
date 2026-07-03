/**
 * Commit timeline panel (F2.6, T14.D4): the conversation's CommitLedger rows
 * (from the v2 export) chronologically — every write attempt with its
 * outcome, effects and idempotency disposition, applied or not.
 */

import type { CommitLedgerExportRow } from '@/lib/debug/conversation-export'

const OUTCOME_STYLES: Record<string, string> = {
  applied: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
  requires_confirmation: 'bg-amber-100 text-amber-700',
  unavailable: 'bg-gray-200 text-gray-600',
  pending: 'bg-blue-100 text-blue-700',
}

export function CommitTimelineSection({ ledger }: { ledger: CommitLedgerExportRow[] }) {
  if (ledger.length === 0) {
    return <p className="text-xs text-gray-500">No commits in this conversation yet.</p>
  }

  return (
    <ul className="space-y-1 text-xs font-mono">
      {ledger.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline gap-1.5">
          <span className="text-[10px] text-gray-400">{row.createdAt.slice(11, 19)}</span>
          <span className="font-semibold">{row.tool}</span>
          <span
            className={`rounded px-1 py-0.5 text-[10px] ${OUTCOME_STYLES[row.outcome] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {row.outcome}
          </span>
          {row.reasonCode && <span className="text-[10px] text-red-600">{row.reasonCode}</span>}
          {row.effects.map((e) => (
            <span key={e} className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-700">
              {e}
            </span>
          ))}
          {row.idempotencyDisposition !== 'fresh' && (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">
              {row.idempotencyDisposition}
            </span>
          )}
          {row.phaseFrom && row.phaseTo && row.phaseFrom !== row.phaseTo && (
            <span className="text-[10px] text-gray-500">
              {row.phaseFrom}→{row.phaseTo}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
