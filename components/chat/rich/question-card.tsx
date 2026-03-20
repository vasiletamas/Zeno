'use client'

import { useState, useCallback } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { t, type Language } from '@/lib/i18n/translations'

/* ── Types ────────────────────────────────────────── */

interface QuestionOption {
  value: string
  label: { en: string; ro: string }
}

interface ValidationRules {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

interface Question {
  id: string
  code: string | null
  text: { en: string; ro: string }
  helpText: { en: string; ro: string } | null
  type: string
  options: QuestionOption[] | null
  validationRules?: ValidationRules | null
}

interface Progress {
  answered: number
  total: number
}

interface QuestionCardProps {
  question: Question
  progress: Progress
  groupType: string
  onAnswer: (value: string | string[]) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
  /** The previously submitted answer, shown in answered state */
  answeredValue?: string | string[]
}

/* ── Helpers ──────────────────────────────────────── */

function loc(obj: { en: string; ro: string }, lang: Language): string {
  return lang === 'ro' ? obj.ro : obj.en
}

/* ── Sub-components ───────────────────────────────── */

function BooleanInput({
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  onAnswer: (v: string) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  const yesLabel = language === 'ro' ? 'Da' : 'Yes'
  const noLabel = language === 'ro' ? 'Nu' : 'No'

  const isYes = answeredValue === 'true' || answeredValue === 'da' || answeredValue === 'yes'
  const isNo = answeredValue === 'false' || answeredValue === 'nu' || answeredValue === 'no'

  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => onAnswer('true')}
        disabled={isAnswered || isLoading}
        className={`
          flex-1 min-h-[44px] text-[15px] font-medium rounded-[10px] px-4 py-3
          transition-colors duration-200
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          disabled:pointer-events-none
          ${isAnswered && isYes
            ? 'bg-forest text-linen'
            : isAnswered
              ? 'opacity-50 bg-transparent text-forest border border-warm-border'
              : 'bg-forest text-linen hover:bg-sage'
          }
        `}
      >
        {isLoading && isYes ? (
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        ) : (
          yesLabel
        )}
      </button>
      <button
        type="button"
        onClick={() => onAnswer('false')}
        disabled={isAnswered || isLoading}
        className={`
          flex-1 min-h-[44px] text-[15px] font-medium rounded-[10px] px-4 py-3
          transition-colors duration-200 border
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          disabled:pointer-events-none
          ${isAnswered && isNo
            ? 'bg-forest text-linen border-forest'
            : isAnswered
              ? 'opacity-50 bg-transparent text-forest border-warm-border'
              : 'bg-transparent text-forest border-warm-border hover:bg-linen'
          }
        `}
      >
        {isLoading && isNo ? (
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        ) : (
          noLabel
        )}
      </button>
    </div>
  )
}

function SingleSelectInput({
  options,
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  options: QuestionOption[]
  onAnswer: (v: string) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const selected = answeredValue === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onAnswer(opt.value)}
            disabled={isAnswered || isLoading}
            className={`
              w-full text-left border rounded-lg px-4 py-3 text-[15px]
              min-h-[44px] transition-colors duration-150
              focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
              disabled:pointer-events-none
              ${isAnswered && selected
                ? 'border-forest bg-forest/5 text-night'
                : isAnswered
                  ? 'border-warm-border text-muted opacity-50'
                  : 'border-warm-border text-night hover:border-forest hover:bg-forest/5'
              }
            `}
          >
            <span className="flex items-center gap-2">
              {isAnswered && selected && (
                <Check className="w-4 h-4 text-forest flex-shrink-0" />
              )}
              {isLoading && selected && (
                <Loader2 className="w-4 h-4 animate-spin text-forest flex-shrink-0" />
              )}
              {loc(opt.label, language)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function MultiSelectInput({
  options,
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  options: QuestionOption[]
  onAnswer: (v: string[]) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  const [selected, setSelected] = useState<string[]>(
    Array.isArray(answeredValue) ? answeredValue : []
  )

  const toggle = (val: string) => {
    setSelected((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    )
  }

  const answeredArr = Array.isArray(answeredValue) ? answeredValue : []

  return (
    <div>
      <div className="space-y-2">
        {options.map((opt) => {
          const isChecked = isAnswered
            ? answeredArr.includes(opt.value)
            : selected.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              disabled={isAnswered || isLoading}
              className={`
                w-full text-left border rounded-lg px-4 py-3 text-[15px]
                min-h-[44px] transition-colors duration-150
                focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
                disabled:pointer-events-none
                ${isChecked
                  ? 'border-forest bg-forest/5 text-night'
                  : isAnswered
                    ? 'border-warm-border text-muted opacity-50'
                    : 'border-warm-border text-night hover:border-forest hover:bg-forest/5'
                }
              `}
            >
              <span className="flex items-center gap-3">
                <span
                  className={`
                    w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0
                    ${isChecked ? 'border-forest bg-forest' : 'border-warm-border'}
                  `}
                >
                  {isChecked && <Check className="w-3 h-3 text-linen" />}
                </span>
                {loc(opt.label, language)}
              </span>
            </button>
          )
        })}
      </div>
      {!isAnswered && (
        <button
          type="button"
          onClick={() => onAnswer(selected)}
          disabled={isLoading || selected.length === 0}
          className="
            mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
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
            t('question_continue', language)
          )}
        </button>
      )}
    </div>
  )
}

function OpenEndedInput({
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  onAnswer: (v: string) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  const [value, setValue] = useState(
    typeof answeredValue === 'string' ? answeredValue : ''
  )

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) onAnswer(trimmed)
  }

  if (isAnswered) {
    return (
      <div className="text-[15px] text-muted bg-linen rounded-lg px-4 py-3">
        {typeof answeredValue === 'string' ? answeredValue : value}
      </div>
    )
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isLoading}
        rows={2}
        className="
          w-full bg-soft-white border border-warm-border rounded-[10px]
          px-4 py-3 text-[15px] text-night font-sans resize-none
          placeholder:text-muted
          focus:outline-none focus:border-sage focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          disabled:opacity-50
          transition-[border-color,box-shadow] duration-150
        "
        placeholder={t('question_type_placeholder', language)}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isLoading || !value.trim()}
        className="
          mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
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
          t('question_submit', language)
        )}
      </button>
    </div>
  )
}

function NumberInput({
  validationRules,
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  validationRules?: ValidationRules | null
  onAnswer: (v: string) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  const [value, setValue] = useState(
    typeof answeredValue === 'string' ? answeredValue : ''
  )

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (trimmed) onAnswer(trimmed)
  }

  if (isAnswered) {
    return (
      <div className="text-[15px] text-muted bg-linen rounded-lg px-4 py-3">
        {typeof answeredValue === 'string' ? answeredValue : value}
      </div>
    )
  }

  return (
    <div>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={isLoading}
        min={validationRules?.min}
        max={validationRules?.max}
        className="
          w-full bg-soft-white border border-warm-border rounded-[10px]
          px-4 py-3 text-[15px] text-night font-sans
          placeholder:text-muted
          focus:outline-none focus:border-sage focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          disabled:opacity-50
          transition-[border-color,box-shadow] duration-150
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
          [&::-webkit-inner-spin-button]:appearance-none
        "
        placeholder={t('question_number_placeholder', language)}
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isLoading || !value.trim()}
        className="
          mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
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
          t('question_submit', language)
        )}
      </button>
    </div>
  )
}

function DateInput({
  onAnswer,
  isAnswered,
  isLoading,
  answeredValue,
  language,
}: {
  onAnswer: (v: string) => void
  isAnswered: boolean
  isLoading: boolean
  answeredValue?: string | string[]
  language: Language
}) {
  const now = new Date()
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')

  const monthNames: Record<Language, string[]> = {
    ro: ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
         'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'],
    en: ['January', 'February', 'March', 'April', 'May', 'June',
         'July', 'August', 'September', 'October', 'November', 'December'],
  }

  const years = Array.from({ length: 80 }, (_, i) => now.getFullYear() - 18 - i)

  const handleSubmit = () => {
    if (day && month && year) {
      const paddedDay = day.padStart(2, '0')
      const paddedMonth = month.padStart(2, '0')
      onAnswer(`${year}-${paddedMonth}-${paddedDay}`)
    }
  }

  if (isAnswered && typeof answeredValue === 'string') {
    const date = new Date(answeredValue)
    const formatted = new Intl.DateTimeFormat(language === 'ro' ? 'ro-RO' : 'en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date)
    return (
      <div className="text-[15px] text-muted bg-linen rounded-lg px-4 py-3">
        {formatted}
      </div>
    )
  }

  const selectClasses = `
    flex-1 min-h-[44px] bg-soft-white border border-warm-border rounded-[10px]
    px-3 py-3 text-[15px] text-night font-sans
    focus:outline-none focus:border-sage focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
    disabled:opacity-50
    transition-[border-color,box-shadow] duration-150
  `

  return (
    <div>
      <div className="flex gap-2">
        {/* Day */}
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          disabled={isLoading}
          className={selectClasses}
          aria-label={language === 'ro' ? 'Zi' : 'Day'}
        >
          <option value="">{language === 'ro' ? 'Zi' : 'Day'}</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={String(d)}>
              {d}
            </option>
          ))}
        </select>

        {/* Month */}
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          disabled={isLoading}
          className={selectClasses}
          aria-label={language === 'ro' ? 'Luna' : 'Month'}
        >
          <option value="">{language === 'ro' ? 'Luna' : 'Month'}</option>
          {monthNames[language].map((name, idx) => (
            <option key={idx} value={String(idx + 1)}>
              {name}
            </option>
          ))}
        </select>

        {/* Year */}
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          disabled={isLoading}
          className={selectClasses}
          aria-label={language === 'ro' ? 'An' : 'Year'}
        >
          <option value="">{language === 'ro' ? 'An' : 'Year'}</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isLoading || !day || !month || !year}
        className="
          mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
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
          t('question_submit', language)
        )}
      </button>
    </div>
  )
}

/* ── Main component ───────────────────────────────── */

export function QuestionCard({
  question,
  progress,
  groupType,
  onAnswer,
  language,
  isAnswered = false,
  isLoading = false,
  answeredValue,
}: QuestionCardProps) {
  const progressPercent =
    progress.total > 0 ? Math.round((progress.answered / progress.total) * 100) : 0

  const handleAnswer = useCallback(
    (value: string | string[]) => {
      onAnswer(value)
    },
    [onAnswer]
  )

  const handleStringAnswer = useCallback(
    (value: string) => {
      handleAnswer(value)
    },
    [handleAnswer]
  )

  const handleArrayAnswer = useCallback(
    (value: string[]) => {
      handleAnswer(value)
    },
    [handleAnswer]
  )

  const renderInput = () => {
    switch (question.type) {
      case 'BOOLEAN':
        return (
          <BooleanInput
            onAnswer={handleStringAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      case 'DROPDOWN':
      case 'MULTIPLE_CHOICE':
        return (
          <SingleSelectInput
            options={question.options ?? []}
            onAnswer={handleStringAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      case 'MULTI_SELECT':
        return (
          <MultiSelectInput
            options={question.options ?? []}
            onAnswer={handleArrayAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      case 'OPEN_ENDED':
        return (
          <OpenEndedInput
            onAnswer={handleStringAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      case 'NUMBER':
        return (
          <NumberInput
            validationRules={question.validationRules}
            onAnswer={handleStringAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      case 'DATE':
        return (
          <DateInput
            onAnswer={handleStringAnswer}
            isAnswered={isAnswered}
            isLoading={isLoading}
            answeredValue={answeredValue}
            language={language}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_200ms_ease-out]"
      data-question-id={question.id}
      data-group-type={groupType}
    >
      {/* Progress */}
      <div className="mb-4">
        <p className="text-xs text-muted mb-1.5">
          {t('question_progress', language)
            .replace('{answered}', String(progress.answered))
            .replace('{total}', String(progress.total))}
        </p>
        <div className="h-1.5 rounded-full bg-warm-border overflow-hidden">
          <div
            className="h-full rounded-full bg-sage transition-[width] duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Question text */}
      <p className="text-[15px] text-night leading-[1.5]">
        {loc(question.text, language)}
      </p>

      {/* Help text */}
      {question.helpText && (
        <p className="text-[13px] text-muted mt-1 leading-[1.5]">
          {loc(question.helpText, language)}
        </p>
      )}

      {/* Input area */}
      <div className="mt-4">{renderInput()}</div>
    </div>
  )
}
