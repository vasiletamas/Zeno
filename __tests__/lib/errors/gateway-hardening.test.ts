import { describe, it, expect } from 'vitest'
import { calculateBackoff } from '@/lib/llm/providers/registry'

describe('calculateBackoff', () => {
  it('returns exponential delay with base 500ms', () => {
    const delay = calculateBackoff(0)
    expect(delay).toBeGreaterThanOrEqual(500)
    expect(delay).toBeLessThanOrEqual(1000)
  })

  it('doubles delay for each attempt', () => {
    const delay = calculateBackoff(1)
    expect(delay).toBeGreaterThanOrEqual(1000)
    expect(delay).toBeLessThanOrEqual(1500)
  })

  it('caps delay at 10 seconds', () => {
    const delay = calculateBackoff(10)
    expect(delay).toBeLessThanOrEqual(10500)
  })

  it('uses retryAfter when provided', () => {
    const delay = calculateBackoff(0, 5000)
    expect(delay).toBe(5000)
  })
})
