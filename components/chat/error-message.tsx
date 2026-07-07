'use client'

import { AlertCircle, RotateCcw } from 'lucide-react'

interface ErrorMessageProps {
  message: string
  /** P1-12: aborted turns are retryable — the button resends the failed message */
  onRetry?: () => void
  language?: 'en' | 'ro'
}

export function ErrorMessage({ message, onRetry, language = 'ro' }: ErrorMessageProps) {
  return (
    <div className="flex justify-start animate-[message-appear_200ms_ease-out]">
      <div className="bg-linen text-error rounded-2xl px-4 py-3 flex items-start gap-2 max-w-[85%]">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="flex flex-col gap-2">
          <span className="text-[15px] leading-[1.5] font-sans">{message}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="self-start inline-flex items-center gap-1.5 text-[14px] font-medium text-error underline underline-offset-2 hover:opacity-80"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {language === 'ro' ? 'Reîncearcă' : 'Retry'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
