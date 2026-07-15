/**
 * Client-side SSE consumption for chat turns.
 *
 * ONE parse/dispatch path shared by sendMessage and sendAction: the hook
 * previously carried two near-duplicate read loops whose shared streaming-id
 * ref let overlapping turns clobber each other's assistant bubble. All
 * per-turn state lives in the caller's closures; this module only reads a
 * Response body and dispatches typed callbacks.
 */

// ==============================================
// SSE PARSER
// ==============================================

export interface ParsedSSEEvent {
  event: string
  data: string
}

export function parseSSEEvents(text: string): ParsedSSEEvent[] {
  const events: ParsedSSEEvent[] = []

  // Split on double newlines to get event blocks
  const blocks = text.split('\n\n')

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    let event = 'message'
    const dataLines: string[] = []

    const lines = trimmed.split('\n')
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') })
    }
  }

  return events
}

// ==============================================
// CONSUMER
// ==============================================

export interface SSEHandlers {
  onContent: (text: string) => void
  onToolStart: (tool: string, statusMessage: string) => void
  onToolComplete: () => void
  onUiAction: (action: { type: string; payload: Record<string, unknown> }) => void
  /** Raw parsed payload: the two senders extract different fields from it. */
  onError: (data: Record<string, unknown>) => void
  onDone: (data: Record<string, unknown>) => void
  onDebug?: (event: string, data: Record<string, unknown>) => void
}

/**
 * Read a chat-turn SSE Response to completion, dispatching each event to its
 * typed handler. Rejects on non-OK / body-less responses and on transport
 * errors (including aborts) — turn-state cleanup is the caller's job.
 */
export async function consumeSSE(response: Response, handlers: SSEHandlers): Promise<void> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('No response body')
  }

  const dispatch = (sseEvent: ParsedSSEEvent) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(sseEvent.data)
    } catch {
      return
    }

    switch (sseEvent.event) {
      case 'content':
        handlers.onContent((data.text as string) ?? '')
        break
      case 'tool_start':
        handlers.onToolStart((data.tool as string) ?? '', (data.statusMessage as string) ?? '')
        break
      case 'tool_complete':
        handlers.onToolComplete()
        break
      case 'ui_action':
        handlers.onUiAction(data as { type: string; payload: Record<string, unknown> })
        break
      case 'error':
        handlers.onError(data)
        break
      case 'done':
        handlers.onDone(data)
        break
      default:
        if (sseEvent.event.startsWith('debug:')) {
          handlers.onDebug?.(sseEvent.event, data)
        }
        break
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Dispatch complete frames (terminated by \n\n); keep the partial tail
    // in the buffer for the next chunk.
    const lastDoubleNewline = buffer.lastIndexOf('\n\n')
    if (lastDoubleNewline === -1) continue

    const completeData = buffer.slice(0, lastDoubleNewline + 2)
    buffer = buffer.slice(lastDoubleNewline + 2)

    for (const sseEvent of parseSSEEvents(completeData)) {
      dispatch(sseEvent)
    }
  }

  // A final frame the server never terminated with \n\n: only `done` is
  // honored so the turn can still finalize — partial content frames stay
  // dropped, matching the legacy loops.
  if (buffer.trim()) {
    for (const sseEvent of parseSSEEvents(buffer)) {
      if (sseEvent.event === 'done') dispatch(sseEvent)
    }
  }
}
