import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logError, logWarn, logFatal } from '@/lib/errors/logger'

describe('Structured Logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('logError outputs valid JSON with all required fields', () => {
    const errorId = logError({
      layer: 'gateway',
      category: 'transient',
      message: 'Provider returned 503',
      context: { provider: 'openai', attempt: 2 },
    })

    expect(errorId).toBeTruthy()
    expect(consoleErrorSpy).toHaveBeenCalledOnce()

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.errorId).toBe(errorId)
    expect(output.severity).toBe('error')
    expect(output.layer).toBe('gateway')
    expect(output.category).toBe('transient')
    expect(output.message).toBe('Provider returned 503')
    expect(output.context.provider).toBe('openai')
    expect(output.timestamp).toBeDefined()
  })

  it('logWarn sets severity to warn', () => {
    logWarn({
      layer: 'orchestrator',
      category: 'db_error',
      message: 'Step 4 context assembly failed, using fallback',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.severity).toBe('warn')
  })

  it('logFatal sets severity to fatal', () => {
    logFatal({
      layer: 'api',
      category: 'internal',
      message: 'Unhandled exception in API route',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.severity).toBe('fatal')
  })

  it('extracts stack trace from Error objects', () => {
    const err = new Error('something broke')
    logError({
      layer: 'tool',
      category: 'tool_failure',
      message: 'Tool execution failed',
      error: err,
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.stack).toContain('something broke')
  })

  it('handles non-Error error values gracefully', () => {
    logError({
      layer: 'provider',
      category: 'unknown',
      message: 'Weird error',
      error: 'just a string',
    })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.stack).toBeUndefined()
  })

  it('generates unique error IDs', () => {
    const id1 = logError({ layer: 'gateway', category: 'transient', message: 'err1' })
    const id2 = logError({ layer: 'gateway', category: 'transient', message: 'err2' })
    expect(id1).not.toBe(id2)
  })

  it('defaults context to empty object when not provided', () => {
    logError({ layer: 'tool', category: 'timeout', message: 'timed out' })

    const output = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string)
    expect(output.context).toEqual({})
  })
})
