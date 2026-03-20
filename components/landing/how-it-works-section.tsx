'use client'

import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

const steps = ['how_step_1', 'how_step_2', 'how_step_3'] as const

export default function HowItWorksSection() {
  const { lang } = useLanguage()

  return (
    <section className="max-w-[640px] mx-auto px-6 py-12">
      <h2 className="text-[22px] font-medium text-night mb-6">
        {t('how_title', lang)}
      </h2>
      <ol className="space-y-4">
        {steps.map((stepKey, index) => (
          <li key={stepKey} className="text-base text-night">
            <span className="text-forest font-medium">{index + 1}.</span>{' '}
            {t(stepKey, lang)}
          </li>
        ))}
      </ol>
    </section>
  )
}
