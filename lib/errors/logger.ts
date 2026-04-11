import { nanoid } from 'nanoid'
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

export function logFatal(input: ErrorInput): string {
  return emitLog('fatal', input)
}
