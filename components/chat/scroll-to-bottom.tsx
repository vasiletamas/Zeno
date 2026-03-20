'use client'

import { ChevronDown } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

interface ScrollToBottomProps {
  visible: boolean
  onClick: () => void
}

export function ScrollToBottom({ visible, onClick }: ScrollToBottomProps) {
  const { lang } = useLanguage()

  return (
    <div
      className={`
        absolute bottom-2 left-1/2 -translate-x-1/2 z-10
        transition-opacity duration-150
        ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      `}
    >
      <button
        type="button"
        onClick={onClick}
        className="
          bg-soft-white border border-warm-border rounded-[20px]
          px-3 py-1.5 shadow-sm
          flex items-center gap-1
          text-[12px] text-night font-sans
          hover:bg-linen transition-colors duration-150
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
        "
        aria-label={t('chat_new_messages', lang)}
      >
        <ChevronDown className="w-4 h-4" />
        <span>{t('chat_new_messages', lang)}</span>
      </button>
    </div>
  )
}
