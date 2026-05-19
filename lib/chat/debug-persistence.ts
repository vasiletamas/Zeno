/**
 * Persist debug events to disk as JSONL for later analysis.
 *
 * Layout: `.debug-traces/<YYYY-MM-DD>/<conversationId>/<traceId>.jsonl`
 * — one file per turn, one event per line. Fire-and-forget; disk
 * failures are swallowed so they can't break the chat flow.
 *
 * Only called from debugYield, which already gates on isDev() && enabled.
 * No additional guard needed here.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DebugEvent } from './debug'

const TRACE_ROOT = '.debug-traces'

// Cache conversationId per traceId. Populated on debug:turn_start, used
// for subsequent events in the same turn, cleared on debug:turn_end.
const traceToConv = new Map<string, string>()

function todayUtcDir(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function writeDebugEvent(event: DebugEvent): Promise<void> {
  try {
    const traceId = event.data.traceId

    if (event.event === 'debug:turn_start') {
      traceToConv.set(traceId, event.data.conversationId || 'untitled')
    }
    const conversationId = traceToConv.get(traceId) ?? 'untitled'

    const dir = path.join(TRACE_ROOT, todayUtcDir(), conversationId)
    await fs.mkdir(dir, { recursive: true })

    const file = path.join(dir, `${traceId}.jsonl`)
    await fs.appendFile(file, JSON.stringify(event) + '\n', 'utf8')

    if (event.event === 'debug:turn_end') {
      traceToConv.delete(traceId)
    }
  } catch {
    // Swallow — disk failures must not break chat
  }
}

// Test-only: clear the in-memory cache between tests
export function _clearTraceCache(): void {
  traceToConv.clear()
}
