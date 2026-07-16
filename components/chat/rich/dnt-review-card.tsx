'use client'

import { useState } from 'react'
import { ShieldCheck, Check, Loader2 } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for show_dnt_review (T7, clauses 5-6 of the questionnaire UX
 * standard): the auto-emitted completion card — a compact recap of every
 * session answer plus the TWO consent checkboxes and the Sign button. Both
 * checkboxes start UNCHECKED (GDPR requires affirmative action; pre-ticked
 * is void) and gate the button. The click posts a tokenless sign_dnt whose
 * consent object is MATERIAL — gui-actor commits are confirmed by
 * construction, so this ONE click is the only confirmation.
 */

export function buildSignDntAction(gdpr: boolean, aiDisclosure: boolean): UIAction | null {
  if (!gdpr || !aiDisclosure) return null
  return { type: 'sign_dnt', payload: { consent: { gdpr: true, aiDisclosure: true } } }
}

const COPY = {
  title: { ro: 'Verifică și semnează analiza de nevoi', en: 'Review and sign your needs analysis' },
  subtitle: {
    ro: 'Răspunsurile tale, pe scurt. Dacă totul este corect, bifează acordurile și semnează.',
    en: 'Your answers at a glance. If everything is correct, tick the consents and sign.',
  },
  gdpr: {
    ro: 'Sunt de acord cu prelucrarea datelor mele personale (GDPR) în scopul vânzării de asigurări.',
    en: 'I consent to the processing of my personal data (GDPR) for insurance sales.',
  },
  ai: {
    ro: 'Am înțeles că sunt asistat de un sistem AI în această conversație.',
    en: 'I acknowledge that I am assisted by an AI system in this conversation.',
  },
  sign: { ro: 'Semnează analiza', en: 'Sign the analysis' },
  signed: { ro: 'Analiza a fost semnată.', en: 'The analysis has been signed.' },
}

interface ReviewAnswer {
  code: string | null
  question: { en: string; ro: string }
  value: string
  valueLabel: { en: string; ro: string } | null
}

interface DntReviewCardProps {
  sessionId: string
  answers: ReviewAnswer[]
  progress: { answered: number; total: number }
  onAction: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function DntReviewCard({
  sessionId,
  answers,
  progress,
  onAction,
  language,
  isAnswered = false,
  isLoading = false,
}: DntReviewCardProps) {
  const [gdpr, setGdpr] = useState(false)
  const [aiDisclosure, setAiDisclosure] = useState(false)
  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const disabled = isAnswered || isLoading
  const action = buildSignDntAction(gdpr, aiDisclosure)

  const consentRow = (checked: boolean, toggle: () => void, label: string) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className="w-full flex items-start gap-3 text-left rounded-lg px-1 py-2 disabled:opacity-50"
    >
      <span
        className={`
          w-5 h-5 mt-0.5 rounded border-2 flex items-center justify-center flex-shrink-0
          ${checked ? 'border-forest bg-forest' : 'border-warm-border'}
        `}
      >
        {checked && <Check className="w-3 h-3 text-linen" />}
      </span>
      <span className="text-[13px] text-night leading-[1.5]">{label}</span>
    </button>
  )

  return (
    <div
      className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]"
      data-session-id={sessionId}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-night leading-[1.5]">{pick(COPY.title)}</p>
          <p className="text-[13px] text-muted leading-[1.5] mt-1">
            {pick(COPY.subtitle)} ({progress.answered}/{progress.total})
          </p>

          {/* Compact recap: question → answer label */}
          <dl className="mt-3 divide-y divide-warm-border border border-warm-border rounded-lg overflow-hidden">
            {answers.map((a, i) => (
              <div key={a.code ?? i} className="flex items-baseline justify-between gap-3 px-3 py-2 bg-linen/50">
                <dt className="text-[13px] text-muted leading-[1.4] min-w-0">{pick(a.question)}</dt>
                <dd className="text-[13px] font-medium text-night leading-[1.4] text-right flex-shrink-0 max-w-[45%] truncate">
                  {a.valueLabel ? pick(a.valueLabel) : a.value}
                </dd>
              </div>
            ))}
          </dl>

          {/* Consents: UNCHECKED by design — GDPR requires affirmative action */}
          <div className="mt-4 space-y-1">
            {consentRow(gdpr, () => setGdpr((v) => !v), pick(COPY.gdpr))}
            {consentRow(aiDisclosure, () => setAiDisclosure((v) => !v), pick(COPY.ai))}
          </div>

          {isAnswered ? (
            <p className="mt-3 text-[13px] text-muted flex items-center gap-2">
              <Check className="w-4 h-4 text-forest" /> {pick(COPY.signed)}
            </p>
          ) : (
            <button
              type="button"
              disabled={disabled || !action}
              onClick={() => action && onAction(action)}
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
