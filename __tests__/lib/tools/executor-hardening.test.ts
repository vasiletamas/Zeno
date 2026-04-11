import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withTimeout } from '@/lib/tools/executor'

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves if operation completes within timeout', async () => {
    const result = await withTimeout(
      () => Promise.resolve('done'),
      'test-op',
      1000,
    )
    expect(result).toBe('done')
  })

  it('rejects with TimeoutError if operation exceeds timeout', async () => {
    const { TimeoutError } = await import('@/lib/errors/types')

    const slow = () => new Promise((resolve) => setTimeout(resolve, 5000))
    const promise = withTimeout(slow, 'slow-op', 1000)

    vi.advanceTimersByTime(1001)

    await expect(promise).rejects.toThrow(TimeoutError)
  })
})
