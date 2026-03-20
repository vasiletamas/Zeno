'use client'

import { AlertCircle } from 'lucide-react'

interface ErrorMessageProps {
  message: string
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div className="flex justify-start animate-[message-appear_200ms_ease-out]">
      <div className="bg-linen text-error rounded-2xl px-4 py-3 flex items-start gap-2 max-w-[85%]">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span className="text-[15px] leading-[1.5] font-sans">{message}</span>
      </div>
    </div>
  )
}
