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
import { DocumentUploadCard } from './document-upload-card'
import { OtpEntryCard } from './otp-entry-card'
import { DntReviewCard } from './dnt-review-card'
import { MedicalReviewCard } from './medical-review-card'
import { MedicalBatchCard } from './medical-batch-card'
import { AcceptanceCard } from './acceptance-card'
import { UnknownActionCard } from './unknown-action-card'

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
  // T15: quote-card rows carry unit/caps/franchise (product cards ignore them)
  unit?: 'per_day' | 'lump_sum'
  maxUnits?: number
  deductibleDays?: number
  capPeriod?: 'per_year' | 'per_event'
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

  // The case list below is mirrored by RENDERED_UI_ACTION_TYPES in
  // lib/chat/ui-action-registry.ts — the parity test
  // (__tests__/lib/chat/ui-action-parity.test.ts) scans this file's `case`
  // literals, so adding/removing a case without updating the registry fails.
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

    /* ── Question card (application questionnaire AND DNT — Task 2.1/D1:
          groupType 'dnt' routes the tap to gui-actor write_dnt_answer) ── */
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
                // C1.9: the code ADDRESSES the commit — without it a click on
                // a stale card writes to whatever question is current
                // (2026-07-06: a "Da" on the health card was recorded against
                // BD_CANCER_HISTORY). With it, the handler's mismatch guard
                // rejects stale clicks precisely.
                questionCode: question.code,
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
            // T23: the primary button OPENS the acceptance card (doc links +
            // ack checkbox + frequency comparison + gated Accept) via the
            // get_acceptance_bundle read — the hard-coded annual accept is
            // dead; the paymentOption is elected ON that card.
            onAction({ type: 'open_acceptance', payload: {} })
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
          mode={(p.mode as 'started' | 'resumed' | 'retried' | undefined) ?? 'started'}
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

    /* ── Secure document upload (T29, Stripe-card pattern T14.D5) ── */
    case 'show_document_upload': {
      return (
        <DocumentUploadCard
          kind={p.kind as string}
          uploadUrl={p.uploadUrl as string}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── DNT review/sign (T7 clauses 5-6: completion auto-emits this card;
          the Sign click behind the two unchecked consents is the ONLY
          confirmation — gui commits are confirmed by construction) ── */
    case 'show_dnt_review': {
      return (
        <DntReviewCard
          sessionId={p.sessionId as string}
          answers={p.answers as { code: string | null; question: LocalizedString; value: string; valueLabel: LocalizedString | null }[]}
          progress={p.progress as { answered: number; total: number }}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Medical declarations review/sign (T11 clauses 5-6: the completing
          write_question_answer auto-emits this card; the Sign click is the
          ONLY affirmation — no checkboxes, consents were captured at DNT) ── */
    case 'show_medical_review': {
      return (
        <MedicalReviewCard
          applicationId={p.applicationId as string}
          declarations={p.declarations as { code: string; question: LocalizedString; value: string; valueLabel: LocalizedString | null }[]}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Medical batch declarations (T10 clause: option c — the six BD
          conditions on ONE card; "none of these apply" posts all-No in one
          write_medical_batch commit, toggles post the exceptions) ── */
    case 'show_medical_batch': {
      return (
        <MedicalBatchCard
          applicationId={p.applicationId as string}
          conditions={p.conditions as { code: string; question: LocalizedString; value: 'true' | 'false' | null }[]}
          progress={p.progress as { answered: number; total: number }}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Acceptance card (T23: doc links + ack checkbox + frequency
          comparison + Accept gated on both; the QuoteCard's primary button
          opens it via the get_acceptance_bundle read) ── */
    case 'show_acceptance': {
      return (
        <AcceptanceCard
          quoteId={p.quoteId as string}
          tierName={p.tierName as LocalizedString | null}
          levelName={p.levelName as LocalizedString | null}
          includesAddon={(p.includesAddon as boolean | undefined) ?? false}
          premium={p.premium as { annual: number; semiAnnual: number | null; quarterly: number | null; currency: string }}
          offeredOptions={((p.frequencies ?? []) as { option: string }[]).map((f) => f.option)}
          documents={(p.documents ?? []) as { id: string; kind: string; title: LocalizedString; url: string }[]}
          disclosuresAcked={(p.disclosuresAcked as boolean | undefined) ?? false}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── OTP entry (T29 — channel verification challenge) ── */
    case 'show_otp_entry': {
      return (
        <OtpEntryCard
          channel={p.channel as string}
          targetMasked={p.targetMasked as string | undefined}
          target={p.target as string | undefined}
          onAction={onAction}
          language={language}
          isAnswered={isAnswered}
          isLoading={isLoading}
        />
      )
    }

    /* ── Unknown types → VISIBLE fallback (T29: the silent null dropped
          show_document_upload/show_otp_entry while the agent pointed the
          customer at the control) ── */
    default:
      return <UnknownActionCard type={action.type} language={language} />
  }
}
