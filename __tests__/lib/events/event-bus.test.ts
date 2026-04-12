import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/lib/events/event-bus'
import type { ZenoEvent } from '@/lib/events/types'

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  const turnStartEvent: ZenoEvent = {
    type: 'turn:start',
    traceId: 'trace-1',
    conversationId: 'conv-1',
    messageIndex: 0,
    timestamp: Date.now(),
  }

  const turnEndEvent: ZenoEvent = {
    type: 'turn:end',
    traceId: 'trace-1',
    conversationId: 'conv-1',
    cost: 0.05,
    latencyMs: 1200,
    anomalies: [],
  }

  it('emits events to matching handlers', () => {
    const handler = vi.fn()
    bus.on('turn:start', handler)
    bus.emit(turnStartEvent)
    expect(handler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('does not emit to non-matching handlers', () => {
    const handler = vi.fn()
    bus.on('turn:end', handler)
    bus.emit(turnStartEvent)
    expect(handler).not.toHaveBeenCalled()
  })

  it('wildcard handler receives all events', () => {
    const handler = vi.fn()
    bus.on('*', handler)
    bus.emit(turnStartEvent)
    bus.emit(turnEndEvent)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenCalledWith(turnStartEvent)
    expect(handler).toHaveBeenCalledWith(turnEndEvent)
  })

  it('unsubscribe removes the handler', () => {
    const handler = vi.fn()
    const unsub = bus.on('turn:start', handler)
    unsub()
    bus.emit(turnStartEvent)
    expect(handler).not.toHaveBeenCalled()
  })

  it('once handler fires only once', () => {
    const handler = vi.fn()
    bus.once('turn:start', handler)
    bus.emit(turnStartEvent)
    bus.emit(turnStartEvent)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('handler errors do not propagate', () => {
    const badHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()
    bus.on('turn:start', badHandler)
    bus.on('turn:start', goodHandler)
    expect(() => bus.emit(turnStartEvent)).not.toThrow()
    expect(goodHandler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('async handler errors do not propagate', () => {
    const badHandler = vi.fn(async () => { throw new Error('async boom') })
    const goodHandler = vi.fn()
    bus.on('turn:start', badHandler)
    bus.on('turn:start', goodHandler)
    expect(() => bus.emit(turnStartEvent)).not.toThrow()
    expect(goodHandler).toHaveBeenCalledWith(turnStartEvent)
  })

  it('multiple handlers for same event all fire', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    bus.on('turn:start', handler1)
    bus.on('turn:start', handler2)
    bus.emit(turnStartEvent)
    expect(handler1).toHaveBeenCalledOnce()
    expect(handler2).toHaveBeenCalledOnce()
  })
})
