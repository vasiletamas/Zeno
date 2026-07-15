import type { EventBus } from './event-bus'
import type { Anomaly } from './types'

// ==============================================
// ROLLING STATS
// ==============================================

export class RollingStats {
  private values: number[] = []

  constructor(private readonly maxSize: number = 200) {}

  push(value: number): void {
    if (this.values.length >= this.maxSize) {
      this.values.shift()
    }
    this.values.push(value)
  }

  mean(): number {
    if (this.values.length === 0) return 0
    return this.values.reduce((a, b) => a + b, 0) / this.values.length
  }

  p95(): number {
    if (this.values.length === 0) return 0
    const sorted = [...this.values].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.95) - 1
    return sorted[Math.max(0, idx)]
  }
}

// ==============================================
// PER-TURN STATE
// ==============================================

const turnAnomalies = new Map<string, Anomaly[]>()
const turnToolFailures = new Map<string, number>()
const turnToolCalls = new Map<string, number>()
const turnToolHistory = new Map<string, Array<{ name: string; success: boolean }>>()
const _rollingLatency = new Map<string, RollingStats>()

function addAnomaly(traceId: string, anomaly: Anomaly): void {
  if (!turnAnomalies.has(traceId)) {
    turnAnomalies.set(traceId, [])
  }
  turnAnomalies.get(traceId)!.push(anomaly)
}

export function getTurnAnomalies(traceId: string): Anomaly[] {
  return turnAnomalies.get(traceId) ?? []
}

/**
 * F2.4: public entry for the orchestrator's runtime invariant monitors —
 * findings join the same per-turn store the drawer badges and TurnDebug/
 * TurnTrace rows read.
 */
export function recordTurnAnomaly(traceId: string, anomaly: Anomaly): void {
  addAnomaly(traceId, anomaly)
}

export function getTurnToolHistory(
  traceId: string,
): Array<{ name: string; success: boolean }> {
  return turnToolHistory.get(traceId) ?? []
}

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerAnomalySubscriber(bus: EventBus): void {
  bus.on('turn:start', (event) => {
    if (event.type !== 'turn:start') return
    turnAnomalies.set(event.traceId, [])
    turnToolFailures.set(event.traceId, 0)
    turnToolCalls.set(event.traceId, 0)
    turnToolHistory.set(event.traceId, [])
  })

  bus.on('phase:end', (event) => {
    if (event.type !== 'phase:end') return
    if (event.durationMs > 10_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `Phase "${event.phase}" took ${event.durationMs}ms (>10s)`,
        metadata: { phase: event.phase, durationMs: event.durationMs },
      })
    }
  })

  // P1-10: the call-count "LLM retry detected" heuristic is RETIRED — it
  // fired on the normal second LLM round of every tool-calling turn (100%
  // false positive) while real retries emitted nothing. The registry now
  // reports the truth on dedicated events.
  bus.on('llm:call:retry', (event) => {
    if (event.type !== 'llm:call:retry' || !event.traceId) return
    addAnomaly(event.traceId, {
      type: 'error_pattern',
      severity: 'info',
      message: `LLM retry (attempt ${event.attempt}) for ${event.provider}/${event.model}: ${event.errorClass}`,
      metadata: { provider: event.provider, model: event.model, attempt: event.attempt, delayMs: event.delayMs, errorClass: event.errorClass },
    })
  })

  bus.on('llm:failover', (event) => {
    if (event.type !== 'llm:failover' || !event.traceId) return
    addAnomaly(event.traceId, {
      type: 'error_pattern',
      severity: 'warning',
      message: `LLM failover ${event.fromModel} -> ${event.toModel} (${event.errorClass})`,
      metadata: { fromModel: event.fromModel, toModel: event.toModel, errorClass: event.errorClass },
    })
  })

  bus.on('llm:call:end', (event) => {
    if (event.type !== 'llm:call:end') return
    if (event.durationMs > 20_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `LLM call took ${event.durationMs}ms (>20s)`,
        metadata: { provider: event.provider, model: event.model, durationMs: event.durationMs },
      })
    }
    if (event.outputTokens > 50_000) {
      addAnomaly(event.traceId, {
        type: 'cost',
        severity: 'warning',
        message: `LLM call produced ${event.outputTokens} output tokens (>50k)`,
        metadata: { provider: event.provider, model: event.model, outputTokens: event.outputTokens },
      })
    }
  })

  bus.on('tool:end', (event) => {
    if (event.type !== 'tool:end') return
    const calls = (turnToolCalls.get(event.traceId) ?? 0) + 1
    turnToolCalls.set(event.traceId, calls)
    // Accumulate tool history for side-effect validation (subsystem C).
    const history = turnToolHistory.get(event.traceId)
    if (history) {
      history.push({ name: event.toolName, success: event.success })
    }
    if (!event.success) {
      const failures = (turnToolFailures.get(event.traceId) ?? 0) + 1
      turnToolFailures.set(event.traceId, failures)
      if (failures === 3) {
        addAnomaly(event.traceId, {
          type: 'error_pattern',
          severity: 'warning',
          message: `${failures} tool failures in this turn`,
          metadata: { failureCount: failures },
        })
      }
    }
    if (calls === 9) {
      addAnomaly(event.traceId, {
        type: 'behavioral',
        severity: 'warning',
        message: `${calls} tool calls in this turn (>8)`,
        metadata: { toolCallCount: calls },
      })
    }
  })

  bus.on('compliance:result', (event) => {
    if (event.type !== 'compliance:result') return
    if (!event.passed) {
      addAnomaly(event.traceId, {
        type: 'behavioral',
        severity: 'warning',
        message: `Compliance check failed: ${event.gaps.join(', ')}`,
        metadata: { gaps: event.gaps },
      })
    }
  })

  bus.on('side_effect:invalid', (event) => {
    if (event.type !== 'side_effect:invalid') return
    const phrases = event.violations.map((v) => `"${v.matchedPhrase}" (${v.category})`).join(', ')
    addAnomaly(event.traceId, {
      type: 'behavioral',
      severity: 'warning',
      message: `Side-effect claim not backed by tool call: ${phrases}`,
      metadata: { violations: event.violations },
    })
  })

  bus.on('turn:end', (event) => {
    if (event.type !== 'turn:end') return
    if (event.latencyMs > 60_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'critical',
        message: `Turn took ${event.latencyMs}ms (>60s)`,
        metadata: { latencyMs: event.latencyMs },
      })
    } else if (event.latencyMs > 30_000) {
      addAnomaly(event.traceId, {
        type: 'latency',
        severity: 'warning',
        message: `Turn took ${event.latencyMs}ms (>30s)`,
        metadata: { latencyMs: event.latencyMs },
      })
    }
    if (event.cost !== null) {
      if (event.cost > 2.00) {
        addAnomaly(event.traceId, {
          type: 'cost',
          severity: 'critical',
          message: `Turn cost $${event.cost.toFixed(3)} (>$2.00)`,
          metadata: { cost: event.cost },
        })
      } else if (event.cost > 0.50) {
        addAnomaly(event.traceId, {
          type: 'cost',
          severity: 'warning',
          message: `Turn cost $${event.cost.toFixed(3)} (>$0.50)`,
          metadata: { cost: event.cost },
        })
      }
    }
    setTimeout(() => {
      turnAnomalies.delete(event.traceId)
      turnToolFailures.delete(event.traceId)
      turnToolCalls.delete(event.traceId)
      turnToolHistory.delete(event.traceId)
    }, 1000)
  })
}
