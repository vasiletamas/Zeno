'use client'

import { ShieldCheck } from 'lucide-react'
import type { Language } from '@/lib/i18n/translations'
import type { UIAction } from '@/lib/chat/action-adapter'

/**
 * Consumer for the gateway's confirm_required ui_action (A3 erratum 5 / M4):
 * the GUI renders this dialog on the first click of a confirmable commit and
 * the confirm button round-trips the SAME commit with the gateway-issued
 * token — buttons never self-confirm.
 */

export const CONFIRMABLE_TOOLS = ['sign_dnt', 'accept_quote'] as const

const COPY: Record<(typeof CONFIRMABLE_TOOLS)[number], { title: { ro: string; en: string }; body: { ro: string; en: string }; cta: { ro: string; en: string } }> = {
  sign_dnt: {
    title: { ro: 'Confirmă semnarea', en: 'Confirm signing' },
    body: { ro: 'Semnezi analiza de nevoi (DNT)? Semnătura confirmă că răspunsurile îți aparțin și include acordul tău pentru prelucrarea datelor (GDPR) și confirmarea că ai înțeles că ești asistat de un sistem AI.', en: 'Sign the demands-and-needs analysis (DNT)? Your signature confirms the answers are yours and includes your consent to data processing (GDPR) and your acknowledgment of the AI-assistance disclosure.' },
    cta: { ro: 'Semnează și îmi dau acordul', en: 'Sign and consent' },
  },
  accept_quote: {
    title: { ro: 'Confirmă acceptarea ofertei', en: 'Confirm quote acceptance' },
    body: { ro: 'Accepți această ofertă? După acceptare trecem la emiterea poliței.', en: 'Accept this quote? After acceptance we proceed to policy issuance.' },
    cta: { ro: 'Accept oferta', en: 'Accept quote' },
  },
}

export function buildConfirmAction(tool: string, confirmToken: string): UIAction | null {
  if (!(CONFIRMABLE_TOOLS as readonly string[]).includes(tool)) return null
  // sign_dnt: clicking the consent-labelled CTA IS the explicit grant (B1.5) —
  // the consent object is material, so it must match the original call's args.
  if (tool === 'sign_dnt') return { type: tool, payload: { confirmToken, consent: { gdpr: true, aiDisclosure: true } } }
  return { type: tool, payload: { confirmToken } }
}

interface ConfirmRequiredCardProps {
  tool: string
  confirmToken: string
  onConfirm: (action: UIAction) => void
  language: Language
  isAnswered?: boolean
  isLoading?: boolean
}

export function ConfirmRequiredCard({
  tool,
  confirmToken,
  onConfirm,
  language,
  isAnswered = false,
  isLoading = false,
}: ConfirmRequiredCardProps) {
  const copy = COPY[tool as (typeof CONFIRMABLE_TOOLS)[number]]
  if (!copy) return null
  const action = buildConfirmAction(tool, confirmToken)

  return (
    <div className="bg-linen border border-warm-border rounded-xl p-5 animate-[message-appear_300ms_ease-out]">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ShieldCheck className="w-5 h-5 text-sage" />
        </div>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-night leading-[1.5]">
            {language === 'ro' ? copy.title.ro : copy.title.en}
          </p>
          <p className="text-[14px] text-night/70 leading-[1.5] mt-1">
            {language === 'ro' ? copy.body.ro : copy.body.en}
          </p>
          <button
            type="button"
            disabled={isAnswered || isLoading || !action}
            onClick={() => action && onConfirm(action)}
            className="mt-3 px-4 py-2 rounded-lg bg-sage text-white text-[14px] font-medium disabled:opacity-50"
          >
            {language === 'ro' ? copy.cta.ro : copy.cta.en}
          </button>
        </div>
      </div>
    </div>
  )
}
