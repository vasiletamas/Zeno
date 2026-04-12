import { trace, type Span, SpanStatusCode } from '@opentelemetry/api'
import type { EventBus } from './event-bus'
import type { ZenoEvent } from './types'

interface TraceState {
  root: Span
  phases: Map<string, Span>
  llmSpans: Map<string, Span>
  toolSpans: Map<string, Span>
  createdAt: number
}

const activeTraces = new Map<string, TraceState>()

const STALE_TRACE_MS = 2 * 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [traceId, state] of activeTraces) {
    if (now - state.createdAt > STALE_TRACE_MS) {
      state.root.end()
      activeTraces.delete(traceId)
    }
  }
}, 5 * 60 * 1000)

function getTracer() {
  return trace.getTracer('zeno-agent')
}

export function registerOtelSubscriber(bus: EventBus): void {
  bus.on('*', (event: ZenoEvent) => {
    switch (event.type) {
      case 'turn:start': {
        const span = getTracer().startSpan('zeno.turn', {
          attributes: {
            'zeno.traceId': event.traceId,
            'zeno.conversationId': event.conversationId,
            'zeno.messageIndex': event.messageIndex,
          },
        })
        activeTraces.set(event.traceId, {
          root: span,
          phases: new Map(),
          llmSpans: new Map(),
          toolSpans: new Map(),
          createdAt: Date.now(),
        })
        break
      }

      case 'phase:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const span = getTracer().startSpan(`zeno.phase.${event.phase}`, {
          attributes: { 'zeno.phase': event.phase },
        })
        ts.phases.set(event.phase, span)
        break
      }

      case 'phase:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.phases.get(event.phase)
        if (!span) return
        span.setAttribute('zeno.durationMs', event.durationMs)
        if (event.metadata) {
          for (const [k, v] of Object.entries(event.metadata)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              span.setAttribute(`zeno.${k}`, v)
            }
          }
        }
        span.end()
        ts!.phases.delete(event.phase)
        break
      }

      case 'llm:call:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const span = getTracer().startSpan(`zeno.llm.${event.provider}.${event.model}`, {
          attributes: {
            'zeno.provider': event.provider,
            'zeno.model': event.model,
            'zeno.agentSlug': event.agentSlug,
          },
        })
        ts.llmSpans.set(`${event.provider}:${event.model}`, span)
        break
      }

      case 'llm:call:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.llmSpans.get(`${event.provider}:${event.model}`)
        if (!span) return
        span.setAttribute('zeno.inputTokens', event.inputTokens)
        span.setAttribute('zeno.outputTokens', event.outputTokens)
        span.setAttribute('zeno.durationMs', event.durationMs)
        span.end()
        ts!.llmSpans.delete(`${event.provider}:${event.model}`)
        break
      }

      case 'tool:start': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        const span = getTracer().startSpan(`zeno.tool.${event.toolName}`, {
          attributes: { 'zeno.toolName': event.toolName },
        })
        ts.toolSpans.set(event.toolName, span)
        break
      }

      case 'tool:end': {
        const ts = activeTraces.get(event.traceId)
        const span = ts?.toolSpans.get(event.toolName)
        if (!span) return
        span.setAttribute('zeno.durationMs', event.durationMs)
        span.setAttribute('zeno.success', event.success)
        span.setAttribute('zeno.cached', event.cached)
        if (!event.success) {
          span.setStatus({ code: SpanStatusCode.ERROR })
        }
        span.end()
        ts!.toolSpans.delete(event.toolName)
        break
      }

      case 'mode:transition': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('mode.transition', { from: event.from, to: event.to })
        break
      }

      case 'skillpack:activated': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('skillpack.activated', { slugs: event.slugs.join(',') })
        break
      }

      case 'skillpack:deactivated': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('skillpack.deactivated', { slugs: event.slugs.join(',') })
        break
      }

      case 'compliance:result': {
        const ts = activeTraces.get(event.traceId)
        ts?.root.addEvent('compliance.result', {
          passed: event.passed,
          gaps: event.gaps.join(','),
        })
        break
      }

      case 'turn:end': {
        const ts = activeTraces.get(event.traceId)
        if (!ts) return
        if (event.cost !== null) ts.root.setAttribute('zeno.cost', event.cost)
        ts.root.setAttribute('zeno.latencyMs', event.latencyMs)
        ts.root.setAttribute('zeno.anomalyCount', event.anomalies.length)
        ts.root.end()
        activeTraces.delete(event.traceId)
        break
      }
    }
  })
}
