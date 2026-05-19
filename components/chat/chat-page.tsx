'use client'

import { useState } from 'react'
import { useChat, type ChatMessage } from '@/lib/hooks/use-chat'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'
import { ChatHeader } from './chat-header'
import { MessageList } from './message-list'
import { SuggestionPills } from './suggestion-pills'
import { ChatInput } from './chat-input'
import { useDebug } from '@/components/debug/debug-provider'
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
    suggestions,
    uiActions,
    answeredMessageIds,
    markAnswered,
  } = useChat(conversationId, customerId, {
    initialMessages,
    onDebugEvent: debug.onDebugEvent,
    extraHeaders: debug.extraHeaders,
  })

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
