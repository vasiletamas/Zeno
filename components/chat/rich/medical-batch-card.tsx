'use client'

import { useState } from 'react'
import { Stethoscope, Check, Loader2 } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for show_medical_batch (T10, ruling: option c): the six BD_*
 * conditions on ONE card. The primary action — "Niciuna dintre acestea nu mi
 * se aplică" — posts every condition as "false" in one write_medical_batch
 * commit; per-condition Da/Nu toggles (default Nu) handle the exceptions and
 * arm the secondary "Continuă" button. gui-actor commits are confirmed by
 * construction, so one click answers everything; the SIGNED affirmation
 * stays the separate medical review card (sign_medical_declarations).
 */

export interface BatchCondition {
  code: string
  question: { en: string; ro: string }
  /** Server value where already answered (a revisit renders pre-toggled); null = unanswered. */
  value: 'true' | 'false' | null
}

/**
 * Pure card logic: every listed condition posts a value — overrides[code]
 * true → 'true', everything else defaults to 'false' ("none of these apply").
 */
export function buildMedicalBatchAction(
  conditions: { code: string }[],
  overrides: Record<string, boolean>,
): UIAction {
  const answers: Record<string, string> = {}
  for (const c of conditions) answers[c.code] = overrides[c.code] ? 'true' : 'false'
  return { type: 'medical_batch', payload: { answers } }
}

const COPY = {
  title: { ro: 'Declarații medicale', en: 'Medical declarations' },
  subtitle: {
    ro: 'Bifează doar afecțiunile care ți se aplică. Dacă niciuna nu ți se aplică, folosește butonul de mai jos.',
    en: 'Toggle only the conditions that apply to you. If none apply, use the button below.',
  },
  yes: { ro: 'Da', en: 'Yes' },
  no: { ro: 'Nu', en: 'No' },
  none: { ro: 'Niciuna dintre acestea nu mi se aplică', en: 'None of these apply to me' },
  continue: { ro: 'Continuă', en: 'Continue' },
  answered: { ro: 'Declarațiile au fost trimise.', en: 'The declarations have been submitted.' },
}

interface MedicalBatchCardProps {
  applicationId: string
  conditions: BatchCondition[]
  progress: { answered: number; total: number }
  onAction: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function MedicalBatchCard({
  applicationId,
  conditions,
  progress,
  onAction,
  language,
  isAnswered = false,
  isLoading = false,
}: MedicalBatchCardProps) {
  // toggles default Nu; an already-answered condition renders pre-toggled
  const [toggles, setToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(conditions.map((c) => [c.code, c.value === 'true'])),
  )
  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const disabled = isAnswered || isLoading
  const anyYes = conditions.some((c) => toggles[c.code])
  const progressPercent = progress.total > 0 ? Math.round((progress.answered / progress.total) * 100) : 0

  const toggleRow = (code: string, on: boolean) =>
    setToggles((prev) => ({ ...prev, [code]: on }))

  return (
    <div
      className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]"
      data-application-id={applicationId}
    >
      {/* Progress */}
      <div className="mb-4">
        <div className="h-1.5 rounded-full bg-warm-border overflow-hidden">
          <div className="h-full rounded-full bg-sage transition-[width] duration-300" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Stethoscope className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-night leading-[1.5]">{pick(COPY.title)}</p>
          <p className="text-[13px] text-muted leading-[1.5] mt-1">{pick(COPY.subtitle)}</p>

          {/* Condition rows: question + Da/Nu toggle (default Nu) */}
          <div className="mt-3 divide-y divide-warm-border border border-warm-border rounded-lg overflow-hidden">
            {conditions.map((c) => {
              const isYes = !!toggles[c.code]
              return (
                <div key={c.code} className="flex items-center justify-between gap-3 px-3 py-2 bg-linen/50">
                  <p className="text-[13px] text-night leading-[1.4] min-w-0">{pick(c.question)}</p>
                  <div className="flex gap-1 flex-shrink-0" role="group" aria-label={c.code}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={isYes}
                      onClick={() => toggleRow(c.code, true)}
                      className={`min-h-[32px] text-[13px] font-medium rounded-[8px] px-3 py-1 transition-colors duration-150 border disabled:pointer-events-none ${
                        isYes ? 'bg-terracotta/90 text-linen border-terracotta/90' : 'bg-transparent text-night border-warm-border hover:bg-linen'
                      }`}
                    >
                      {pick(COPY.yes)}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={!isYes}
                      onClick={() => toggleRow(c.code, false)}
                      className={`min-h-[32px] text-[13px] font-medium rounded-[8px] px-3 py-1 transition-colors duration-150 border disabled:pointer-events-none ${
                        !isYes ? 'bg-forest text-linen border-forest' : 'bg-transparent text-night border-warm-border hover:bg-linen'
                      }`}
                    >
                      {pick(COPY.no)}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {isAnswered ? (
            <p className="mt-3 text-[13px] text-muted flex items-center gap-2">
              <Check className="w-4 h-4 text-forest" /> {pick(COPY.answered)}
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {/* primary: all-No in one click */}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onAction(buildMedicalBatchAction(conditions, {}))}
                className="w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium rounded-[10px] px-6 py-3 hover:bg-sage transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-linen" /> : pick(COPY.none)}
              </button>
              {/* secondary: armed once any toggle says Da — posts the mixed values */}
              <button
                type="button"
                disabled={disabled || !anyYes}
                onClick={() => onAction(buildMedicalBatchAction(conditions, toggles))}
                className="w-full min-h-[44px] bg-transparent text-forest text-[15px] font-medium rounded-[10px] px-6 py-3 border border-warm-border hover:bg-linen transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {pick(COPY.continue)}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
