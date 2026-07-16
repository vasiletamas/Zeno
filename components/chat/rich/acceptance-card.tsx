'use client'

import { useState } from 'react'
import { Check, FileText, Loader2 } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'
import { INSTALLMENTS_BY_FREQUENCY, type PaymentFrequency } from '@/lib/engines/payment-schedule'

/**
 * Consumer for show_acceptance (T23): the ONE acceptance card — offer recap,
 * the disclosure document links (plain anchors, new tab, so the SPA survives
 * the navigation), ONE affirmative acknowledgment checkbox that commits
 * acknowledge_disclosures on first check, and the payment-frequency
 * comparison (equal yearly totals visible) gating the Accept button.
 *
 * gui-actor commits are confirmed by construction — the checkbox click and
 * the Accept click each apply in one call, no confirmToken round-trip.
 *
 * Identity note: the card can render while identity is below
 * verified_channel — an Accept click is then rejected by the gateway
 * legality wall (requires_identity envelope) and the model narrates the gap
 * in the same turn. Acceptable: the funnel does OTP before acceptance
 * (T27/T28 own the ordering); this card gates only on ack + frequency.
 */

export interface AcceptancePremium {
  annual: number
  semiAnnual: number | null
  quarterly: number | null
  currency: string
}

export interface FrequencyRow {
  option: PaymentFrequency
  perInstallment: number
  installments: number
  totalPerYear: number
}

/**
 * The comparison rows, from the quote's PRECOMPUTED premium fields ∩ the
 * options the product offers — display math only; the actual schedule is
 * built at accept in integer minor units (lib/engines/payment-schedule).
 */
export function buildFrequencyRows(premium: AcceptancePremium, offeredOptions: string[]): FrequencyRow[] {
  const variant: Record<PaymentFrequency, number | null> = {
    annual: premium.annual,
    semi_annual: premium.semiAnnual,
    quarterly: premium.quarterly,
  }
  return (Object.keys(INSTALLMENTS_BY_FREQUENCY) as PaymentFrequency[])
    .filter((opt) => offeredOptions.includes(opt) && variant[opt] != null)
    .map((opt) => {
      const perInstallment = variant[opt]!
      const installments = INSTALLMENTS_BY_FREQUENCY[opt]
      return {
        option: opt,
        perInstallment,
        installments,
        totalPerYear: Math.round(perInstallment * installments * 100) / 100,
      }
    })
}

/**
 * The gated Accept: null until the disclosures are acknowledged (bundle-read
 * fact OR just posted from this card) AND a frequency is elected. The elected
 * paymentOption is MATERIAL — the hard-coded annual accept is dead (T23).
 */
export function buildAcceptAction(state: { acked: boolean; justAcked?: boolean; frequency: string | null }): UIAction | null {
  if (!(state.acked || state.justAcked === true) || !state.frequency) return null
  return { type: 'accept_quote', payload: { paymentOption: state.frequency } }
}

/** The ONE checkbox's commit — tokenless; one gui click applies. */
export function buildAckAction(): UIAction {
  return { type: 'acknowledge_disclosures', payload: {} }
}

const COPY = {
  title: { ro: 'Acceptarea ofertei', en: 'Accept your offer' },
  documents: { ro: 'Documentele ofertei', en: 'Offer documents' },
  ack: {
    ro: 'Confirm că am citit și înțeles IPID și Termenii și Condițiile',
    en: 'I confirm I have read and understood the IPID and the Terms and Conditions',
  },
  frequency: { ro: 'Cum vrei să plătești?', en: 'How would you like to pay?' },
  perYear: { ro: 'an', en: 'year' },
  accept: { ro: 'Acceptă oferta', en: 'Accept the offer' },
}

const FREQUENCY_LABELS: Record<PaymentFrequency, { ro: string; en: string }> = {
  annual: { ro: 'Anual', en: 'Annual' },
  semi_annual: { ro: 'Semestrial', en: 'Semi-annual' },
  quarterly: { ro: 'Trimestrial', en: 'Quarterly' },
}

interface AcceptanceDocument {
  id: string
  kind: string
  title: { en: string; ro: string }
  url: string
}

interface AcceptanceCardProps {
  quoteId: string
  tierName: { en: string; ro: string } | null
  levelName: { en: string; ro: string } | null
  includesAddon: boolean
  premium: AcceptancePremium
  offeredOptions: string[]
  documents: AcceptanceDocument[]
  disclosuresAcked: boolean
  onAction: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function AcceptanceCard({
  quoteId,
  tierName,
  levelName,
  includesAddon,
  premium,
  offeredOptions,
  documents,
  disclosuresAcked,
  onAction,
  language,
  isAnswered = false,
  isLoading = false,
}: AcceptanceCardProps) {
  // disclosuresAcked:true (post-ack bundle) renders checked+disabled; the
  // first affirmative check posts the commit and remembers it locally.
  const [justAcked, setJustAcked] = useState(false)
  const [frequency, setFrequency] = useState<string | null>(null)
  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const disabled = isAnswered || isLoading
  const checked = disclosuresAcked || justAcked
  const rows = buildFrequencyRows(premium, offeredOptions)
  const acceptAction = buildAcceptAction({ acked: disclosuresAcked, justAcked, frequency })

  const recap = [
    tierName ? `${pick(tierName)}${levelName ? ` ${pick(levelName)}` : ''}` : null,
    includesAddon ? '+ BD' : null,
  ].filter(Boolean).join(' ')

  return (
    <div
      className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]"
      data-quote-id={quoteId}
    >
      {/* Offer recap: tier/level/addon + the annual premium lead */}
      <h3 className="text-[18px] font-medium text-night">{pick(COPY.title)}</h3>
      {recap ? <p className="text-[14px] text-night mt-1">{recap}</p> : null}
      <p className="text-[13px] text-muted mt-1">
        {premium.annual} {premium.currency}/{pick(COPY.perYear)}
      </p>

      {/* Document links: plain anchors, new tab — the SPA survives */}
      <div className="mt-4">
        <p className="text-[13px] font-medium text-night mb-2">{pick(COPY.documents)}</p>
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-2 text-[13px] text-forest underline underline-offset-2 hover:opacity-80"
              >
                <FileText className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                {pick(doc.title)}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* ONE ack checkbox — UNCHECKED by design (affirmative action); the
          first check commits acknowledge_disclosures. The returning turn
          re-emits this card with disclosuresAcked:true (checked+disabled). */}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled || checked}
        onClick={() => {
          if (checked) return
          setJustAcked(true)
          onAction(buildAckAction())
        }}
        className="mt-4 w-full flex items-start gap-3 text-left rounded-lg px-1 py-2 disabled:opacity-70"
      >
        <span
          className={`
            w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0
            ${checked ? 'border-forest bg-forest' : 'border-warm-border'}
          `}
        >
          {checked && <Check className="w-3 h-3 text-linen" />}
        </span>
        <span className="text-[13px] text-night leading-[1.5]">{pick(COPY.ack)}</span>
      </button>

      {/* Frequency comparison — equal yearly totals visible on every row */}
      <div className="mt-4">
        <p className="text-[13px] font-medium text-night mb-2">{pick(COPY.frequency)}</p>
        <div role="radiogroup" className="space-y-1.5">
          {rows.map((row) => {
            const selected = frequency === row.option
            return (
              <button
                key={row.option}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => setFrequency(row.option)}
                className={`
                  w-full flex items-center gap-3 text-left rounded-lg border px-3 py-2 transition-colors duration-150
                  ${selected ? 'border-forest bg-forest/5' : 'border-warm-border bg-linen/50'}
                  disabled:opacity-50
                `}
              >
                <span
                  className={`
                    w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                    ${selected ? 'border-forest' : 'border-warm-border'}
                  `}
                >
                  {selected && <span className="w-2 h-2 rounded-full bg-forest" />}
                </span>
                <span className="text-[13px] text-night">
                  {pick(FREQUENCY_LABELS[row.option])} — {row.perInstallment} {premium.currency} ×{row.installments}{' '}
                  = {row.totalPerYear} {premium.currency}/{pick(COPY.perYear)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Accept — gated on (acked || just-posted-ack) AND a chosen frequency.
          No terminal claim text: an isAnswered card may be superseded by the
          ack re-emit, not accepted — the disabled state is the honest one
          (show_quote_accepted is the acceptance's own card). */}
      <button
        type="button"
        disabled={disabled || !acceptAction}
        onClick={() => acceptAction && onAction(acceptAction)}
        className="mt-5 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium rounded-[10px] px-6 py-3 hover:bg-sage transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
      >
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-linen" /> : pick(COPY.accept)}
      </button>
    </div>
  )
}
