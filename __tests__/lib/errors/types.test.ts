import { describe, it, expect } from 'vitest'
import {
  CircuitOpenError,
  TimeoutError,
  type ErrorSeverity,
  type ErrorLayer,
} from '@/lib/errors/types'

// ==============================================
// ErrorSeverity type
// ==============================================

describe('ErrorSeverity type', () => {
  it('accepts valid severity values', () => {
    const severities: ErrorSeverity[] = ['warn', 'error', 'fatal']
    expect(severities).toEqual(['warn', 'error', 'fatal'])
  })
})

// ==============================================
// ErrorLayer type
// ==============================================

describe('ErrorLayer type', () => {
  it('accepts valid layer values', () => {
    const layers: ErrorLayer[] = [
      'provider',
      'gateway',
      'orchestrator',
      'tool',
      'api',
    ]
    expect(layers).toEqual(['provider', 'gateway', 'orchestrator', 'tool', 'api'])
  })
})

// ==============================================
// CircuitOpenError
// ==============================================

describe('CircuitOpenError', () => {
  it('extends Error', () => {
    const err = new CircuitOpenError('openai')
    expect(err).toBeInstanceOf(Error)
  })

  it('sets name to "CircuitOpenError"', () => {
    const err = new CircuitOpenError('openai')
    expect(err.name).toBe('CircuitOpenError')
  })

  it('stores circuitName as a readonly property', () => {
    const err = new CircuitOpenError('openai')
    expect(err.circuitName).toBe('openai')
  })

  it('produces the expected message', () => {
    const err = new CircuitOpenError('anthropic')
    expect(err.message).toBe(
      'Circuit breaker "anthropic" is open — call rejected'
    )
  })

  it('is catchable as an Error', () => {
    expect(() => {
      throw new CircuitOpenError('test')
    }).toThrow(Error)
  })
})

// ==============================================
// TimeoutError
// ==============================================

describe('TimeoutError', () => {
  it('extends Error', () => {
    const err = new TimeoutError('fetchCompletion', 5000)
    expect(err).toBeInstanceOf(Error)
  })

  it('sets name to "TimeoutError"', () => {
    const err = new TimeoutError('fetchCompletion', 5000)
    expect(err.name).toBe('TimeoutError')
  })

  it('stores operation as a readonly property', () => {
    const err = new TimeoutError('fetchCompletion', 5000)
    expect(err.operation).toBe('fetchCompletion')
  })

  it('stores timeoutMs as a readonly property', () => {
    const err = new TimeoutError('fetchCompletion', 5000)
    expect(err.timeoutMs).toBe(5000)
  })

  it('produces the expected message', () => {
    const err = new TimeoutError('callProvider', 3000)
    expect(err.message).toBe(
      'Operation "callProvider" timed out after 3000ms'
    )
  })

  it('is catchable as an Error', () => {
    expect(() => {
      throw new TimeoutError('test', 1000)
    }).toThrow(Error)
  })
})
