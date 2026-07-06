/**
 * Tests for event bus instrumentation in executor and gateway.
 *
 * Verifies that executeTool and gateway emit the expected events
 * when a traceId is provided.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ZenoEvent } from '@/lib/events/types'

// =============================================
// EXECUTOR INSTRUMENTATION
// =============================================

describe('executeTool instrumentation', () => {
  const emittedEvents: ZenoEvent[] = []
  // Swapped per test instead of re-doMock-ing the registry: two doMock
  // registrations for one path in the same test context resolve
  // nondeterministically (the full-suite flake of 2026-07-06).
  let handlerImpl: (args: unknown) => Promise<unknown> = async () => ({ success: true, data: { result: 'ok' } })
  let cacheImpl: { cacheable: boolean; cached: unknown } = { cacheable: false, cached: null }

  beforeEach(async () => {
    emittedEvents.length = 0
    handlerImpl = async () => ({ success: true, data: { result: 'ok' } })
    cacheImpl = { cacheable: false, cached: null }
    vi.resetModules()

    // Mock the event bus to capture emitted events
    vi.doMock('@/lib/events', () => ({
      eventBus: {
        emit: (event: ZenoEvent) => { emittedEvents.push(event) },
        on: vi.fn(),
        once: vi.fn(),
      },
    }))

    // Mock tool registry, validation, permissions, cache, circuit breaker
    vi.doMock('@/lib/tools/registry', () => ({
      getToolDefinition: vi.fn((name: string) => ({
        name,
        description: 'Test tool',
        parameters: {},
        sideEffects: false,
      })),
      getToolHandler: vi.fn(() => (args: unknown) => handlerImpl(args)),
    }))

    vi.doMock('@/lib/tools/validation', () => ({
      validateToolArgs: vi.fn(() => ({
        valid: true,
        data: { foo: 'bar' },
      })),
    }))

    vi.doMock('@/lib/tools/permissions', () => ({
      checkPermission: vi.fn(() => ({ allowed: true })),
    }))

    vi.doMock('@/lib/tools/cache', () => ({
      isToolCacheable: vi.fn(() => cacheImpl.cacheable),
      getCachedResult: vi.fn(() => cacheImpl.cached),
      setCachedResult: vi.fn(),
    }))

    vi.doMock('@/lib/errors/circuit-breaker', () => ({
      CircuitBreaker: class MockCircuitBreaker {
        state = 'closed'
        recordSuccess = vi.fn()
        recordFailure = vi.fn()
        constructor(_opts: unknown) {}
      },
    }))

    vi.doMock('@/lib/errors/types', () => ({
      TimeoutError: class TimeoutError extends Error {
        constructor(op: string, ms: number) {
          super(`${op} timed out after ${ms}ms`)
        }
      },
    }))

    vi.doMock('@/lib/errors/logger', () => ({
      logError: vi.fn(),
      logWarn: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits tool:start and tool:end when traceId is provided', async () => {
    const { executeTool } = await import('@/lib/tools/executor')

    const result = await executeTool(
      'test-tool',
      { foo: 'bar' },
      { customerId: 'c1', conversationId: 'conv1', language: 'en' } as never,
      'CUSTOMER',
      'trace-abc',
    )

    expect(result.success).toBe(true)

    const startEvents = emittedEvents.filter(e => e.type === 'tool:start')
    const endEvents = emittedEvents.filter(e => e.type === 'tool:end')

    expect(startEvents).toHaveLength(1)
    expect(endEvents).toHaveLength(1)

    expect(startEvents[0]).toMatchObject({
      type: 'tool:start',
      traceId: 'trace-abc',
      toolName: 'test-tool',
    })

    expect(endEvents[0]).toMatchObject({
      type: 'tool:end',
      traceId: 'trace-abc',
      toolName: 'test-tool',
      success: true,
      cached: false,
    })

    // durationMs should be a non-negative number
    const endEvent = endEvents[0] as Extract<ZenoEvent, { type: 'tool:end' }>
    expect(endEvent.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does NOT emit events when traceId is not provided', async () => {
    const { executeTool } = await import('@/lib/tools/executor')

    const result = await executeTool(
      'test-tool',
      { foo: 'bar' },
      { customerId: 'c1', conversationId: 'conv1', language: 'en' } as never,
      'CUSTOMER',
      // no traceId
    )

    expect(result.success).toBe(true)
    expect(emittedEvents).toHaveLength(0)
  })

  it('emits tool:end with success=false on handler error', async () => {
    handlerImpl = async () => { throw new Error('kaboom') }

    const { executeTool } = await import('@/lib/tools/executor')

    const result = await executeTool(
      'fail-tool',
      {},
      { customerId: 'c1', conversationId: 'conv1', language: 'en' } as never,
      'CUSTOMER',
      'trace-fail',
    )

    expect(result.success).toBe(false)

    const endEvents = emittedEvents.filter(e => e.type === 'tool:end')
    expect(endEvents).toHaveLength(1)
    expect(endEvents[0]).toMatchObject({
      type: 'tool:end',
      traceId: 'trace-fail',
      toolName: 'fail-tool',
      success: false,
      cached: false,
    })
  })

  it('emits tool:start/end with cached=true on cache hit', async () => {
    cacheImpl = { cacheable: true, cached: { success: true, data: { cached: true } } }

    const { executeTool } = await import('@/lib/tools/executor')

    const result = await executeTool(
      'cached-tool',
      { foo: 'bar' },
      { customerId: 'c1', conversationId: 'conv1', language: 'en' } as never,
      'CUSTOMER',
      'trace-cached',
    )

    expect(result.success).toBe(true)

    const startEvents = emittedEvents.filter(e => e.type === 'tool:start')
    const endEvents = emittedEvents.filter(e => e.type === 'tool:end')

    expect(startEvents).toHaveLength(1)
    expect(endEvents).toHaveLength(1)

    expect(endEvents[0]).toMatchObject({
      type: 'tool:end',
      traceId: 'trace-cached',
      toolName: 'cached-tool',
      success: true,
      cached: true,
      durationMs: 0,
    })
  })
})

// =============================================
// GATEWAY INSTRUMENTATION
// =============================================

describe('gateway instrumentation', () => {
  const emittedEvents: ZenoEvent[] = []

  beforeEach(async () => {
    emittedEvents.length = 0
    vi.resetModules()

    vi.doMock('@/lib/events', () => ({
      eventBus: {
        emit: (event: ZenoEvent) => { emittedEvents.push(event) },
        on: vi.fn(),
        once: vi.fn(),
      },
    }))

    vi.doMock('@/lib/llm/agent-config', () => ({
      getAgentConfig: vi.fn(async () => ({
        provider: 'OPENAI',
        model: 'gpt-4',
        systemPrompt: 'You are helpful.',
        temperature: 0.7,
        maxTokens: 1000,
        fallbackProvider: null,
        fallbackModel: null,
      })),
    }))

    vi.doMock('@/lib/llm/providers/registry', () => ({
      getProvider: vi.fn(() => ({
        chat: vi.fn(async () => ({
          content: 'Hello!',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        })),
        chatWithTools: vi.fn(async () => ({
          content: 'Using tool.',
          toolCalls: [],
          usage: { promptTokens: 200, completionTokens: 75, totalTokens: 275 },
        })),
        chatStream: vi.fn(async () => (async function* () {
          yield { type: 'content', content: 'Hi' }
          yield { type: 'done', usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 } }
        })()),
      })),
      callWithFailover: vi.fn(async (_primary: unknown, _fallback: unknown, fn: Function) => {
        const provider = {
          chat: vi.fn(async () => ({
            content: 'Hello!',
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          })),
          chatWithTools: vi.fn(async () => ({
            content: 'Using tool.',
            toolCalls: [],
            usage: { promptTokens: 200, completionTokens: 75, totalTokens: 275 },
          })),
        }
        return fn(provider, 'gpt-4')
      }),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits llm:call:start and llm:call:end on gateway.call() with traceId', async () => {
    const { gateway } = await import('@/lib/llm/gateway')

    await gateway.call('main-chat', {
      messages: [{ role: 'user', content: 'Hi' }],
      traceId: 'trace-gw-1',
    })

    const startEvents = emittedEvents.filter(e => e.type === 'llm:call:start')
    const endEvents = emittedEvents.filter(e => e.type === 'llm:call:end')

    expect(startEvents).toHaveLength(1)
    expect(endEvents).toHaveLength(1)

    expect(startEvents[0]).toMatchObject({
      type: 'llm:call:start',
      traceId: 'trace-gw-1',
      provider: 'OPENAI',
      model: 'gpt-4',
      agentSlug: 'main-chat',
    })

    expect(endEvents[0]).toMatchObject({
      type: 'llm:call:end',
      traceId: 'trace-gw-1',
      provider: 'OPENAI',
      model: 'gpt-4',
      inputTokens: 100,
      outputTokens: 50,
    })

    const endEvent = endEvents[0] as Extract<ZenoEvent, { type: 'llm:call:end' }>
    expect(endEvent.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('does NOT emit events on gateway.call() without traceId', async () => {
    const { gateway } = await import('@/lib/llm/gateway')

    await gateway.call('main-chat', {
      messages: [{ role: 'user', content: 'Hi' }],
      // no traceId
    })

    expect(emittedEvents).toHaveLength(0)
  })
})
