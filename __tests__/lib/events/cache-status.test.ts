import { describe, it, expect } from 'vitest'
import { eventBus } from '@/lib/events'
import type { ZenoEvent } from '@/lib/events'
import { parseCacheUsage } from '@/lib/llm/gateway'

describe('cache:status event', () => {
  it('is a valid ZenoEvent type', () => {
    const events: ZenoEvent[] = []
    const unsub = eventBus.on('cache:status', (event) => { events.push(event) })

    eventBus.emit({
      type: 'cache:status',
      traceId: 'trace-1',
      provider: 'ANTHROPIC',
      cacheRead: 5000,
      cacheWrite: 2000,
      cacheHit: true,
    })

    expect(events).toHaveLength(1)
    if (events[0].type === 'cache:status') {
      expect(events[0].cacheRead).toBe(5000)
      expect(events[0].cacheWrite).toBe(2000)
      expect(events[0].cacheHit).toBe(true)
    }
    unsub()
  })
})

describe('parseCacheUsage', () => {
  it('extracts Anthropic cache tokens', () => {
    const result = parseCacheUsage('ANTHROPIC', {
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 300,
    })
    expect(result).toEqual({ cacheRead: 500, cacheWrite: 300, cacheHit: true })
  })

  it('extracts OpenAI cached tokens', () => {
    const result = parseCacheUsage('OPENAI', {
      prompt_tokens_details: { cached_tokens: 1000 },
    })
    expect(result).toEqual({ cacheRead: 1000, cacheWrite: 0, cacheHit: true })
  })

  it('returns zeros for unknown providers', () => {
    const result = parseCacheUsage('UNKNOWN', {})
    expect(result).toEqual({ cacheRead: 0, cacheWrite: 0, cacheHit: false })
  })

  it('handles missing cache fields gracefully', () => {
    const result = parseCacheUsage('ANTHROPIC', {})
    expect(result).toEqual({ cacheRead: 0, cacheWrite: 0, cacheHit: false })
  })
})
