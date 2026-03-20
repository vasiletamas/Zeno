'use client'

import { Shield, Globe, Check } from 'lucide-react'
import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

const benefits = [
  { icon: Shield, titleKey: 'benefit_1_title', descKey: 'benefit_1_desc' },
  { icon: Globe, titleKey: 'benefit_2_title', descKey: 'benefit_2_desc' },
  { icon: Check, titleKey: 'benefit_3_title', descKey: 'benefit_3_desc' },
] as const

export default function BenefitsSection() {
  const { lang } = useLanguage()

  return (
    <section className="max-w-[640px] mx-auto px-6 py-12">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {benefits.map((benefit) => {
          const Icon = benefit.icon
          return (
            <div
              key={benefit.titleKey}
              className="bg-soft-white border border-warm-border rounded-xl p-5"
            >
              <Icon className="text-forest w-6 h-6 mb-3" />
              <h3 className="text-base font-medium text-night">
                {t(benefit.titleKey, lang)}
              </h3>
              <p className="text-sm text-muted mt-1">
                {t(benefit.descKey, lang)}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
