'use client'

import { useState, useMemo } from 'react'
import { Check, AlertCircle, Loader2 } from 'lucide-react'
import { t, type Language } from '@/lib/i18n/translations'
import type { CardViewStatus } from '@/lib/chat/card-view'

interface Validation {
  pattern?: string
  minLength?: number
  maxLength?: number
}

interface InlineDataFormProps {
  field: string
  label: { en: string; ro: string }
  type: 'text' | 'email' | 'tel' | 'date' | 'textarea'
  validation?: Validation
  placeholder?: { en: string; ro: string }
  onSubmit: (value: string) => void
  language: Language
  /** Derived card truth (spec 2026-07-20 §2): interactive | submitting |
   *  inert_resolved | inert_expired | inert_released. The ✓ renders ONLY
   *  with a locally-typed value — never a fake empty-✓. */
  viewStatus?: CardViewStatus
  isLoading?: boolean
}

/* ── State copy (server derives status; the card localizes) ── */

const STATE_COPY = {
  submitting: { ro: 'Se trimite…', en: 'Submitting…' },
  noLongerNeeded: { ro: 'Nu mai este necesar', en: 'No longer needed' },
  released: { ro: 'Amânat la cererea ta', en: 'Deferred at your request' },
}

/* ── Built-in validation patterns ─────────────────── */

const BUILTIN_PATTERNS: Record<string, { pattern: RegExp; errorKey: string }> = {
  cnp: { pattern: /^[1-9]\d{12}$/, errorKey: 'data_form_cnp_error' },
  email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, errorKey: 'data_form_email_error' },
  phone: { pattern: /^(\+?40|0)[0-9]{9}$/, errorKey: 'data_form_phone_error' },
}

function DateFieldInput({
  onSubmit,
  isLoading,
  language,
}: {
  onSubmit: (v: string) => void
  isLoading: boolean
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
      onSubmit(`${year}-${paddedMonth}-${paddedDay}`)
    }
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
          t('data_form_save', language)
        )}
      </button>
    </div>
  )
}

export function InlineDataForm({
  field,
  label,
  type,
  validation,
  placeholder,
  onSubmit,
  language,
  viewStatus = 'interactive',
  isLoading = false,
}: InlineDataFormProps) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)

  const labelText = language === 'ro' ? label.ro : label.en
  const placeholderText = placeholder
    ? language === 'ro' ? placeholder.ro : placeholder.en
    : ''

  /* ── Validation ──────────────────────────────────── */

  const validationResult = useMemo(() => {
    if (!value.trim()) return { valid: false, error: null }

    // Check built-in pattern for known fields
    const builtin = BUILTIN_PATTERNS[field]
    if (builtin && !builtin.pattern.test(value.trim())) {
      return { valid: false, error: t(builtin.errorKey, language) }
    }

    // Check custom pattern from props
    if (validation?.pattern) {
      const regex = new RegExp(validation.pattern)
      if (!regex.test(value.trim())) {
        return { valid: false, error: t('data_form_invalid', language) }
      }
    }

    // Check length constraints
    if (validation?.minLength && value.trim().length < validation.minLength) {
      return {
        valid: false,
        error: t('data_form_too_short', language).replace(
          '{min}',
          String(validation.minLength)
        ),
      }
    }
    if (validation?.maxLength && value.trim().length > validation.maxLength) {
      return {
        valid: false,
        error: t('data_form_too_long', language).replace(
          '{max}',
          String(validation.maxLength)
        ),
      }
    }

    return { valid: true, error: null }
  }, [value, field, validation, language])

  const handleSubmit = () => {
    setTouched(true)
    if (validationResult.valid) {
      onSubmit(value.trim())
    }
  }

  /* ── Inert states (derived truth — spec 2026-07-20 §2) ── */

  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)

  if (viewStatus === 'inert_released') {
    return (
      <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <label className="text-[13px] font-medium text-muted block mb-1">
          {labelText}
        </label>
        <span className="text-[14px] text-muted">{pick(STATE_COPY.released)}</span>
      </div>
    )
  }

  if (viewStatus === 'inert_resolved' || viewStatus === 'inert_expired') {
    // ✓ ONLY beside the value this session actually typed — a resolved card
    // with no local value renders "no longer needed" (kills the fake-✓).
    if (value.trim()) {
      return (
        <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
          <label className="text-[13px] font-medium text-muted block mb-1">
            {labelText}
          </label>
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-sage flex-shrink-0" />
            <span className="text-[15px] text-night">{value}</span>
          </div>
        </div>
      )
    }
    return (
      <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <label className="text-[13px] font-medium text-muted block mb-1">
          {labelText}
        </label>
        <span className="text-[14px] text-muted">{pick(STATE_COPY.noLongerNeeded)}</span>
      </div>
    )
  }

  const submitting = viewStatus === 'submitting'
  const disabled = isLoading || submitting

  /* ── Date type ───────────────────────────────────── */

  if (type === 'date') {
    return (
      <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <label className="text-[13px] font-medium text-night block mb-3">
          {labelText}
        </label>
        <DateFieldInput onSubmit={onSubmit} isLoading={disabled} language={language} />
      </div>
    )
  }

  /* ── Active / submitting state ───────────────────── */

  const showError = touched && validationResult.error
  const showValid = touched && validationResult.valid && value.trim()
  const InputTag = type === 'textarea' ? 'textarea' : 'input'

  return (
    <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <label className="text-[13px] font-medium text-night block mb-3">
        {labelText}
      </label>

      <div className="relative">
        <InputTag
          type={type === 'textarea' ? undefined : type}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (!touched) setTouched(true)
          }}
          disabled={disabled}
          placeholder={placeholderText}
          maxLength={validation?.maxLength}
          {...(type === 'textarea' ? { rows: 3 } : {})}
          className={`
            w-full bg-soft-white border rounded-[10px]
            px-4 py-3 text-[15px] text-night font-sans
            placeholder:text-muted
            focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
            disabled:opacity-50
            transition-[border-color,box-shadow] duration-150
            ${type === 'textarea' ? 'resize-none' : ''}
            ${showError ? 'border-error focus:border-error' : 'border-warm-border focus:border-sage'}
          `}
          aria-label={labelText}
          aria-invalid={showError ? true : undefined}
        />

        {/* Inline validation indicator */}
        {showValid && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Check className="w-5 h-5 text-sage" />
          </div>
        )}
      </div>

      {/* Validation feedback */}
      {showError && (
        <div className="flex items-center gap-1.5 mt-2">
          <AlertCircle className="w-4 h-4 text-error flex-shrink-0" />
          <span className="text-[13px] text-error">{validationResult.error}</span>
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="
          mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium
          rounded-[10px] px-6 py-3
          hover:bg-sage transition-colors duration-200
          disabled:opacity-50 disabled:pointer-events-none
          focus:outline-none focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
          flex items-center justify-center gap-2
        "
      >
        {submitting ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin text-linen" />
            <span>{pick(STATE_COPY.submitting)}</span>
          </>
        ) : isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-linen" />
        ) : (
          t('data_form_save', language)
        )}
      </button>
    </div>
  )
}
