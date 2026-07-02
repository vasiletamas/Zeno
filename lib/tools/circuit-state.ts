/**
 * Per-tool circuit-breaker registry (A2.7, erratum 10).
 *
 * A LEAF module: imported by both the executor (which records outcomes) and
 * the engine snapshot loader (which exposes open circuits as M10 degraded-
 * mode input) — extracting it here avoids the snapshot-loader → executor →
 * registry → handlers → snapshot-loader import cycle, and keeps the engine's
 * dependency a pure state read.
 */

import { CircuitBreaker } from '@/lib/errors/circuit-breaker'

const toolCircuits = new Map<string, CircuitBreaker>()

export function getToolCircuit(name: string): CircuitBreaker {
  let cb = toolCircuits.get(name)
  if (!cb) {
    cb = new CircuitBreaker({
      name: `tool:${name}`,
      failureThreshold: 3,
      resetTimeoutMs: 20_000,
      monitorWindowMs: 30_000,
    })
    toolCircuits.set(name, cb)
  }
  return cb
}

export function getOpenCircuitTools(): string[] {
  return [...toolCircuits.entries()].filter(([, cb]) => cb.state === 'open').map(([n]) => n)
}
