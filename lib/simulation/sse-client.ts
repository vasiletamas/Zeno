/**
 * SSE Client for Customer Simulation
 *
 * HTTP client that calls the chat API and parses SSE responses.
 */

import { prisma } from '@/lib/db'
import type { ParsedTurn } from './types'

// Re-export for consumers
export type { ParsedTurn }

// ==============================================
// SSE PARSING
// ==============================================

function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  let eventType = 'message'
  let dataStr = ''

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataStr += line.slice('data:'.length).trim()
    }
  }

  if (!dataStr) return null

  try {
    return { event: eventType, data: JSON.parse(dataStr) }
  } catch {
    return { event: eventType, data: dataStr }
  }
}

function routeEvent(turn: ParsedTurn, eventType: string, data: unknown): void {
  turn.rawEvents.push({ event: eventType, data })

  switch (eventType) {
    case 'content': {
      const d = data as Record<string, unknown>
      turn.content += (typeof d.text === 'string' ? d.text : '') || (typeof d.content === 'string' ? d.content : '')
      break
    }
    case 'tool_start': {
      const d = data as Record<string, unknown>
      const name = (typeof d.tool === 'string' ? d.tool : null) ?? (typeof d.name === 'string' ? d.name : null)
      if (name) turn.toolsCalled.push(name)
      break
    }
    case 'ui_action': {
      const d = data as Record<string, unknown>
      if (typeof d.type === 'string') {
        turn.uiActions.push({ type: d.type, payload: (d.payload as Record<string, unknown>) ?? {} })
      }
      break
    }
    case 'error': {
      const d = data as Record<string, unknown>
      turn.errors.push(typeof d.message === 'string' ? d.message : typeof d.error === 'string' ? d.error : JSON.stringify(d))
      break
    }
    case 'done':
      turn.done = data as Record<string, unknown>
      break
  }
}

async function parseSSEStream(stream: ReadableStream<Uint8Array>): Promise<ParsedTurn> {
  const turn: ParsedTurn = {
    content: '',
    toolsCalled: [],
    uiActions: [],
    errors: [],
    done: null,
    rawEvents: [],
  }

  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const trimmed = frame.trim()
          if (!trimmed) continue
          const parsed = parseSSEFrame(trimmed)
          if (parsed) routeEvent(turn, parsed.event, parsed.data)
        }
      }
      if (done) break
    }
    if (buffer.trim()) {
      const parsed = parseSSEFrame(buffer.trim())
      if (parsed) routeEvent(turn, parsed.event, parsed.data)
    }
  } finally {
    reader.releaseLock()
  }

  return turn
}

// ==============================================
// PUBLIC API
// ==============================================

export async function createSimulationConversation(
  baseUrl: string,
): Promise<{ customerId: string; conversationId: string }> {
  const sessionRes = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!sessionRes.ok) {
    throw new Error(`POST /api/session failed (${sessionRes.status}): ${await sessionRes.text()}`)
  }
  const { customerId } = (await sessionRes.json()) as { customerId: string }

  const createRes = await fetch(`${baseUrl}/api/chat/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  })
  if (!createRes.ok) {
    throw new Error(`POST /api/chat/create failed (${createRes.status}): ${await createRes.text()}`)
  }
  const { conversationId } = (await createRes.json()) as { conversationId: string }

  return { customerId, conversationId }
}

export async function setSimulationChannel(conversationId: string): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { channel: 'simulation' },
  })
}

export async function sendSimulationMessage(
  conversationId: string,
  customerId: string,
  message: string,
  baseUrl: string,
): Promise<ParsedTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, customerId, message }),
  })
  if (!response.ok) {
    throw new Error(`POST /api/chat failed (${response.status}): ${await response.text()}`)
  }
  if (!response.body) {
    throw new Error('POST /api/chat returned no body')
  }
  return parseSSEStream(response.body)
}

export async function sendSimulationAction(
  conversationId: string,
  customerId: string,
  action: { type: string; payload: Record<string, unknown> },
  baseUrl: string,
): Promise<ParsedTurn> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, customerId, action }),
  })
  if (!response.ok) {
    throw new Error(`POST /api/chat (action) failed (${response.status}): ${await response.text()}`)
  }
  if (!response.body) {
    throw new Error('POST /api/chat (action) returned no body')
  }
  return parseSSEStream(response.body)
}
