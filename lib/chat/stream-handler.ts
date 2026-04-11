/**
 * SSE Stream Handler
 *
 * Creates ReadableStreams from async generators for Server-Sent Events.
 * Also provides a status message picker for tool execution UX.
 */

// ==============================================
// SSE EVENT TYPES
// ==============================================

export interface SSEEvent {
  event: 'content' | 'tool_start' | 'tool_complete' | 'ui_action' | 'error' | 'done' | 'status'
  data: Record<string, unknown>
}

// ==============================================
// SSE STREAM FACTORY
// ==============================================

/**
 * Wrap an async generator of SSEEvents into a ReadableStream<Uint8Array>.
 * Each event is formatted as standard SSE: `event: <type>\ndata: <json>\n\n`
 *
 * On generator error, an SSE error event is emitted before closing.
 */
export function createSSEStream(
  generator: () => AsyncGenerator<SSEEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const sse of generator()) {
          const formatted = `event: ${sse.event}\ndata: ${JSON.stringify(sse.data)}\n\n`
          controller.enqueue(encoder.encode(formatted))
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal stream error'
        const errorEvent = `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`
        controller.enqueue(encoder.encode(errorEvent))
      } finally {
        controller.close()
      }
    },
  })
}

// ==============================================
// STATUS MESSAGE PICKER
// ==============================================

/**
 * Pick a random status message from a pool, avoiding the most recently used one.
 * Returns null if statusMessage is null or the pool for the language is empty.
 */
export function pickStatusMessage(
  statusMessage: { ro: string[]; en: string[] } | null,
  language: 'en' | 'ro',
  lastUsed?: string,
): string | null {
  if (!statusMessage) return null

  const pool = statusMessage[language]
  if (!pool || pool.length === 0) return null

  // If pool has only one message, return it regardless of lastUsed
  if (pool.length === 1) return pool[0]

  // Filter out the last used message to avoid immediate repetition
  const candidates = lastUsed ? pool.filter((m) => m !== lastUsed) : pool
  const source = candidates.length > 0 ? candidates : pool

  const index = Math.floor(Math.random() * source.length)
  return source[index]
}
