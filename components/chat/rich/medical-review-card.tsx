'use client'

import { Stethoscope, Check, Loader2 } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for show_medical_review (T11, clauses 5-6 of the questionnaire UX
 * standard): the auto-emitted completion card — every pending medical
 * declaration (localized question + the customer's Da/Nu answer) plus the
 * Sign button. NO checkboxes: the consents were captured at DNT, so the
 * Sign click is the single affirmation (clause 6 — gui-actor commits are
 * confirmed by construction; the tokenless post applies in one call).
 */

export function buildSignMedicalAction(): UIAction {
  return { type: 'sign_medical_declarations', payload: {} }
}

const COPY = {
  title: { ro: 'Verifică și semnează declarațiile medicale', en: 'Review and sign your medical declarations' },
  subtitle: {
    ro: 'Răspunsurile tale medicale, pe scurt. Dacă totul este corect, semnează declarațiile.',
    en: 'Your medical answers at a glance. If everything is correct, sign the declarations.',
  },
  sign: { ro: 'Semnează declarațiile', en: 'Sign the declarations' },
  signed: { ro: 'Declarațiile medicale au fost semnate.', en: 'The medical declarations have been signed.' },
}

interface ReviewDeclaration {
  code: string
  question: { en: string; ro: string }
  value: string
  valueLabel: { en: string; ro: string } | null
}

interface MedicalReviewCardProps {
  applicationId: string
  declarations: ReviewDeclaration[]
  onAction: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function MedicalReviewCard({
  applicationId,
  declarations,
  onAction,
  language,
  isAnswered = false,
  isLoading = false,
}: MedicalReviewCardProps) {
  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const disabled = isAnswered || isLoading

  return (
    <div
      className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]"
      data-application-id={applicationId}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Stethoscope className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-night leading-[1.5]">{pick(COPY.title)}</p>
          <p className="text-[13px] text-muted leading-[1.5] mt-1">{pick(COPY.subtitle)}</p>

          {/* Compact recap: declaration → answer label */}
          <dl className="mt-3 divide-y divide-warm-border border border-warm-border rounded-lg overflow-hidden">
            {declarations.map((d) => (
              <div key={d.code} className="flex items-baseline justify-between gap-3 px-3 py-2 bg-linen/50">
                <dt className="text-[13px] text-muted leading-[1.4] min-w-0">{pick(d.question)}</dt>
                <dd className="text-[13px] font-medium text-night leading-[1.4] text-right flex-shrink-0 max-w-[45%] truncate">
                  {d.valueLabel ? pick(d.valueLabel) : d.value}
                </dd>
              </div>
            ))}
          </dl>

          {isAnswered ? (
            <p className="mt-3 text-[13px] text-muted flex items-center gap-2">
              <Check className="w-4 h-4 text-forest" /> {pick(COPY.signed)}
            </p>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAction(buildSignMedicalAction())}
              className="mt-4 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium rounded-[10px] px-6 py-3 hover:bg-sage transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-linen" /> : pick(COPY.sign)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
