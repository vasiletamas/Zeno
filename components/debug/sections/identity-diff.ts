import type { DebugTurn } from '@/lib/debug/reducer'

type Identity = NonNullable<DebugTurn['identity']>

export interface IdentityDiffResult {
  changes: number
  scalarDiffs: Map<string, { now: unknown; was: unknown }>
  newMemoryIds: Set<string>
}

function equalish(a: unknown, b: unknown): boolean {
  // Collapse null/undefined to a single 'not set' value for comparison.
  const an = a === undefined ? null : a
  const bn = b === undefined ? null : b
  return an === bn
}

function diffScalars(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
  pathPrefix: string,
  out: Map<string, { now: unknown; was: unknown }>,
): void {
  const keys = new Set([...Object.keys(current), ...Object.keys(previous)])
  for (const k of keys) {
    const path = `${pathPrefix}.${k}`
    const now = current[k]
    const was = previous[k]
    if (!equalish(now, was)) {
      out.set(path, { now: now ?? null, was: was ?? null })
    }
  }
}

export function diffIdentity(
  current: Identity,
  previous: Identity | null,
): IdentityDiffResult {
  const scalarDiffs = new Map<string, { now: unknown; was: unknown }>()
  const newMemoryIds = new Set<string>()

  if (previous === null) {
    return { changes: 0, scalarDiffs, newMemoryIds }
  }

  // Identity scalars
  diffScalars(
    current.identity as unknown as Record<string, unknown>,
    previous.identity as unknown as Record<string, unknown>,
    'identity',
    scalarDiffs,
  )

  // Customer scalars
  diffScalars(
    current.customer as unknown as Record<string, unknown>,
    previous.customer as unknown as Record<string, unknown>,
    'customer',
    scalarDiffs,
  )

  // Consent scalars
  diffScalars(
    current.consent as unknown as Record<string, unknown>,
    previous.consent as unknown as Record<string, unknown>,
    'consent',
    scalarDiffs,
  )

  // Conversation state scalars (phase, product, candidate)
  diffScalars(
    current.conversation as unknown as Record<string, unknown>,
    previous.conversation as unknown as Record<string, unknown>,
    'conversation',
    scalarDiffs,
  )

  // Memory — new insights by id
  const prevIds = new Set(previous.memory.map((m) => m.id))
  for (const m of current.memory) {
    if (!prevIds.has(m.id)) newMemoryIds.add(m.id)
  }

  return {
    changes: scalarDiffs.size + newMemoryIds.size,
    scalarDiffs,
    newMemoryIds,
  }
}
