import { describe, it, expect, vi, afterEach } from 'vitest'
import { consumeSSE, parseSSEEvents, type SSEHandlers } from '@/lib/chat/sse-consumer'
import { nextTurnMessageId } from '@/lib/hooks/use-chat'

// T4: ONE parse/dispatch path for both senders (sendMessage/sendAction). The
// pre-T4 hook carried two duplicate read loops that shared
// streamingMessageIdRef behind a stale isStreaming guard, so overlapping
// turns clobbered each other's assistant bubble (truncated replies, stuck
// blinking cursor, input left disabled).

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

interface RecordedCall {
  event: string
  payload: unknown
}

function recorder(): { calls: RecordedCall[]; handlers: SSEHandlers } {
  const calls: RecordedCall[] = []
  return {
    calls,
    handlers: {
      onContent: (text) => calls.push({ event: 'content', payload: text }),
      onToolStart: (tool, statusMessage) =>
        calls.push({ event: 'tool_start', payload: { tool, statusMessage } }),
      onToolComplete: () => calls.push({ event: 'tool_complete', payload: null }),
      onUiAction: (action) => calls.push({ event: 'ui_action', payload: action }),
      onError: (data) => calls.push({ event: 'error', payload: data }),
      onDone: (data) => calls.push({ event: 'done', payload: data }),
      onDebug: (event, data) => calls.push({ event: 'debug', payload: { event, data } }),
    },
  }
}

describe('consumeSSE', () => {
  it('reassembles content frames split mid-frame across chunk boundaries', async () => {
    const { calls, handlers } = recorder()
    await consumeSSE(
      sseResponse([
        'event: content\ndata: {"te',
        'xt":"Sal"}\n\nevent: content\ndata: {"text":"ut"}\n',
        '\nevent: done\ndata: {}\n\n',
      ]),
      handlers,
    )
    expect(calls).toEqual([
      { event: 'content', payload: 'Sal' },
      { event: 'content', payload: 'ut' },
      { event: 'done', payload: {} },
    ])
  })

  it('dispatches a whole turn arriving as ONE concatenated chunk, in order', async () => {
    const { calls, handlers } = recorder()
    const chunk =
      'event: content\ndata: {"text":"Verific"}\n\n' +
      'event: tool_start\ndata: {"tool":"get_products","statusMessage":"Caut produse"}\n\n' +
      'event: tool_complete\ndata: {}\n\n' +
      'event: ui_action\ndata: {"type":"question","payload":{"questionCode":"BD_SMOKER"}}\n\n' +
      'event: content\ndata: {"text":" gata."}\n\n' +
      'event: done\ndata: {"suggestions":["Da","Nu"]}\n\n'
    await consumeSSE(sseResponse([chunk]), handlers)
    expect(calls).toEqual([
      { event: 'content', payload: 'Verific' },
      { event: 'tool_start', payload: { tool: 'get_products', statusMessage: 'Caut produse' } },
      { event: 'tool_complete', payload: null },
      {
        event: 'ui_action',
        payload: { type: 'question', payload: { questionCode: 'BD_SMOKER' } },
      },
      { event: 'content', payload: ' gata.' },
      { event: 'done', payload: { suggestions: ['Da', 'Nu'] } },
    ])
  })

  it('delivers the raw error payload (both structured and plain shapes)', async () => {
    const { calls, handlers } = recorder()
    await consumeSSE(
      sseResponse([
        'event: error\ndata: {"message":"turn aborted","retryable":true,"traceId":"t1"}\n\n',
      ]),
      handlers,
    )
    expect(calls).toEqual([
      { event: 'error', payload: { message: 'turn aborted', retryable: true, traceId: 't1' } },
    ])

    const plain = recorder()
    await consumeSSE(sseResponse(['event: error\ndata: {"error":"boom"}\n\n']), plain.handlers)
    expect(plain.calls).toEqual([{ event: 'error', payload: { error: 'boom' } }])
  })

  it('passes debug:* events through with their full event name', async () => {
    const { calls, handlers } = recorder()
    await consumeSSE(
      sseResponse(['event: debug:turn\ndata: {"round":1}\n\nevent: done\ndata: {}\n\n']),
      handlers,
    )
    expect(calls).toEqual([
      { event: 'debug', payload: { event: 'debug:turn', data: { round: 1 } } },
      { event: 'done', payload: {} },
    ])
  })

  it('honors a trailing done frame missing its final terminator; drops a trailing partial content frame', async () => {
    const done = recorder()
    await consumeSSE(
      sseResponse([
        'event: content\ndata: {"text":"a"}\n\n',
        'event: done\ndata: {"suggestions":["x"]}',
      ]),
      done.handlers,
    )
    expect(done.calls).toEqual([
      { event: 'content', payload: 'a' },
      { event: 'done', payload: { suggestions: ['x'] } },
    ])

    const dropped = recorder()
    await consumeSSE(
      sseResponse(['event: content\ndata: {"text":"a"}\n\nevent: content\ndata: {"text":"never"}']),
      dropped.handlers,
    )
    expect(dropped.calls).toEqual([{ event: 'content', payload: 'a' }])
  })

  it('skips malformed JSON frames without aborting the stream', async () => {
    const { calls, handlers } = recorder()
    await consumeSSE(
      sseResponse(['event: content\ndata: {broken\n\nevent: content\ndata: {"text":"ok"}\n\n']),
      handlers,
    )
    expect(calls).toEqual([{ event: 'content', payload: 'ok' }])
  })

  it('rejects on a non-OK response with the HTTP status', async () => {
    const { handlers } = recorder()
    const response = new Response(null, { status: 502, statusText: 'Bad Gateway' })
    await expect(consumeSSE(response, handlers)).rejects.toThrow('HTTP 502: Bad Gateway')
  })

  it('rejects on a body-less response', async () => {
    const { handlers } = recorder()
    const response = new Response(null, { status: 200 })
    await expect(consumeSSE(response, handlers)).rejects.toThrow('No response body')
  })
})

describe('parseSSEEvents (legacy parsing behavior kept)', () => {
  it('joins multi-line data with newlines, defaults the event name, skips data-less blocks', () => {
    const events = parseSSEEvents(
      'data: line1\ndata: line2\n\nevent: named\n\nevent: content\ndata: {"text":"x"}\n\n',
    )
    expect(events).toEqual([
      { event: 'message', data: 'line1\nline2' },
      { event: 'content', data: '{"text":"x"}' },
    ])
  })
})

describe('nextTurnMessageId', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('never collides for two turns started in the same millisecond (the double-Enter race)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
    const a = nextTurnMessageId('assistant')
    const b = nextTurnMessageId('assistant')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^assistant_\d+_\d+$/)
    expect(nextTurnMessageId('user')).toMatch(/^user_\d+_\d+$/)
  })
})
