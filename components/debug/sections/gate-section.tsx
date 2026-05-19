import type { DebugTurn } from '@/lib/debug/reducer'

export function GateSection({ gate }: { gate: DebugTurn['gate'] }) {
  if (!gate) return <p className="text-xs text-gray-500">No gate data yet.</p>

  if (gate.skipped) {
    return (
      <div className="space-y-1 text-xs">
        <p className="font-mono">
          <span className="font-semibold">Skipped:</span> {gate.reason}
        </p>
      </div>
    )
  }

  const out = gate.output
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        {out?.complexity && (
          <>
            <dt>complexity</dt>
            <dd>{out.complexity}</dd>
          </>
        )}
        {out?.situationType && (
          <>
            <dt>situationType</dt>
            <dd>{out.situationType}</dd>
          </>
        )}
        {typeof out?.confidence === 'number' && (
          <>
            <dt>confidence</dt>
            <dd>{out.confidence.toFixed(2)}</dd>
          </>
        )}
        {out?.modeTransition && (
          <>
            <dt>modeTransition</dt>
            <dd>{out.modeTransition}</dd>
          </>
        )}
        <dt>durationMs</dt>
        <dd>{gate.durationMs}</dd>
      </dl>
      {out?.recommendedSkillPacks && out.recommendedSkillPacks.length > 0 && (
        <p className="font-mono">
          skillPacks: {out.recommendedSkillPacks.join(', ')}
        </p>
      )}
      {out?.requiredSections && out.requiredSections.length > 0 && (
        <p className="font-mono">required: {out.requiredSections.join(', ')}</p>
      )}
      {out?.excludedSections && out.excludedSections.length > 0 && (
        <p className="font-mono">excluded: {out.excludedSections.join(', ')}</p>
      )}
    </div>
  )
}
