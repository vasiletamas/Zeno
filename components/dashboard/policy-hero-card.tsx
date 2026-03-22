'use client'

/**
 * Policy Hero Card
 *
 * Dark card (bg-forest text-soft-white) displaying the customer's policy.
 * Shows: tier + level name, status badge, total coverage, next payment.
 * Per brand book Section 7 wireframe: dark card, status badge, coverage.
 */

import { useLanguage } from '@/lib/i18n/language-context'
import { t } from '@/lib/i18n/translations'

export interface PolicyCardData {
  id: string
  tierName: string
  levelName: string
  hasAddon: boolean
  status: 'PENDING_SUBMISSION' | 'SUBMITTED' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED'
  premiumMonthly: number
  premiumAnnual: number
  currency: string
  coverageSummary: Record<string, unknown>
  paymentFrequency: string | null
  effectiveFrom: string | null
  effectiveUntil: string | null
}

function formatCurrency(amount: number, currency: string): string {
  if (currency === 'EUR') {
    return `${amount.toLocaleString('ro-RO')} EUR`
  }
  return `${amount.toLocaleString('ro-RO')} ${currency}`
}

function getStatusConfig(
  status: PolicyCardData['status'],
  lang: 'ro' | 'en',
): { label: string; bgColor: string; textColor: string } {
  switch (status) {
    case 'ACTIVE':
      return {
        label: lang === 'ro' ? 'Activa' : 'Active',
        bgColor: '#E8F5E9',
        textColor: '#2D6B52',
      }
    case 'PENDING_SUBMISSION':
    case 'SUBMITTED':
      return {
        label: lang === 'ro' ? 'In curs de activare' : 'Pending activation',
        bgColor: '#FFF8E1',
        textColor: '#B8860B',
      }
    case 'CANCELLED':
      return {
        label: lang === 'ro' ? 'Anulata' : 'Cancelled',
        bgColor: '#FBE9E7',
        textColor: '#8B2D2D',
      }
    case 'EXPIRED':
      return {
        label: lang === 'ro' ? 'Expirata' : 'Expired',
        bgColor: '#FBE9E7',
        textColor: '#8B2D2D',
      }
  }
}

function getTotalCoverage(
  coverageSummary: Record<string, unknown>,
): string | null {
  // coverageSummary is a JSON object from the policy.
  // Try to extract a total or sum top-level numeric values.
  if (!coverageSummary || typeof coverageSummary !== 'object') return null

  const values = Object.values(coverageSummary)
  let total = 0
  let currency = 'EUR'

  for (const val of values) {
    if (typeof val === 'number') {
      total += val
    } else if (
      typeof val === 'object' &&
      val !== null &&
      'amount' in val &&
      typeof (val as Record<string, unknown>).amount === 'number'
    ) {
      total += (val as { amount: number }).amount
      if ('currency' in val && typeof (val as Record<string, unknown>).currency === 'string') {
        currency = (val as { currency: string }).currency
      }
    }
  }

  if (total === 0) return null
  return formatCurrency(total, currency)
}

export default function PolicyHeroCard({
  policy,
}: {
  policy: PolicyCardData
}) {
  const { lang } = useLanguage()
  const statusConfig = getStatusConfig(policy.status, lang)
  const totalCoverage = getTotalCoverage(
    policy.coverageSummary as Record<string, unknown>,
  )

  const isPending =
    policy.status === 'PENDING_SUBMISSION' || policy.status === 'SUBMITTED'

  return (
    <div className="rounded-xl bg-forest p-6 text-soft-white">
      {/* Header: tier + status */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-soft-white/70">
            {t('dashboard_your_policy', lang)}
          </p>
          <h2 className="mt-1 text-xl font-medium">
            {policy.tierName} {policy.levelName}
            {policy.hasAddon ? ' + BD' : ''}
          </h2>
        </div>

        <span
          className="inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-xs font-medium"
          style={{
            backgroundColor: statusConfig.bgColor,
            color: statusConfig.textColor,
          }}
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Coverage */}
      {totalCoverage && (
        <div className="mt-5">
          <p className="text-sm text-soft-white/70">
            {t('dashboard_total_coverage', lang)}
          </p>
          <p className="mt-0.5 text-2xl font-medium">{totalCoverage}</p>
        </div>
      )}

      {/* Next payment */}
      <div className="mt-5 flex items-center justify-between border-t border-soft-white/20 pt-4">
        <div>
          <p className="text-sm text-soft-white/70">
            {t('dashboard_next_payment', lang)}
          </p>
          <p className="mt-0.5 text-lg font-medium">
            {formatCurrency(policy.premiumMonthly, 'RON')}/
            {lang === 'ro' ? 'luna' : 'month'}
          </p>
        </div>
      </div>

      {/* Pending message */}
      {isPending && (
        <p className="mt-4 text-sm text-soft-white/70">
          {t('policy_pending', lang)}
        </p>
      )}
    </div>
  )
}
