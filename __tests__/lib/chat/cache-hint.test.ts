import { describe, it, expect } from 'vitest'
import type { Message, CacheHint } from '@/lib/llm/providers/types'

describe('CacheHint on Message', () => {
  it('allows setting cacheHint on a system message', () => {
    const msg: Message = {
      role: 'system',
      content: 'You are Zeno',
      cacheHint: { breakpoint: 'ephemeral' },
    }
    expect(msg.cacheHint).toBeDefined()
    expect(msg.cacheHint!.breakpoint).toBe('ephemeral')
  })

  it('cacheHint is optional and defaults to undefined', () => {
    const msg: Message = { role: 'user', content: 'Hello' }
    expect(msg.cacheHint).toBeUndefined()
  })
})
