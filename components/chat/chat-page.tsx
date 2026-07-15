'use client'

import { useEffect, useState } from 'react'
import { useChat, type ChatMessage } from '@/lib/hooks/use-chat'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'
import { ChatHeader } from './chat-header'
import { MessageList } from './message-list'
import { SuggestionPills } from './suggestion-pills'
import { ChatInput } from './chat-input'
import { useDebug } from '@/components/debug/debug-provider'
import type { DebugTurn } from '@/lib/debug/reducer'
import { DebugToggle } from '@/components/debug/debug-toggle'
import { DebugDrawer } from '@/components/debug/debug-drawer'

interface ChatPageProps {
  conversationId: string
  customerId: string
  initialMessages: ChatMessage[]
  language: 'ro' | 'en'
}

export default function ChatPage({
  conversationId,
  customerId,
  initialMessages,
}: ChatPageProps) {
  const { lang } = useLanguage()
  const debug = useDebug()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const {
    messages,
    isStreaming,
    toolStatus,
    error,
    sendMessage,
    sendAction,
    retryLastMessage,
    suggestions,
    uiActions,
    answeredMessageIds,
    markAnswered,
  } = useChat(conversationId, customerId, {
    initialMessages,
    onDebugEvent: debug.onDebugEvent,
    extraHeaders: debug.extraHeaders,
  })

  // Replay this conversation's persisted debug turns into the panel on load
  // (and whenever debug is toggled on), so a refresh doesn't lose history.
  useEffect(() => {
    if (!debug.enabled || !conversationId) return
    let cancelled = false
    fetch(`/api/conversations/${conversationId}/debug`)
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((body: { turns: DebugTurn[] }) => {
        if (!cancelled) debug.hydrate(body.turns)
      })
      .catch(() => {
        /* dev-only convenience; ignore fetch failures */
      })
    return () => {
      cancelled = true
    }
  }, [conversationId, debug.enabled, debug.hydrate])

  const handleSuggestionSelect = (text: string) => {
    sendMessage(text)
  }

  return (
    <>
      <div className="h-dvh flex flex-col bg-soft-white max-w-[640px] mx-auto w-full">
        <ChatHeader />

        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          typingStatus={toolStatus?.message ?? null}
          error={error}
          uiActions={uiActions}
          answeredMessageIds={answeredMessageIds}
          onAction={sendAction}
          markAnswered={markAnswered}
          onRetry={retryLastMessage}
          language={lang}
        />

        {suggestions.length > 0 && (
          <SuggestionPills
            suggestions={suggestions}
            onSelect={handleSuggestionSelect}
            disabled={isStreaming}
          />
        )}

        <ChatInput
          onSend={sendMessage}
          disabled={isStreaming}
          placeholder={t('chat_placeholder', lang)}
        />
      </div>
      <DebugToggle open={drawerOpen} onOpenChange={setDrawerOpen} />
      <DebugDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  )
}
