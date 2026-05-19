import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeDebugEvent, _clearTraceCache } from '@/lib/chat/debug-persistence'
import type { DebugEvent } from '@/lib/chat/debug'

const TRACE_ROOT = '.debug-traces'

async function cleanup() {
  try { await fs.rm(TRACE_ROOT, { recursive: true, force: true }) } catch {}
}

function todayDir(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function turnStart(traceId: string, conversationId: string): DebugEvent {
  return {
    event: 'debug:turn_start',
    data: { traceId, conversationId, messageIndex: 0, userMessage: 'hi', language: 'en' },
  }
}

function gate(traceId: string): DebugEvent {
  return {
    event: 'debug:gate',
    data: { traceId, skipped: true, reason: 'fast_path', durationMs: 0 },
  }
}

function turnEnd(traceId: string): DebugEvent {
  return {
    event: 'debug:turn_end',
    data: { traceId, phases: {}, totalInputTokens: 1, totalOutputTokens: 2, cost: null, latencyMs: 10, anomalies: [] },
  }
}

describe('writeDebugEvent', () => {
  beforeEach(async () => {
    _clearTraceCache()
    await cleanup()
  })
  afterEach(cleanup)

  it('writes a turn_start event to the conversation-specific file', async () => {
    await writeDebugEvent(turnStart('t1', 'conv-abc'))
    const file = path.join(TRACE_ROOT, todayDir(), 'conv-abc', 't1.jsonl')
    const content = await fs.readFile(file, 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      event: 'debug:turn_start',
      data: { traceId: 't1', conversationId: 'conv-abc' },
    })
  })

  it('appends subsequent events from the same turn to the same file', async () => {
    await writeDebugEvent(turnStart('t1', 'conv-abc'))
    await writeDebugEvent(gate('t1'))
    await writeDebugEvent(turnEnd('t1'))

    const file = path.join(TRACE_ROOT, todayDir(), 'conv-abc', 't1.jsonl')
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).event).toBe('debug:turn_start')
    expect(JSON.parse(lines[1]).event).toBe('debug:gate')
    expect(JSON.parse(lines[2]).event).toBe('debug:turn_end')
  })

  it('routes the gate event to the correct conversation dir by traceId lookup', async () => {
    await writeDebugEvent(turnStart('t1', 'conv-abc'))
    await writeDebugEvent(turnStart('t2', 'conv-xyz'))
    await writeDebugEvent(gate('t1'))
    await writeDebugEvent(gate('t2'))

    const fileA = path.join(TRACE_ROOT, todayDir(), 'conv-abc', 't1.jsonl')
    const fileX = path.join(TRACE_ROOT, todayDir(), 'conv-xyz', 't2.jsonl')
    expect((await fs.readFile(fileA, 'utf8')).trim().split('\n')).toHaveLength(2)
    expect((await fs.readFile(fileX, 'utf8')).trim().split('\n')).toHaveLength(2)
  })

  it('uses "untitled" when conversationId is empty', async () => {
    await writeDebugEvent(turnStart('t1', ''))
    const file = path.join(TRACE_ROOT, todayDir(), 'untitled', 't1.jsonl')
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('debug:turn_start')
  })

  it('uses "untitled" when no prior turn_start was seen', async () => {
    await writeDebugEvent(gate('orphan'))
    const file = path.join(TRACE_ROOT, todayDir(), 'untitled', 'orphan.jsonl')
    const content = await fs.readFile(file, 'utf8')
    expect(content).toContain('debug:gate')
  })

  it('does not throw if disk write fails', async () => {
    // Force a write failure by passing an event with a traceId containing
    // an illegal Windows path character.
    const bad: DebugEvent = {
      event: 'debug:turn_start',
      data: { traceId: 'a/../../escape', conversationId: 'conv', messageIndex: 0, userMessage: '', language: 'en' },
    }
    await expect(writeDebugEvent(bad)).resolves.toBeUndefined()
  })
})
