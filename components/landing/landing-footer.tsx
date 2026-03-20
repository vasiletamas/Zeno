'use client'

import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

export default function LandingFooter() {
  const { lang } = useLanguage()

  return (
    <footer className="bg-night text-muted py-8">
      <div className="max-w-[640px] mx-auto px-6">
        <p className="text-sm">
          Zeno — powered by Allianz-Țiriac
        </p>
        <p className="text-xs mt-2">
          {t('footer_legal', lang)}
        </p>
        <p className="text-xs mt-1">
          {t('footer_asf', lang)}
        </p>
        <p className="text-xs mt-1">
          {t('footer_copyright', lang)}
        </p>
      </div>
    </footer>
  )
}
