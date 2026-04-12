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
const turnLlmStarts = new Map<string, Map<string, number>>()
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

// ==============================================
// SUBSCRIBER
// ==============================================

export function registerAnomalySubscriber(bus: EventBus): void {
  bus.on('turn:start', (event) => {
    if (event.type !== 'turn:start') return
    turnAnomalies.set(event.traceId, [])
    turnToolFailures.set(event.traceId, 0)
    turnToolCalls.set(event.traceId, 0)
    turnLlmStarts.set(event.traceId, new Map())
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

  bus.on('llm:call:start', (event) => {
    if (event.type !== 'llm:call:start') return
    const slugMap = turnLlmStarts.get(event.traceId)
    if (!slugMap) return
    const count = (slugMap.get(event.agentSlug) ?? 0) + 1
    slugMap.set(event.agentSlug, count)
    if (count === 2) {
      addAnomaly(event.traceId, {
        type: 'error_pattern',
        severity: 'info',
        message: `LLM retry detected for agent "${event.agentSlug}"`,
        metadata: { agentSlug: event.agentSlug, callCount: count },
      })
    }
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
      turnLlmStarts.delete(event.traceId)
    }, 1000)
  })
}
