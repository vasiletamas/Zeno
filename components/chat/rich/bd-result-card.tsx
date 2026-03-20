'use client'

import { Check } from 'lucide-react'
import { t, type Language } from '@/lib/i18n/translations'

interface BdResultCardProps {
  eligible: boolean
  message: { en: string; ro: string }
  onContinue?: () => void
  onDecline?: () => void
  language: Language
  isAnswered?: boolean
}

export function BdResultCard({
  eligible,
  message,
  onContinue,
  onDecline,
  language,
  isAnswered = false,
}: BdResultCardProps) {
  const text = language === 'ro' ? message.ro : message.en

  if (eligible) {
    return (
      <div className="bg-sage/10 border border-sage rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-5 h-5 text-sage" />
          </div>
          <p className="text-[15px] text-night leading-[1.5]">{text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-linen border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <p className="text-[15px] text-night leading-[1.5]">{text}</p>

      {!isAnswered && (onContinue || onDecline) && (
        <div className="mt-5 flex items-center gap-3">
          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="
                min-h-[44px] bg-forest text-linen text-[15px] font-medium
                rounded-[10px] px-6 py-3
                hover:bg-sage transition-colors duration-200
                focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
              "
            >
              {t('bd_result_continue', language)}
            </button>
          )}
          {onDecline && (
            <button
              type="button"
              onClick={onDecline}
              className="
                min-h-[44px] text-sage text-[15px] font-medium
                bg-transparent px-4 py-3
                hover:underline transition-colors duration-200
                focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
              "
            >
              {t('bd_result_decline', language)}
            </button>
          )}
        </div>
      )}

      {isAnswered && (
        <p className="mt-3 text-xs text-muted">
          {t('bd_result_answered', language)}
        </p>
      )}
    </div>
  )
}
