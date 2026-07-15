'use client'

import { useState, useCallback } from 'react'
import { t, type Language } from '@/lib/i18n/translations'
import { resolvePaymentCardState } from '@/lib/payments/card-state'

/* ── Stripe imports (loaded dynamically) ─────────────── */

import { loadStripe, type Stripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'

/* ── Brand colors ────────────────────────────────────── */

const FOREST = '#1A3A2F'
const LINEN = '#F5EDE3'
const BORDER = '#E5E0D8'
const SAGE = '#2D6B52'
const ERROR_COLOR = '#8B2D2D'

/* ── Stripe appearance ───────────────────────────────── */

const zenoAppearance = {
  theme: 'flat' as const,
  variables: {
    colorPrimary: FOREST,
    colorBackground: '#FFFFFF',
    colorText: FOREST,
    colorDanger: ERROR_COLOR,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    borderRadius: '8px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: `1px solid ${BORDER}`,
      boxShadow: 'none',
    },
    '.Input:focus': {
      border: `1px solid ${SAGE}`,
      boxShadow: `0 0 0 1px ${SAGE}`,
    },
    '.Label': {
      color: FOREST,
      fontWeight: '500',
    },
  },
}

/* ── Lazy Stripe.js loading ──────────────────────────── */

let stripePromise: Promise<Stripe | null> | null = null

function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!key) {
      console.error('[PaymentCard] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set')
      return Promise.resolve(null)
    }
    stripePromise = loadStripe(key)
  }
  return stripePromise
}

/* ── Copy ────────────────────────────────────────────── */

const COPY = {
  ro: {
    payButton: (amount: string) => `Plătește ${amount} RON`,
    payuButton: 'Continuă la PayU',
    mockButton: 'Simulează plata',
    processing: 'Se procesează...',
    confirmed: 'Plata confirmată',
    errorGeneric: 'A apărut o eroare. Te rugăm să încerci din nou.',
    secureNote: 'Plata ta este securizată și criptată.',
    premiumLabel: 'Primă de plată',
    policyLabel: 'Polița',
  },
  en: {
    payButton: (amount: string) => `Pay ${amount} RON`,
    payuButton: 'Continue to PayU',
    mockButton: 'Simulate payment',
    processing: 'Processing...',
    confirmed: 'Payment confirmed',
    errorGeneric: 'An error occurred. Please try again.',
    secureNote: 'Your payment is secure and encrypted.',
    premiumLabel: 'Payment premium',
    policyLabel: 'Policy',
  },
}

/* ── Props ───────────────────────────────────────────── */

interface PaymentCardProps {
  clientSecret: string
  amount: number
  currency: string
  providerName: string
  paymentId: string
  policyDescription: string
  redirectUrl?: string | null
  /** D3.5 (M4): engine-determined session mode — keys the card's action
   *  label (payment_mode_* translations); codes only, localized here (M6). */
  mode?: 'started' | 'resumed' | 'retried'
  onPaymentComplete: (paymentId: string) => void
  language: Language
  isAnswered: boolean
}

/* ── Stripe Checkout Form (inner) ────────────────────── */

function StripeCheckoutForm({
  amount,
  paymentId,
  onPaymentComplete,
  language,
}: {
  amount: number
  paymentId: string
  onPaymentComplete: (paymentId: string) => void
  language: Language
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = COPY[language]

  const formattedAmount = amount.toLocaleString('ro-RO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!stripe || !elements) return

      setProcessing(true)
      setError(null)

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
      const returnUrl = `${appUrl}/api/payments/confirm?provider=stripe&paymentId=${paymentId}`

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl,
        },
        redirect: 'if_required',
      })

      if (result.error) {
        setError(result.error.message ?? c.errorGeneric)
        setProcessing(false)
      } else if (result.paymentIntent?.status === 'succeeded') {
        // Immediate success (no redirect needed)
        onPaymentComplete(paymentId)
      }
      // If redirect is needed, stripe handles it automatically
    },
    [stripe, elements, paymentId, onPaymentComplete, c.errorGeneric],
  )

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />

      {error && (
        <p
          className="mt-3 text-[14px]"
          style={{ color: ERROR_COLOR }}
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        className="mt-4 w-full py-3 px-6 rounded-lg font-medium text-[16px] transition-opacity disabled:opacity-50"
        style={{
          backgroundColor: FOREST,
          color: LINEN,
        }}
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner />
            {c.processing}
          </span>
        ) : (
          c.payButton(formattedAmount)
        )}
      </button>
    </form>
  )
}

/* ── Amount summary (module-level: not re-created per render) ── */

function AmountSummary({
  policyLabel, policyDescription, premiumLabel, modeLabel, formattedAmount, currency,
}: {
  policyLabel: string; policyDescription: string; premiumLabel: string
  modeLabel: string; formattedAmount: string; currency: string
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[14px]" style={{ color: '#8A8680' }}>{policyLabel}</span>
        <span className="text-[14px] font-medium" style={{ color: FOREST }}>{policyDescription}</span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-[14px]" style={{ color: '#8A8680' }}>{premiumLabel} · {modeLabel}</span>
        <span className="text-[20px] font-semibold" style={{ color: FOREST }}>{formattedAmount} {currency}</span>
      </div>
    </div>
  )
}

/* ── Loading Spinner ─────────────────────────────────── */

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

/* ── Main PaymentCard ────────────────────────────────── */

export function PaymentCard({
  clientSecret,
  amount,
  currency,
  providerName,
  paymentId,
  policyDescription,
  redirectUrl,
  mode = 'started',
  onPaymentComplete,
  language,
  isAnswered,
}: PaymentCardProps) {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = COPY[language]
  // D3.5 (M4/M6): the engine-determined session mode keys the card headline —
  // the engine emits codes only; localization lives here.
  const modeLabel = t(`payment_mode_${mode}`, language)

  // P1-5: one pure decision — never mount Stripe <Elements> with a null
  // clientSecret, nor leave a dead disabled PayU button.
  const cardState = resolvePaymentCardState({ isAnswered, providerName, clientSecret, redirectUrl: redirectUrl ?? null })

  const formattedAmount = amount.toLocaleString('ro-RO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

  // ─── Answered state (read-only) ────────────────────────
  if (cardState.kind === 'answered') {
    return (
      <div
        className="rounded-xl p-6 border"
        style={{ backgroundColor: `${SAGE}10`, borderColor: SAGE }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: SAGE }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 8.5L6.5 12L13 4"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <p className="font-medium text-[16px]" style={{ color: FOREST }}>
              {c.confirmed}
            </p>
            <p className="text-[14px]" style={{ color: SAGE }}>
              {formattedAmount} {currency}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Amount summary card ───────────────────────────────
  const amountSummary = (
    <AmountSummary
      policyLabel={c.policyLabel}
      policyDescription={policyDescription}
      premiumLabel={c.premiumLabel}
      modeLabel={modeLabel}
      formattedAmount={formattedAmount}
      currency={currency}
    />
  )

  // ─── Unavailable: no usable provider credential (P1-5) ──
  if (cardState.kind === 'unavailable') {
    return (
      <div
        className="rounded-xl p-6 border"
        style={{ borderColor: BORDER, backgroundColor: '#FFFFFF' }}
      >
        {amountSummary}
        <p className="text-[14px]" style={{ color: ERROR_COLOR }} role="alert">
          {c.errorGeneric}
        </p>
      </div>
    )
  }

  // ─── Stripe mode ───────────────────────────────────────
  if (cardState.kind === 'stripe_form') {
    return (
      <div
        className="rounded-xl p-6 border"
        style={{ borderColor: BORDER, backgroundColor: '#FFFFFF' }}
      >
        {amountSummary}

        <Elements
          stripe={getStripePromise()}
          options={{
            clientSecret: cardState.clientSecret,
            appearance: zenoAppearance,
          }}
        >
          <StripeCheckoutForm
            amount={amount}
            paymentId={paymentId}
            onPaymentComplete={onPaymentComplete}
            language={language}
          />
        </Elements>

        <p className="mt-3 text-center text-[12px]" style={{ color: '#8A8680' }}>
          {c.secureNote}
        </p>
      </div>
    )
  }

  // ─── PayU mode ─────────────────────────────────────────
  if (cardState.kind === 'payu_redirect') {
    const payuRedirectUrl = cardState.redirectUrl
    const handlePayURedirect = () => {
      window.location.href = payuRedirectUrl
    }

    return (
      <div
        className="rounded-xl p-6 border"
        style={{ borderColor: BORDER, backgroundColor: '#FFFFFF' }}
      >
        {amountSummary}

        <button
          onClick={handlePayURedirect}
          className="w-full py-3 px-6 rounded-lg font-medium text-[16px] border transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: 'transparent',
            color: FOREST,
            borderColor: FOREST,
          }}
        >
          {c.payuButton}
        </button>

        <p className="mt-3 text-center text-[12px]" style={{ color: '#8A8680' }}>
          {c.secureNote}
        </p>
      </div>
    )
  }

  // ─── Mock mode ─────────────────────────────────────────
  const handleMockPayment = async () => {
    setProcessing(true)
    setError(null)

    try {
      // Simulate 2-second processing delay
      await new Promise((resolve) => setTimeout(resolve, 2000))
      onPaymentComplete(paymentId)
    } catch {
      setError(c.errorGeneric)
      setProcessing(false)
    }
  }

  return (
    <div
      className="rounded-xl p-6 border"
      style={{ borderColor: BORDER, backgroundColor: '#FFFFFF' }}
    >
      {amountSummary}

      {error && (
        <p
          className="mb-3 text-[14px]"
          style={{ color: ERROR_COLOR }}
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        onClick={handleMockPayment}
        disabled={processing}
        className="w-full py-3 px-6 rounded-lg font-medium text-[16px] transition-opacity disabled:opacity-50"
        style={{
          backgroundColor: FOREST,
          color: LINEN,
        }}
      >
        {processing ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner />
            {c.processing}
          </span>
        ) : (
          c.mockButton
        )}
      </button>

      <p className="mt-3 text-center text-[12px]" style={{ color: '#8A8680' }}>
        {c.secureNote}
      </p>
    </div>
  )
}
