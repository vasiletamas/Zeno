'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { ChatMessage } from '@/lib/hooks/use-chat'
import { MessageBubble } from './message-bubble'
import { TypingIndicator } from './typing-indicator'
import { ErrorMessage } from './error-message'
import { ScrollToBottom } from './scroll-to-bottom'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  typingStatus: string | null
  error: string | null
}

export function MessageList({ messages, isStreaming, typingStatus, error }: MessageListProps) {
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
        {messages.map((message) => {
          if (message.role === 'user' || message.role === 'assistant') {
            return (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                isStreaming={message.isStreaming}
              />
            )
          }
          return null
        })}

        {error && <ErrorMessage message={error} />}

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
