'use client'

import { t, type Language } from '@/lib/i18n/translations'
import { Confetti } from './confetti'

interface PolicyIssuedCardProps {
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  includesAddon: boolean
  premiumMonthly: number
  totalCoverage: string
  language: Language
}

export function PolicyIssuedCard({
  tierName,
  levelName,
  includesAddon,
  premiumMonthly,
  totalCoverage,
  language,
}: PolicyIssuedCardProps) {
  const name = language === 'ro' ? tierName.ro : tierName.en
  const level = language === 'ro' ? levelName.ro : levelName.en

  return (
    <div className="relative bg-forest/5 border border-sage rounded-xl p-6 animate-[message-appear_300ms_ease-out] overflow-hidden">
      <Confetti />

      {/* Header */}
      <h3 className="font-display text-[22px] text-night relative z-10">
        {t('policy_congratulations', language)}
      </h3>
      <p className="text-[16px] text-night mt-1 relative z-10">
        {t('policy_activating', language)}
      </p>

      {/* Summary */}
      <div className="mt-4 relative z-10">
        <p className="text-[14px] font-medium text-night">
          {name} {level}
          {includesAddon ? ' + BD' : ''}
        </p>
        <p className="text-[14px] text-night mt-1">
          {t('policy_total_coverage', language)}: {totalCoverage}
        </p>
        <p className="text-[20px] font-medium text-forest mt-2">
          {premiumMonthly} lei/{language === 'ro' ? 'luna' : 'month'}
        </p>
      </div>

      {/* Confirmation note */}
      <p className="text-[14px] text-muted mt-4 relative z-10">
        {t('policy_email_confirmation', language)}
      </p>
    </div>
  )
}
