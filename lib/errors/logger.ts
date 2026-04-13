import { nanoid } from 'nanoid'
import * as Sentry from '@sentry/nextjs'
import type { ErrorSeverity, ErrorLayer } from './types'

// ==============================================
// TYPES
// ==============================================

export interface ErrorEntry {
  errorId: string
  severity: ErrorSeverity
  layer: ErrorLayer
  category: string
  context: Record<string, unknown>
  message: string
  timestamp: string
  stack?: string
}

export interface ErrorInput {
  layer: ErrorLayer
  category: string
  message: string
  context?: Record<string, unknown>
  error?: unknown
}

// ==============================================
// CORE LOGGING
// ==============================================

function emitLog(severity: ErrorSeverity, input: ErrorInput): string {
  const errorId = nanoid(12)

  const entry: ErrorEntry = {
    errorId,
    severity,
    layer: input.layer,
    category: input.category,
    context: input.context ?? {},
    message: input.message,
    timestamp: new Date().toISOString(),
  }

  if (input.error instanceof Error) {
    entry.stack = input.error.stack
  }

  console.error(JSON.stringify(entry))

  // Sentry transport: send errors and fatals
  if ((severity === 'error' || severity === 'fatal') && process.env.SENTRY_DSN) {
    try {
      Sentry.captureException(
        input.error instanceof Error ? input.error : new Error(input.message),
        {
          tags: { layer: input.layer, category: input.category, errorId },
          extra: input.context ?? {},
          level: severity === 'fatal' ? 'fatal' : 'error',
        },
      )
    } catch {
      // Sentry transport failure must never break the logger
    }
  }

  return errorId
}

// ==============================================
// PUBLIC API
// ==============================================

export function logError(input: ErrorInput): string {
  return emitLog('error', input)
}

export function logWarn(input: ErrorInput): string {
  return emitLog('warn', input)
}

export function logInfo(input: ErrorInput): string {
  return emitLog('info', input)
}

export function logFatal(input: ErrorInput): string {
  return emitLog('fatal', input)
}
