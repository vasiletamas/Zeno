import { describe, it, expect } from 'vitest'
import { toUnavailable } from '@/lib/tools/gateway'
import { TimeoutError } from '@/lib/errors/types'

describe('unavailable ≠ rejected (M10 invariant)', () => {
  it('maps TimeoutError to outcome unavailable with retryable=true and NO effects', () => {
    const env = toUnavailable(new TimeoutError('tool:generate_quote', 15000))
    expect(env.outcome).toBe('unavailable')
    expect(env.effects).toEqual([])
    expect((env.data as { retryable: boolean }).retryable).toBe(true)
  })
})
