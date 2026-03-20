'use client'

import Link from 'next/link'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

export default function HeroSection() {
  const { lang } = useLanguage()

  return (
    <section className="max-w-[640px] mx-auto px-6 pt-12 md:pt-16 pb-12 text-center">
      <h1 className="font-display text-[32px] md:text-[48px] font-medium leading-tight text-night">
        {t('hero_headline', lang)}
      </h1>
      <p className="mt-4 text-lg text-muted">
        {t('hero_subtitle', lang)}
      </p>
      <Link
        href="/chat"
        className="mt-8 inline-block bg-forest text-linen px-6 py-3 rounded-[10px] text-[15px] font-medium hover:bg-sage transition-colors duration-200"
      >
        {t('cta_button', lang)}
      </Link>
      <p className="mt-6 text-sm text-muted">
        {t('trust_badge', lang)}
      </p>
    </section>
  )
}
