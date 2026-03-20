'use client'

import { useState, useCallback, useRef } from 'react'

// ==============================================
// TYPES
// ==============================================

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming: boolean
  createdAt: Date
}

export interface UIAction {
  type: string
  payload: Record<string, unknown>
}

export interface UseChatReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  toolStatus: { tool: string; message: string } | null
  error: string | null
  conversationId: string | null
  customerId: string | null
  sendMessage: (text: string) => void
  sendAction: (action: UIAction) => void
  suggestions: string[]
}

// ==============================================
// SSE PARSER
// ==============================================

interface ParsedSSEEvent {
  event: string
  data: string
}

function parseSSEEvents(text: string): ParsedSSEEvent[] {
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
// HOOK
// ==============================================

export function useChat(
  conversationId: string,
  customerId: string,
  initialMessages?: ChatMessage[]
): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? [])
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState<{ tool: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])

  // Use ref to track the current streaming assistant message id
  const streamingMessageIdRef = useRef<string | null>(null)

  // Abort controller for cancelling requests
  const abortControllerRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (text: string) => {
      if (isStreaming) return

      // Clear previous error
      setError(null)
      setSuggestions([])

      // Optimistic user message
      const userMsg: ChatMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: text,
        isStreaming: false,
        createdAt: new Date(),
      }

      // Empty assistant message for streaming
      const assistantMsgId = `assistant_${Date.now()}`
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date(),
      }

      streamingMessageIdRef.current = assistantMsgId
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, customerId, message: text }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()

          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Process complete events (separated by \n\n)
          // Keep incomplete data in the buffer
          const lastDoubleNewline = buffer.lastIndexOf('\n\n')
          if (lastDoubleNewline === -1) continue

          const completeData = buffer.slice(0, lastDoubleNewline + 2)
          buffer = buffer.slice(lastDoubleNewline + 2)

          const events = parseSSEEvents(completeData)

          for (const sseEvent of events) {
            let data: Record<string, unknown>
            try {
              data = JSON.parse(sseEvent.data)
            } catch {
              continue
            }

            switch (sseEvent.event) {
              case 'content': {
                const contentText = (data.text as string) ?? ''
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingMessageIdRef.current
                      ? { ...m, content: m.content + contentText }
                      : m
                  )
                )
                break
              }

              case 'tool_start': {
                setToolStatus({
                  tool: (data.tool as string) ?? '',
                  message: (data.statusMessage as string) ?? '',
                })
                break
              }

              case 'tool_complete': {
                setToolStatus(null)
                break
              }

              case 'ui_action': {
                // Store for B2 future use — currently no-op
                break
              }

              case 'error': {
                const errorMessage = (data.error as string) ?? 'Unknown error'
                setError(errorMessage)
                // Remove the streaming assistant message
                setMessages((prev) =>
                  prev.filter((m) => m.id !== streamingMessageIdRef.current)
                )
                setIsStreaming(false)
                setToolStatus(null)
                streamingMessageIdRef.current = null
                break
              }

              case 'done': {
                // Finalize the message
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingMessageIdRef.current
                      ? { ...m, isStreaming: false }
                      : m
                  )
                )
                // Extract suggestions if present
                if (data.suggestions && Array.isArray(data.suggestions)) {
                  setSuggestions(data.suggestions as string[])
                }
                setIsStreaming(false)
                setToolStatus(null)
                streamingMessageIdRef.current = null
                break
              }
            }
          }
        }

        // Handle any remaining buffer
        if (buffer.trim()) {
          const events = parseSSEEvents(buffer)
          for (const sseEvent of events) {
            if (sseEvent.event === 'done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamingMessageIdRef.current
                    ? { ...m, isStreaming: false }
                    : m
                )
              )
              setIsStreaming(false)
              setToolStatus(null)
              streamingMessageIdRef.current = null
            }
          }
        }

        // Ensure streaming state is cleared even if no 'done' event
        if (streamingMessageIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMessageIdRef.current
                ? { ...m, isStreaming: false }
                : m
            )
          )
          setIsStreaming(false)
          setToolStatus(null)
          streamingMessageIdRef.current = null
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return // Request was cancelled intentionally
        }
        const errorMessage = err instanceof Error ? err.message : 'Connection failed'
        setError(errorMessage)
        // Remove the streaming assistant message on fetch error
        setMessages((prev) =>
          prev.filter((m) => m.id !== streamingMessageIdRef.current)
        )
        setIsStreaming(false)
        setToolStatus(null)
        streamingMessageIdRef.current = null
      }
    },
    [isStreaming, conversationId, customerId]
  )

  const sendAction = useCallback(
    async (action: UIAction) => {
      if (isStreaming) return

      setError(null)
      setSuggestions([])

      const assistantMsgId = `assistant_${Date.now()}`
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date(),
      }

      streamingMessageIdRef.current = assistantMsgId
      setMessages((prev) => [...prev, assistantMsg])
      setIsStreaming(true)

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, customerId, action }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        if (!response.body) {
          throw new Error('No response body')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lastDoubleNewline = buffer.lastIndexOf('\n\n')
          if (lastDoubleNewline === -1) continue

          const completeData = buffer.slice(0, lastDoubleNewline + 2)
          buffer = buffer.slice(lastDoubleNewline + 2)

          const events = parseSSEEvents(completeData)

          for (const sseEvent of events) {
            let data: Record<string, unknown>
            try {
              data = JSON.parse(sseEvent.data)
            } catch {
              continue
            }

            switch (sseEvent.event) {
              case 'content': {
                const contentText = (data.text as string) ?? ''
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingMessageIdRef.current
                      ? { ...m, content: m.content + contentText }
                      : m
                  )
                )
                break
              }
              case 'tool_start':
                setToolStatus({
                  tool: (data.tool as string) ?? '',
                  message: (data.statusMessage as string) ?? '',
                })
                break
              case 'tool_complete':
                setToolStatus(null)
                break
              case 'error': {
                const errorMessage = (data.error as string) ?? 'Unknown error'
                setError(errorMessage)
                setMessages((prev) =>
                  prev.filter((m) => m.id !== streamingMessageIdRef.current)
                )
                setIsStreaming(false)
                setToolStatus(null)
                streamingMessageIdRef.current = null
                break
              }
              case 'done': {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === streamingMessageIdRef.current
                      ? { ...m, isStreaming: false }
                      : m
                  )
                )
                if (data.suggestions && Array.isArray(data.suggestions)) {
                  setSuggestions(data.suggestions as string[])
                }
                setIsStreaming(false)
                setToolStatus(null)
                streamingMessageIdRef.current = null
                break
              }
            }
          }
        }

        // Ensure streaming state is cleared
        if (streamingMessageIdRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMessageIdRef.current
                ? { ...m, isStreaming: false }
                : m
            )
          )
          setIsStreaming(false)
          setToolStatus(null)
          streamingMessageIdRef.current = null
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        const errorMessage = err instanceof Error ? err.message : 'Connection failed'
        setError(errorMessage)
        setMessages((prev) =>
          prev.filter((m) => m.id !== streamingMessageIdRef.current)
        )
        setIsStreaming(false)
        setToolStatus(null)
        streamingMessageIdRef.current = null
      }
    },
    [isStreaming, conversationId, customerId]
  )

  return {
    messages,
    isStreaming,
    toolStatus,
    error,
    conversationId,
    customerId,
    sendMessage,
    sendAction,
    suggestions,
  }
}
