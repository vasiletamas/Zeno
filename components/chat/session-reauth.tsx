'use client'

/**
 * T26 (P5.2): the returning-account-holder gate on /chat. /api/session
 * answered {status:'reauth_required', maskedEmail} — whoever holds the
 * cookie must prove the account email again (OTP) or explicitly continue
 * without the account (fresh anonymous session). The request-building
 * helpers are pure and exported for node tests; the JSX shell stays thin.
 */
import { useState } from 'react'

export interface SessionInitResponse {
  customerId?: string
  isNew?: boolean
  status?: 'reauth_required'
  maskedEmail?: string
  /** T21: latest ACTIVE conversation on resume paths (null when none) */
  activeConversationId?: string | null
}

export const isReauthRequired = (
  r: SessionInitResponse,
): r is SessionInitResponse & { status: 'reauth_required'; maskedEmail: string } =>
  r.status === 'reauth_required'

const jsonInit = (body: unknown) => ({
  method: 'POST' as const,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const reauthStartRequest = () => ({ url: '/api/session/reauth/start', init: jsonInit({}) })
export const reauthConfirmRequest = (code: string) => ({ url: '/api/session/reauth/confirm', init: jsonInit({ code }) })
export const freshSessionRequest = () => ({ url: '/api/session', init: jsonInit({ fresh: true }) })

export function SessionReauth({
  maskedEmail,
  onAuthenticated,
  onContinueFresh,
}: {
  maskedEmail: string
  onAuthenticated: (customerId: string) => void
  onContinueFresh: () => void
}) {
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode() {
    setBusy(true)
    setError(null)
    const r = reauthStartRequest()
    await fetch(r.url, r.init).catch(() => null)
    setSent(true)
    setBusy(false)
  }

  async function confirmCode() {
    if (code.trim().length !== 6) {
      setError('Introdu codul de 6 cifre din email.')
      return
    }
    setBusy(true)
    setError(null)
    const r = reauthConfirmRequest(code.trim())
    const res = await fetch(r.url, r.init).catch(() => null)
    if (res?.ok) {
      const body = (await res.json()) as { customerId: string }
      onAuthenticated(body.customerId)
      return
    }
    const body = res ? ((await res.json().catch(() => ({}))) as { attemptsRemaining?: number }) : {}
    setError(
      typeof body.attemptsRemaining === 'number'
        ? `Codul nu este corect — mai ai ${body.attemptsRemaining} încercări.`
        : 'Codul nu a putut fi verificat — cere un cod nou.',
    )
    setBusy(false)
  }

  return (
    <div className="h-dvh flex items-center justify-center bg-soft-white px-4">
      <div className="w-full max-w-sm flex flex-col gap-4 text-center font-sans">
        <h1 className="text-lg font-semibold">Bine ai revenit</h1>
        <p className="text-sm text-muted">
          Această sesiune aparține contului <span className="font-medium">{maskedEmail}</span>. Pentru
          siguranță, confirmă că ești tu printr-un cod trimis pe email.
        </p>
        {!sent ? (
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className="rounded-lg bg-forest text-white py-2.5 text-sm font-medium disabled:opacity-50"
          >
            Trimite codul pe email
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="Codul din 6 cifre"
              className="rounded-lg border border-gray-300 px-3 py-2.5 text-center text-lg tracking-widest"
              aria-label="Cod de verificare"
            />
            <button
              type="button"
              onClick={confirmCode}
              disabled={busy}
              className="rounded-lg bg-forest text-white py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Confirmă
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={onContinueFresh}
          disabled={busy}
          className="text-sm text-muted underline underline-offset-2"
        >
          Continuă fără cont
        </button>
      </div>
    </div>
  )
}
