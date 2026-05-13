'use client'

import { Check, Loader2 } from 'lucide-react'
import { t, type Language } from '@/lib/i18n/translations'

interface ProductCardProps {
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  tierCode: string
  levelCode: string
  premiumMonthly: number
  premiumAnnual: number
  coverages: {
    name: { en: string; ro: string }
    amount: number
    currency: string
    amountRange?: { min: number; max: number }
  }[]
  isRecommended: boolean
  onSelect: () => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

function formatAmount(amount: number, currency: string): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M ${currency}`
  }
  return `${amount.toLocaleString('ro-RO')} ${currency}`
}

export function ProductCard({
  tierName,
  levelName,
  tierCode,
  levelCode,
  premiumMonthly,
  premiumAnnual,
  coverages,
  isRecommended,
  onSelect,
  language,
  isAnswered = false,
  isLoading = false,
}: ProductCardProps) {
  const name = language === 'ro' ? tierName.ro : tierName.en
  const level = language === 'ro' ? levelName.ro : levelName.en
  const btnLabel = t('product_card_select', language)

  return (
    <div
      className={`
        bg-soft-white border rounded-xl p-5 animate-[message-appear_300ms_ease-out]
        transition-[border-color] duration-150
        ${isAnswered ? 'border-forest border-2' : 'border-warm-border'}
      `}
      data-tier={tierCode}
      data-level={levelCode}
    >
      {/* Recommended badge */}
      {isRecommended && (
        <div className="flex justify-end mb-3">
          <span className="bg-sand text-night text-[11px] font-medium uppercase tracking-[0.5px] px-2.5 py-1 rounded-md">
            {t('product_card_recommended', language)}
          </span>
        </div>
      )}

      {/* Tier & level name */}
      <h3 className="text-[16px] font-medium text-night">{name}</h3>
      <p className="text-[13px] text-muted mt-0.5">{level}</p>

      {/* Price */}
      <div className="mt-4">
        <span className="text-[28px] font-medium text-night">
          {premiumMonthly} lei
        </span>
        <span className="text-[14px] text-muted ml-1">
          /{language === 'ro' ? 'luna' : 'month'}
        </span>
      </div>
      <p className="text-xs text-muted">
        {premiumAnnual} RON/{language === 'ro' ? 'an' : 'year'}
      </p>

      {/* Coverages */}
      <ul className="mt-4 space-y-2">
        {coverages.map((cov, idx) => {
          const covName = language === 'ro' ? cov.name.ro : cov.name.en
          const amountText = cov.amountRange
            ? `${formatAmount(cov.amountRange.min, cov.currency)} – ${formatAmount(cov.amountRange.max, cov.currency)} ${language === 'ro' ? '(în funcție de vârstă)' : '(depending on age)'}`
            : formatAmount(cov.amount, cov.currency)
          return (
            <li key={idx} className="flex items-start gap-2 text-[13px] text-night">
              <Check className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
              <span>
                {covName}: {amountText}
              </span>
            </li>
          )
        })}
      </ul>

      {/* Select button */}
      <button
        type="button"
        onClick={onSelect}
        disabled={isAnswered || isLoading}
        className="
          mt-5 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
          rounded-[10px] px-6 py-3
          hover:bg-sage transition-colors duration-200
          disabled:opacity-50 disabled:pointer-events-none
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          flex items-center justify-center gap-2
        "
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-linen" />
        ) : (
          btnLabel
        )}
      </button>
    </div>
  )
}
