import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Sentry before importing logger
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
}))

import * as Sentry from '@sentry/nextjs'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'

const mockCapture = vi.mocked(Sentry.captureException)

describe('Sentry Logger Transport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SENTRY_DSN = 'https://test@sentry.io/123'
  })

  afterEach(() => {
    delete process.env.SENTRY_DSN
  })

  it('sends errors to Sentry with correct tags', () => {
    const errorId = logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Provider timeout',
      context: { provider: 'OPENAI' },
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [exception, options] = mockCapture.mock.calls[0]
    expect(exception).toBeInstanceOf(Error)
    expect((exception as Error).message).toBe('Provider timeout')
    expect(options).toEqual(expect.objectContaining({
      tags: { layer: 'gateway', category: 'transient', errorId },
      level: 'error',
    }))
    expect((options as { extra?: unknown })?.extra).toEqual(expect.objectContaining({ provider: 'OPENAI' }))
  })

  it('sends fatals to Sentry with fatal level', () => {
    logFatal({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Database unreachable',
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [, options] = mockCapture.mock.calls[0]
    expect((options as { level?: unknown })?.level).toBe('fatal')
  })

  it('does NOT send warnings to Sentry', () => {
    logWarn({
      layer: 'tool',
      category: 'validation',
      message: 'Invalid argument',
    })

    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('uses original Error object when provided', () => {
    const originalError = new Error('original')
    logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Wrapped error',
      error: originalError,
    })

    expect(mockCapture).toHaveBeenCalledOnce()
    const [exception] = mockCapture.mock.calls[0]
    expect(exception).toBe(originalError)
  })

  it('skips Sentry when SENTRY_DSN is not set', () => {
    delete process.env.SENTRY_DSN
    logError({
      layer: 'gateway',
      category: 'transient',
      message: 'No DSN',
    })

    expect(mockCapture).not.toHaveBeenCalled()
  })
})
