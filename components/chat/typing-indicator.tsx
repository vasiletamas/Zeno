'use client'

interface TypingIndicatorProps {
  statusMessage?: string | null
  visible: boolean
}

export function TypingIndicator({ statusMessage, visible }: TypingIndicatorProps) {
  if (!visible) return null

  return (
    <div className="flex justify-start animate-[message-appear_200ms_ease-out]">
      <div className="bg-linen rounded-2xl rounded-bl-sm px-4 py-3 relative min-h-[40px] flex items-center">
        {/* Dots state */}
        <div
          className={`flex items-center gap-1.5 transition-opacity duration-150 ${statusMessage ? 'opacity-0 absolute' : 'opacity-100'}`}
          aria-label="Zeno is typing"
          aria-live="polite"
        >
          <span
            className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="w-2 h-2 rounded-full bg-forest animate-[typing-pulse_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: '300ms' }}
          />
        </div>

        {/* Status message state */}
        <div
          className={`text-[13px] text-muted font-sans transition-opacity duration-150 ${statusMessage ? 'opacity-100' : 'opacity-0 absolute'}`}
          aria-live="polite"
        >
          {statusMessage}
        </div>
      </div>
    </div>
  )
}
