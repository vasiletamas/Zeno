'use client'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const isUser = role === 'user'

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[message-appear_200ms_ease-out]`}
    >
      <div
        className={`
          max-w-[85%] px-4 py-3 text-[15px] leading-[1.5] font-sans
          ${isUser
            ? 'bg-forest text-soft-white rounded-2xl rounded-br-sm'
            : 'bg-linen text-night rounded-2xl rounded-bl-sm'
          }
        `}
      >
        <span className="whitespace-pre-wrap break-words">{content}</span>
        {isStreaming && (
          <span className="inline-block ml-0.5 animate-[typing-pulse_1s_ease-in-out_infinite]">
            &#9610;
          </span>
        )}
      </div>
    </div>
  )
}
