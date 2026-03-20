'use client'

interface SuggestionPillsProps {
  suggestions: string[]
  onSelect: (text: string) => void
  disabled?: boolean
}

export function SuggestionPills({ suggestions, onSelect, disabled }: SuggestionPillsProps) {
  if (suggestions.length === 0) return null

  return (
    <div
      className={`
        flex overflow-x-auto gap-2 px-4 py-2 flex-shrink-0
        animate-[message-appear_150ms_ease-out]
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          className="
            bg-soft-white border border-warm-border rounded-[20px]
            px-4 py-2 text-[13px] text-night font-sans
            whitespace-nowrap flex-shrink-0
            hover:bg-linen hover:border-sand
            transition-colors duration-150
            focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
            disabled:opacity-50 disabled:pointer-events-none
          "
        >
          {suggestion}
        </button>
      ))}
    </div>
  )
}
