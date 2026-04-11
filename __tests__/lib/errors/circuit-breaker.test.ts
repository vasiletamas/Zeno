import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker } from '@/lib/errors/circuit-breaker'
import { CircuitOpenError } from '@/lib/errors/types'

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in closed state', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    expect(cb.state).toBe('closed')
  })

  it('executes function normally when closed', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    const result = await cb.execute(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it('opens after failureThreshold failures', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    }
    expect(cb.state).toBe('open')
  })

  it('rejects immediately with CircuitOpenError when open', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')
    await expect(cb.execute(() => Promise.resolve(1))).rejects.toThrow(CircuitOpenError)
  })

  it('transitions to half-open after resetTimeout', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')
    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')
  })

  it('closes on success in half-open state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')
    await cb.execute(() => Promise.resolve('ok'))
    expect(cb.state).toBe('closed')
  })

  it('re-opens on failure in half-open state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    vi.advanceTimersByTime(5001)
    expect(cb.state).toBe('half-open')
    await cb.execute(() => Promise.reject(new Error('still broken'))).catch(() => {})
    expect(cb.state).toBe('open')
  })

  it('does not open if failures are outside monitorWindow', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 2000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    vi.advanceTimersByTime(2001)
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('closed')
  })

  it('reset() returns to closed state', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('open')
    cb.reset()
    expect(cb.state).toBe('closed')
  })

  it('recordSuccess clears failure count', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, resetTimeoutMs: 5000, monitorWindowMs: 10000 })
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    cb.recordSuccess()
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {})
    expect(cb.state).toBe('closed')
  })
})
