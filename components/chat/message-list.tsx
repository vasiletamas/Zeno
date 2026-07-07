'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { ChatMessage, UIAction } from '@/lib/hooks/use-chat'
import type { Language } from '@/lib/i18n/translations'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'
import { ErrorMessage } from './error-message'
import { ScrollToBottom } from './scroll-to-bottom'
import { RichContent } from './rich/rich-content'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  typingStatus: string | null
  error: string | null
  uiActions?: Map<string, { type: string; payload: Record<string, unknown> }>
  answeredMessageIds?: Set<string>
  onAction?: (action: UIAction) => void
  markAnswered?: (messageId: string) => void
  /** P1-12: resend the message whose turn aborted */
  onRetry?: () => void
  language?: Language
}

export function MessageList({
  messages,
  isStreaming,
  typingStatus,
  error,
  uiActions,
  answeredMessageIds,
  onAction,
  markAnswered,
  onRetry,
  language = 'ro',
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  // Check if user is near bottom
  const isNearBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return true
    const threshold = 100
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom()
    setAutoScroll(nearBottom)
    setShowScrollButton(!nearBottom)
  }, [isNearBottom])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages, isStreaming, typingStatus, autoScroll])

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setAutoScroll(true)
      setShowScrollButton(false)
    }
  }, [])

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-3 space-y-3"
        role="log"
        aria-live="polite"
      >
        {(() => {
          // Only the NEWEST card stays interactive: a superseded card acting
          // on old state is how a "Da" on the health question got recorded
          // against the cancer question (2026-07-06). Older cards render in
          // their answered (inert) state.
          const lastActionableId = [...messages].reverse().find(
            (m) => m.role === 'assistant' && uiActions?.has(m.id),
          )?.id
          return messages.map((message) => {
            if (message.role === 'user' || message.role === 'assistant') {
              const actionData = message.role === 'assistant' ? uiActions?.get(message.id) : undefined
              return (
                <div key={message.id}>
                  <MessageBubble
                    role={message.role}
                    content={message.content}
                    isStreaming={message.isStreaming}
                  />
                  {actionData && onAction && (
                    <RichContent
                      action={actionData}
                      onAction={(action) => {
                        onAction(action)
                        markAnswered?.(message.id)
                      }}
                      language={language}
                      isAnswered={(answeredMessageIds?.has(message.id) ?? false) || message.id !== lastActionableId}
                      isLoading={isStreaming}
                    />
                  )}
                </div>
              )
            }
            return null
          })
        })()}

        {error && <ErrorMessage message={error} onRetry={onRetry} language={language === 'en' ? 'en' : 'ro'} />}

        <TypingIndicator
          visible={isStreaming && !messages.some((m) => m.isStreaming)}
          statusMessage={typingStatus}
        />

        {/* Also show typing indicator when we have a streaming message but with tool status */}
        {typingStatus && messages.some((m) => m.isStreaming) && (
          <TypingIndicator visible={true} statusMessage={typingStatus} />
        )}
      </div>

      <ScrollToBottom visible={showScrollButton} onClick={scrollToBottom} />
    </div>
  )
}
