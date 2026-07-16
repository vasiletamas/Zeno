'use client'

import { Check, Loader2 } from 'lucide-react'
import { t, type Language } from '@/lib/i18n/translations'
import { formatCoverage, type FormattableCoverage } from '@/lib/products/coverage-format'

// T15: coverage rows carry every qualifier the catalog has (unit, caps,
// franchise) — formatCoverage renders them; the name stays local.
interface Coverage extends FormattableCoverage {
  name: { en: string; ro: string }
}

interface QuoteCardProps {
  quoteId: string
  tierName: { en: string; ro: string }
  levelName: { en: string; ro: string }
  includesAddon: boolean
  premiumAnnual: number
  premiumMonthly: number
  baseCoverages: Coverage[]
  addonCoverages: Coverage[]
  validUntil: string
  onAccept: () => void
  onModify: () => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

function formatDateRo(isoDate: string): string {
  const date = new Date(isoDate)
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

export function QuoteCard({
  quoteId,
  tierName,
  levelName,
  includesAddon,
  premiumAnnual,
  premiumMonthly,
  baseCoverages,
  addonCoverages,
  validUntil,
  onAccept,
  onModify,
  language,
  isAnswered = false,
  isLoading = false,
}: QuoteCardProps) {
  const name = language === 'ro' ? tierName.ro : tierName.en
  const level = language === 'ro' ? levelName.ro : levelName.en
  const allCoverages = [...baseCoverages, ...addonCoverages]

  return (
    <div
      className={`
        bg-soft-white border rounded-xl p-5 animate-[message-appear_300ms_ease-out]
        ${isAnswered ? 'border-forest border-2' : 'border-warm-border'}
      `}
      data-quote-id={quoteId}
    >
      {/* Header */}
      <h3 className="text-[18px] font-medium text-night">
        {t('quote_card_title', language)}
      </h3>

      {/* Tier summary */}
      <p className="text-[14px] text-night mt-2">
        {name} {level}
        {includesAddon ? ' + BD' : ''}
      </p>

      {/* Price */}
      <div className="mt-4">
        <span className="text-[28px] font-medium text-forest">
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
      <div className="mt-4">
        <p className="text-[13px] font-medium text-night mb-2">
          {t('quote_card_coverages', language)}
        </p>
        <ul className="space-y-2">
          {allCoverages.map((cov, idx) => {
            const covName = language === 'ro' ? cov.name.ro : cov.name.en
            return (
              <li key={idx} className="flex items-start gap-2 text-[13px] text-night">
                <Check className="w-4 h-4 text-sage flex-shrink-0 mt-0.5" />
                <span>
                  {covName}: {formatCoverage(cov, language)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Valid until */}
      <p className="text-xs text-muted mt-4">
        {t('quote_card_valid_until', language)} {formatDateRo(validUntil)}
      </p>

      {/* Actions */}
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={isAnswered || isLoading}
          className="
            flex-1 min-h-[44px] bg-forest text-linen text-[15px] font-medium
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
            t('quote_card_accept', language)
          )}
        </button>
        <button
          type="button"
          onClick={onModify}
          disabled={isAnswered || isLoading}
          className="
            flex-1 min-h-[44px] bg-transparent text-forest text-[15px] font-medium
            border border-warm-border rounded-[10px] px-6 py-3
            hover:bg-linen transition-colors duration-200
            disabled:opacity-50 disabled:pointer-events-none
            focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          "
        >
          {t('quote_card_modify', language)}
        </button>
      </div>
    </div>
  )
}
