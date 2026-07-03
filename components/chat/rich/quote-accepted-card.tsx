'use client'

import { CalendarCheck } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'

/**
 * Consumer for accept_quote's show_quote_accepted uiAction (D2.5, M9): the
 * quote is accepted and the payment schedule exists — the POLICY is issued
 * at the first successful payment, so no confetti here, just the first
 * installment the customer is about to pay.
 */

interface QuoteAcceptedCardProps {
  quoteId: string
  paymentOption: string
  firstInstallment: { amountMinor: number; dueAt: string }
  language: Language
}

const FREQ_LABEL: Record<string, { ro: string; en: string }> = {
  annual: { ro: 'anuală', en: 'annual' },
  semi_annual: { ro: 'semestrială', en: 'semi-annual' },
  quarterly: { ro: 'trimestrială', en: 'quarterly' },
}

export function QuoteAcceptedCard({ paymentOption, firstInstallment, language }: QuoteAcceptedCardProps) {
  const amount = (firstInstallment.amountMinor / 100).toLocaleString(language === 'ro' ? 'ro-RO' : 'en-US', { minimumFractionDigits: 2 })
  const freq = FREQ_LABEL[paymentOption]?.[language === 'ro' ? 'ro' : 'en'] ?? paymentOption
  return (
    <div className="bg-forest/5 border border-sage rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <CalendarCheck className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-night leading-[1.5]">
            {language === 'ro' ? 'Ofertă acceptată' : 'Quote accepted'}
          </p>
          <p className="text-[14px] text-night/70 leading-[1.5] mt-1">
            {language === 'ro'
              ? `Plată ${freq} — prima rată: ${amount} RON. Polița se emite la prima plată reușită.`
              : `${freq.charAt(0).toUpperCase() + freq.slice(1)} payment — first installment: ${amount} RON. The policy is issued at the first successful payment.`}
          </p>
        </div>
      </div>
    </div>
  )
}
