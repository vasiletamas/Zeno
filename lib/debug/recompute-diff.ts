/**
 * Recompute-and-diff replay (F2.3, T14.D2): re-run deriveAndExpose over the
 * STORED (redacted) snapshots and diff against the STORED state/actions.
 * A diff under the SAME engine version is a bug (same_version_drift — the
 * engine is no longer deterministic over its inputs, or a rule changed
 * without a version bump); a diff across versions is the behavioral
 * changelog (cross_version_change), expected and reportable.
 *
 * Caveat: a handful of rules are time-dependent (quote expiry, free-look
 * window, DNT-expiring flag), so replaying OLD conversations can surface
 * time-driven diffs that are neither bugs nor rule changes — the diff
 * output names the changed keys so a reviewer can spot `expired`/window
 * flips at a glance. Replay soon after recording for a clean bug signal.
 */
import type { DebugTurn } from './reducer'
import type { DomainSnapshot } from '@/lib/engines/domain-types'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'

export interface LegalityDiff {
  messageIndex: number
  point: string
  kind: 'same_version_drift' | 'cross_version_change'
  storedEngineVersion: string
  stateDiff: string[]
  actionsDiff: { addedAvailable: string[]; removedAvailable: string[]; blockedChanged: string[] }
}

type DeriveFn = (snapshot: unknown) => { state: Record<string, unknown>; actions: { available: string[]; blocked: { action: string; reason: string }[] } }

export function recomputeAndDiff(
  turns: DebugTurn[],
  opts: { currentEngineVersion: string; derive?: DeriveFn },
): LegalityDiff[] {
  const derive = opts.derive ?? ((s: unknown) => deriveAndExpose(s as DomainSnapshot) as unknown as ReturnType<DeriveFn>)
  const diffs: LegalityDiff[] = []
  for (const t of turns) {
    for (const entry of t.legality ?? []) {
      const fresh = derive(entry.snapshot)
      const storedState = entry.state as unknown as Record<string, unknown>
      const stateDiff: string[] = []
      for (const key of new Set([...Object.keys(storedState), ...Object.keys(fresh.state)])) {
        const a = JSON.stringify(storedState[key])
        const b = JSON.stringify(fresh.state[key])
        if (a !== b) stateDiff.push(`${key}: ${a ?? 'null'} -> ${b ?? 'null'}`)
      }
      const addedAvailable = fresh.actions.available.filter((x) => !entry.actions.available.includes(x))
      const removedAvailable = entry.actions.available.filter((x) => !fresh.actions.available.includes(x))
      const blockedChanged = JSON.stringify(entry.actions.blocked) === JSON.stringify(fresh.actions.blocked) ? [] : ['blocked set changed']
      if (stateDiff.length || addedAvailable.length || removedAvailable.length || blockedChanged.length) {
        diffs.push({
          messageIndex: t.messageIndex,
          point: entry.point,
          kind: entry.engineVersion === opts.currentEngineVersion ? 'same_version_drift' : 'cross_version_change',
          storedEngineVersion: entry.engineVersion,
          stateDiff,
          actionsDiff: { addedAvailable, removedAvailable, blockedChanged },
        })
      }
    }
  }
  return diffs
}
