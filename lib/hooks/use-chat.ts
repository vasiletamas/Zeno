'use client'

import { useState, useCallback, useRef } from 'react'
import { consumeSSE } from '@/lib/chat/sse-consumer'

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
  /** P1-12: resend the message whose turn aborted (no-op when none failed) */
  retryLastMessage: () => void
  suggestions: string[]
  uiActions: Map<string, { type: string; payload: Record<string, unknown> }>
  answeredMessageIds: Set<string>
  markAnswered: (messageId: string) => void
}

// ==============================================
// TURN IDENTITY
// ==============================================

// Two turns started in the same millisecond (double-Enter, a card click
// racing a send) must never share a message id: the id is how each
// invocation's closures address ONLY their own bubble.
let turnSeq = 0

export function nextTurnMessageId(role: 'user' | 'assistant'): string {
  turnSeq += 1
  return `${role}_${Date.now()}_${turnSeq}`
}

// The in-flight turn, compared by reference: an aborted turn must never
// release (or tear down) a successor's claim. `kind` lets an action click
// take over a MESSAGE stream deliberately while a second click during an
// action turn is treated as a double-click and dropped.
interface InFlightTurn {
  kind: 'message' | 'action'
}

// ==============================================
// HOOK
// ==============================================

export interface UseChatOptions {
  initialMessages?: ChatMessage[]
  /**
   * T9/T12 reload parity: the server-derived pending question card
   * (lib/chat/derive-pending-card.ts), keyed to an assistant message id from
   * initialMessages. Seeds the uiActions map so a reload mid-questionnaire
   * renders the same card the live turn emitted.
   */
  initialUiAction?: { messageId: string; action: UIAction } | null
  onDebugEvent?: (event: { event: string; data: Record<string, unknown> }) => void
  extraHeaders?: Record<string, string>
}

export function useChat(
  conversationId: string,
  customerId: string,
  options: UseChatOptions = {},
): UseChatReturn {
  const { initialMessages, initialUiAction, onDebugEvent, extraHeaders } = options
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? [])
  const [isStreaming, setIsStreaming] = useState(false)
  const [toolStatus, setToolStatus] = useState<{ tool: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  // Seeded with the server-derived pending card (reload parity, T9/T12):
  // keyed to the LAST assistant message, it is the newest entry and therefore
  // message-list's lastActionableId — it renders interactive on load.
  const [uiActions, setUiActions] = useState<Map<string, { type: string; payload: Record<string, unknown> }>>(() => {
    const seeded = new Map<string, { type: string; payload: Record<string, unknown> }>()
    if (initialUiAction) seeded.set(initialUiAction.messageId, initialUiAction.action)
    return seeded
  })
  const [answeredMessageIds, setAnsweredMessageIds] = useState<Set<string>>(new Set())

  // Synchronous concurrency guard: checked-and-set before any await. React's
  // isStreaming STATE is stale within the same tick and must only drive UI
  // (input disabling), never gate overlapping turns.
  const inFlightRef = useRef<InFlightTurn | null>(null)

  // Abort controller for cancelling requests
  const abortControllerRef = useRef<AbortController | null>(null)

  // P1-12: the last message whose turn ABORTED — the retry affordance
  // resends exactly this text
  const lastFailedMessageRef = useRef<string | null>(null)

  const markAnswered = useCallback((messageId: string) => {
    setAnsweredMessageIds((prev) => {
      const next = new Set(prev)
      next.add(messageId)
      return next
    })
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (inFlightRef.current) return
      const turn: InFlightTurn = { kind: 'message' }
      inFlightRef.current = turn
      // Only the turn that still owns the flight may touch shared state
      // (isStreaming, toolStatus, error, suggestions); a superseded turn is
      // confined to its own bubble.
      const ownsTurn = () => inFlightRef.current === turn

      // Clear previous error
      setError(null)
      setSuggestions([])

      // Optimistic user message
      const userMsg: ChatMessage = {
        id: nextTurnMessageId('user'),
        role: 'user',
        content: text,
        isStreaming: false,
        createdAt: new Date(),
      }

      // Empty assistant message for streaming
      const msgId = nextTurnMessageId('assistant')
      const assistantMsg: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // Set by the done/error handlers; a stream that ends without either
      // still finalizes below.
      let settled = false

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { ...(extraHeaders ?? {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, customerId, message: text }),
          signal: abortController.signal,
        })

        await consumeSSE(response, {
          onContent: (contentText) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, content: m.content + contentText } : m
              )
            )
          },
          onToolStart: (tool, statusMessage) => {
            if (ownsTurn()) setToolStatus({ tool, message: statusMessage })
          },
          onToolComplete: () => {
            if (ownsTurn()) setToolStatus(null)
          },
          onUiAction: (actionData) => {
            setUiActions((prev) => {
              const next = new Map(prev)
              next.set(msgId, actionData)
              return next
            })
          },
          onError: (data) => {
            settled = true
            // Remove the streaming assistant message
            setMessages((prev) => prev.filter((m) => m.id !== msgId))
            if (!ownsTurn()) return
            // P1-12: the orchestrator's abort guard sends a structured
            // payload ({ message, retryable, traceId }); transport-level
            // errors carry { error }.
            const errorMessage = (data.message as string) ?? (data.error as string) ?? 'Unknown error'
            setError(errorMessage)
            lastFailedMessageRef.current = text
            setIsStreaming(false)
            setToolStatus(null)
          },
          onDone: (data) => {
            settled = true
            // Finalize the message
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
            )
            if (!ownsTurn()) return
            // Extract suggestions if present
            if (data.suggestions && Array.isArray(data.suggestions)) {
              setSuggestions(data.suggestions as string[])
            }
            setIsStreaming(false)
            setToolStatus(null)
          },
          onDebug: (event, data) => onDebugEvent?.({ event, data }),
        })

        // Ensure streaming state is cleared even if no 'done' event
        if (!settled) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
          )
          if (ownsTurn()) {
            setIsStreaming(false)
            setToolStatus(null)
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // A successor turn took over deliberately: settle only this turn's
          // bubble (keep partial text, drop an empty shell) and leave the
          // successor's streaming state alone.
          setMessages((prev) =>
            prev
              .map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
              .filter((m) => m.id !== msgId || m.content !== '')
          )
          if (ownsTurn()) {
            setIsStreaming(false)
            setToolStatus(null)
          }
          return
        }
        const errorMessage = err instanceof Error ? err.message : 'Connection failed'
        // Remove the streaming assistant message on fetch error
        setMessages((prev) => prev.filter((m) => m.id !== msgId))
        if (ownsTurn()) {
          setError(errorMessage)
          lastFailedMessageRef.current = text // P1-12: retryable
          setIsStreaming(false)
          setToolStatus(null)
        }
      } finally {
        if (inFlightRef.current === turn) inFlightRef.current = null
      }
    },
    [conversationId, customerId, onDebugEvent, extraHeaders]
  )

  const sendAction = useCallback(
    async (action: UIAction) => {
      // An action click deliberately takes over an in-flight MESSAGE stream;
      // a second click while an ACTION turn is in flight is a double-click
      // and is dropped. The abort transfers ownership immediately — the
      // aborted turn sees it has been superseded and only settles its own
      // bubble.
      const inFlight = inFlightRef.current
      if (inFlight?.kind === 'action') return
      if (inFlight && abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const turn: InFlightTurn = { kind: 'action' }
      inFlightRef.current = turn
      const ownsTurn = () => inFlightRef.current === turn

      setError(null)
      setSuggestions([])

      const msgId = nextTurnMessageId('assistant')
      const assistantMsg: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        createdAt: new Date(),
      }

      setMessages((prev) => [...prev, assistantMsg])
      setIsStreaming(true)

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      let settled = false

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { ...(extraHeaders ?? {}), 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId, customerId, action }),
          signal: abortController.signal,
        })

        await consumeSSE(response, {
          onContent: (contentText) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId ? { ...m, content: m.content + contentText } : m
              )
            )
          },
          onToolStart: (tool, statusMessage) => {
            if (ownsTurn()) setToolStatus({ tool, message: statusMessage })
          },
          onToolComplete: () => {
            if (ownsTurn()) setToolStatus(null)
          },
          onUiAction: (actionData) => {
            setUiActions((prev) => {
              const next = new Map(prev)
              next.set(msgId, actionData)
              return next
            })
          },
          onError: (data) => {
            settled = true
            setMessages((prev) => prev.filter((m) => m.id !== msgId))
            if (!ownsTurn()) return
            setError((data.error as string) ?? 'Unknown error')
            setIsStreaming(false)
            setToolStatus(null)
          },
          onDone: (data) => {
            settled = true
            setMessages((prev) =>
              prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
            )
            if (!ownsTurn()) return
            if (data.suggestions && Array.isArray(data.suggestions)) {
              setSuggestions(data.suggestions as string[])
            }
            setIsStreaming(false)
            setToolStatus(null)
          },
          onDebug: (event, data) => onDebugEvent?.({ event, data }),
        })

        // Ensure streaming state is cleared
        if (!settled) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
          )
          if (ownsTurn()) {
            setIsStreaming(false)
            setToolStatus(null)
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setMessages((prev) =>
            prev
              .map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
              .filter((m) => m.id !== msgId || m.content !== '')
          )
          if (ownsTurn()) {
            setIsStreaming(false)
            setToolStatus(null)
          }
          return
        }
        const errorMessage = err instanceof Error ? err.message : 'Connection failed'
        setMessages((prev) => prev.filter((m) => m.id !== msgId))
        if (ownsTurn()) {
          setError(errorMessage)
          setIsStreaming(false)
          setToolStatus(null)
        }
      } finally {
        if (inFlightRef.current === turn) inFlightRef.current = null
      }
    },
    [conversationId, customerId, onDebugEvent, extraHeaders]
  )

  // P1-12: the retry affordance for an aborted turn — resends the exact
  // message whose turn died (the server saved the original user message,
  // but the reply never came; a resend is a fresh turn).
  const retryLastMessage = useCallback(() => {
    const failed = lastFailedMessageRef.current
    if (!failed || inFlightRef.current) return
    lastFailedMessageRef.current = null
    void sendMessage(failed)
  }, [sendMessage])

  return {
    messages,
    isStreaming,
    toolStatus,
    error,
    conversationId,
    customerId,
    sendMessage,
    sendAction,
    retryLastMessage,
    suggestions,
    uiActions,
    answeredMessageIds,
    markAnswered,
  }
}
