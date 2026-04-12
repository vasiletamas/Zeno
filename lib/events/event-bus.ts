import type { ZenoEvent, ZenoEventType, EventHandler } from './types'
import { logWarn } from '@/lib/errors/logger'

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>()
  private wildcardHandlers = new Set<EventHandler>()

  on(type: ZenoEventType | '*', handler: EventHandler): () => void {
    if (type === '*') {
      this.wildcardHandlers.add(handler)
      return () => { this.wildcardHandlers.delete(handler) }
    }

    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)

    return () => { this.handlers.get(type)?.delete(handler) }
  }

  once(type: ZenoEventType, handler: EventHandler): void {
    const unsub = this.on(type, (event) => {
      unsub()
      return handler(event)
    })
  }

  emit(event: ZenoEvent): void {
    const handlers = this.handlers.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        this.safeCall(handler, event)
      }
    }
    for (const handler of this.wildcardHandlers) {
      this.safeCall(handler, event)
    }
  }

  private safeCall(handler: EventHandler, event: ZenoEvent): void {
    try {
      const result = handler(event)
      if (result && typeof result.catch === 'function') {
        result.catch((err: unknown) => {
          logWarn({
            layer: 'orchestrator',
            category: 'event_handler_error',
            message: `Async event handler failed for ${event.type}`,
            context: { traceId: event.traceId },
            error: err,
          })
        })
      }
    } catch (err) {
      logWarn({
        layer: 'orchestrator',
        category: 'event_handler_error',
        message: `Event handler failed for ${event.type}`,
        context: { traceId: event.traceId },
        error: err,
      })
    }
  }
}

export const eventBus = new EventBus()
