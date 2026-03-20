'use client'

import type { Language } from '@/lib/i18n/translations'
import { ProductCard } from './product-card'
import { QuoteCard } from './quote-card'
import { QuestionCard } from './question-card'
import { BdResultCard } from './bd-result-card'
import { PolicyIssuedCard } from './policy-issued-card'
import { InlineDataForm } from './inline-data-form'

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
            onAction({ type: 'accept_quote', payload: { confirmAcceptance: true } })
          }
          onModify={() => onAction({ type: 'modify_quote', payload: {} })}
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

    /* ── Policy issued ────────────────────────────── */
    case 'show_policy_issued': {
      return (
        <PolicyIssuedCard
          tierName={p.tierName as LocalizedString}
          levelName={p.levelName as LocalizedString}
          includesAddon={p.includesAddon as boolean}
          premiumMonthly={p.premiumMonthly as number}
          totalCoverage={p.totalCoverage as string}
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

    /* ── Unknown types → null (forward compatible) ── */
    default:
      return null
  }
}
