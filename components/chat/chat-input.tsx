'use client'

import { useState, useCallback, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder = 'Scrie un mesaj...' }: ChatInputProps) {
  const [value, setValue] = useState('')

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="flex-shrink-0 bg-soft-white border-t border-warm-border px-4 py-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="
            flex-1 bg-soft-white border border-warm-border rounded-[10px]
            px-4 py-3 text-[15px] text-night font-sans
            placeholder:text-muted
            focus:outline-none focus:border-sage focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
            disabled:opacity-50
            transition-[border-color,box-shadow] duration-150
          "
          aria-label="Message input"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="
            bg-forest rounded-full w-10 h-10 flex items-center justify-center
            flex-shrink-0
            hover:bg-sage transition-colors duration-150
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          "
          aria-label="Send message"
        >
          <ArrowUp className="w-5 h-5 text-linen" />
        </button>
      </div>
    </div>
  )
}
