/**
 * SSE Parser for E2E Tests
 *
 * Sends messages to POST /api/chat and parses the SSE stream response.
 * Mirrors the SSE format emitted by lib/chat/stream-handler.ts but for
 * Node.js consumption (no browser APIs, no 'use client').
 */

// ==============================================
// TYPES
// ==============================================

export interface ParsedTurn {
  /** Accumulated text from content events */
  content: string
  /** Tool names from tool_start events */
  toolsCalled: string[]
  /** UI actions from ui_action events */
  uiActions: { type: string; payload: Record<string, unknown> }[]
  /** Error messages from error events */
  errors: string[]
  /** Data from the done event, or null if stream ended without one */
  done: Record<string, unknown> | null
  /** All raw events in order of receipt */
  rawEvents: { event: string; data: unknown }[]
}

// ==============================================
// SSE PARSING INTERNALS
// ==============================================

function createEmptyTurn(): ParsedTurn {
  return {
    content: '',
    toolsCalled: [],
    uiActions: [],
    errors: [],
    done: null,
    rawEvents: [],
  }
}

/**
 * Route a single SSE event into the accumulator.
 */
function routeEvent(
  turn: ParsedTurn,
  eventType: string,
  data: unknown,
): void {
  turn.rawEvents.push({ event: eventType, data })

  switch (eventType) {
    case 'content': {
      const d = data as Record<string, unknown>
      if (typeof d.content === 'string') {
        turn.content += d.content
      } else if (typeof d.text === 'string') {
        turn.content += d.text
      }
      break
    }

    case 'tool_start': {
      const d = data as Record<string, unknown>
      const toolName =
        typeof d.tool === 'string'
          ? d.tool
          : typeof d.name === 'string'
            ? d.name
            : typeof d.toolName === 'string'
              ? d.toolName
              : null
      if (toolName) {
        turn.toolsCalled.push(toolName)
      }
      break
    }

    case 'tool_complete':
      // Tracked for raw events; no accumulation needed
      break

    case 'ui_action': {
      const d = data as Record<string, unknown>
      if (typeof d.type === 'string') {
        turn.uiActions.push({
          type: d.type,
          payload: (d.payload as Record<string, unknown>) ?? {},
        })
      }
      break
    }

    case 'error': {
      const d = data as Record<string, unknown>
      const msg =
        typeof d.error === 'string'
          ? d.error
          : typeof d.message === 'string'
            ? d.message
            : JSON.stringify(d)
      turn.errors.push(msg)
      break
    }

    case 'done': {
      turn.done = data as Record<string, unknown>
      break
    }

    default:
      // Unknown event type — still captured in rawEvents
      break
  }
}

/**
 * Parse a complete SSE frame (text between double newlines) into
 * its event type and data payload.
 *
 * SSE format:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 */
function parseSSEFrame(frame: string): { event: string; data: unknown } | null {
  let eventType = 'message'
  let dataStr = ''

  const lines = frame.split('\n')
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataStr += line.slice('data:'.length).trim()
    }
    // Ignore comments (lines starting with ':') and other fields
  }

  if (!dataStr) return null

  try {
    const data: unknown = JSON.parse(dataStr)
    return { event: eventType, data }
  } catch {
    // Non-JSON data line — wrap as string
    return { event: eventType, data: dataStr }
  }
}

/**
 * Read a ReadableStream<Uint8Array> and parse SSE events,
 * buffering incomplete lines across chunks.
 */
async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): Promise<ParsedTurn> {
  const turn = createEmptyTurn()
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (value) {
        buffer += decoder.decode(value, { stream: true })

        // Split on double newline — each complete SSE frame
        const frames = buffer.split('\n\n')
        // Last element may be incomplete — keep it in the buffer
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const trimmed = frame.trim()
          if (!trimmed) continue

          const parsed = parseSSEFrame(trimmed)
          if (parsed) {
            routeEvent(turn, parsed.event, parsed.data)
          }
        }
      }

      if (done) break
    }

    // Process any remaining buffer content
    if (buffer.trim()) {
      const parsed = parseSSEFrame(buffer.trim())
      if (parsed) {
        routeEvent(turn, parsed.event, parsed.data)
      }
    }
  } finally {
    reader.releaseLock()
  }

  return turn
}

// ==============================================
// DEFAULT BASE URL
// ==============================================

function getBaseUrl(baseUrl?: string): string {
  return baseUrl ?? process.env.APP_URL ?? 'http://localhost:3001'
}

// ==============================================
// PUBLIC API
// ==============================================

/**
 * Send a text message to POST /api/chat and parse the full SSE response.
 */
export async function sendMessageAndParse(
  conversationId: string,
  customerId: string,
  message: string,
  baseUrl?: string,
): Promise<ParsedTurn> {
  const url = `${getBaseUrl(baseUrl)}/api/chat`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      customerId,
      message,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `POST /api/chat failed (${response.status}): ${text}`,
    )
  }

  if (!response.body) {
    throw new Error('POST /api/chat returned no body')
  }

  return parseSSEStream(response.body)
}

/**
 * Send a UI action to POST /api/chat and parse the full SSE response.
 */
export async function sendActionAndParse(
  conversationId: string,
  customerId: string,
  action: { type: string; payload: Record<string, unknown> },
  baseUrl?: string,
): Promise<ParsedTurn> {
  const url = `${getBaseUrl(baseUrl)}/api/chat`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      customerId,
      action,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `POST /api/chat (action) failed (${response.status}): ${text}`,
    )
  }

  if (!response.body) {
    throw new Error('POST /api/chat (action) returned no body')
  }

  return parseSSEStream(response.body)
}

/**
 * Create a new test conversation by calling session + conversation creation APIs.
 * Returns the IDs needed to send messages.
 */
export async function createTestConversation(
  baseUrl?: string,
): Promise<{ conversationId: string; customerId: string }> {
  const base = getBaseUrl(baseUrl)

  // Step 1: Create a session (anonymous customer)
  const sessionRes = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })

  if (!sessionRes.ok) {
    const text = await sessionRes.text()
    throw new Error(
      `POST /api/session failed (${sessionRes.status}): ${text}`,
    )
  }

  const sessionData = (await sessionRes.json()) as { customerId: string }
  const { customerId } = sessionData

  if (!customerId) {
    throw new Error(
      'POST /api/session did not return customerId',
    )
  }

  // Step 2: Create a conversation for this customer
  const createRes = await fetch(`${base}/api/chat/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    throw new Error(
      `POST /api/chat/create failed (${createRes.status}): ${text}`,
    )
  }

  const createData = (await createRes.json()) as { conversationId: string }
  const { conversationId } = createData

  if (!conversationId) {
    throw new Error(
      'POST /api/chat/create did not return conversationId',
    )
  }

  return { conversationId, customerId }
}
