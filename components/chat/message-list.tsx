'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { ChatMessage, UIAction } from '@/lib/hooks/use-chat'
import type { Language } from '@/lib/i18n/translations'
import { cardKeyForUiAction, cardView, type ActiveCardEntry } from '@/lib/chat/card-view'
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
  /** Transcript anchors: which card renders at which message (presentation
   *  only — interactivity comes from cardsState, spec 2026-07-20 §2). */
  uiActions?: Map<string, { type: string; payload: Record<string, unknown> }>
  /** The server-derived active card set — the ONLY card-truth source. */
  cardsState?: ActiveCardEntry[]
  /** Semantic key of the card whose submit is in flight. */
  submittingKey?: string | null
  onAction?: (action: UIAction) => void
  /** P1-12: resend the message whose turn aborted */
  onRetry?: () => void
  language?: Language
}

/**
 * Reload parity for ALL input cards (plan 2026-07-20 Step 12.1): active-set
 * entries carrying a renderable uiAction whose key no transcript message
 * anchors render here, after the last message. Deferred entries are facts
 * for the agent, not cards for the customer.
 */
function PendingCardsBlock({
  cards,
  renderedKeys,
  submittingKey,
  onAction,
  isStreaming,
  language,
}: {
  cards: ActiveCardEntry[]
  renderedKeys: Set<string>
  submittingKey: string | null
  onAction: (action: UIAction) => void
  isStreaming: boolean
  language: Language
}) {
  const pending = cards.filter(
    (c) => c.status !== 'deferred' && c.uiAction && !renderedKeys.has(c.key),
  )
  if (pending.length === 0) return null
  return (
    <>
      {pending.map((c) => {
        const view = cardView(c.key, cards, submittingKey)
        return (
          <div key={c.key}>
            <RichContent
              action={c.uiAction as { type: string; payload: Record<string, unknown> }}
              onAction={onAction}
              language={language}
              isAnswered={view.status !== 'interactive'}
              isLoading={isStreaming}
              viewStatus={view.status}
            />
          </div>
        )
      })}
    </>
  )
}

export function MessageList({
  messages,
  isStreaming,
  typingStatus,
  error,
  uiActions,
  cardsState,
  submittingKey = null,
  onAction,
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
          const cards = cardsState ?? []
          // Keyed INPUT cards (data_field/otp/question) render from the
          // derived card state — position is presentation only (spec
          // 2026-07-20 §2). Presentation cards (key === null: products,
          // quotes, reviews, confirms) keep the legacy newest-wins rule: a
          // superseded card acting on old state is how a "Da" on the health
          // question got recorded against the cancer question (2026-07-06).
          const lastActionableId = [...messages].reverse().find(
            (m) => m.role === 'assistant' && uiActions?.has(m.id),
          )?.id
          // Keys already anchored by a transcript message — PendingCardsBlock
          // renders only the derived-set remainder (reload parity).
          const renderedKeys = new Set<string>()
          for (const m of messages) {
            if (m.role !== 'assistant') continue
            const a = uiActions?.get(m.id)
            if (!a) continue
            const k = cardKeyForUiAction(a)
            if (k) renderedKeys.add(k)
          }
          return (
            <>
              {messages.map((message) => {
                if (message.role === 'user' || message.role === 'assistant') {
                  const actionData = message.role === 'assistant' ? uiActions?.get(message.id) : undefined
                  const key = actionData ? cardKeyForUiAction(actionData) : null
                  const view = key !== null ? cardView(key, cards, submittingKey) : null
                  return (
                    <div key={message.id}>
                      <MessageBubble
                        role={message.role}
                        content={message.content}
                        isStreaming={message.isStreaming}
                        language={language === 'en' ? 'en' : 'ro'}
                      />
                      {actionData && onAction && (
                        <RichContent
                          action={actionData}
                          onAction={onAction}
                          language={language}
                          isAnswered={view ? view.status !== 'interactive' : message.id !== lastActionableId}
                          isLoading={isStreaming}
                          viewStatus={view?.status}
                        />
                      )}
                    </div>
                  )
                }
                return null
              })}
              {onAction && (
                <PendingCardsBlock
                  cards={cards}
                  renderedKeys={renderedKeys}
                  submittingKey={submittingKey}
                  onAction={onAction}
                  isStreaming={isStreaming}
                  language={language}
                />
              )}
            </>
          )
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
