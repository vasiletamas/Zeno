import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSimulationConversation, sendSimulationMessage, setSimulationChannel } from '@/lib/simulation/sse-client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

describe('sse-client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createSimulationConversation calls session and create endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ customerId: 'cust-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ conversationId: 'conv-1' }) })

    const result = await createSimulationConversation('http://localhost:3000')
    expect(result).toEqual({ customerId: 'cust-1', conversationId: 'conv-1' })
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('createSimulationConversation throws on session failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'error' })
    await expect(createSimulationConversation('http://localhost:3000')).rejects.toThrow('POST /api/session failed')
  })

  it('sendSimulationMessage parses SSE content events', async () => {
    const sseBody = 'event: content\ndata: {"text":"Hello"}\n\nevent: content\ndata: {"text":" world"}\n\nevent: done\ndata: {"messageId":"m1"}\n\n'
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream })

    const result = await sendSimulationMessage('conv-1', 'cust-1', 'test message', 'http://localhost:3000')
    expect(result.content).toBe('Hello world')
    expect(result.done).toEqual({ messageId: 'm1' })
    expect(result.errors).toHaveLength(0)
  })

  it('sendSimulationMessage parses tool and ui_action events', async () => {
    const sseBody = [
      'event: tool_start\ndata: {"tool":"list_products"}\n',
      'event: tool_complete\ndata: {"tool":"list_products","success":true}\n',
      'event: ui_action\ndata: {"type":"show_question","payload":{"code":"AGE"}}\n',
      'event: content\ndata: {"text":"response"}\n',
      'event: done\ndata: {}\n',
    ].join('\n')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody))
        controller.close()
      },
    })
    mockFetch.mockResolvedValueOnce({ ok: true, body: stream })

    const result = await sendSimulationMessage('conv-1', 'cust-1', 'test', 'http://localhost:3000')
    expect(result.toolsCalled).toEqual(['list_products'])
    expect(result.uiActions).toHaveLength(1)
    expect(result.uiActions[0].type).toBe('show_question')
  })

  it('setSimulationChannel updates conversation in DB', async () => {
    const { prisma } = await import('@/lib/db')
    await setSimulationChannel('conv-1')
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { channel: 'simulation' },
    })
  })
})
