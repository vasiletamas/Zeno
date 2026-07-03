'use client'

import type { Language } from '@/lib/i18n/translations'
import { ProductCard } from './product-card'
import { QuoteCard } from './quote-card'
import { QuestionCard } from './question-card'
import { BdResultCard } from './bd-result-card'
import { ConfirmRequiredCard } from './confirm-required-card'
import { QuoteAcceptedCard } from './quote-accepted-card'
import { InlineDataForm } from './inline-data-form'
import { PaymentCard } from './payment-card'

/* ── Types ────────────────────────────────────────── */

interface UIAction {
  type: string
  payload: Record<string, unknown>
}

interface RichContentProps {
  action: UIAction
  onAction: (action: UIAction) => void
  language: Language
  isAnswered: boolean
  isLoading: boolean
}

/* ── Payload type helpers ─────────────────────────── */

interface LocalizedString {
  en: string
  ro: string
}

interface CoveragePayload {
  name: LocalizedString
  amount: number
  currency: string
  amountRange?: { min: number; max: number }
}

interface TierLevel {
  levelCode: string
  levelName: LocalizedString
  premiumAnnual: number
  premiumMonthly: number
  coverages: CoveragePayload[]
}

interface TierPayload {
  tierCode: string
  tierName: LocalizedString
  levels: TierLevel[]
  isRecommended: boolean
}

interface QuestionOptionPayload {
  value: string
  label: LocalizedString
}

interface QuestionPayload {
  id: string
  code: string | null
  text: LocalizedString
  helpText: LocalizedString | null
  type: string
  options: QuestionOptionPayload[] | null
  validationRules?: { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string } | null
}

/* ── Component ────────────────────────────────────── */

export function RichContent({
  action,
  onAction,
  language,
  isAnswered,
  isLoading,
}: RichContentProps) {
  const p = action.payload

  switch (action.type) {
    /* ── Product cards (multiple tiers) ──────────── */
    case 'show_product_cards': {
      const tiers = (p.tiers ?? []) as TierPayload[]
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tiers.flatMap((tier) =>
            tier.levels.map((level) => (
              <ProductCard
                key={`${tier.tierCode}-${level.levelCode}`}
                tierName={tier.tierName}
                levelName={level.levelName}
                tierCode={tier.tierCode}
                levelCode={level.levelCode}
                premiumMonthly={level.premiumMonthly}
                premiumAnnual={level.premiumAnnual}
                coverages={level.coverages}
                isRecommended={tier.isRecommended}
                onSelect={() =>
                  onAction({
                    type: 'select_tier',
                    payload: { tierCode: tier.tierCode, levelCode: level.levelCode },
                  })
                }
                language={language}
                isAnswered={isAnswered}
                isLoading={isLoading}
              />
            ))
          )}
        </div>
      )
    }

    /* ── Single product card ──────────────────────── */
    case 'show_product_card': {
      return (
        <ProductCard
          tierName={p.tierName as LocalizedString}
          levelName={p.levelName as LocalizedString}
          tierCode={p.tierCode as string}
          levelCode={p.levelCode as string}
          premiumMonthly={p.premiumMonthly as number}
          premiumAnnual={p.premiumAnnual as number}
          coverages={p.coverages as CoveragePayload[]}
          isRecommended={p.isRecommended as boolean}
          onSelect={() =>
            onAction({
              type: 'select_tier',
              payload: { tierCode: p.tierCode, levelCode: p.levelCode },
            })
          }
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Question card ────────────────────────────── */
    case 'show_question': {
      const question = p.question as QuestionPayload
      const progress = p.progress as { answered: number; total: number }
      const groupType = p.groupType as string

      return (
        <QuestionCard
          question={question}
          progress={progress}
          groupType={groupType}
          onAnswer={(value) =>
            onAction({
              type: 'answer_question',
              payload: {
                answer: value,
                questionId: question.id,
                groupType,
              },
            })
          }
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Gateway confirm round-trip (A3.5/M4) ─────── */
    case 'confirm_required': {
      return (
        <ConfirmRequiredCard
          tool={p.tool as string}
          confirmToken={p.confirmToken as string}
          args={(p.args ?? {}) as Record<string, unknown>}
          onConfirm={(confirmAction) => onAction(confirmAction)}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Quote card ───────────────────────────────── */
    case 'show_quote': {
      return (
        <QuoteCard
          quoteId={p.quoteId as string}
          tierName={p.tierName as LocalizedString}
          levelName={p.levelName as LocalizedString}
          includesAddon={p.includesAddon as boolean}
          premiumAnnual={p.premiumAnnual as number}
          premiumMonthly={p.premiumMonthly as number}
          baseCoverages={p.baseCoverages as CoveragePayload[]}
          addonCoverages={p.addonCoverages as CoveragePayload[]}
          validUntil={p.validUntil as string}
          onAccept={() =>
            // No self-confirm (M4/A3.5): the tokenless first click makes the
            // gateway answer requires_confirmation → confirm_required card.
            // D2.5: the GUI button elects the ANNUAL frequency shown on the
            // card (paymentOption is material); other frequencies are elected
            // through the agent, changeable via change_payment_option (D3).
            onAction({ type: 'accept_quote', payload: { paymentOption: 'annual' } })
          }
          onModify={() => onAction({ type: 'cancel_quote', payload: {} })}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── BD eligibility result ────────────────────── */
    case 'show_bd_result':
    case 'show_bd_rejected': {
      const eligible = action.type === 'show_bd_result'
      return (
        <BdResultCard
          eligible={eligible}
          message={p.message as LocalizedString}
          onContinue={
            !eligible
              ? () =>
                  onAction({
                    type: 'answer_question',
                    payload: { answer: 'continue_without_bd', groupType: 'bd_medical' },
                  })
              : undefined
          }
          onDecline={
            !eligible
              ? () =>
                  onAction({
                    type: 'answer_question',
                    payload: { answer: 'decline', groupType: 'bd_medical' },
                  })
              : undefined
          }
          language={language}
          isAnswered={isAnswered}
        />
      )
    }

    /* ── Quote accepted (D2.5 — replaces show_policy_issued at accept:
          the policy is issued at first successful payment, M9) ──────── */
    case 'show_quote_accepted': {
      return (
        <QuoteAcceptedCard
          quoteId={p.quoteId as string}
          paymentOption={p.paymentOption as string}
          firstInstallment={p.firstInstallment as { amountMinor: number; dueAt: string }}
          language={language}
        />
      )
    }

    /* ── Inline data field ────────────────────────── */
    case 'show_data_field': {
      return (
        <InlineDataForm
          field={p.field as string}
          label={p.label as LocalizedString}
          type={p.type as 'text' | 'email' | 'tel' | 'date' | 'textarea'}
          validation={
            p.validation as
              | { pattern?: string; minLength?: number; maxLength?: number }
              | undefined
          }
          placeholder={p.placeholder as LocalizedString | undefined}
          onSubmit={(value) =>
            onAction({
              type: 'submit_field',
              payload: { field: p.field, value },
            })
          }
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Payment card ────────────────────────────── */
    case 'show_payment': {
      return (
        <PaymentCard
          clientSecret={p.clientSecret as string}
          amount={p.amount as number}
          currency={p.currency as string}
          providerName={p.providerName as string}
          paymentId={p.paymentId as string}
          policyDescription={p.policyDescription as string}
          redirectUrl={p.redirectUrl as string | null | undefined}
          onPaymentComplete={(paymentId) =>
            onAction({
              type: 'payment_complete',
              payload: { paymentId },
            })
          }
          language={language}
          isAnswered={isAnswered}
        />
      )
    }

    /* ── Payment success celebration ─────────────── */
    case 'show_payment_success': {
      const policyDesc = p.policyDescription as string | undefined
      const premiumMo = p.premiumMonthly as number | undefined
      const curr = (p.currency as string) ?? 'RON'
      const dashUrl = p.dashboardUrl as string | undefined

      return (
        <div className="relative bg-forest/5 border border-sage rounded-xl p-6 animate-[message-appear_300ms_ease-out] overflow-hidden">
          {/* Success icon */}
          <div className="flex items-center gap-3 mb-3 relative z-10">
            <div className="w-10 h-10 rounded-full bg-sage flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 10.5L8 14.5L16 5.5"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h3 className="font-display text-[20px] text-night">
                {language === 'ro' ? 'Plata confirmata!' : 'Payment confirmed!'}
              </h3>
            </div>
          </div>

          {/* Details */}
          {policyDesc ? (
            <p className="text-[15px] text-night relative z-10">
              {policyDesc}
              {premiumMo ? (
                <span className="font-medium">
                  {' '}&mdash; {premiumMo} {curr}/{language === 'ro' ? 'luna' : 'month'}
                </span>
              ) : null}
            </p>
          ) : null}

          <p className="text-[14px] text-muted mt-3 relative z-10">
            {language === 'ro'
              ? 'Polita ta este in curs de activare. Vei primi un email de confirmare.'
              : 'Your policy is being activated. You will receive a confirmation email.'}
          </p>

          {/* Dashboard link */}
          {dashUrl ? (
            <a
              href={dashUrl}
              className="inline-block mt-4 px-5 py-2.5 bg-forest text-linen rounded-lg text-[14px] font-medium hover:opacity-90 transition-opacity relative z-10"
            >
              {language === 'ro' ? 'Acceseaza contul tau' : 'Access your account'}
            </a>
          ) : null}
        </div>
      )
    }

    /* ── Unknown types → null (forward compatible) ── */
    default:
      return null
  }
}
