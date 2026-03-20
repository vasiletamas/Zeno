'use client'

import { useLanguage } from '@/lib/i18n/language-context'

export default function LandingHeader() {
  const { lang, toggleLanguage } = useLanguage()

  return (
    <header className="flex justify-between items-center px-6 py-4 max-w-[640px] mx-auto">
      <span className="font-display text-2xl font-medium text-forest tracking-tight">
        Zeno
      </span>
      <button
        onClick={toggleLanguage}
        className="text-[13px] font-medium min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={lang === 'ro' ? 'Switch to English' : 'Schimbă în română'}
      >
        <span className={lang === 'ro' ? 'text-forest' : 'text-muted'}>
          RO
        </span>
        <span className="text-muted mx-1">|</span>
        <span className={lang === 'en' ? 'text-forest' : 'text-muted'}>
          EN
        </span>
      </button>
    </header>
  )
}
