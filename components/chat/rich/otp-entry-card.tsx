'use client'

import { useState } from 'react'
import { ShieldCheck, Check, Loader2 } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'
import type { CardViewStatus } from '@/lib/chat/card-view'

/**
 * Consumer for show_otp_entry (T29): the 6-digit challenge from
 * start_channel_verification. Submit round-trips through the adapter to
 * confirm_channel_verification; the resend affordance re-issues the SAME
 * challenge with resend:true (the gateway's verificationResendEscape).
 *
 * Card truth (spec 2026-07-20 §2): rendering follows the derived viewStatus —
 * interactive as before; submitting locks everything; inert_expired disables
 * the code path but keeps RESEND enabled (an action is allowed from an
 * expired card); inert_resolved is fully inert with a truthful ✓.
 */

export function buildOtpSubmitAction(code: string, channel?: string): UIAction | null {
  if (!/^\d{6}$/.test(code)) return null
  // the channel rides along so the card-view submitting key is truthful
  // (otp:sms vs otp:email); the adapter only consumes `code`
  return { type: 'otp_submit', payload: { code, ...(channel ? { channel } : {}) } }
}

export function buildOtpResendAction(channel: string, target: string): UIAction {
  return { type: 'otp_resend', payload: { channel, target } }
}

const COPY = {
  title: { ro: 'Introdu codul de verificare', en: 'Enter the verification code' },
  sentTo: { ro: 'Cod trimis la', en: 'Code sent to' },
  sent: { ro: 'Ți-am trimis un cod de 6 cifre.', en: 'We sent you a 6-digit code.' },
  submit: { ro: 'Verifică', en: 'Verify' },
  resend: { ro: 'Retrimite codul', en: 'Resend the code' },
  expired: { ro: 'Codul a expirat', en: 'The code expired' },
  verified: { ro: 'Verificat', en: 'Verified' },
}

interface OtpEntryCardProps {
  channel: string
  targetMasked?: string
  target?: string
  onAction: (action: UIAction) => void
  language: Language
  /** Derived card truth (spec 2026-07-20 §2). */
  viewStatus?: CardViewStatus
  isLoading?: boolean
}

export function OtpEntryCard({
  channel,
  targetMasked,
  target,
  onAction,
  language,
  viewStatus = 'interactive',
  isLoading = false,
}: OtpEntryCardProps) {
  const [code, setCode] = useState('')
  const pick = (key: { ro: string; en: string }) => (language === 'ro' ? key.ro : key.en)
  const submitAction = buildOtpSubmitAction(code, channel)

  const submitting = viewStatus === 'submitting'
  const interactive = viewStatus === 'interactive'
  const expired = viewStatus === 'inert_expired'
  const resolved = viewStatus === 'inert_resolved'
  // code entry: only an interactive card accepts input
  const codeDisabled = !interactive || isLoading
  // resend: allowed from an interactive OR expired card (spec §2 — the
  // resend from an expired card is the recovery path), locked in flight
  const resendDisabled = !(interactive || expired) || isLoading

  /* ── Fully inert ✓ (challenge consumed / superseded) ── */
  if (resolved) {
    return (
      <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5 text-sage" />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-medium text-night leading-[1.5]">{pick(COPY.title)}</p>
            <div className="flex items-center gap-2 mt-2">
              <Check className="w-4 h-4 text-sage flex-shrink-0" />
              <span className="text-[15px] text-night">{pick(COPY.verified)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-soft-white border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-night leading-[1.5]">{pick(COPY.title)}</p>
          <p className="text-[13px] text-muted leading-[1.5] mt-1">
            {targetMasked ? `${pick(COPY.sentTo)} ${targetMasked}` : pick(COPY.sent)}
          </p>

          {expired && (
            <p className="text-[13px] text-error leading-[1.5] mt-2">{pick(COPY.expired)}</p>
          )}

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            disabled={codeDisabled}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="
              mt-3 w-full bg-soft-white border border-warm-border rounded-[10px]
              px-4 py-3 text-[18px] tracking-[0.4em] text-night font-sans text-center
              placeholder:text-muted placeholder:tracking-[0.4em]
              focus:outline-none focus:border-sage focus:shadow-[0_0_0_3px_rgba(45,107,82,0.1)]
              disabled:opacity-50
              transition-[border-color,box-shadow] duration-150
            "
            aria-label={pick(COPY.title)}
          />

          <button
            type="button"
            disabled={codeDisabled || !submitAction}
            onClick={() => submitAction && onAction(submitAction)}
            className="mt-3 w-full min-h-[44px] bg-forest text-linen text-[15px] font-medium rounded-[10px] px-6 py-3 hover:bg-sage transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {isLoading || submitting ? <Loader2 className="w-5 h-5 animate-spin text-linen" /> : pick(COPY.submit)}
          </button>

          {/* resend needs the raw target — cards persisted before T29 lack it */}
          {target ? (
            <button
              type="button"
              disabled={resendDisabled}
              onClick={() => onAction(buildOtpResendAction(channel, target))}
              className="mt-2 text-[13px] text-muted underline underline-offset-2 hover:text-night disabled:opacity-50"
            >
              {pick(COPY.resend)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
